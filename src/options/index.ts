import { createHideListSyncClient } from '../shared/hide-list-sync-client';
import type { HideListMutationOperation, HideListStateSnapshot } from '../shared/hide-list-messaging';
import { createChromeStorageLocalDriver, LocalStorageRepository, type HiddenKeyMetadata } from '../storage';

const optionsSyncClient = createHideListSyncClient({
  source: 'options'
});

function resolveOptionsMetadataRepository(): LocalStorageRepository | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local || !chrome.runtime) {
    return null;
  }

  try {
    return new LocalStorageRepository(createChromeStorageLocalDriver());
  } catch {
    return null;
  }
}

const optionsMetadataRepository = resolveOptionsMetadataRepository();

const URL_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;
const KYOBO_SEARCH_URL = 'https://www.kyobobook.co.kr/search';

interface OptionsRowViewModel {
  hiddenKey: string;
  createdAtLabel: string;
  originalLink: string;
}

interface OptionsDomElements {
  tableBody: HTMLElement;
  emptyMessage: HTMLElement;
  summaryCount: HTMLElement;
  refreshButton: HTMLButtonElement;
  clearAllButton: HTMLButtonElement;
}

function isLikelyUrl(value: string): boolean {
  return URL_SCHEME_REGEX.test(value);
}

function resolveOriginalLink(hiddenKey: string): string {
  if (isLikelyUrl(hiddenKey)) {
    try {
      const parsedUrl = new URL(hiddenKey);
      return `${parsedUrl.origin}${parsedUrl.pathname}`;
    } catch {
      return hiddenKey;
    }
  }

  const searchUrl = new URL(KYOBO_SEARCH_URL);
  searchUrl.searchParams.set('keyword', hiddenKey);
  return searchUrl.toString();
}

function normalizeHiddenKeys(snapshot: HideListStateSnapshot | null): string[] {
  if (!snapshot) {
    return [];
  }

  return [...snapshot.hiddenKeys];
}

function formatCreatedAt(createdAtMs: number): string {
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    return 'Unknown';
  }

  return new Date(createdAtMs).toLocaleString();
}

function indexMetadataByHiddenKey(metadataItems: readonly HiddenKeyMetadata[]): Map<string, HiddenKeyMetadata> {
  const metadataByHiddenKey = new Map<string, HiddenKeyMetadata>();

  for (const metadataItem of metadataItems) {
    metadataByHiddenKey.set(metadataItem.hiddenKey, metadataItem);
  }

  return metadataByHiddenKey;
}

export function createOptionsRowViewModels(
  snapshot: HideListStateSnapshot | null,
  metadataItems: readonly HiddenKeyMetadata[] = []
): OptionsRowViewModel[] {
  const metadataByHiddenKey = indexMetadataByHiddenKey(metadataItems);

  return normalizeHiddenKeys(snapshot).map((hiddenKey) => ({
    hiddenKey,
    createdAtLabel: formatCreatedAt(metadataByHiddenKey.get(hiddenKey)?.createdAtMs ?? 0),
    originalLink: metadataByHiddenKey.get(hiddenKey)?.originalLink ?? resolveOriginalLink(hiddenKey)
  }));
}

export function renderOptionsSummaryCount(summaryCount: HTMLElement, rows: readonly OptionsRowViewModel[]): void {
  summaryCount.textContent = String(rows.length);
}

function readOptionsDomElements(rootDocument: Document): OptionsDomElements | null {
  const tableBody = rootDocument.getElementById('hidden-items-body');
  const emptyMessage = rootDocument.getElementById('hidden-items-empty');
  const summaryCount = rootDocument.getElementById('hidden-items-summary-count');
  const refreshButton = rootDocument.getElementById('refresh-options-button');
  const clearAllButton = rootDocument.getElementById('clear-all-button');

  if (
    !tableBody ||
    !emptyMessage ||
    !summaryCount ||
    !(refreshButton instanceof HTMLButtonElement) ||
    !(clearAllButton instanceof HTMLButtonElement)
  ) {
    return null;
  }

  return {
    tableBody,
    emptyMessage,
    summaryCount,
    refreshButton,
    clearAllButton
  };
}

