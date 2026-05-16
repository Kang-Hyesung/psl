import { describe, expect, it } from 'vitest';

import { createOptionsRowViewModels } from '../../../src/options/index';

describe('options row view model', () => {
  it('builds rows from hidden keys with deterministic fallback values', () => {
    const rows = createOptionsRowViewModels({
      revision: 2,
      hiddenKeys: ['S000123456789', 'https://www.kyobobook.co.kr/product/detailViewKor.laf?barcode=9791193078116&utm_source=test']
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      hiddenKey: 'S000123456789',
      createdAtLabel: 'Unknown',
      originalLink: 'https://www.kyobobook.co.kr/search?keyword=S000123456789'
    });
    expect(rows[1]).toEqual({
      hiddenKey: 'https://www.kyobobook.co.kr/product/detailViewKor.laf?barcode=9791193078116&utm_source=test',
      createdAtLabel: 'Unknown',
      originalLink: 'https://www.kyobobook.co.kr/product/detailViewKor.laf'
    });
  });

  it('uses metadata when available for created-at and original-link columns', () => {
    const rows = createOptionsRowViewModels(
      {
        revision: 1,
        hiddenKeys: ['A-11111']
      },
      [
        {
          hiddenKey: 'A-11111',
          createdAtMs: 1710000000000,
          originalLink: 'https://www.kyobobook.co.kr/product/detailViewKor.laf'
        }
      ]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].createdAtLabel).not.toBe('Unknown');
    expect(rows[0].originalLink).toBe('https://www.kyobobook.co.kr/product/detailViewKor.laf');
  });

  it('returns empty rows for null snapshot', () => {
    expect(createOptionsRowViewModels(null)).toEqual([]);
  });
});
