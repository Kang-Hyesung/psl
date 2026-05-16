import { createHideListSyncClient } from '../shared/hide-list-sync-client';
import { readHideListEnabledSetting, writeHideListEnabledSetting } from '../shared/hide-list-enabled-setting';
import { KyoboAdapter } from '../adapters/kyobo-adapter';
import type { HideListMutationOperation, HideListStateSnapshot } from '../shared/hide-list-messaging';

const popupSyncClient = createHideListSyncClient({
  source: 'popup'
});

const RECENT_HIDDEN_KEYS_LIMIT = 3;

type KyoboTabStatus = 'supported' | 'unsupported' | 'unavailable';

interface PopupSnapshotSummary {
  hiddenCount: number;
  recentHiddenKeys: string[];
  isEmpty: boolean;
}

interface PopupStatusViewModel {
  snapshot: PopupSnapshotSummary;
  kyoboTabStatus: KyoboTabStatus;
  isHideEnabled: boolean;
}

interface PopupDomElements {
  hiddenCount: HTMLElement;
  recentHiddenList: HTMLElement;
  recentEmptyMessage: HTMLElement;
  tabStatus: HTMLElement;
  hideEnabledStatus: HTMLElement;
  refreshButton: HTMLButtonElement;
  toggleHideEnabledButton: HTMLButtonElement;
  openHiddenListButton: HTMLButtonElement;
  openOptionsButton: HTMLButtonElement;
}

function normalizeHiddenKeys(snapshot: HideListStateSnapshot | null): string[] {
  if (!snapshot) {
    return [];
  }

  return [...snapshot.hiddenKeys];
}

export function createPopupSnapshotSummary(snapshot: HideListStateSnapshot | null): PopupSnapshotSummary {
  const hiddenKeys = normalizeHiddenKeys(snapshot);

  return {
    hiddenCount: hiddenKeys.length,
    recentHiddenKeys: hiddenKeys.slice(-RECENT_HIDDEN_KEYS_LIMIT).reverse(),
    isEmpty: hiddenKeys.length === 0
  };
}

export function resolveKyoboTabStatusFromUrl(url: string | null): KyoboTabStatus {
  if (!url) {
    return 'unavailable';
  }

  return new KyoboAdapter().supports(url) ? 'supported' : 'unsupported';
}

function toKyoboTabStatusLabel(status: KyoboTabStatus): string {
  if (status === 'supported') {
    return 'Kyobo supported';
  }

  if (status === 'unsupported') {
    return 'Kyobo not supported';
  }

  return 'Current tab unavailable';
}

async function readActiveTabUrl(): Promise<string | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      chrome.tabs.query(
        {
          active: true,
          currentWindow: true
        },
        (tabs) => {
          resolve(tabs[0]?.url ?? null);
        }
      );
    } catch {
      resolve(null);
    }
  });
}

async function readPopupStatusViewModel(): Promise<PopupStatusViewModel> {
  const [snapshot, activeTabUrl, isHideEnabled] = await Promise.all([
    readPopupHideListSnapshot(),
    readActiveTabUrl(),
    readHideListEnabledSetting()
  ]);

  return {
    snapshot: createPopupSnapshotSummary(snapshot),
    kyoboTabStatus: resolveKyoboTabStatusFromUrl(activeTabUrl),
    isHideEnabled
  };
}

