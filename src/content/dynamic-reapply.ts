import type { SiteAdapter } from '../adapters/site-adapter';
import { runHideContentFlow, type HiddenKeyRepository, type HideListMutationPublisher, type RuntimeCard } from './runtime';

type TimeoutHandle = ReturnType<typeof setTimeout>;

const DEFAULT_REAPPLY_DEBOUNCE_MS = 80;
const DEFAULT_MUTATION_OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true
};

interface QueryableNode {
  matches?: (selector: string) => boolean;
  querySelector?: (selector: string) => Element | null;
}

interface DynamicReapplySchedulerInput {
  runPass: () => Promise<void>;
  debounceMs: number;
  scheduleTimeout: (callback: () => void, timeoutMs: number) => TimeoutHandle;
  cancelTimeout: (timeoutId: TimeoutHandle) => void;
}

export interface ReapplyEventSource {
  subscribe(onSignal: () => void): () => void;
}

export interface DynamicReapplyFlowInput {
  adapter: SiteAdapter;
  repository: HiddenKeyRepository;
  mutationPublisher?: HideListMutationPublisher;
  isEnabled?: () => boolean | Promise<boolean>;
  onDisabledPass?: () => void | Promise<void>;
  readUrl: () => string;
  readCards: () => readonly RuntimeCard[];
  eventSources: readonly ReapplyEventSource[];
  debounceMs?: number;
  scheduleTimeout?: (callback: () => void, timeoutMs: number) => TimeoutHandle;
  cancelTimeout?: (timeoutId: TimeoutHandle) => void;
}

export interface DynamicReapplyFlowHandle {
  requestReapply(): void;
  dispose(): void;
}

function matchesCardSelector(node: Node, cardSelector: string): boolean {
  const queryableNode = node as unknown as QueryableNode;

  if (typeof queryableNode.matches === 'function' && queryableNode.matches(cardSelector)) {
    return true;
  }

  if (typeof queryableNode.querySelector === 'function') {
    return queryableNode.querySelector(cardSelector) !== null;
  }

  return false;
}

export function hasRelevantCardAddition(mutations: readonly MutationRecord[], cardSelector: string): boolean {
  for (const mutation of mutations) {
    const addedNodes = Array.from(mutation.addedNodes);

    for (const node of addedNodes) {
      if (matchesCardSelector(node, cardSelector)) {
        return true;
      }
    }
  }

  return false;
}

function createDynamicReapplyScheduler(input: DynamicReapplySchedulerInput): DynamicReapplyFlowHandle {
  let isStopped = false;
  let isRunningPass = false;
  let hasPendingReapply = false;
  let timeoutId: TimeoutHandle | null = null;

  const schedulePass = (): void => {
    if (isStopped || isRunningPass || timeoutId !== null || !hasPendingReapply) {
      return;
    }

    timeoutId = input.scheduleTimeout(() => {
      void flushPass();
    }, input.debounceMs);
  };

  const flushPass = async (): Promise<void> => {
    timeoutId = null;

    if (isStopped || isRunningPass || !hasPendingReapply) {
      return;
    }

    hasPendingReapply = false;
    isRunningPass = true;

    try {
      await input.runPass();
    } catch {
      // Runtime pass is fail-safe by design.
    } finally {
      isRunningPass = false;
      schedulePass();
    }
  };

  const requestReapply = (): void => {
    if (isStopped) {
      return;
    }

    hasPendingReapply = true;
    schedulePass();
  };

  const dispose = (): void => {
    if (isStopped) {
      return;
    }

    isStopped = true;
    hasPendingReapply = false;

    if (timeoutId !== null) {
      input.cancelTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return {
    requestReapply,
    dispose
  };
}

export function createWindowEventSource(
  eventTarget: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  eventName: 'popstate' | 'hashchange'
): ReapplyEventSource {
  return {
    subscribe(onSignal: () => void): () => void {
      eventTarget.addEventListener(eventName, onSignal);

      return () => {
        eventTarget.removeEventListener(eventName, onSignal);
      };
    }
  };
}

export function createMutationObserverEventSource(
  rootDocument: Pick<Document, 'body' | 'documentElement'>,
  mutationObserverCtor: typeof MutationObserver,
  cardSelector: string
): ReapplyEventSource {
  return {
    subscribe(onSignal: () => void): () => void {
      const observerRoot = rootDocument.body ?? rootDocument.documentElement;

      if (!observerRoot) {
        return () => {
          // No-op.
        };
      }

      const observer = new mutationObserverCtor((mutations) => {
        if (hasRelevantCardAddition(mutations, cardSelector)) {
          onSignal();
        }
      });

      observer.observe(observerRoot, DEFAULT_MUTATION_OBSERVER_OPTIONS);

      return () => {
        observer.disconnect();
      };
    }
  };
}

export function startDynamicReapplyFlow(input: DynamicReapplyFlowInput): DynamicReapplyFlowHandle {
  const scheduleTimeout =
    input.scheduleTimeout ??
    ((callback: () => void, timeoutMs: number): TimeoutHandle => {
      return globalThis.setTimeout(callback, timeoutMs);
    });
  const cancelTimeout =
    input.cancelTimeout ??
    ((timeoutId: TimeoutHandle): void => {
      globalThis.clearTimeout(timeoutId);
    });

  const scheduler = createDynamicReapplyScheduler({
    debounceMs: input.debounceMs ?? DEFAULT_REAPPLY_DEBOUNCE_MS,
    scheduleTimeout,
    cancelTimeout,
    runPass: async () => {
      if (input.isEnabled) {
        let isEnabled = true;

        try {
          isEnabled = await input.isEnabled();
        } catch {
          isEnabled = true;
        }

        if (!isEnabled) {
          if (input.onDisabledPass) {
            await input.onDisabledPass();
          }

          return;
        }
      }

      const url = input.readUrl();

      if (!input.adapter.supports(url)) {
        return;
      }

      await runHideContentFlow({
        url,
        adapter: input.adapter,
        repository: input.repository,
        mutationPublisher: input.mutationPublisher,
        cards: input.readCards()
      });
    }
  });

  const sourceUnsubscribers: Array<() => void> = [];

  for (const source of input.eventSources) {
    try {
      sourceUnsubscribers.push(source.subscribe(() => scheduler.requestReapply()));
    } catch {
      sourceUnsubscribers.push(() => {
        // No-op fallback when source subscription fails.
      });
    }
  }

  scheduler.requestReapply();

  return {
    requestReapply(): void {
      scheduler.requestReapply();
    },
    dispose(): void {
      scheduler.dispose();

      for (const unsubscribe of sourceUnsubscribers) {
        try {
          unsubscribe();
        } catch {
          // No-op during cleanup.
        }
      }
    }
  };
}
