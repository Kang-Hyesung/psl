import {
  createHideListMutationRequestMessage,
  createHideListSnapshotRequestMessage,
  parseHideListBackgroundResponseMessage,
  parseHideListContextInboundMessage,
  type HideListClientSource,
  type HideListContextInboundMessage,
  type HideListMutationOperation,
  type HideListMutationResultMessage,
  type HideListStateSnapshot
} from './hide-list-messaging';
import type { RuntimeMessageListener, RuntimeMessagePort } from './runtime-message-port';

const DEFAULT_REQUEST_TIMEOUT_MS = 250;

interface HideListMutationRequestOptions {
  issuedAtMs?: number;
  requestId?: string;
}

interface HideListSnapshotRequestOptions {
  requestId?: string;
}

export interface CreateHideListSyncClientInput {
  source: HideListClientSource;
  runtime?: RuntimeMessagePort | null;
  requestTimeoutMs?: number;
  now?: () => number;
}

export interface HideListSyncClient {
  mutateHiddenKey(
    operation: HideListMutationOperation,
    hiddenKey: string,
    options?: HideListMutationRequestOptions
  ): Promise<HideListMutationResultMessage | null>;
  requestSnapshot(options?: HideListSnapshotRequestOptions): Promise<HideListStateSnapshot | null>;
  subscribeToSync(onSync: (message: HideListContextInboundMessage) => void): () => void;
}

function resolveDefaultRuntimePort(): RuntimeMessagePort | null {
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    return null;
  }

  return chrome.runtime as unknown as RuntimeMessagePort;
}

function createRequestIdFactory(source: HideListClientSource): () => string {
  let sequence = 0;

  return (): string => {
    sequence += 1;
    return `${source}-${Date.now()}-${sequence}`;
  };
}

function sendRuntimeRequest(
  runtime: RuntimeMessagePort,
  request: unknown,
  timeoutMs: number,
  parseResponse: (rawResponse: unknown) => unknown
): Promise<unknown> {
  return new Promise((resolve) => {
    let isSettled = false;

    const complete = (value: unknown): void => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(timeoutHandle);
      resolve(value);
    };

    const timeoutHandle = setTimeout(() => {
      complete(null);
    }, timeoutMs);

    try {
      runtime.sendMessage(request, (rawResponse) => {
        complete(parseResponse(rawResponse));
      });
    } catch {
      complete(null);
    }
  });
}

export function createHideListSyncClient(input: CreateHideListSyncClientInput): HideListSyncClient {
  const runtime = input.runtime ?? resolveDefaultRuntimePort();
  const now = input.now ?? Date.now;
  const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const generateRequestId = createRequestIdFactory(input.source);

  return {
    async mutateHiddenKey(
      operation: HideListMutationOperation,
      hiddenKey: string,
      options: HideListMutationRequestOptions = {}
    ): Promise<HideListMutationResultMessage | null> {
      if (!runtime) {
        return null;
      }

      const requestId = options.requestId ?? generateRequestId();
      const request = createHideListMutationRequestMessage({
        source: input.source,
        requestId,
        operation,
        hiddenKey,
        issuedAtMs: options.issuedAtMs ?? now()
      });

      const response = (await sendRuntimeRequest(runtime, request, requestTimeoutMs, (rawResponse) => {
        const parsedResponse = parseHideListBackgroundResponseMessage(rawResponse);

        if (!parsedResponse || parsedResponse.requestId !== requestId || parsedResponse.type !== 'hide-list/mutation-result') {
          return null;
        }

        return parsedResponse;
      })) as HideListMutationResultMessage | null;

      return response;
    },
    async requestSnapshot(options: HideListSnapshotRequestOptions = {}): Promise<HideListStateSnapshot | null> {
      if (!runtime) {
        return null;
      }

      const requestId = options.requestId ?? generateRequestId();
      const request = createHideListSnapshotRequestMessage({
        source: input.source,
        requestId
      });

      const response = (await sendRuntimeRequest(runtime, request, requestTimeoutMs, (rawResponse) => {
        const parsedResponse = parseHideListBackgroundResponseMessage(rawResponse);

        if (!parsedResponse || parsedResponse.requestId !== requestId || parsedResponse.type !== 'hide-list/snapshot-result') {
          return null;
        }

        return parsedResponse;
      })) as { state: HideListStateSnapshot } | null;

      return response?.state ?? null;
    },
    subscribeToSync(onSync: (message: HideListContextInboundMessage) => void): () => void {
      if (!runtime) {
        return () => {
          // No-op on non-extension runtime.
        };
      }

      const listener: RuntimeMessageListener = (rawMessage) => {
        const parsedMessage = parseHideListContextInboundMessage(rawMessage);

        if (!parsedMessage) {
          return;
        }

        try {
          onSync(parsedMessage);
        } catch {
          // No-op safety: page should not crash on sync callback failure.
        }
      };

      runtime.onMessage.addListener(listener);

      return () => {
        runtime.onMessage.removeListener(listener);
      };
    }
  };
}
