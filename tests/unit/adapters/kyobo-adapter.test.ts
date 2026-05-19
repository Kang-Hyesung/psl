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
      anchorSelectorCandidates: ['.prod_btn_wrap .btn_wrap.full', '.prod_btn_wrap', '.prod_btn_area', '.prod_btn_box', '.prod_bottom', '.prod_info_box'],
      insertionPosition: 'beforeend'
    });
  });

  it('discovers modern Kyobo product list items and extracts data-id', () => {
    const adapter = new KyoboAdapter();
    const html = `
      <ol class="prod_list">
        <li class="prod_item" data-binding="true" data-id="S000219524044">
          <div class="prod_area">
            <div class="prod_info_box">
              <a class="prod_info" href="https://product.kyobobook.co.kr/detail/S000219524044">도서</a>
            </div>
          </div>
          <div class="prod_btn_wrap">
            <div class="btn_wrap full"></div>
          </div>
        </li>
      </ol>
    `;

    const cards = adapter.discoverCards({
      url: 'https://www.kyobobook.co.kr/search?keyword=javascript',
      html
    });

    expect(cards).toHaveLength(1);
    expect(adapter.extractProductKeyCandidates(cards[0])).toContain('S000219524044');
  });

  it('supports Kyobo search and product subdomains used by the live site', () => {
    const adapter = new KyoboAdapter();

    expect(adapter.supports('https://www.kyobobook.co.kr/search?keyword=javascript')).toBe(true);
    expect(adapter.supports('https://search.kyobobook.co.kr/search?keyword=javascript')).toBe(true);
    expect(adapter.supports('https://product.kyobobook.co.kr/detail/S000219524044')).toBe(true);
  });

  it('provides a page-based replenishment hook for the live Kyobo search domain', () => {
    const adapter = new KyoboAdapter();
    const hook = adapter.getCardReplenishmentHook?.('https://search.kyobobook.co.kr/search?keyword=javascript&page=2');

    expect(hook).not.toBeNull();
    expect(hook?.containerSelectorCandidates).toContain('ul.prod_list');
    expect(hook?.cardSelector).toBe('li.prod_item, article.prod_item');
    expect(hook?.targetVisibleCardCount).toBe(20);
    expect(hook?.getCurrentPageNumber('https://search.kyobobook.co.kr/search?keyword=javascript&page=2')).toBe(2);
    expect(hook?.createPageUrl('https://search.kyobobook.co.kr/search?keyword=javascript&page=2', 3)).toBe(
      'https://search.kyobobook.co.kr/search?keyword=javascript&page=3'
    );
    expect(adapter.getCardReplenishmentHook?.('https://www.kyobobook.co.kr/search?keyword=javascript')).toBeNull();
  });

  it('provides an API-backed replenishment hook for Kyobo category pages', () => {
    const adapter = new KyoboAdapter();
    const hook = adapter.getCardReplenishmentHook?.('https://product.kyobobook.co.kr/category/KOR/330101#?page=2&type=all&per=20&sort=new');

    expect(hook).not.toBeNull();
    expect(hook?.containerSelectorCandidates).toContain('ol.prod_list');
    expect(hook?.getCurrentPageNumber('https://product.kyobobook.co.kr/category/KOR/330101#?page=2&type=all&per=20&sort=new')).toBe(2);
    expect(hook?.createPageUrl('https://product.kyobobook.co.kr/category/KOR/330101#?page=2&type=all&per=20&sort=new', 3)).toBe(
      'https://product.kyobobook.co.kr/api/gw/pdt/category/all?page=3&per=20&saleCmdtDvsnCode=KOR&saleCmdtClstCode=330101&isEvent=false&isPackage=false&isMDPicked=false&sort=new'
    );

    const cardHtmls = hook?.extractCardHtmls?.(
      JSON.stringify({
        data: {
          tabContents: [
            {
              saleCmdtId: 'S000215697828',
              cmdtName: '컴퓨터공학 개론',
              cmdtcode: '9791168331747',
              chrcName: '이병욱',
              pbcmName: '21세기사',
              rlseDate: '20250205',
              sapr: 35000,
              price: 35000,
              dscnRate: 0,
              upntAcmlAmnt: 1050,
              revwRvgrAvg: 10,
              whlRevwCont: 2,
              bestEmtnKywrName: '추천해요',
              inbukCntt: '컴퓨터 공학 입문서'
            }
          ]
        }
      })
    );

    expect(cardHtmls).toHaveLength(1);
    expect(cardHtmls?.[0]).toContain('data-id="S000215697828"');
    expect(cardHtmls?.[0]).toContain('컴퓨터공학 개론');
  });

  it('ignores nested prod_area elements when discovering static cards', () => {
    const adapter = new KyoboAdapter();
    const html = `
      <ol class="prod_list">
        <li class="prod_item" data-id="S000219524044">
          <div class="prod_area">
            <a class="prod_info" href="https://product.kyobobook.co.kr/detail/S000219524044">도서</a>
          </div>
        </li>
        <li class="prod_item" data-id="S000219725328">
          <div class="prod_area">
            <a class="prod_info" href="https://product.kyobobook.co.kr/detail/S000219725328">도서</a>
          </div>
        </li>
      </ol>
    `;

    const cards = adapter.discoverCards({
      url: 'https://www.kyobobook.co.kr/search?keyword=javascript',
      html
    });

    expect(cards).toHaveLength(2);
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
