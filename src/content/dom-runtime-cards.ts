import type { AdapterCard, SiteAdapter } from '../adapters/site-adapter';
import type { RuntimeCard } from './runtime';

export const RUNTIME_CARD_SELECTOR = 'article.prod_item';

export const HIDE_BUTTON_MARKER_ATTRIBUTE = 'data-kyobo-hide-list-hide-button';
export const HIDE_BUTTON_MARKER_VALUE = 'true';
export const HIDE_BUTTON_CLASS_NAME = 'kyobo-hide-list-hide-button';
export const HIDDEN_CARD_MARKER_ATTRIBUTE = 'data-kyobo-hide-list-hidden';

function readAdapterCardFromElement(cardElement: HTMLElement): AdapterCard {
  const attributes: Record<string, string> = {};

  for (const attribute of Array.from(cardElement.attributes)) {
    attributes[attribute.name] = attribute.value;
  }

  return {
    html: cardElement.outerHTML,
    attributes
  };
}

function selectInsertionAnchor(cardElement: HTMLElement, selectorCandidates: readonly string[]): HTMLElement | null {
  for (const selector of selectorCandidates) {
    const anchor = cardElement.querySelector<HTMLElement>(selector);

    if (anchor) {
      return anchor;
    }
  }

  return null;
}

function createHideButton(ownerDocument: Document, onClick: () => Promise<void> | void): HTMLButtonElement {
  const buttonElement = ownerDocument.createElement('button');
  buttonElement.type = 'button';
  buttonElement.textContent = '숨기기';
  buttonElement.className = HIDE_BUTTON_CLASS_NAME;
  buttonElement.setAttribute(HIDE_BUTTON_MARKER_ATTRIBUTE, HIDE_BUTTON_MARKER_VALUE);
  buttonElement.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void onClick();
  });
  return buttonElement;
}

export function createDomRuntimeCards(rootDocument: Document, adapter: SiteAdapter): RuntimeCard[] {
  const cardElements = Array.from(rootDocument.querySelectorAll<HTMLElement>(RUNTIME_CARD_SELECTOR));

  return cardElements.map((cardElement) => {
    const adapterCard = readAdapterCardFromElement(cardElement);

    return {
      adapterCard,
      hasHideButton(): boolean {
        return cardElement.querySelector(`[${HIDE_BUTTON_MARKER_ATTRIBUTE}="${HIDE_BUTTON_MARKER_VALUE}"]`) !== null;
      },
      injectHideButton(onClick: () => Promise<void> | void): void {
        if (this.hasHideButton()) {
          return;
        }

        const hideButtonHook = adapter.getHideButtonHook(adapterCard);

        if (!hideButtonHook) {
          return;
        }

        const anchor = selectInsertionAnchor(cardElement, hideButtonHook.anchorSelectorCandidates);
        const hideButton = createHideButton(rootDocument, onClick);

        if (anchor) {
          anchor.insertAdjacentElement(hideButtonHook.insertionPosition, hideButton);
          return;
        }

        cardElement.insertAdjacentElement('afterbegin', hideButton);
      },
      hide(): void {
        cardElement.style.display = 'none';
        cardElement.setAttribute(HIDDEN_CARD_MARKER_ATTRIBUTE, 'true');
      },
      show(): void {
        cardElement.style.display = '';
        cardElement.removeAttribute(HIDDEN_CARD_MARKER_ATTRIBUTE);
      }
    };
  });
}

export function revealHiddenRuntimeCards(rootDocument: Document): void {
  const hiddenCardElements = Array.from(rootDocument.querySelectorAll<HTMLElement>(`[${HIDDEN_CARD_MARKER_ATTRIBUTE}="true"]`));

  for (const hiddenCardElement of hiddenCardElements) {
    hiddenCardElement.style.display = '';
    hiddenCardElement.removeAttribute(HIDDEN_CARD_MARKER_ATTRIBUTE);
  }
}
