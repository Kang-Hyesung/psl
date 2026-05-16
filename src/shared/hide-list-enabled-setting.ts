export const HIDE_LIST_ENABLED_STORAGE_KEY = 'hideListEnabled';

function resolveStorageLocal(): chrome.storage.LocalStorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return null;
  }

  return chrome.storage.local;
}

export async function readHideListEnabledSetting(): Promise<boolean> {
  const storageLocal = resolveStorageLocal();

  if (!storageLocal) {
    return true;
  }

  return new Promise((resolve) => {
    try {
      storageLocal.get(HIDE_LIST_ENABLED_STORAGE_KEY, (items) => {
        const rawValue = items?.[HIDE_LIST_ENABLED_STORAGE_KEY];
        resolve(typeof rawValue === 'boolean' ? rawValue : true);
      });
    } catch {
      resolve(true);
    }
  });
}

export async function writeHideListEnabledSetting(isEnabled: boolean): Promise<boolean> {
  const storageLocal = resolveStorageLocal();

  if (!storageLocal) {
    return false;
  }

  return new Promise((resolve) => {
    try {
      storageLocal.set(
        {
          [HIDE_LIST_ENABLED_STORAGE_KEY]: isEnabled
        },
        () => {
          resolve(true);
        }
      );
    } catch {
      resolve(false);
    }
  });
}
