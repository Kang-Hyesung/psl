import {
  type AdapterCard,
  type AdapterPageContext,
  type HideButtonInsertionHook,
  type SiteAdapter
} from './site-adapter';

const KYOBO_HOST = 'www.kyobobook.co.kr';
const CARD_REGEX = /<article\b[^>]*class=(?:"[^"]*\bprod_item\b[^"]*"|'[^']*\bprod_item\b[^']*')[^>]*>[\s\S]*?<\/article>/gi;
const OPENING_TAG_REGEX = /^<article\b([^>]*)>/i;
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
    return new URL(href, `https://${KYOBO_HOST}`);
  } catch {
    return null;
  }
}

export class KyoboAdapter implements SiteAdapter {
  public readonly siteName = 'kyobo';

  public supports(url: string): boolean {
    try {
      return new URL(url).hostname === KYOBO_HOST;
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
    const productId = card.attributes['data-prod-id'];

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
      anchorSelectorCandidates: ['.prod_btn_area', '.prod_info'],
      insertionPosition: 'beforeend'
    };
  }
}
