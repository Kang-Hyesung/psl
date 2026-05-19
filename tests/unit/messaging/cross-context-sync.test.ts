import { describe, expect, it } from 'vitest';

import { createHideListSyncBackgroundService } from '../../../src/background/hide-list-sync-service';
import { createHideListSyncClient } from '../../../src/shared/hide-list-sync-client';
import { LocalStorageRepository } from '../../../src/storage/local-storage-repository';
import type { RuntimeMessageListener, RuntimeMessagePort } from '../../../src/shared/runtime-message-port';
import type { StorageDriver } from '../../../src/storage/storage-driver';

class InMemoryStorageDriver implements StorageDriver {
  private readonly store = new Map<string, unknown>();

  public async getItem(key: string): Promise<unknown> {
    return this.store.get(key);
  }

  public async setItem(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }

  public async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  public async clear(): Promise<void> {
    this.store.clear();
  }
}

class FakeRuntimePort implements RuntimeMessagePort {
  private readonly listeners = new Set<RuntimeMessageListener>();
  public stateSyncCallbackCount = 0;
  public returnRejectedStateSyncPromise = false;
  public stateSyncRejectedPromiseCatchCount = 0;

  public readonly onMessage = {
    addListener: (listener: RuntimeMessageListener): void => {
      this.listeners.add(listener);
    },
    removeListener: (listener: RuntimeMessageListener): void => {
      this.listeners.delete(listener);
    }
  };

  public sendMessage(message: unknown, responseCallback?: (response?: unknown) => void): unknown {
    const isStateSyncMessage =
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      (message as { type?: unknown }).type === 'hide-list/state-sync';

    if (isStateSyncMessage && responseCallback) {
      this.stateSyncCallbackCount += 1;
    }

    let responseSent = false;

    const sendResponse = (response?: unknown): void => {
      if (responseSent) {
        return;
      }

      responseSent = true;
      responseCallback?.(response);
    };

    for (const listener of Array.from(this.listeners)) {
      try {
        listener(message, { id: 'fake-runtime' }, sendResponse);
      } catch {
        // No-op for test harness parity with extension runtime safety.
      }
    }

    if (isStateSyncMessage && this.returnRejectedStateSyncPromise) {
      return {
        catch: () => {
          this.stateSyncRejectedPromiseCatchCount += 1;
        }
      };
    }

    return undefined;
  }
}

describe('Task 9 cross-context sync messaging', () => {
  it('propagates popup mutation updates to options/content via typed sync messages', async () => {
    const runtime = new FakeRuntimePort();
    const repository = new LocalStorageRepository(new InMemoryStorageDriver());
    const service = createHideListSyncBackgroundService({
      runtime,
      repository
    });
    const stopService = service.start();

    const popupClient = createHideListSyncClient({
      source: 'popup',
      runtime,
      requestTimeoutMs: 50
    });
    const optionsClient = createHideListSyncClient({
      source: 'options',
      runtime,
      requestTimeoutMs: 50
    });
    const contentClient = createHideListSyncClient({
      source: 'content',
      runtime,
      requestTimeoutMs: 50
    });

    const optionsSyncRevisions: number[] = [];
    const contentSyncRevisions: number[] = [];
    const unsubscribeOptions = optionsClient.subscribeToSync((message) => {
      optionsSyncRevisions.push(message.state.revision);
    });
    const unsubscribeContent = contentClient.subscribeToSync((message) => {
      contentSyncRevisions.push(message.state.revision);
    });

    const mutationResult = await popupClient.mutateHiddenKey('add', 'S000123456789', {
      requestId: 'popup-add-1',
      issuedAtMs: 100
    });

    expect(mutationResult?.result).toBe('applied');
    expect(mutationResult?.state.hiddenKeys).toEqual(['S000123456789']);
    expect(optionsSyncRevisions).toEqual([1]);
    expect(contentSyncRevisions).toEqual([1]);
    expect(runtime.stateSyncCallbackCount).toBe(1);

    await expect(
      optionsClient.requestSnapshot({
        requestId: 'options-snapshot-1'
      })
    ).resolves.toEqual({
      revision: 1,
      hiddenKeys: ['S000123456789']
    });

    unsubscribeContent();
    unsubscribeOptions();
    stopService();
  });

  it('attaches a callback to background sync broadcasts to avoid unhandled no-receiver rejections', async () => {
    const runtime = new FakeRuntimePort();
    runtime.returnRejectedStateSyncPromise = true;
    const repository = new LocalStorageRepository(new InMemoryStorageDriver());
    const service = createHideListSyncBackgroundService({
      runtime,
      repository
    });
    const stopService = service.start();

    const popupClient = createHideListSyncClient({
      source: 'popup',
      runtime,
      requestTimeoutMs: 50
    });

    await popupClient.mutateHiddenKey('add', 'S000123456789', {
      requestId: 'popup-add-with-broadcast-callback',
      issuedAtMs: 100
    });

    expect(runtime.stateSyncCallbackCount).toBe(1);
    expect(runtime.stateSyncRejectedPromiseCatchCount).toBe(1);

    stopService();
  });

  it('handles concurrent add/remove conflict with deterministic last-write-wins', async () => {
    const runtime = new FakeRuntimePort();
    const repository = new LocalStorageRepository(new InMemoryStorageDriver());
    const service = createHideListSyncBackgroundService({
      runtime,
      repository
    });
    const stopService = service.start();

    const popupClient = createHideListSyncClient({
      source: 'popup',
      runtime,
      requestTimeoutMs: 50
    });
    const optionsClient = createHideListSyncClient({
      source: 'options',
      runtime,
      requestTimeoutMs: 50
    });

    const hiddenKey = 'S000987654321';

    await popupClient.mutateHiddenKey('add', hiddenKey, {
      requestId: 'prime-add',
      issuedAtMs: 100
    });

    const removePromise = optionsClient.mutateHiddenKey('remove', hiddenKey, {
      requestId: 'remove-newer',
      issuedAtMs: 300
    });
    const addPromise = popupClient.mutateHiddenKey('add', hiddenKey, {
      requestId: 'add-older',
      issuedAtMs: 200
    });

    const [removeResult, addResult] = await Promise.all([removePromise, addPromise]);

    expect(removeResult?.result).toBe('applied');
    expect(addResult?.result).toBe('ignored');
    expect(addResult?.ignoredReason).toBe('stale');

    await expect(
      popupClient.requestSnapshot({
        requestId: 'final-snapshot'
      })
    ).resolves.toEqual({
      revision: 2,
      hiddenKeys: []
    });

    stopService();
  });

  it('ignores malformed runtime messages without throwing', () => {
    const runtime = new FakeRuntimePort();
    const client = createHideListSyncClient({
      source: 'content',
      runtime,
      requestTimeoutMs: 50
    });

    const unsubscribe = client.subscribeToSync(() => {
      throw new Error('sync callback should not run for malformed payloads');
    });

    expect(() => {
      runtime.sendMessage({
        type: 'hide-list/state-sync',
        source: 'background',
        requestId: 'broken',
        trigger: 'mutation',
        state: {
          revision: 'not-a-number',
          hiddenKeys: [42]
        }
      });
    }).not.toThrow();

    unsubscribe();
  });
});
