import { afterEach, describe, expect, it, vi } from 'vitest';

import { KyoboAdapter } from '../../../src/adapters/kyobo-adapter';
import {
  createMutationObserverEventSource,
  createWindowEventSource,
  hasRelevantCardAddition,
  startDynamicReapplyFlow,
  type ReapplyEventSource
} from '../../../src/content/dynamic-reapply';
import { type RuntimeCard } from '../../../src/content/runtime';
import { HIDDEN_KEYS_SCHEMA_VERSION, LocalStorageRepository } from '../../../src/storage/local-storage-repository';
import type { StorageDriver } from '../../../src/storage/storage-driver';

class InMemoryStorageDriver implements StorageDriver {
  private readonly store = new Map<string, unknown>();

  public constructor(initialEntries: Record<string, unknown> = {}) {
    for (const key of Object.keys(initialEntries)) {
      this.store.set(key, initialEntries[key]);
    }
  }

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

class FakeRuntimeCard implements RuntimeCard {
  public readonly adapterCard: { html: string; attributes: Record<string, string> };

  public injectionCount = 0;

  public hidden = false;

  private hasButton = false;

  public constructor(attributes: Record<string, string>, html: string) {
    this.adapterCard = {
      html,
      attributes
    };
  }

  public hasHideButton(): boolean {
    return this.hasButton;
  }

  public injectHideButton(_onClick: () => Promise<void> | void): void {
    this.hasButton = true;
    this.injectionCount += 1;
  }

  public hide(): void {
    this.hidden = true;
  }

  public show(): void {
    this.hidden = false;
  }
}

class ManualEventSource implements ReapplyEventSource {
  private readonly listeners = new Set<() => void>();

  public subscribe(onSignal: () => void): () => void {
    this.listeners.add(onSignal);

    return () => {
      this.listeners.delete(onSignal);
    };
  }

  public emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

class DeferredRepository extends LocalStorageRepository {
  private readonly pendingResolvers: Array<() => void> = [];

  public listCallCount = 0;

  public async list(): Promise<string[]> {
    this.listCallCount += 1;

    await new Promise<void>((resolve) => {
      this.pendingResolvers.push(resolve);
    });

    return super.list();
  }

  public resolveNextListCall(): void {
    const resolve = this.pendingResolvers.shift();

    if (resolve) {
      resolve();
    }
  }
}

class FakeWindowEventTarget {
  private readonly listeners = new Map<string, Set<() => void>>();

  public addEventListener(eventName: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== 'function') {
      return;
    }

    const listenersForEvent = this.listeners.get(eventName) ?? new Set<() => void>();
    listenersForEvent.add(listener as () => void);
    this.listeners.set(eventName, listenersForEvent);
  }

  public removeEventListener(eventName: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== 'function') {
      return;
    }

    this.listeners.get(eventName)?.delete(listener as () => void);
  }

  public emit(eventName: string): void {
    const listenersForEvent = this.listeners.get(eventName);

    if (!listenersForEvent) {
      return;
    }

    for (const listener of listenersForEvent) {
      listener();
    }
  }
}

class FakeMutationObserver {
  public static latest: FakeMutationObserver | null = null;

  public observedTarget: Node | null = null;

  public observedOptions: MutationObserverInit | null = null;

  public disconnected = false;

  private readonly callback: MutationCallback;

  public constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeMutationObserver.latest = this;
  }

  public observe(target: Node, options?: MutationObserverInit): void {
    this.observedTarget = target;
    this.observedOptions = options ?? null;
  }

  public disconnect(): void {
    this.disconnected = true;
  }

  public emit(mutations: MutationRecord[]): void {
    this.callback(mutations, this as unknown as MutationObserver);
  }
}

function createKyoboCardHtml(href: string): string {
  return `<article class="prod_item"><div class="prod_info"><a href="${href}">도서</a></div><div class="prod_btn_area"></div></article>`;
}

function createMutationRecordWithNodes(nodes: unknown[]): MutationRecord {
  return {
    addedNodes: nodes as unknown as NodeList
  } as MutationRecord;
}

