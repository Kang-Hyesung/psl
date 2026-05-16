export const HIDE_LIST_MUTATION_REQUEST_MESSAGE = 'hide-list/mutation-request' as const;
export const HIDE_LIST_SNAPSHOT_REQUEST_MESSAGE = 'hide-list/snapshot-request' as const;
export const HIDE_LIST_MUTATION_RESULT_MESSAGE = 'hide-list/mutation-result' as const;
export const HIDE_LIST_SNAPSHOT_RESULT_MESSAGE = 'hide-list/snapshot-result' as const;
export const HIDE_LIST_STATE_SYNC_MESSAGE = 'hide-list/state-sync' as const;

const CONTEXT_SOURCE_ORDER: Record<HideListClientSource, number> = {
  content: 0,
  popup: 1,
  options: 2
};

export type HideListMessageSource = 'content' | 'popup' | 'options' | 'background';
export type HideListClientSource = Exclude<HideListMessageSource, 'background'>;
export type HideListMutationOperation = 'add' | 'remove';
export type HideListIgnoredMutationReason = 'stale' | 'invalid_hidden_key' | 'write_failed';

export interface HideListStateSnapshot {
  revision: number;
  hiddenKeys: string[];
}

export interface HideListMutationClock {
  issuedAtMs: number;
  requestId: string;
  source: HideListClientSource;
}

export interface HideListMutationRequestMessage {
  type: typeof HIDE_LIST_MUTATION_REQUEST_MESSAGE;
  source: HideListClientSource;
  requestId: string;
  mutation: {
    operation: HideListMutationOperation;
    hiddenKey: string;
    issuedAtMs: number;
  };
}

export interface HideListSnapshotRequestMessage {
  type: typeof HIDE_LIST_SNAPSHOT_REQUEST_MESSAGE;
  source: HideListClientSource;
  requestId: string;
}

export interface HideListMutationResultMessage {
  type: typeof HIDE_LIST_MUTATION_RESULT_MESSAGE;
  source: 'background';
  requestId: string;
  result: 'applied' | 'ignored';
  ignoredReason?: HideListIgnoredMutationReason;
  state: HideListStateSnapshot;
}

export interface HideListSnapshotResultMessage {
  type: typeof HIDE_LIST_SNAPSHOT_RESULT_MESSAGE;
  source: 'background';
  requestId: string;
  state: HideListStateSnapshot;
}

export interface HideListStateSyncMessage {
  type: typeof HIDE_LIST_STATE_SYNC_MESSAGE;
  source: 'background';
  requestId: string;
  trigger: 'mutation' | 'snapshot';
  state: HideListStateSnapshot;
}

export type HideListBackgroundInboundMessage = HideListMutationRequestMessage | HideListSnapshotRequestMessage;
export type HideListBackgroundResponseMessage = HideListMutationResultMessage | HideListSnapshotResultMessage;
export type HideListContextInboundMessage = HideListStateSyncMessage;

