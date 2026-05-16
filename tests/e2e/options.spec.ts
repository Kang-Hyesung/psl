import { expect, test, type Page } from '@playwright/test';
import { routeLocalDistAssets } from './static-assets';

async function mockOptionsRuntime(page: Page, hiddenKeys: string[]): Promise<void> {
  await page.addInitScript(({ initialHiddenKeys }) => {
    const state = {
      revision: initialHiddenKeys.length,
      hiddenKeys: [...initialHiddenKeys]
    };
    const storageItems: Record<string, unknown> = {
      hiddenKeysState: {
        version: 2,
        hiddenKeys: [...initialHiddenKeys],
        hiddenItems: initialHiddenKeys.map((hiddenKey, index) => ({
          hiddenKey,
          createdAtMs: 1710000000000 + index,
          originalLink: null
        }))
      }
    };

    const syncStorageFromState = () => {
      const currentState = storageItems.hiddenKeysState as {
        hiddenItems: Array<{ hiddenKey: string; createdAtMs: number; originalLink: string | null }>;
      };
      const metadataByKey = new Map(currentState.hiddenItems.map((item) => [item.hiddenKey, item]));

      storageItems.hiddenKeysState = {
        version: 2,
        hiddenKeys: [...state.hiddenKeys],
        hiddenItems: state.hiddenKeys.map((hiddenKey, index) => {
          const existing = metadataByKey.get(hiddenKey);

          if (existing) {
            return existing;
          }

          return {
            hiddenKey,
            createdAtMs: 1710001000000 + index,
            originalLink: null
          };
        })
      };
    };

    const windowWithMocks = window as Window & {
      chrome?: {
        runtime: {
          sendMessage: (message: unknown, callback?: (response?: unknown) => void) => void;
          onMessage: {
            addListener: () => void;
            removeListener: () => void;
          };
        };
        storage: {
          local: {
            get: (key: string, callback: (items: Record<string, unknown>) => void) => void;
            set: (items: Record<string, unknown>, callback?: () => void) => void;
            remove: (key: string, callback?: () => void) => void;
            clear: (callback?: () => void) => void;
          };
        };
      };
      __setOptionsHiddenKeysForTest?: (hiddenKeys: string[]) => void;
    };

    windowWithMocks.__setOptionsHiddenKeysForTest = (hiddenKeys) => {
      state.hiddenKeys = [...hiddenKeys];
      state.revision += 1;
      syncStorageFromState();
    };

    windowWithMocks.chrome = {
      runtime: {
        sendMessage: (message, callback) => {
          const typedMessage = message as {
            type?: string;
            requestId?: string;
            mutation?: { operation?: string; hiddenKey?: string };
          };

          if (typedMessage.type === 'hide-list/snapshot-request') {
            callback?.({
              type: 'hide-list/snapshot-result',
              source: 'background',
              requestId: typedMessage.requestId ?? 'options-snapshot-e2e',
              state
            });
            return;
          }

          if (typedMessage.type === 'hide-list/mutation-request') {
            const hiddenKey = typedMessage.mutation?.hiddenKey ?? '';
            const operation = typedMessage.mutation?.operation;

            if (operation === 'remove') {
              state.hiddenKeys = state.hiddenKeys.filter((value) => value !== hiddenKey);
            }

            if (operation === 'add' && !state.hiddenKeys.includes(hiddenKey)) {
              state.hiddenKeys.push(hiddenKey);
            }

            state.revision += 1;
            syncStorageFromState();

            callback?.({
              type: 'hide-list/mutation-result',
              source: 'background',
              requestId: typedMessage.requestId ?? 'options-mutation-e2e',
              result: 'applied',
              state
            });
            return;
          }

          callback?.(null);
        },
        onMessage: {
          addListener: () => {},
          removeListener: () => {}
        }
      },
      storage: {
        local: {
          get: (key, callback) => {
            callback({
              [key]: storageItems[key]
            });
          },
          set: (items, callback) => {
            Object.assign(storageItems, items);
            callback?.();
          },
          remove: (key, callback) => {
            delete storageItems[key];
            callback?.();
          },
          clear: (callback) => {
            for (const key of Object.keys(storageItems)) {
              delete storageItems[key];
            }

            callback?.();
          }
        }
      }
    };
  }, { initialHiddenKeys: hiddenKeys });
}

test('options page removes an item through row action', async ({ page }) => {
  await routeLocalDistAssets(page);
  await mockOptionsRuntime(page, ['S000123456789']);
  await page.goto('/options.html');

  await expect(page.getByRole('heading', { name: 'Hidden List Management' })).toBeVisible();
  await expect(page.locator('#hidden-items-body tr')).toHaveCount(1);

  await page.getByRole('button', { name: 'Remove' }).click();

  await expect(page.locator('#hidden-items-body tr')).toHaveCount(0);
  await expect(page.locator('#hidden-items-empty')).toHaveText('No hidden items saved.');
  await expect(page.locator('#hidden-items-empty')).toBeVisible();
});

test('clear-all cancellation keeps current list intact', async ({ page }) => {
  await routeLocalDistAssets(page);
  await mockOptionsRuntime(page, ['A-11111', 'B-22222']);
  await page.addInitScript(() => {
    window.confirm = () => false;
  });
  await page.goto('/options.html');

  await page.getByRole('button', { name: 'Clear all' }).click();

  await expect(page.locator('#hidden-items-body tr')).toHaveCount(2);
  await expect(page.locator('#hidden-items-empty')).toBeHidden();
});

test('clear-all confirmation accepted clears all rows', async ({ page }) => {
  await routeLocalDistAssets(page);
  await mockOptionsRuntime(page, ['A-11111', 'B-22222']);
  await page.addInitScript(() => {
    window.confirm = () => true;
  });
  await page.goto('/options.html');

  await page.getByRole('button', { name: 'Clear all' }).click();

  await expect(page.locator('#hidden-items-body tr')).toHaveCount(0);
  await expect(page.locator('#hidden-items-empty')).toBeVisible();
});

test('refresh button re-reads snapshot and updates table', async ({ page }) => {
  await routeLocalDistAssets(page);
  await mockOptionsRuntime(page, ['A-11111']);
  await page.goto('/options.html');

  await expect(page.locator('#hidden-items-body tr')).toHaveCount(1);

  await page.evaluate(() => {
    const testWindow = window as Window & {
      __setOptionsHiddenKeysForTest?: (hiddenKeys: string[]) => void;
    };

    testWindow.__setOptionsHiddenKeysForTest?.(['A-11111', 'B-22222']);
  });

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('#hidden-items-body tr')).toHaveCount(2);
});
