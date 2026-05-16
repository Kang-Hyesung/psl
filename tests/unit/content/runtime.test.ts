import { describe, expect, it } from 'vitest';

import { KyoboAdapter } from '../../../src/adapters/kyobo-adapter';
import { HIDDEN_KEYS_SCHEMA_VERSION, LocalStorageRepository } from '../../../src/storage/local-storage-repository';
import type { StorageDriver } from '../../../src/storage/storage-driver';
import { runHideContentFlow, type RuntimeCard } from '../../../src/content/runtime';

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

  private onClickHandler: (() => Promise<void> | void) | null = null;

  public constructor(attributes: Record<string, string>, html: string) {
    this.adapterCard = {
      html,
      attributes
    };
  }

  public hasHideButton(): boolean {
    return this.hasButton;
  }

  public injectHideButton(onClick: () => Promise<void> | void): void {
    this.hasButton = true;
    this.injectionCount += 1;
    this.onClickHandler = onClick;
  }

  public hide(): void {
    this.hidden = true;
  }

  public show(): void {
    this.hidden = false;
  }

  public async clickHideButton(): Promise<void> {
    if (!this.onClickHandler) {
      throw new Error('hide button is not injected');
    }

    await this.onClickHandler();
  }
}

function createKyoboCardHtml(href: string): string {
  return `<article class="prod_item"><div class="prod_info"><a href="${href}">도서</a></div><div class="prod_btn_area"></div></article>`;
}

describe('content runtime Task 7 behavior', () => {
  it('keeps non-kyobo domains as strict no-op', async () => {
    const adapter = new KyoboAdapter();
    const repository = new LocalStorageRepository(new InMemoryStorageDriver());
    const card = new FakeRuntimeCard(
      { 'data-prod-id': '9791191111111' },
      createKyoboCardHtml('/product/detailViewKor.laf?productId=S000123456789')
    );

    await runHideContentFlow({
      url: 'https://example.com/books?keyword=typescript',
      adapter,
      repository,
      cards: [card]
    });

    expect(card.injectionCount).toBe(0);
    expect(card.hidden).toBe(false);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it('prevents duplicate hide button injection for the same card', async () => {
    const adapter = new KyoboAdapter();
    const repository = new LocalStorageRepository(new InMemoryStorageDriver());
    const card = new FakeRuntimeCard(
      { 'data-prod-id': '9791191111111' },
      createKyoboCardHtml('/product/detailViewKor.laf?productId=S000123456789')
    );

    await runHideContentFlow({
      url: 'https://www.kyobobook.co.kr/search?keyword=typescript',
      adapter,
      repository,
      cards: [card]
    });

    await runHideContentFlow({
      url: 'https://www.kyobobook.co.kr/search?keyword=typescript',
      adapter,
      repository,
      cards: [card]
    });

    expect(card.injectionCount).toBe(1);
  });

  it('persists canonical key and hides card immediately on hide-button click', async () => {
    const adapter = new KyoboAdapter();
    const repository = new LocalStorageRepository(new InMemoryStorageDriver());
    const card = new FakeRuntimeCard(
      { 'data-prod-id': '9791191111111' },
      createKyoboCardHtml('/product/detailViewKor.laf?barcode=9791191111111&productId=S000123456789')
    );

    await runHideContentFlow({
      url: 'https://www.kyobobook.co.kr/search?keyword=typescript',
      adapter,
      repository,
      cards: [card]
    });

    await card.clickHideButton();

    expect(card.hidden).toBe(true);
    await expect(repository.list()).resolves.toEqual(['S000123456789']);
  });

  it('does no-op for invalid or missing identifiers without throwing', async () => {
    const adapter = new KyoboAdapter();
    const repository = new LocalStorageRepository(new InMemoryStorageDriver());
    const card = new FakeRuntimeCard({}, '<article class="prod_item"><div class="prod_info"></div></article>');

    await runHideContentFlow({
      url: 'https://www.kyobobook.co.kr/search?keyword=typescript',
      adapter,
      repository,
      cards: [card]
    });

    await expect(card.clickHideButton()).resolves.toBeUndefined();
    expect(card.hidden).toBe(false);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it('applies persisted hidden keys on initial render without user interaction', async () => {
    const adapter = new KyoboAdapter();
    const repository = new LocalStorageRepository(
      new InMemoryStorageDriver({
        hiddenKeysState: {
          version: HIDDEN_KEYS_SCHEMA_VERSION,
          hiddenKeys: ['S000123456789']
        }
      })
    );
    const card = new FakeRuntimeCard(
      { 'data-prod-id': '9791191111111' },
      createKyoboCardHtml('/product/detailViewKor.laf?productId=S000123456789')
    );

    await runHideContentFlow({
      url: 'https://www.kyobobook.co.kr/search?keyword=typescript',
      adapter,
      repository,
      cards: [card]
    });

    expect(card.hidden).toBe(true);
  });

  it('reveals a previously hidden card when key is removed from persisted state', async () => {
    const adapter = new KyoboAdapter();
    const repository = new LocalStorageRepository(new InMemoryStorageDriver());
    const card = new FakeRuntimeCard(
      { 'data-prod-id': '9791191111111' },
      createKyoboCardHtml('/product/detailViewKor.laf?productId=S000123456789')
    );

    await repository.add('S000123456789');
    await runHideContentFlow({
      url: 'https://www.kyobobook.co.kr/search?keyword=typescript',
      adapter,
      repository,
      cards: [card]
    });
    expect(card.hidden).toBe(true);

    await repository.remove('S000123456789');
    await runHideContentFlow({
      url: 'https://www.kyobobook.co.kr/search?keyword=typescript',
      adapter,
      repository,
      cards: [card]
    });

    expect(card.hidden).toBe(false);
  });
});
