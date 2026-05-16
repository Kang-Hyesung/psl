import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { KyoboAdapter } from '../../../src/adapters/kyobo-adapter';

function readFixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

describe('KyoboAdapter contract baseline', () => {
  it('discovers cards and extracts key candidates from Kyobo-like fixture', () => {
    const adapter = new KyoboAdapter();
    const html = readFixture('kyobo-listing.html');

    const cards = adapter.discoverCards({
      url: 'https://www.kyobobook.co.kr/search?keyword=typescript',
      html
    });

    expect(cards).toHaveLength(2);

    const candidates = adapter.extractProductKeyCandidates(cards[0]);

    expect(candidates).toContain('9791191111111');
    expect(candidates).toContain('/product/detailViewKor.laf?barcode=9791191111111&productId=S000123456789');
    expect(candidates).toContain('S000123456789');

    const hook = adapter.getHideButtonHook(cards[0]);

    expect(hook).toEqual({
      anchorSelectorCandidates: ['.prod_btn_area', '.prod_info'],
      insertionPosition: 'beforeend'
    });
  });

  it('returns no-op behavior on unsupported page input without throwing', () => {
    const adapter = new KyoboAdapter();
    const unsupportedHtml = readFixture('unsupported-page.html');

    expect(adapter.supports('https://example.com/books')).toBe(false);
    expect(adapter.supports('not-a-url')).toBe(false);

    expect(() =>
      adapter.discoverCards({
        url: 'https://example.com/books',
        html: unsupportedHtml
      })
    ).not.toThrow();

    const cards = adapter.discoverCards({
      url: 'https://example.com/books',
      html: unsupportedHtml
    });

    expect(cards).toEqual([]);
    expect(adapter.extractProductKeyCandidates({ html: '', attributes: {} })).toEqual([]);
    expect(adapter.getHideButtonHook({ html: '', attributes: {} })).toBeNull();
  });
});
