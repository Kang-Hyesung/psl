import { describe, expect, it } from 'vitest';

import { createPopupSnapshotSummary, resolveKyoboTabStatusFromUrl } from '../../../src/popup/index';

describe('popup status helpers', () => {
  it('returns count and recent hidden keys for happy snapshot state', () => {
    const summary = createPopupSnapshotSummary({
      revision: 4,
      hiddenKeys: ['A-11111', 'B-22222', 'C-33333', 'D-44444']
    });

    expect(summary.hiddenCount).toBe(4);
    expect(summary.recentHiddenKeys).toEqual(['D-44444', 'C-33333', 'B-22222']);
    expect(summary.isEmpty).toBe(false);
  });

  it('returns explicit empty state when snapshot is null', () => {
    const summary = createPopupSnapshotSummary(null);

    expect(summary.hiddenCount).toBe(0);
    expect(summary.recentHiddenKeys).toEqual([]);
    expect(summary.isEmpty).toBe(true);
  });

  it('resolves kyobo tab status from active-tab url', () => {
    expect(resolveKyoboTabStatusFromUrl('https://www.kyobobook.co.kr/product/detailViewKor.laf?barcode=9791193078116')).toBe(
      'supported'
    );
    expect(resolveKyoboTabStatusFromUrl('https://example.com/books')).toBe('unsupported');
    expect(resolveKyoboTabStatusFromUrl(null)).toBe('unavailable');
  });
});
