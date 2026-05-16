import { describe, expect, it } from 'vitest';

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

describe('LocalStorageRepository', () => {
  it('supports deterministic CRUD flow with dedupe', async () => {
    const repository = new LocalStorageRepository(new InMemoryStorageDriver());

    expect(await repository.list()).toEqual([]);
    expect(await repository.get('S000123456789')).toBe(false);

    expect(await repository.add('S000123456789')).toEqual(['S000123456789']);
    expect(await repository.add('S000123456789')).toEqual(['S000123456789']);
    expect(await repository.add('9791191111111')).toEqual(['S000123456789', '9791191111111']);

    expect(await repository.get('S000123456789')).toBe(true);
    expect(await repository.list()).toEqual(['S000123456789', '9791191111111']);

    expect(await repository.remove('S000123456789')).toEqual(['9791191111111']);
    expect(await repository.get('S000123456789')).toBe(false);
    expect(await repository.list()).toEqual(['9791191111111']);

    await repository.clear();
    expect(await repository.list()).toEqual([]);
  });

  it('dedupes persisted keys deterministically by first appearance', async () => {
    const repository = new LocalStorageRepository(
      new InMemoryStorageDriver({
        hiddenKeysState: {
          version: HIDDEN_KEYS_SCHEMA_VERSION,
          hiddenKeys: ['A', 'A', 'B', 'A', 'C', 'B']
        }
      })
    );

    expect(await repository.list()).toEqual(['A', 'B', 'C']);
    expect(await repository.add('B')).toEqual(['A', 'B', 'C']);
    expect(await repository.add('D')).toEqual(['A', 'B', 'C', 'D']);
  });

  it('stores metadata items for created-at and original-link', async () => {
    const repository = new LocalStorageRepository(new InMemoryStorageDriver());

    await repository.add('https://www.kyobobook.co.kr/product/detailViewKor.laf?barcode=9791193078116');
    const items = await repository.listItems();

    expect(items).toHaveLength(1);
    expect(items[0].hiddenKey).toBe('https://www.kyobobook.co.kr/product/detailViewKor.laf?barcode=9791193078116');
    expect(items[0].createdAtMs).toBeGreaterThan(0);
    expect(items[0].originalLink).toBe('https://www.kyobobook.co.kr/product/detailViewKor.laf');
  });

  it('recovers safely from malformed payloads and unknown schema versions without throwing', async () => {
    const malformedPayloadRepository = new LocalStorageRepository(
      new InMemoryStorageDriver({
        hiddenKeysState: {
          version: HIDDEN_KEYS_SCHEMA_VERSION,
          hiddenKeys: [null, 42, 'S000123456789', 'S000123456789', '   ']
        }
      })
    );

    const unknownVersionRepository = new LocalStorageRepository(
      new InMemoryStorageDriver({
        hiddenKeysState: {
          version: 999,
          hiddenKeys: ['S000123456789']
        }
      })
    );

    await expect(malformedPayloadRepository.list()).resolves.toEqual(['S000123456789']);
    await expect(malformedPayloadRepository.get('S000123456789')).resolves.toBe(true);
    await expect(unknownVersionRepository.list()).resolves.toEqual([]);
    await expect(unknownVersionRepository.get('S000123456789')).resolves.toBe(false);
  });

  it('migrates legacy schema version 1 payload into current schema without losing keys', async () => {
    const repository = new LocalStorageRepository(
      new InMemoryStorageDriver({
        hiddenKeysState: {
          version: 1,
          hiddenKeys: ['A-11111', 'B-22222']
        }
      })
    );

    await expect(repository.list()).resolves.toEqual(['A-11111', 'B-22222']);
    const items = await repository.listItems();

    expect(items).toHaveLength(2);
    expect(items[0].createdAtMs).toBe(0);
  });
});
