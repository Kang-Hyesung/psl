import type { AdapterCard, SiteAdapter } from '../adapters/site-adapter';
import type { RuntimeCard } from './runtime';

const PRIMARY_RUNTIME_CARD_SELECTOR = 'li.prod_item, article.prod_item';
const FALLBACK_RUNTIME_CARD_SELECTOR = '.prod_area';

export const RUNTIME_CARD_SELECTOR = `${PRIMARY_RUNTIME_CARD_SELECTOR}, ${FALLBACK_RUNTIME_CARD_SELECTOR}`;

export const HIDE_BUTTON_MARKER_ATTRIBUTE = 'data-kyobo-hide-list-hide-button';
export const HIDE_BUTTON_MARKER_VALUE = 'true';
export const HIDE_BUTTON_CLASS_NAME = 'kyobo-hide-list-hide-button';
export const HIDDEN_CARD_MARKER_ATTRIBUTE = 'data-kyobo-hide-list-hidden';

type HideButtonVariant = 'full' | 'compact';

interface InsertionAnchor {
  element: HTMLElement;
  selector: string;
  insertionPosition: InsertPosition;
}

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

function selectInsertionAnchor(cardElement: HTMLElement, selectorCandidates: readonly string[], defaultInsertionPosition: InsertPosition): InsertionAnchor | null {
  for (const selector of selectorCandidates) {
    const anchor = cardElement.querySelector<HTMLElement>(selector);

    if (anchor && isElementVisibleForInsertion(anchor)) {
      return {
        element: anchor,
        selector,
        insertionPosition: selector === '.prod_bottom' ? 'afterend' : defaultInsertionPosition
      };
    }
  }

  return null;
}

function isElementVisibleForInsertion(element: HTMLElement): boolean {
  const ownerWindow = element.ownerDocument.defaultView;

  if (!ownerWindow) {
    return true;
  }

  for (let currentElement: HTMLElement | null = element; currentElement; currentElement = currentElement.parentElement) {
    const style = ownerWindow.getComputedStyle(currentElement);

    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
  }

  return element.getClientRects().length > 0;
}

function isInjectedButtonVisible(buttonElement: HTMLElement): boolean {
  const ownerWindow = buttonElement.ownerDocument.defaultView;

  if (!ownerWindow || buttonElement.getClientRects().length === 0) {
    return false;
  }

  const style = ownerWindow.getComputedStyle(buttonElement);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function resolveHideButtonVariant(anchorSelector: string | null): HideButtonVariant {
  if (!anchorSelector) {
    return 'compact';
  }

  return anchorSelector.includes('prod_btn') ? 'full' : 'compact';
}

function createHideButton(ownerDocument: Document, variant: HideButtonVariant, onClick: () => Promise<void> | void): HTMLButtonElement {
  const buttonElement = ownerDocument.createElement('button');
  buttonElement.type = 'button';
  buttonElement.textContent = '\uC228\uAE30\uAE30';
  buttonElement.className = HIDE_BUTTON_CLASS_NAME;
  Object.assign(buttonElement.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    position: variant === 'full' ? 'static' : 'absolute',
    top: variant === 'full' ? 'auto' : '0',
    right: variant === 'full' ? 'auto' : '0',
    zIndex: variant === 'full' ? 'auto' : '10',
    minHeight: variant === 'full' ? '32px' : '28px',
    width: variant === 'full' ? '100%' : 'auto',
    minWidth: variant === 'full' ? '0' : '64px',
    padding: variant === 'full' ? '0 12px' : '0 10px',
    marginTop: variant === 'full' ? '8px' : '0',
    marginLeft: '0',
    border: '1px solid #f1b8b2',
    borderRadius: '6px',
    background: '#fff7f6',
    color: '#b42318',
    fontSize: '12px',
    fontWeight: '600',
    lineHeight: '1',
    cursor: 'pointer',
    flex: '0 0 auto'
  });
  buttonElement.setAttribute(HIDE_BUTTON_MARKER_ATTRIBUTE, HIDE_BUTTON_MARKER_VALUE);
  buttonElement.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void onClick();
  });
  return buttonElement;
}

function prepareCardForHideButton(cardElement: HTMLElement, variant: HideButtonVariant, ownerDocument: Document): void {
  if (variant !== 'compact') {
    return;
  }

  const ownerWindow = ownerDocument.defaultView;

  if (!ownerWindow) {
    cardElement.style.position = cardElement.style.position || 'relative';
    return;
  }

  if (ownerWindow.getComputedStyle(cardElement).position === 'static') {
    cardElement.style.position = 'relative';
  }
}

function isProductLikeElement(cardElement: HTMLElement): boolean {
  return (
    cardElement.hasAttribute('data-prod-id') ||
    cardElement.hasAttribute('data-id') ||
    cardElement.querySelector('a[href*="/detail/"], a[href*="detailView"]') !== null
  );
}

function selectRuntimeCardElements(rootDocument: Document): HTMLElement[] {
  const primaryCardElements = Array.from(rootDocument.querySelectorAll<HTMLElement>(PRIMARY_RUNTIME_CARD_SELECTOR));
  const fallbackCardElements = Array.from(rootDocument.querySelectorAll<HTMLElement>(FALLBACK_RUNTIME_CARD_SELECTOR)).filter(
    (cardElement) =>
      cardElement.closest(PRIMARY_RUNTIME_CARD_SELECTOR) === null &&
      isProductLikeElement(cardElement)
  );

  return [...primaryCardElements, ...fallbackCardElements];
}

export function createDomRuntimeCards(rootDocument: Document, adapter: SiteAdapter): RuntimeCard[] {
  const cardElements = selectRuntimeCardElements(rootDocument);

  return cardElements.map((cardElement) => {
    const adapterCard = readAdapterCardFromElement(cardElement);

    return {
      adapterCard,
      hasHideButton(): boolean {
        const hideButton = cardElement.querySelector<HTMLElement>(
          `[${HIDE_BUTTON_MARKER_ATTRIBUTE}="${HIDE_BUTTON_MARKER_VALUE}"]`
        );

        return hideButton !== null && isInjectedButtonVisible(hideButton);
      },
      injectHideButton(onClick: () => Promise<void> | void): void {
        const existingHideButton = cardElement.querySelector<HTMLElement>(
          `[${HIDE_BUTTON_MARKER_ATTRIBUTE}="${HIDE_BUTTON_MARKER_VALUE}"]`
        );

        if (existingHideButton) {
          if (isInjectedButtonVisible(existingHideButton)) {
            return;
          }

          existingHideButton.remove();
        }

        const hideButtonHook = adapter.getHideButtonHook(adapterCard);

        if (!hideButtonHook) {
          return;
        }

        const anchor = selectInsertionAnchor(cardElement, hideButtonHook.anchorSelectorCandidates, hideButtonHook.insertionPosition);
        const hideButtonVariant = resolveHideButtonVariant(anchor?.selector ?? null);
        prepareCardForHideButton(cardElement, hideButtonVariant, rootDocument);
        const hideButton = createHideButton(rootDocument, hideButtonVariant, onClick);

        if (anchor) {
          anchor.element.insertAdjacentElement(anchor.insertionPosition, hideButton);
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
