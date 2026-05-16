import { describe, expect, it } from 'vitest';

import { dedupeCanonicalProductKeys, resolveCanonicalProductKey } from '../../../../src/core/key/canonical-key';

describe('canonical product key normalization', () => {
  it('maps query/hash URL variants to the same normalized URL key', () => {
    const variantA = ['/product/detailViewKor.laf?utm_source=test#summary'];
    const variantB = ['/product/detailViewKor.laf?query=value'];

    expect(resolveCanonicalProductKey(variantA)).toBe('https://www.kyobobook.co.kr/product/detailViewKor.laf');
    expect(resolveCanonicalProductKey(variantB)).toBe('https://www.kyobobook.co.kr/product/detailViewKor.laf');
  });

  it('prefers explicit productId over pathname token and normalized URL', () => {
    const candidates = ['/product/detail/S1234567890?productId=S000123456789', '1234567890'];

    expect(resolveCanonicalProductKey(candidates)).toBe('S000123456789');
  });

  it('falls back to pathname numeric token when explicit id is missing', () => {
    const candidates = ['https://www.kyobobook.co.kr/product/detail/9791191111111?utm_campaign=promo'];

    expect(resolveCanonicalProductKey(candidates)).toBe('9791191111111');
  });

  it('returns null for missing or invalid candidates without throwing', () => {
    expect(() => resolveCanonicalProductKey([])).not.toThrow();
    expect(() => resolveCanonicalProductKey(['   ', '\n\t'])).not.toThrow();
    expect(() => resolveCanonicalProductKey(null)).not.toThrow();

    expect(resolveCanonicalProductKey([])).toBeNull();
    expect(resolveCanonicalProductKey(['   ', '\n\t'])).toBeNull();
    expect(resolveCanonicalProductKey(null)).toBeNull();
  });

  it('dedupes equivalent variants deterministically by first canonical appearance', () => {
    const deduped = dedupeCanonicalProductKeys([
      ['/product/detailViewKor.laf?utm_source=a'],
      ['https://www.kyobobook.co.kr/product/detailViewKor.laf#fragment'],
      ['/product/detail/9791191111111?utm_source=a'],
      ['https://www.kyobobook.co.kr/product/detail/9791191111111?query=b'],
      ['/product/detail/S1234567890?productId=S000123456789'],
      ['S000123456789']
    ]);

    expect(deduped).toEqual([
      'https://www.kyobobook.co.kr/product/detailViewKor.laf',
      '9791191111111',
      'S000123456789'
    ]);
  });
});