function renderOptionsRows(rootDocument: Document, tableBody: HTMLElement, rows: readonly OptionsRowViewModel[]): void {
  tableBody.textContent = '';

  for (const row of rows) {
    const tableRow = rootDocument.createElement('tr');

    const keyCell = rootDocument.createElement('td');
    keyCell.textContent = row.hiddenKey;

    const createdAtCell = rootDocument.createElement('td');
    createdAtCell.textContent = row.createdAtLabel;

    const linkCell = rootDocument.createElement('td');
    const originalLink = rootDocument.createElement('a');
    originalLink.href = row.originalLink;
    originalLink.textContent = row.originalLink;
    originalLink.target = '_blank';
    originalLink.rel = 'noopener noreferrer';
    linkCell.append(originalLink);

    const actionCell = rootDocument.createElement('td');
    const removeButton = rootDocument.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
      void (async () => {
        removeButton.disabled = true;

        try {
          await mutateHiddenKeyFromOptions('remove', row.hiddenKey);
          await refreshOptionsUi(rootDocument);
        } finally {
          removeButton.disabled = false;
        }
      })();
    });
    actionCell.append(removeButton);

    tableRow.append(keyCell, createdAtCell, linkCell, actionCell);
    tableBody.append(tableRow);
  }
}

async function clearAllHiddenKeys(hiddenKeys: readonly string[]): Promise<void> {
  for (const hiddenKey of hiddenKeys) {
    await mutateHiddenKeyFromOptions('remove', hiddenKey);
  }
}

function shouldClearAll(rootWindow: Window): boolean {
  try {
    return rootWindow.confirm('Clear all hidden items?');
  } catch {
    return false;
  }
}

export async function refreshOptionsUi(rootDocument: Document): Promise<void> {
  const elements = readOptionsDomElements(rootDocument);

  if (!elements) {
    return;
  }

  const metadataPromise = optionsMetadataRepository ? optionsMetadataRepository.listItems() : Promise.resolve([] as HiddenKeyMetadata[]);
  const [snapshot, metadataItems] = await Promise.all([readOptionsHideListSnapshot(), metadataPromise]);
  const rows = createOptionsRowViewModels(snapshot, metadataItems);
  renderOptionsSummaryCount(elements.summaryCount, rows);
  renderOptionsRows(rootDocument, elements.tableBody, rows);

  const isEmpty = rows.length === 0;
  elements.emptyMessage.hidden = !isEmpty;
  elements.clearAllButton.disabled = isEmpty;
}

export async function initializeOptionsUi(rootDocument: Document): Promise<void> {
  const elements = readOptionsDomElements(rootDocument);

  if (!elements) {
    return;
  }

  const refresh = async (): Promise<void> => {
    await refreshOptionsUi(rootDocument);
  };

  optionsSyncClient.subscribeToSync(() => {
    void refresh();
  });

  elements.refreshButton.addEventListener('click', () => {
    void refresh();
  });

  elements.clearAllButton.addEventListener('click', () => {
    void (async () => {
      const snapshot = await readOptionsHideListSnapshot();
      const hiddenKeys = normalizeHiddenKeys(snapshot);

      if (hiddenKeys.length === 0 || !shouldClearAll(window)) {
        return;
      }

      elements.clearAllButton.disabled = true;

      try {
        await clearAllHiddenKeys(hiddenKeys);
        await refresh();
      } finally {
        elements.clearAllButton.disabled = false;
      }
    })();
  });

  await refresh();
}

export async function mutateHiddenKeyFromOptions(operation: HideListMutationOperation, hiddenKey: string): Promise<boolean> {
  const result = await optionsSyncClient.mutateHiddenKey(operation, hiddenKey);
  return result !== null;
}

export async function readOptionsHideListSnapshot(): Promise<HideListStateSnapshot | null> {
  return optionsSyncClient.requestSnapshot();
}

if (typeof document !== 'undefined') {
  void initializeOptionsUi(document).catch(() => {
    // Options page should fail safe without crashing extension settings UI.
  });
}
