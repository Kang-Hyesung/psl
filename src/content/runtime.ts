import type { AdapterCard, SiteAdapter } from '../adapters/site-adapter';
import { resolveCanonicalProductKey } from '../core/key/canonical-key';
import type { HideListMutationOperation } from '../shared/hide-list-messaging';

export interface HiddenKeyRepository {
  list(): Promise<string[]>;
  add(hiddenKey: string): Promise<string[]>;
}

export interface RuntimeCard {
  readonly adapterCard: AdapterCard;
  hasHideButton(): boolean;
  injectHideButton(onClick: () => Promise<void> | void): void;
  hide(): void;
  show(): void;
}

export interface HideListMutationPublisher {
  publishMutation(operation: HideListMutationOperation, hiddenKey: string): Promise<boolean>;
}

export interface RunHideContentFlowInput {
  url: string;
  adapter: SiteAdapter;
  repository: HiddenKeyRepository;
  cards: readonly RuntimeCard[];
  mutationPublisher?: HideListMutationPublisher;
}

function resolveCardCanonicalKey(adapter: SiteAdapter, card: RuntimeCard): string | null {
  return resolveCanonicalProductKey(adapter.extractProductKeyCandidates(card.adapterCard));
}

export async function persistAndHideCard(
  adapter: SiteAdapter,
  repository: HiddenKeyRepository,
  card: RuntimeCard,
  mutationPublisher?: HideListMutationPublisher
): Promise<void> {
  const canonicalKey = resolveCardCanonicalKey(adapter, card);

  if (!canonicalKey) {
    return;
  }

  let persistedByMessagingLayer = false;

  if (mutationPublisher) {
    try {
      persistedByMessagingLayer = await mutationPublisher.publishMutation('add', canonicalKey);
    } catch {
      persistedByMessagingLayer = false;
    }
  }

  try {
    if (!persistedByMessagingLayer) {
      await repository.add(canonicalKey);
    }
  } catch {
    // No-op: user interaction should still hide locally.
  }

  card.hide();
}

export async function runHideContentFlow(input: RunHideContentFlowInput): Promise<void> {
  if (!input.adapter.supports(input.url)) {
    return;
  }

  let persistedHiddenKeys: string[] = [];

  try {
    persistedHiddenKeys = await input.repository.list();
  } catch {
    persistedHiddenKeys = [];
  }

  const persistedHiddenKeySet = new Set(persistedHiddenKeys);

  for (const card of input.cards) {
    try {
      if (!card.hasHideButton()) {
        card.injectHideButton(() => persistAndHideCard(input.adapter, input.repository, card, input.mutationPublisher));
      }

      const canonicalKey = resolveCardCanonicalKey(input.adapter, card);

      if (canonicalKey && persistedHiddenKeySet.has(canonicalKey)) {
        card.hide();
      } else {
        card.show();
      }
    } catch {
      // Per-card no-op safety to avoid breaking the whole page.
    }
  }
}
