import type { AdapterCard, CardReplenishmentHook, SiteAdapter } from '../adapters/site-adapter';
import { resolveCanonicalProductKey } from '../core/key/canonical-key';
import { HIDDEN_CARD_MARKER_ATTRIBUTE } from './dom-runtime-cards';

const REPLENISHED_CARD_MARKER_ATTRIBUTE = 'data-kyobo-hide-list-replenished';
const REPLENISHED_CARD_PAGE_ATTRIBUTE = 'data-kyobo-hide-list-replenished-page';

export interface CardReplenishmentInput {
  url: string;
  hiddenKeys: readonly string[];
}

export interface CardReplenisher {
  replenish(input: CardReplenishmentInput): Promise<void>;
}

export interface CreateDomCardReplenisherInput {
  rootDocument: Document;
  adapter: SiteAdapter;
  fetchPage?: (url: string) => Promise<string | null>;
}

function readAttributes(element: HTMLElement): Record<string, string> {
  const attributes: Record<string, string> = {};

  for (const attribute of Array.from(element.attributes)) {
    attributes[attribute.name] = attribute.value;
  }

  return attributes;
}

function readAdapterCardFromElement(element: HTMLElement): AdapterCard {
  return {
    html: element.outerHTML,
    attributes: readAttributes(element)
  };
}

function resolveCardKey(adapter: SiteAdapter, element: HTMLElement): string | null {
  return resolveCanonicalProductKey(adapter.extractProductKeyCandidates(readAdapterCardFromElement(element)));
}

function findFirstElement(root: ParentNode, selectorCandidates: readonly string[]): HTMLElement | null {
  for (const selector of selectorCandidates) {
    const element = root.querySelector<HTMLElement>(selector);

    if (element) {
      return element;
    }
  }

  return null;
}

function findCardContainer(root: ParentNode, hook: CardReplenishmentHook): HTMLElement | null {
  const fallbackContainer = findFirstElement(root, hook.containerSelectorCandidates);

  for (const selector of hook.containerSelectorCandidates) {
    const containers = Array.from(root.querySelectorAll<HTMLElement>(selector));
    const populatedContainer = containers.find((container) => container.querySelector(hook.cardSelector) !== null);

    if (populatedContainer) {
      return populatedContainer;
    }
  }

  return fallbackContainer;
}

function isElementHidden(element: HTMLElement): boolean {
  return element.getAttribute(HIDDEN_CARD_MARKER_ATTRIBUTE) === 'true' || element.style.display === 'none';
}

function countVisibleCards(container: HTMLElement, hook: CardReplenishmentHook): number {
  return Array.from(container.querySelectorAll<HTMLElement>(hook.cardSelector)).filter((cardElement) => !isElementHidden(cardElement)).length;
}

function createPageKey(adapter: SiteAdapter, url: string): string {
  try {
    const parsedUrl = new URL(url);
    parsedUrl.searchParams.delete('page');
    return `${adapter.siteName}:${parsedUrl.origin}${parsedUrl.pathname}?${parsedUrl.searchParams.toString()}`;
  } catch {
    return `${adapter.siteName}:${url}`;
  }
}

function stripDuplicateIds(element: HTMLElement): void {
  element.removeAttribute('id');

  for (const child of Array.from(element.querySelectorAll<HTMLElement>('[id]'))) {
    child.removeAttribute('id');
  }
}

function createCardElementsFromPageText(ownerDocument: Document, hook: CardReplenishmentHook, pageText: string): HTMLElement[] {
  if (hook.extractCardHtmls) {
    const template = ownerDocument.createElement('template');
    const cardElements: HTMLElement[] = [];

    for (const cardHtml of hook.extractCardHtmls(pageText)) {
      template.innerHTML = cardHtml.trim();

      const cardElement = template.content.firstElementChild;

      if (cardElement instanceof HTMLElement) {
        cardElements.push(cardElement);
      }
    }

    return cardElements;
  }

  const fetchedDocument = new DOMParser().parseFromString(pageText, 'text/html');
  const fetchedContainer = findFirstElement(fetchedDocument, hook.containerSelectorCandidates) ?? fetchedDocument.body;

  return Array.from(fetchedContainer.querySelectorAll<HTMLElement>(hook.cardSelector));
}

function defaultFetchPage(url: string): Promise<string | null> {
  return fetch(url, {
    credentials: 'include'
  })
    .then((response) => {
      if (!response.ok) {
        return null;
      }

      return response.text();
    })
    .catch(() => null);
}

export function createDomCardReplenisher(input: CreateDomCardReplenisherInput): CardReplenisher {
  const fetchPage = input.fetchPage ?? defaultFetchPage;
  const nextPageNumberByPageKey = new Map<string, number>();

  return {
    async replenish(replenishmentInput: CardReplenishmentInput): Promise<void> {
      const hook = input.adapter.getCardReplenishmentHook?.(replenishmentInput.url);

      if (!hook) {
        return;
      }

      const container = findCardContainer(input.rootDocument, hook);

      if (!container) {
        return;
      }

      const existingCardElements = Array.from(container.querySelectorAll<HTMLElement>(hook.cardSelector));

      if (existingCardElements.length === 0) {
        return;
      }

      const currentPageNumber = hook.getCurrentPageNumber(replenishmentInput.url);

      if (!currentPageNumber) {
        return;
      }

      const pageKey = createPageKey(input.adapter, replenishmentInput.url);
      const hiddenKeySet = new Set(replenishmentInput.hiddenKeys);
      const existingKeySet = new Set<string>();

      for (const cardElement of existingCardElements) {
        const key = resolveCardKey(input.adapter, cardElement);

        if (key) {
          existingKeySet.add(key);
        }
      }

      let missingCardCount = hook.targetVisibleCardCount - countVisibleCards(container, hook);

      if (missingCardCount <= 0) {
        return;
      }

      let nextPageNumber = nextPageNumberByPageKey.get(pageKey) ?? currentPageNumber + 1;

      for (let fetchedPageCount = 0; missingCardCount > 0 && fetchedPageCount < hook.maxFetchPages; fetchedPageCount += 1) {
        const nextPageUrl = hook.createPageUrl(replenishmentInput.url, nextPageNumber);

        if (!nextPageUrl) {
          return;
        }

        nextPageNumberByPageKey.set(pageKey, nextPageNumber + 1);
        nextPageNumber += 1;

        const pageHtml = await fetchPage(nextPageUrl);

        if (!pageHtml) {
          return;
        }

        const fetchedCards = createCardElementsFromPageText(input.rootDocument, hook, pageHtml);
        let appendedCardCount = 0;

        for (const fetchedCard of fetchedCards) {
          const key = resolveCardKey(input.adapter, fetchedCard);

          if (!key || hiddenKeySet.has(key) || existingKeySet.has(key)) {
            continue;
          }

          const cardClone = fetchedCard.cloneNode(true) as HTMLElement;
          stripDuplicateIds(cardClone);
          cardClone.setAttribute(REPLENISHED_CARD_MARKER_ATTRIBUTE, 'true');
          cardClone.setAttribute(REPLENISHED_CARD_PAGE_ATTRIBUTE, String(nextPageNumber - 1));
          container.appendChild(cardClone);
          existingKeySet.add(key);
          missingCardCount -= 1;
          appendedCardCount += 1;

          if (missingCardCount <= 0) {
            break;
          }
        }

        if (fetchedCards.length === 0 || appendedCardCount === 0) {
          continue;
        }
      }
    }
  };
}
