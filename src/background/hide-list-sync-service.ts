import {
  compareMutationClocks,
  createHideListMutationResultMessage,
  createHideListSnapshotResultMessage,
  createHideListStateSyncMessage,
  parseHideListBackgroundInboundMessage,
  sanitizeHiddenKey,
  type HideListBackgroundInboundMessage,
  type HideListIgnoredMutationReason,
  type HideListMutationClock,
  type HideListMutationRequestMessage,
  type HideListStateSnapshot
} from '../shared/hide-list-messaging';
import type { RuntimeMessageListener, RuntimeMessagePort } from '../shared/runtime-message-port';

export interface HideListMutationRepository {
  list(): Promise<string[]>;
  add(hiddenKey: string): Promise<string[]>;
  remove(hiddenKey: string): Promise<string[]>;
}

export interface CreateHideListSyncBackgroundServiceInput {
  runtime: RuntimeMessagePort;
  repository: HideListMutationRepository;
}

export interface HideListSyncBackgroundService {
  start(): () => void;
}

function dedupeHiddenKeys(hiddenKeys: readonly string[]): string[] {
  const deduped: string[] = [];

  for (const hiddenKey of hiddenKeys) {
    if (!deduped.includes(hiddenKey)) {
      deduped.push(hiddenKey);
    }
  }

  return deduped;
}

function consumeRuntimeLastError(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.lastError) {
    return;
  }

  void chrome.runtime.lastError.message;
}

function suppressSendMessageRejection(sendResult: unknown): void {
  if (!sendResult || (typeof sendResult !== 'object' && typeof sendResult !== 'function')) {
    return;
  }

  const maybeCatch = (sendResult as { catch?: unknown }).catch;

  if (typeof maybeCatch !== 'function') {
    return;
  }

  try {
    void maybeCatch.call(sendResult, () => {
      // No-op: no receiving content script is a valid broadcast outcome.
    });
  } catch {
    // No-op: defensive handling for non-standard thenables.
  }
}

export function createHideListSyncBackgroundService(
  input: CreateHideListSyncBackgroundServiceInput
): HideListSyncBackgroundService {
  let revision = 0;
  let processingChain: Promise<void> = Promise.resolve();
  const latestMutationClockByKey = new Map<string, HideListMutationClock>();

  const readSnapshot = async (): Promise<HideListStateSnapshot> => {
    try {
      const hiddenKeys = await input.repository.list();

      return {
        revision,
        hiddenKeys: dedupeHiddenKeys(hiddenKeys)
      };
    } catch {
      return {
        revision,
        hiddenKeys: []
      };
    }
  };

  const broadcastState = (requestId: string, state: HideListStateSnapshot, trigger: 'mutation' | 'snapshot'): void => {
    try {
      const sendResult = input.runtime.sendMessage(
        createHideListStateSyncMessage({
          requestId,
          state,
          trigger
        }),
        consumeRuntimeLastError
      );
      suppressSendMessageRejection(sendResult);
    } catch {
      // No-op: broadcast failures must not crash service worker.
    }
  };

  const handleMutationRequest = async (
    request: HideListMutationRequestMessage
  ): Promise<ReturnType<typeof createHideListMutationResultMessage>> => {
    const normalizedHiddenKey = sanitizeHiddenKey(request.mutation.hiddenKey);

    if (!normalizedHiddenKey) {
      return createHideListMutationResultMessage({
        requestId: request.requestId,
        state: await readSnapshot(),
        result: 'ignored',
        ignoredReason: 'invalid_hidden_key'
      });
    }

    const mutationClock: HideListMutationClock = {
      issuedAtMs: request.mutation.issuedAtMs,
      requestId: request.requestId,
      source: request.source
    };
    const previousClock = latestMutationClockByKey.get(normalizedHiddenKey);

    if (previousClock && compareMutationClocks(mutationClock, previousClock) <= 0) {
      return createHideListMutationResultMessage({
        requestId: request.requestId,
        state: await readSnapshot(),
        result: 'ignored',
        ignoredReason: 'stale'
      });
    }

    let writeFailure: HideListIgnoredMutationReason | null = null;

    try {
      if (request.mutation.operation === 'add') {
        await input.repository.add(normalizedHiddenKey);
      } else {
        await input.repository.remove(normalizedHiddenKey);
      }
    } catch {
      writeFailure = 'write_failed';
    }

    if (writeFailure) {
      return createHideListMutationResultMessage({
        requestId: request.requestId,
        state: await readSnapshot(),
        result: 'ignored',
        ignoredReason: writeFailure
      });
    }

    latestMutationClockByKey.set(normalizedHiddenKey, mutationClock);
    revision += 1;

    const nextState = await readSnapshot();
    broadcastState(request.requestId, nextState, 'mutation');

    return createHideListMutationResultMessage({
      requestId: request.requestId,
      state: nextState,
      result: 'applied'
    });
  };

  const handleRequest = async (request: HideListBackgroundInboundMessage): Promise<unknown> => {
    if (request.type === 'hide-list/snapshot-request') {
      const state = await readSnapshot();

      return createHideListSnapshotResultMessage({
        requestId: request.requestId,
        state
      });
    }

    return handleMutationRequest(request);
  };

  return {
    start(): () => void {
      const listener: RuntimeMessageListener = (rawMessage, _sender, sendResponse) => {
        const request = parseHideListBackgroundInboundMessage(rawMessage);

        if (!request) {
          return false;
        }

        processingChain = processingChain
          .then(async () => {
            const response = await handleRequest(request);

            try {
              sendResponse(response);
            } catch {
              // No-op safety for closed channels.
            }
          })
          .catch(() => {
            // Keep queue alive after unexpected handler failures.
          });

        return true;
      };

      input.runtime.onMessage.addListener(listener);

      return () => {
        input.runtime.onMessage.removeListener(listener);
      };
    }
  };
}