describe('dynamic reapply runtime Task 8 behavior', () => {
  afterEach(() => {
    vi.useRealTimers();
    FakeMutationObserver.latest = null;
  });

  it('re-applies hide flow when mutation source signals newly appended card', async () => {
    vi.useFakeTimers();

    const adapter = new KyoboAdapter();
    const repository = new LocalStorageRepository(
      new InMemoryStorageDriver({
        hiddenKeysState: {
          version: HIDDEN_KEYS_SCHEMA_VERSION,
          hiddenKeys: ['S000123456789']
        }
      })
    );
    const cards: FakeRuntimeCard[] = [
      new FakeRuntimeCard(
        { 'data-prod-id': '9791191111111' },
        createKyoboCardHtml('/product/detailViewKor.laf?productId=S000123456789')
      )
    ];
    const mutationSource = new ManualEventSource();
    const routeSource = new ManualEventSource();

    const runtimeHandle = startDynamicReapplyFlow({
      adapter,
      repository,
      readUrl: () => 'https://www.kyobobook.co.kr/search?keyword=typescript',
      readCards: () => cards,
      eventSources: [mutationSource, routeSource],
      debounceMs: 10
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(cards[0].injectionCount).toBe(1);
    expect(cards[0].hidden).toBe(true);

    const appendedCard = new FakeRuntimeCard(
      { 'data-prod-id': '9791191111112' },
      createKyoboCardHtml('/product/detailViewKor.laf?productId=S000123456789')
    );
    cards.push(appendedCard);

    mutationSource.emit();
    await vi.advanceTimersByTimeAsync(10);

    expect(appendedCard.injectionCount).toBe(1);
    expect(appendedCard.hidden).toBe(true);

    routeSource.emit();
    await vi.advanceTimersByTimeAsync(10);
    expect(cards[0].injectionCount).toBe(1);

    runtimeHandle.dispose();
  });

  it('coalesces observer storm triggers into bounded reapply passes', async () => {
    vi.useFakeTimers();

    const adapter = new KyoboAdapter();
    const repository = new DeferredRepository(new InMemoryStorageDriver());
    const cards: FakeRuntimeCard[] = [
      new FakeRuntimeCard(
        { 'data-prod-id': '9791192222222' },
        createKyoboCardHtml('/product/detailViewKor.laf?productId=S000223456789')
      )
    ];
    const mutationSource = new ManualEventSource();

    const runtimeHandle = startDynamicReapplyFlow({
      adapter,
      repository,
      readUrl: () => 'https://www.kyobobook.co.kr/search?keyword=storm',
      readCards: () => cards,
      eventSources: [mutationSource],
      debounceMs: 10
    });

    for (let index = 0; index < 50; index += 1) {
      mutationSource.emit();
    }

    await vi.advanceTimersByTimeAsync(10);
    expect(repository.listCallCount).toBe(1);

    for (let index = 0; index < 50; index += 1) {
      mutationSource.emit();
    }

    repository.resolveNextListCall();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(10);
    expect(repository.listCallCount).toBe(2);

    repository.resolveNextListCall();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync();

    expect(cards[0].injectionCount).toBe(1);

    runtimeHandle.dispose();
  });

  it('forwards popstate/hashchange through window event source and unsubscribes safely', () => {
    const eventTarget = new FakeWindowEventTarget();
    const popstateSource = createWindowEventSource(
      eventTarget as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>,
      'popstate'
    );
    const hashchangeSource = createWindowEventSource(
      eventTarget as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>,
      'hashchange'
    );
    let signalCount = 0;

    const unsubscribePopstate = popstateSource.subscribe(() => {
      signalCount += 1;
    });
    const unsubscribeHashchange = hashchangeSource.subscribe(() => {
      signalCount += 1;
    });

    eventTarget.emit('popstate');
    eventTarget.emit('hashchange');
    expect(signalCount).toBe(2);

    unsubscribePopstate();
    unsubscribeHashchange();
    eventTarget.emit('popstate');
    eventTarget.emit('hashchange');

    expect(signalCount).toBe(2);
  });

  it('filters mutation callbacks to only relevant added card nodes', () => {
    let signalCount = 0;
    const documentRoot = { body: {} as Node, documentElement: null } as Pick<Document, 'body' | 'documentElement'>;
    const eventSource = createMutationObserverEventSource(
      documentRoot,
      FakeMutationObserver as unknown as typeof MutationObserver,
      'article.prod_item'
    );

    const unsubscribe = eventSource.subscribe(() => {
      signalCount += 1;
    });

    const observer = FakeMutationObserver.latest;

    if (!observer) {
      throw new Error('expected fake mutation observer instance');
    }

    observer.emit([
      createMutationRecordWithNodes([
        {
          matches: () => false,
          querySelector: () => null
        }
      ])
    ]);
    expect(signalCount).toBe(0);

    observer.emit([
      createMutationRecordWithNodes([
        {
          matches: (selector: string) => selector === 'article.prod_item'
        }
      ])
    ]);
    expect(signalCount).toBe(1);

    expect(
      hasRelevantCardAddition(
        [
          createMutationRecordWithNodes([
            {
              querySelector: (selector: string) => (selector === 'article.prod_item' ? ({} as Element) : null)
            }
          ])
        ],
        'article.prod_item'
      )
    ).toBe(true);

    unsubscribe();
    expect(observer.disconnected).toBe(true);
  });
});
