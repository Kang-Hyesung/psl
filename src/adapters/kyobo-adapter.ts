import {
  type AdapterCard,
  type AdapterPageContext,
  type CardReplenishmentHook,
  type HideButtonInsertionHook,
  type SiteAdapter
} from './site-adapter';

const KYOBO_URL_BASE = 'https://www.kyobobook.co.kr';
const KYOBO_HOSTS = new Set(['www.kyobobook.co.kr', 'search.kyobobook.co.kr', 'product.kyobobook.co.kr']);
const KYOBO_SEARCH_HOST = 'search.kyobobook.co.kr';
const KYOBO_SEARCH_PATH = '/search';
const KYOBO_PRODUCT_HOST = 'product.kyobobook.co.kr';
const KYOBO_CATEGORY_PATH_REGEX = /^\/category\/([A-Z0-9]+)\/([0-9A-Z]+)$/;
const CARD_REGEX =
  /<(article|li)\b[^>]*class=(?:"[^"]*\bprod_item\b[^"]*"|'[^']*\bprod_item\b[^']*')[^>]*>[\s\S]*?<\/\1>/gi;
const OPENING_TAG_REGEX = /^<(?:article|li)\b([^>]*)>/i;
const ATTRIBUTE_REGEX = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)=(?:"([^"]*)"|'([^']*)')/g;
const HREF_REGEX = /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>/i;
const NUMERIC_TOKEN_REGEX = /\b\d{5,13}\b/g;

function readAttributes(cardHtml: string): Record<string, string> {
  const openingTag = cardHtml.match(OPENING_TAG_REGEX);

  if (!openingTag) {
    return {};
  }

  const attributes: Record<string, string> = {};
  const source = openingTag[1];

  for (const match of source.matchAll(ATTRIBUTE_REGEX)) {
    const attributeName = match[1];
    const attributeValue = match[2] ?? match[3] ?? '';
    attributes[attributeName] = attributeValue;
  }

  return attributes;
}

function readHref(cardHtml: string): string | null {
  const hrefMatch = cardHtml.match(HREF_REGEX);

  if (!hrefMatch) {
    return null;
  }

  return hrefMatch[1] ?? hrefMatch[2] ?? null;
}

function parseUrlSafely(href: string): URL | null {
  try {
    return new URL(href, KYOBO_URL_BASE);
  } catch {
    return null;
  }
}

