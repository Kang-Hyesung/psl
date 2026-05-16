import type { StorageDriver } from './storage-driver';

export interface HiddenKeysState {
  version: number;
  hiddenKeys: string[];
  hiddenItems: HiddenKeyMetadata[];
}

export interface HiddenKeyMetadata {
  hiddenKey: string;
  createdAtMs: number;
  originalLink: string | null;
}

export const HIDDEN_KEYS_STORAGE_KEY = 'hiddenKeysState';
const DEFAULT_STORAGE_KEY = HIDDEN_KEYS_STORAGE_KEY;
export const HIDDEN_KEYS_SCHEMA_VERSION = 2;

interface LocalStorageRepositoryOptions {
  storageKey?: string;
  schemaVersion?: number;
}

function createEmptyState(schemaVersion: number): HiddenKeysState {
  return {
    version: schemaVersion,
    hiddenKeys: [],
    hiddenItems: []
  };
}

function resolveOriginalLink(hiddenKey: string): string | null {
  try {
    const parsedUrl = new URL(hiddenKey);
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch {
    return null;
  }
}

function normalizeHiddenKey(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeHiddenKeys(rawHiddenKeys: unknown): string[] {
  if (!Array.isArray(rawHiddenKeys)) {
    return [];
  }

  const deduped: string[] = [];

  for (const rawHiddenKey of rawHiddenKeys) {
    if (typeof rawHiddenKey !== 'string') {
      continue;
    }

    const hiddenKey = normalizeHiddenKey(rawHiddenKey);

    if (hiddenKey && !deduped.includes(hiddenKey)) {
      deduped.push(hiddenKey);
    }
  }

  return deduped;
}

function sanitizeCreatedAtMs(rawCreatedAtMs: unknown): number {
  if (typeof rawCreatedAtMs !== 'number' || !Number.isFinite(rawCreatedAtMs) || rawCreatedAtMs <= 0) {
    return 0;
  }

  return Math.floor(rawCreatedAtMs);
}

function sanitizeOriginalLink(rawOriginalLink: unknown): string | null {
  if (typeof rawOriginalLink !== 'string') {
    return null;
  }

  const normalized = rawOriginalLink.trim();
  return normalized.length > 0 ? normalized : null;
}

function createMetadataFromHiddenKey(hiddenKey: string, createdAtMs: number): HiddenKeyMetadata {
  return {
    hiddenKey,
    createdAtMs,
    originalLink: resolveOriginalLink(hiddenKey)
  };
}

function sanitizeHiddenItems(rawHiddenItems: unknown): HiddenKeyMetadata[] {
  if (!Array.isArray(rawHiddenItems)) {
    return [];
  }

  const normalizedItems: HiddenKeyMetadata[] = [];

  for (const rawItem of rawHiddenItems) {
    if (!isRecord(rawItem)) {
      continue;
    }

    const hiddenKey = normalizeHiddenKey(typeof rawItem.hiddenKey === 'string' ? rawItem.hiddenKey : '');

    if (!hiddenKey || normalizedItems.some((item) => item.hiddenKey === hiddenKey)) {
      continue;
    }

    normalizedItems.push({
      hiddenKey,
      createdAtMs: sanitizeCreatedAtMs(rawItem.createdAtMs),
      originalLink: sanitizeOriginalLink(rawItem.originalLink)
    });
  }

  return normalizedItems;
}

function normalizeState(rawState: unknown, schemaVersion: number): HiddenKeysState {
  if (!isRecord(rawState)) {
    return createEmptyState(schemaVersion);
  }

  const version = rawState.version;

  const hiddenKeys = sanitizeHiddenKeys(rawState.hiddenKeys);
  const hiddenItems = sanitizeHiddenItems(rawState.hiddenItems);

  if (version === schemaVersion) {
    if (hiddenItems.length > 0) {
      const normalizedKeys = hiddenItems.map((item) => item.hiddenKey);

      return {
        version: schemaVersion,
        hiddenKeys: normalizedKeys,
        hiddenItems
      };
    }

    return {
      version: schemaVersion,
      hiddenKeys,
      hiddenItems: hiddenKeys.map((hiddenKey) => createMetadataFromHiddenKey(hiddenKey, 0))
    };
  }

  if (version === 1) {
    return {
      version: schemaVersion,
      hiddenKeys,
      hiddenItems: hiddenKeys.map((hiddenKey) => createMetadataFromHiddenKey(hiddenKey, 0))
    };
  }

  return {
    version: schemaVersion,
    hiddenKeys: [],
    hiddenItems: []
  };
}

export class LocalStorageRepository {
  private readonly storageKey: string;

  private readonly schemaVersion: number;

  private readonly now: () => number;

  public constructor(
    private readonly storage: StorageDriver,
    options: LocalStorageRepositoryOptions = {}
  ) {
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.schemaVersion = options.schemaVersion ?? HIDDEN_KEYS_SCHEMA_VERSION;
    this.now = Date.now;
  }

  public async get(hiddenKey: string): Promise<boolean> {
    const normalizedHiddenKey = normalizeHiddenKey(hiddenKey);

    if (!normalizedHiddenKey) {
      return false;
    }

    const state = await this.readState();
    return state.hiddenKeys.includes(normalizedHiddenKey);
  }

  public async list(): Promise<string[]> {
    const state = await this.readState();
    return [...state.hiddenKeys];
  }

  public async listItems(): Promise<HiddenKeyMetadata[]> {
    const state = await this.readState();
    return state.hiddenItems.map((item) => ({ ...item }));
  }

  public async add(hiddenKey: string): Promise<string[]> {
    const normalizedHiddenKey = normalizeHiddenKey(hiddenKey);
    const state = await this.readState();

    if (!normalizedHiddenKey || state.hiddenKeys.includes(normalizedHiddenKey)) {
      return [...state.hiddenKeys];
    }

    const createdAtMs = this.now();
    const nextHiddenItems = [...state.hiddenItems, createMetadataFromHiddenKey(normalizedHiddenKey, createdAtMs)];

    const nextState: HiddenKeysState = {
      version: this.schemaVersion,
      hiddenKeys: nextHiddenItems.map((item) => item.hiddenKey),
      hiddenItems: nextHiddenItems
    };

    await this.writeState(nextState);
    return [...nextState.hiddenKeys];
  }

  public async remove(hiddenKey: string): Promise<string[]> {
    const normalizedHiddenKey = normalizeHiddenKey(hiddenKey);
    const state = await this.readState();

    if (!normalizedHiddenKey) {
      return [...state.hiddenKeys];
    }

    const nextHiddenItems = state.hiddenItems.filter((item) => item.hiddenKey !== normalizedHiddenKey);
    const nextHiddenKeys = nextHiddenItems.map((item) => item.hiddenKey);

    if (nextHiddenKeys.length === state.hiddenKeys.length) {
      return [...state.hiddenKeys];
    }

    const nextState: HiddenKeysState = {
      version: this.schemaVersion,
      hiddenKeys: nextHiddenKeys,
      hiddenItems: nextHiddenItems
    };

    await this.writeState(nextState);
    return [...nextState.hiddenKeys];
  }

  public async clear(): Promise<void> {
    await this.writeState(createEmptyState(this.schemaVersion));
  }

  private async readState(): Promise<HiddenKeysState> {
    const rawState = await this.storage.getItem(this.storageKey);
    return normalizeState(rawState, this.schemaVersion);
  }

  private async writeState(state: HiddenKeysState): Promise<void> {
    await this.storage.setItem(this.storageKey, state);
  }
}