function readPopupDomElements(rootDocument: Document): PopupDomElements | null {
  const hiddenCount = rootDocument.getElementById('hidden-count');
  const recentHiddenList = rootDocument.getElementById('recent-hidden-list');
  const recentEmptyMessage = rootDocument.getElementById('recent-empty-message');
  const tabStatus = rootDocument.getElementById('tab-status');
  const hideEnabledStatus = rootDocument.getElementById('hide-enabled-status');
  const refreshButton = rootDocument.getElementById('refresh-button');
  const toggleHideEnabledButton = rootDocument.getElementById('toggle-hide-enabled-button');
  const openHiddenListButton = rootDocument.getElementById('open-hidden-list-button');
  const openOptionsButton = rootDocument.getElementById('open-options-button');

  if (
    !hiddenCount ||
    !recentHiddenList ||
    !recentEmptyMessage ||
    !tabStatus ||
    !hideEnabledStatus ||
    !(refreshButton instanceof HTMLButtonElement) ||
    !(toggleHideEnabledButton instanceof HTMLButtonElement) ||
    !(openHiddenListButton instanceof HTMLButtonElement) ||
    !(openOptionsButton instanceof HTMLButtonElement)
  ) {
    return null;
  }

  return {
    hiddenCount,
    recentHiddenList,
    recentEmptyMessage,
    tabStatus,
    hideEnabledStatus,
    refreshButton,
    toggleHideEnabledButton,
    openHiddenListButton,
    openOptionsButton
  };
}

function renderRecentHiddenKeys(recentHiddenList: HTMLElement, recentHiddenKeys: readonly string[]): void {
  recentHiddenList.textContent = '';

  for (const hiddenKey of recentHiddenKeys) {
    const item = document.createElement('li');
    item.textContent = hiddenKey;
    recentHiddenList.append(item);
  }
}

function applyStatusToDom(elements: PopupDomElements, viewModel: PopupStatusViewModel): void {
  elements.hiddenCount.textContent = String(viewModel.snapshot.hiddenCount);
  elements.tabStatus.textContent = toKyoboTabStatusLabel(viewModel.kyoboTabStatus);
  elements.hideEnabledStatus.textContent = viewModel.isHideEnabled ? 'On' : 'Off';
  elements.toggleHideEnabledButton.textContent = viewModel.isHideEnabled ? 'Turn off hide' : 'Turn on hide';

  if (viewModel.snapshot.isEmpty) {
    elements.recentHiddenList.hidden = true;
    elements.recentEmptyMessage.hidden = false;
    elements.recentEmptyMessage.textContent = 'No hidden items yet.';
    return;
  }

  elements.recentEmptyMessage.hidden = true;
  elements.recentHiddenList.hidden = false;
  renderRecentHiddenKeys(elements.recentHiddenList, viewModel.snapshot.recentHiddenKeys);
}

function openOptionsPage(): void {
  if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
    void chrome.runtime.openOptionsPage();
    return;
  }

  window.location.href = '/options.html';
}

function openHiddenList(): void {
  openOptionsPage();
}

async function initializePopupUi(rootDocument: Document): Promise<void> {
  const elements = readPopupDomElements(rootDocument);

  if (!elements) {
    return;
  }

  const refresh = async (): Promise<void> => {
    const viewModel = await readPopupStatusViewModel();
    applyStatusToDom(elements, viewModel);
  };

  popupSyncClient.subscribeToSync(() => {
    void refresh();
  });

  elements.refreshButton.addEventListener('click', () => {
    void refresh();
  });

  elements.toggleHideEnabledButton.addEventListener('click', () => {
    void (async () => {
      elements.toggleHideEnabledButton.disabled = true;
      const currentSetting = await readHideListEnabledSetting();
      await writeHideListEnabledSetting(!currentSetting);
      elements.toggleHideEnabledButton.disabled = false;
      await refresh();
    })();
  });

  elements.openHiddenListButton.addEventListener('click', () => {
    openHiddenList();
  });

  elements.openOptionsButton.addEventListener('click', () => {
    openOptionsPage();
  });

  await refresh();
}

export async function mutateHiddenKeyFromPopup(operation: HideListMutationOperation, hiddenKey: string): Promise<boolean> {
  const result = await popupSyncClient.mutateHiddenKey(operation, hiddenKey);
  return result !== null;
}

export async function readPopupHideListSnapshot(): Promise<HideListStateSnapshot | null> {
  return popupSyncClient.requestSnapshot();
}

if (typeof document !== 'undefined') {
  void initializePopupUi(document).catch(() => {
    // Popup should fail safe without breaking extension action open.
  });
}
