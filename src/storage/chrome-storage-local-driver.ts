import type { StorageDriver } from './storage-driver';

function withStorageAreaError(action: () => void, reject: (error: Error) => void): void {
  action();

  if (chrome.runtime.lastError) {
    reject(new Error(chrome.runtime.lastError.message));
  }
}

export function createChromeStorageLocalDriver(storageArea: chrome.storage.StorageArea = chrome.storage.local): StorageDriver {
  return {
    getItem(key: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        withStorageAreaError(
          () => {
            storageArea.get(key, (items) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }

              resolve(items[key]);
            });
          },
          reject
        );
      });
    },
    setItem(key: string, value: unknown): Promise<void> {
      return new Promise((resolve, reject) => {
        withStorageAreaError(
          () => {
            storageArea.set({ [key]: value }, () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }

              resolve();
            });
          },
          reject
        );
      });
    },
    removeItem(key: string): Promise<void> {
      return new Promise((resolve, reject) => {
        withStorageAreaError(
          () => {
            storageArea.remove(key, () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }

              resolve();
            });
          },
          reject
        );
      });
    },
    clear(): Promise<void> {
      return new Promise((resolve, reject) => {
        withStorageAreaError(
          () => {
            storageArea.clear(() => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }

              resolve();
            });
          },
          reject
        );
      });
    }
  };
}