function parseAbsoluteUrlSafely(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function parseHashSearchParams(parsedUrl: URL): URLSearchParams {
  const hashValue = parsedUrl.hash.startsWith('#') ? parsedUrl.hash.slice(1) : parsedUrl.hash;
  const searchValue = hashValue.startsWith('?') ? hashValue.slice(1) : hashValue;
  return new URLSearchParams(searchValue);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value: unknown): string {
  const rawValue = String(value ?? '');

  if (!/^\d{8}$/.test(rawValue)) {
    return '';
  }

  return `${rawValue.slice(0, 4)}.${rawValue.slice(4, 6)}.${rawValue.slice(6, 8)}`;
}

function formatNumber(value: unknown): string {
  const numericValue = Number(value ?? 0);

  if (!Number.isFinite(numericValue)) {
    return '0';
  }

  return numericValue.toLocaleString('ko-KR');
}

function createCategoryCardHtml(rawItem: unknown): string | null {
  if (!rawItem || typeof rawItem !== 'object') {
    return null;
  }

  const item = rawItem as Record<string, unknown>;
  const productId = String(item.saleCmdtId ?? '');
  const barcode = String(item.cmdtcode ?? '');

  if (!productId) {
    return null;
  }

  const title = escapeHtml(item.cmdtName);
  const author = escapeHtml(item.chrcName);
  const publisher = escapeHtml(item.pbcmName);
  const date = formatDate(item.rlseDate);
  const price = formatNumber(item.sapr);
  const normalPrice = formatNumber(item.price);
  const point = formatNumber(item.upntAcmlAmnt);
  const discountRate = Number(item.dscnRate ?? 0);
  const reviewScore = Number(item.revwRvgrAvg ?? item.revwRvgr ?? 0);
  const reviewCount = Number(item.whlRevwCont ?? item.revwCont ?? 0);
  const reactionLabel = escapeHtml(item.bestEmtnKywrName ?? '도움돼요');
  const introduction = escapeHtml(item.inbukCntt);
  const imageSrc = barcode ? `https://contents.kyobobook.co.kr/sih/fit-in/300x0/pdt/${encodeURIComponent(barcode)}.jpg` : '';
  const detailUrl = `https://product.kyobobook.co.kr/detail/${encodeURIComponent(productId)}`;

  return `<li class="prod_item" data-binding="true" data-id="${escapeHtml(productId)}">
    <div class="form_chk no_label"><input type="checkbox"><label><span class="hidden">상품선택</span></label></div>
    <div class="prod_area">
      <div class="prod_thumb_box size_lg">
        <a class="prod_link" href="${detailUrl}"><span class="img_box"><img loading="lazy" alt="${title}" src="${imageSrc}" data-src="${imageSrc}"></span></a>
        <div class="prod_viewer_control"><a href="${detailUrl}" target="_blank" class="btn_prod_viewer"><span class="ico_blank"></span><span class="text">새창보기</span></a></div>
      </div>
      <div class="prod_info_box">
        <div class="auto_overflow_wrap prod_name_group"><div class="auto_overflow_contents"><div class="auto_overflow_inner"><a href="${detailUrl}" class="prod_info"><span class="prod_name">${title}</span></a></div></div></div>
        <span class="prod_author">${author}${publisher ? ` · ${publisher}` : ''}${date ? `<span class="date"> · ${date}</span>` : ''}</span>
        <div class="prod_price">${discountRate > 0 ? `<span class="percent">${discountRate}%</span>` : ''}<span class="price"><span class="val">${price}</span><span class="unit">원</span></span><span class="price_normal"><span class="text">정가</span><s class="val">${normalPrice}원</s></span><span class="gap">|</span><span class="point">${point}p</span></div>
        <p class="prod_introduction">${introduction}</p>
        <div class="prod_bottom"><div class="review_summary_wrap type_sm"><span class="review_klover_box"><span class="review_klover_text font_size_xxs">${Number.isFinite(reviewScore) ? reviewScore : 0}</span>${reviewCount > 0 ? `<a class="review_desc" href="${detailUrl}#ReviewList1">(${reviewCount}개의 리뷰)</a>` : ''}</span><span class="gap">/</span><span class="review_quotes_text font_size_xxs">${reactionLabel}</span></div><button class="btn_wish_icon" type="button"><span class="ico_wish"></span><span class="hidden">관심 등록</span></button></div>
      </div>
    </div>
    <div class="prod_order_state"></div>
    <div class="prod_btn_wrap"><button class="btn_wish_icon" type="button"><span class="ico_wish"></span><span class="hidden">관심 등록</span></button><div class="btn_wrap full"><a class="btn_light_gray btn_sm"><span class="text">장바구니</span></a><a class="btn_primary btn_sm"><span class="text">바로구매</span></a></div></div>
  </li>`;
}

function extractCategoryCardHtmls(pageText: string): string[] {
  try {
    const parsed = JSON.parse(pageText) as { data?: { tabContents?: unknown[] } };
    const items = Array.isArray(parsed.data?.tabContents) ? parsed.data.tabContents : [];

    return items.map(createCategoryCardHtml).filter((html): html is string => html !== null);
  } catch {
    return [];
  }
}

export class KyoboAdapter implements SiteAdapter {
  public readonly siteName = 'kyobo';

  public supports(url: string): boolean {
    try {
      return KYOBO_HOSTS.has(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  public discoverCards(context: AdapterPageContext): AdapterCard[] {
    if (!this.supports(context.url)) {
      return [];
    }

    const cards: AdapterCard[] = [];

    for (const match of context.html.matchAll(CARD_REGEX)) {
      const html = match[0];
      cards.push({
        html,
        attributes: readAttributes(html)
      });
    }

    return cards;
  }

  public extractProductKeyCandidates(card: AdapterCard): string[] {
    const candidates = new Set<string>();
    const productId = card.attributes['data-prod-id'] ?? card.attributes['data-id'];

    if (productId) {
      candidates.add(productId);
    }

    const href = readHref(card.html);

    if (!href) {
      return [...candidates];
    }

    candidates.add(href);

    const parsedUrl = parseUrlSafely(href);

    if (!parsedUrl) {
      return [...candidates];
    }

    const pathTokens = parsedUrl.pathname.match(NUMERIC_TOKEN_REGEX) ?? [];

    for (const token of pathTokens) {
      candidates.add(token);
    }

    const explicitIds = [
      parsedUrl.searchParams.get('productId'),
      parsedUrl.searchParams.get('id'),
      parsedUrl.searchParams.get('isbn'),
      parsedUrl.searchParams.get('ean'),
      parsedUrl.searchParams.get('barcode')
    ];

    for (const explicitId of explicitIds) {
      if (explicitId) {
        candidates.add(explicitId);
      }
    }

    return [...candidates];
  }

  public getHideButtonHook(card: AdapterCard): HideButtonInsertionHook | null {
    if (!card.html) {
      return null;
    }

    return {
      anchorSelectorCandidates: ['.prod_btn_wrap .btn_wrap.full', '.prod_btn_wrap', '.prod_btn_area', '.prod_btn_box', '.prod_bottom', '.prod_info_box'],
      insertionPosition: 'beforeend'
    };
  }

  public getCardReplenishmentHook(url: string): CardReplenishmentHook | null {
    const parsedUrl = parseAbsoluteUrlSafely(url);

    if (!parsedUrl) {
      return null;
    }

    if (parsedUrl.hostname === KYOBO_PRODUCT_HOST) {
      const categoryMatch = parsedUrl.pathname.match(KYOBO_CATEGORY_PATH_REGEX);

      if (categoryMatch) {
        const saleCmdtDvsnCode = categoryMatch[1];
        const saleCmdtClstCode = categoryMatch[2];

        return {
          containerSelectorCandidates: ['ol.prod_list', 'ul.prod_list', '.prod_list'],
          cardSelector: 'li.prod_item, article.prod_item',
          targetVisibleCardCount: 20,
          maxFetchPages: 3,
          getCurrentPageNumber(currentUrl: string): number | null {
            const currentParsedUrl = parseAbsoluteUrlSafely(currentUrl);

            if (!currentParsedUrl) {
              return null;
            }

            const pageNumber = Number(parseHashSearchParams(currentParsedUrl).get('page') ?? '1');
            return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
          },
          createPageUrl(currentUrl: string, pageNumber: number): string | null {
            const currentParsedUrl = parseAbsoluteUrlSafely(currentUrl);

            if (!currentParsedUrl || !Number.isInteger(pageNumber) || pageNumber < 1) {
              return null;
            }

            const hashParams = parseHashSearchParams(currentParsedUrl);
            const apiUrl = new URL('/api/gw/pdt/category/all', currentParsedUrl.origin);
            apiUrl.searchParams.set('page', String(pageNumber));
            apiUrl.searchParams.set('per', hashParams.get('per') ?? '20');
            apiUrl.searchParams.set('saleCmdtDvsnCode', saleCmdtDvsnCode);
            apiUrl.searchParams.set('saleCmdtClstCode', saleCmdtClstCode);
            apiUrl.searchParams.set('isEvent', 'false');
            apiUrl.searchParams.set('isPackage', 'false');
            apiUrl.searchParams.set('isMDPicked', 'false');
            apiUrl.searchParams.set('sort', hashParams.get('sort') ?? 'new');
            return apiUrl.toString();
          },
          extractCardHtmls: extractCategoryCardHtmls
        };
      }
    }

    if (parsedUrl.hostname !== KYOBO_SEARCH_HOST || parsedUrl.pathname !== KYOBO_SEARCH_PATH) {
      return null;
    }

    return {
      containerSelectorCandidates: ['ul.prod_list', 'ol.prod_list', '.prod_list'],
      cardSelector: 'li.prod_item, article.prod_item',
      targetVisibleCardCount: 20,
      maxFetchPages: 3,
      getCurrentPageNumber(currentUrl: string): number | null {
        const currentParsedUrl = parseAbsoluteUrlSafely(currentUrl);

        if (!currentParsedUrl) {
          return null;
        }

        const pageNumber = Number(currentParsedUrl.searchParams.get('page') ?? '1');

        return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
      },
      createPageUrl(currentUrl: string, pageNumber: number): string | null {
        const currentParsedUrl = parseAbsoluteUrlSafely(currentUrl);

        if (!currentParsedUrl || !Number.isInteger(pageNumber) || pageNumber < 1) {
          return null;
        }

        currentParsedUrl.searchParams.set('page', String(pageNumber));
        return currentParsedUrl.toString();
      }
    };
  }
}
