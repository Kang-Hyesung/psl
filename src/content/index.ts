import { KyoboAdapter } from '../adapters/kyobo-adapter';
import { readHideListEnabledSetting, HIDE_LIST_ENABLED_STORAGE_KEY } from '../shared/hide-list-enabled-setting';
import { createHideListSyncClient, type HideListSyncClient } from '../shared/hide-list-sync-client';
import { createChromeStorageLocalDriver, HIDDEN_KEYS_STORAGE_KEY, LocalStorageRepository } from '../storage';
import { createDomCardReplenisher } from './card-replenishment';
import { createMutationObserverEventSource, createWindowEventSource, type ReapplyEventSource, startDynamicReapplyFlow } from './dynamic-reapply';
import { createDomRuntimeCards, revealHiddenRuntimeCards, RUNTIME_CARD_SELECTOR } from './dom-runtime-cards';

const CONTENT_RUNTIME_MARKER = '__kyoboHideListDynamicReapplyAttached__';

interface MarkerWindow extends Window {
  __kyoboHideListDynamicReapplyAttached__?: boolean;
  __kyoboHideListForceEnableForTest__?: boolean;
}

type StorageChangeMap = Record<string, chrome.storage.StorageChange>;
type StorageChangedListener = (changes: StorageChangeMap, areaName: string) => void;

interface StorageChangedEventTarget {
  addListener(listener: StorageChangedListener): void;
  removeListener(listener: StorageChangedListener): void;
}

function createRuntimeMessageEventSource(syncClient: HideListSyncClient): ReapplyEventSource {
  return {
    subscribe(onSignal: () => void): () => void {
      return syncClient.subscribeToSync(() => {
        onSignal();
      });
    }
  };
}

function createStorageChangeEventSource(
  storageEventTarget: StorageChangedEventTarget,
  storageKeys: readonly string[]
): ReapplyEventSource {
  return {
    subscribe(onSignal: () => void): () => void {
      const listener: StorageChangedListener = (changes, areaName) => {
        if (areaName !== 'local') {
          return;
        }

        for (const storageKey of storageKeys) {
          if (Object.prototype.hasOwnProperty.call(changes, storageKey)) {
            onSignal();
            return;
          }
        }
      };

      storageEventTarget.addListener(listener);

      return () => {
        storageEventTarget.removeListener(listener);
      };
    }
  };
}

function createRuntimeEventSources(rootDocument: Document, syncClient: HideListSyncClient): ReapplyEventSource[] {
  const sources: ReapplyEventSource[] = [
    createWindowEventSource(window, 'popstate'),
    createWindowEventSource(window, 'hashchange'),
    createWindowEventSource(window, 'click'),
    createRuntimeMessageEventSource(syncClient)
  ];

  if (typeof MutationObserver === 'function') {
    sources.push(createMutationObserverEventSource(rootDocument, MutationObserver, RUNTIME_CARD_SELECTOR));
  }

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    const storageEventTarget = chrome.storage.onChanged as unknown as StorageChangedEventTarget;
    sources.push(createStorageChangeEventSource(storageEventTarget, [HIDDEN_KEYS_STORAGE_KEY, HIDE_LIST_ENABLED_STORAGE_KEY]));
  }

  return sources;
}

async function runContentScript(): Promise<void> {
  const adapter = new KyoboAdapter();
  const url = window.location.href;
  const markerWindow = window as MarkerWindow;

  if (!adapter.supports(url) && !markerWindow.__kyoboHideListForceEnableForTest__) {
    return;
  }

  if (markerWindow[CONTENT_RUNTIME_MARKER]) {
    return;
  }

  markerWindow[CONTENT_RUNTIME_MARKER] = true;

  const repository = new LocalStorageRepository(createChromeStorageLocalDriver());
  const syncClient = createHideListSyncClient({
    source: 'content'
  });

  startDynamicReapplyFlow({
    adapter,
    repository,
    isEnabled: () => readHideListEnabledSetting(),
    onDisabledPass: async () => {
      revealHiddenRuntimeCards(document);
    },
    mutationPublisher: {
      async publishMutation(operation, hiddenKey): Promise<boolean> {
        const result = await syncClient.mutateHiddenKey(operation, hiddenKey);
        return result !== null;
      }
    },
    replenisher: createDomCardReplenisher({
      rootDocument: document,
      adapter
    }),
    readUrl: () => (markerWindow.__kyoboHideListForceEnableForTest__ ? 'https://www.kyobobook.co.kr/search?keyword=test' : window.location.href),
    readCards: () => createDomRuntimeCards(document, adapter),
    eventSources: createRuntimeEventSources(document, syncClient)
  });
}

void runContentScript().catch(() => {
  // Content script should fail safe and never break host page rendering.
});
