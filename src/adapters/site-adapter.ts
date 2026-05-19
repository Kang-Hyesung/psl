export type HideButtonInsertionPosition = 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend';

export interface HideButtonInsertionHook {
  anchorSelectorCandidates: string[];
  insertionPosition: HideButtonInsertionPosition;
}

export interface AdapterCard {
  html: string;
  attributes: Record<string, string>;
}

export interface AdapterPageContext {
  url: string;
  html: string;
}

export interface CardReplenishmentHook {
  containerSelectorCandidates: string[];
  cardSelector: string;
  targetVisibleCardCount: number;
  maxFetchPages: number;
  getCurrentPageNumber(url: string): number | null;
  createPageUrl(url: string, pageNumber: number): string | null;
  extractCardHtmls?(pageText: string): string[];
}

export interface SiteAdapter {
  readonly siteName: string;
  supports(url: string): boolean;
  discoverCards(context: AdapterPageContext): AdapterCard[];
  extractProductKeyCandidates(card: AdapterCard): string[];
  getHideButtonHook(card: AdapterCard): HideButtonInsertionHook | null;
  getCardReplenishmentHook?(url: string): CardReplenishmentHook | null;
}
