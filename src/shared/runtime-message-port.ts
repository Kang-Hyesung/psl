export type RuntimeMessageResponseCallback = (response?: unknown) => void;

export type RuntimeMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: RuntimeMessageResponseCallback
) => void | boolean;

export interface RuntimeMessagePort {
  sendMessage(message: unknown, responseCallback?: RuntimeMessageResponseCallback): void;
  onMessage: {
    addListener(listener: RuntimeMessageListener): void;
    removeListener(listener: RuntimeMessageListener): void;
  };
}