type HideListAnyRuntimeMessage =
  | HideListMutationRequestMessage
  | HideListSnapshotRequestMessage
  | HideListMutationResultMessage
  | HideListSnapshotResultMessage
  | HideListStateSyncMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHideListClientSource(value: unknown): value is HideListClientSource {
  return value === 'content' || value === 'popup' || value === 'options';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeHiddenKeys(rawHiddenKeys: unknown): string[] {
  if (!Array.isArray(rawHiddenKeys)) {
    return [];
  }

  const normalizedHiddenKeys: string[] = [];

  for (const rawHiddenKey of rawHiddenKeys) {
    const hiddenKey = normalizeString(rawHiddenKey);

    if (!hiddenKey || normalizedHiddenKeys.includes(hiddenKey)) {
      continue;
    }

    normalizedHiddenKeys.push(hiddenKey);
  }

  return normalizedHiddenKeys;
}

function parseHideListStateSnapshot(rawState: unknown): HideListStateSnapshot | null {
  if (!isRecord(rawState)) {
    return null;
  }

  const revision = rawState.revision;

  if (!isNonNegativeInteger(revision)) {
    return null;
  }

  return {
    revision,
    hiddenKeys: normalizeHiddenKeys(rawState.hiddenKeys)
  };
}

function parseHideListMutationRequestMessage(rawMessage: Record<string, unknown>): HideListMutationRequestMessage | null {
  const source = rawMessage.source;
  const requestId = normalizeString(rawMessage.requestId);
  const mutation = rawMessage.mutation;

  if (!isHideListClientSource(source) || !requestId || !isRecord(mutation)) {
    return null;
  }

  const operation = mutation.operation;
  const hiddenKey = mutation.hiddenKey;
  const issuedAtMs = mutation.issuedAtMs;

  if ((operation !== 'add' && operation !== 'remove') || typeof hiddenKey !== 'string' || !isFiniteNumber(issuedAtMs)) {
    return null;
  }

  return {
    type: HIDE_LIST_MUTATION_REQUEST_MESSAGE,
    source,
    requestId,
    mutation: {
      operation,
      hiddenKey,
      issuedAtMs
    }
  };
}

function parseHideListSnapshotRequestMessage(rawMessage: Record<string, unknown>): HideListSnapshotRequestMessage | null {
  const source = rawMessage.source;
  const requestId = normalizeString(rawMessage.requestId);

  if (!isHideListClientSource(source) || !requestId) {
    return null;
  }

  return {
    type: HIDE_LIST_SNAPSHOT_REQUEST_MESSAGE,
    source,
    requestId
  };
}

function parseHideListMutationResultMessage(rawMessage: Record<string, unknown>): HideListMutationResultMessage | null {
  const requestId = normalizeString(rawMessage.requestId);
  const state = parseHideListStateSnapshot(rawMessage.state);
  const result = rawMessage.result;
  const ignoredReason = rawMessage.ignoredReason;

  if (rawMessage.source !== 'background' || !requestId || !state || (result !== 'applied' && result !== 'ignored')) {
    return null;
  }

  if (result === 'ignored') {
    if (ignoredReason !== 'stale' && ignoredReason !== 'invalid_hidden_key' && ignoredReason !== 'write_failed') {
      return null;
    }

    return {
      type: HIDE_LIST_MUTATION_RESULT_MESSAGE,
      source: 'background',
      requestId,
      result,
      ignoredReason,
      state
    };
  }

  return {
    type: HIDE_LIST_MUTATION_RESULT_MESSAGE,
    source: 'background',
    requestId,
    result,
    state
  };
}

function parseHideListSnapshotResultMessage(rawMessage: Record<string, unknown>): HideListSnapshotResultMessage | null {
  const requestId = normalizeString(rawMessage.requestId);
  const state = parseHideListStateSnapshot(rawMessage.state);

  if (rawMessage.source !== 'background' || !requestId || !state) {
    return null;
  }

  return {
    type: HIDE_LIST_SNAPSHOT_RESULT_MESSAGE,
    source: 'background',
    requestId,
    state
  };
}

function parseHideListStateSyncMessage(rawMessage: Record<string, unknown>): HideListStateSyncMessage | null {
  const requestId = normalizeString(rawMessage.requestId);
  const state = parseHideListStateSnapshot(rawMessage.state);
  const trigger = rawMessage.trigger;

  if (rawMessage.source !== 'background' || !requestId || !state || (trigger !== 'mutation' && trigger !== 'snapshot')) {
    return null;
  }

  return {
    type: HIDE_LIST_STATE_SYNC_MESSAGE,
    source: 'background',
    requestId,
    trigger,
    state
  };
}

export function compareMutationClocks(left: HideListMutationClock, right: HideListMutationClock): number {
  if (left.issuedAtMs !== right.issuedAtMs) {
    return left.issuedAtMs - right.issuedAtMs;
  }

  if (left.requestId !== right.requestId) {
    return left.requestId.localeCompare(right.requestId);
  }

  return CONTEXT_SOURCE_ORDER[left.source] - CONTEXT_SOURCE_ORDER[right.source];
}

export function parseHideListBackgroundInboundMessage(rawMessage: unknown): HideListBackgroundInboundMessage | null {
  if (!isRecord(rawMessage)) {
    return null;
  }

  const messageType = rawMessage.type;

  if (messageType === HIDE_LIST_MUTATION_REQUEST_MESSAGE) {
    return parseHideListMutationRequestMessage(rawMessage);
  }

  if (messageType === HIDE_LIST_SNAPSHOT_REQUEST_MESSAGE) {
    return parseHideListSnapshotRequestMessage(rawMessage);
  }

  return null;
}

export function parseHideListBackgroundResponseMessage(rawMessage: unknown): HideListBackgroundResponseMessage | null {
  if (!isRecord(rawMessage)) {
    return null;
  }

  const messageType = rawMessage.type;

  if (messageType === HIDE_LIST_MUTATION_RESULT_MESSAGE) {
    return parseHideListMutationResultMessage(rawMessage);
  }

  if (messageType === HIDE_LIST_SNAPSHOT_RESULT_MESSAGE) {
    return parseHideListSnapshotResultMessage(rawMessage);
  }

  return null;
}

export function parseHideListContextInboundMessage(rawMessage: unknown): HideListContextInboundMessage | null {
  if (!isRecord(rawMessage)) {
    return null;
  }

  if (rawMessage.type === HIDE_LIST_STATE_SYNC_MESSAGE) {
    return parseHideListStateSyncMessage(rawMessage);
  }

  return null;
}

export function createHideListMutationRequestMessage(input: {
  source: HideListClientSource;
  requestId: string;
  operation: HideListMutationOperation;
  hiddenKey: string;
  issuedAtMs: number;
}): HideListMutationRequestMessage {
  return {
    type: HIDE_LIST_MUTATION_REQUEST_MESSAGE,
    source: input.source,
    requestId: input.requestId,
    mutation: {
      operation: input.operation,
      hiddenKey: input.hiddenKey,
      issuedAtMs: input.issuedAtMs
    }
  };
}

export function createHideListSnapshotRequestMessage(input: {
  source: HideListClientSource;
  requestId: string;
}): HideListSnapshotRequestMessage {
  return {
    type: HIDE_LIST_SNAPSHOT_REQUEST_MESSAGE,
    source: input.source,
    requestId: input.requestId
  };
}

export function createHideListMutationResultMessage(input: {
  requestId: string;
  state: HideListStateSnapshot;
  result: 'applied' | 'ignored';
  ignoredReason?: HideListIgnoredMutationReason;
}): HideListMutationResultMessage {
  return {
    type: HIDE_LIST_MUTATION_RESULT_MESSAGE,
    source: 'background',
    requestId: input.requestId,
    state: input.state,
    result: input.result,
    ...(input.result === 'ignored' ? { ignoredReason: input.ignoredReason ?? 'stale' } : {})
  };
}

export function createHideListSnapshotResultMessage(input: {
  requestId: string;
  state: HideListStateSnapshot;
}): HideListSnapshotResultMessage {
  return {
    type: HIDE_LIST_SNAPSHOT_RESULT_MESSAGE,
    source: 'background',
    requestId: input.requestId,
    state: input.state
  };
}

export function createHideListStateSyncMessage(input: {
  requestId: string;
  trigger: 'mutation' | 'snapshot';
  state: HideListStateSnapshot;
}): HideListStateSyncMessage {
  return {
    type: HIDE_LIST_STATE_SYNC_MESSAGE,
    source: 'background',
    requestId: input.requestId,
    trigger: input.trigger,
    state: input.state
  };
}

export function sanitizeHiddenKey(rawHiddenKey: string): string | null {
  return normalizeString(rawHiddenKey);
}

export function isHideListRuntimeMessage(rawMessage: unknown): rawMessage is HideListAnyRuntimeMessage {
  return (
    parseHideListBackgroundInboundMessage(rawMessage) !== null ||
    parseHideListBackgroundResponseMessage(rawMessage) !== null ||
    parseHideListContextInboundMessage(rawMessage) !== null
  );
}
