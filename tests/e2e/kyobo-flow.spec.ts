import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function installMockRuntime(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const STATE_KEY = '__kyobo_flow_runtime_state__';

    const loadState = (): { revision: number; hiddenKeys: string[] } => {
      const rawState = window.localStorage.getItem(STATE_KEY);

      if (!rawState) {
        return {
          revision: 0,
          hiddenKeys: []
        };
      }

      try {
        const parsed = JSON.parse(rawState) as { revision?: number; hiddenKeys?: string[] };

        return {
          revision: typeof parsed.revision === 'number' ? parsed.revision : 0,
          hiddenKeys: Array.isArray(parsed.hiddenKeys) ? [...parsed.hiddenKeys] : []
        };
      } catch {
        return {
          revision: 0,
          hiddenKeys: []
        };
      }
    };

    const saveState = (state: { revision: number; hiddenKeys: string[] }): void => {
      window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
    };

    const state = loadState();

    const runtimeListeners = new Set<(message: unknown) => void>();
    const storageListeners = new Set<(changes: Record<string, unknown>, areaName: string) => void>();

    const emitSync = (requestId: string): void => {
      const message = {
        type: 'hide-list/state-sync',
        source: 'background',
        requestId,
        trigger: 'mutation',
        state: {
          revision: state.revision,
          hiddenKeys: [...state.hiddenKeys]
        }
      };

      for (const listener of runtimeListeners) {
        listener(message);
      }
    };

    const emitStorage = (): void => {
      const changes = {
        hiddenKeysState: {
          oldValue: undefined,
          newValue: {
            version: 2,
            hiddenKeys: [...state.hiddenKeys],
            hiddenItems: state.hiddenKeys.map((hiddenKey) => ({
              hiddenKey,
              createdAtMs: Date.now(),
              originalLink: null
            }))
          }
        }
      };

      for (const listener of storageListeners) {
        listener(changes, 'local');
      }
    };

    const windowWithMocks = window as Window & {
      chrome?: {
        runtime: {
          sendMessage: (message: unknown, callback?: (response?: unknown) => void) => void;
          onMessage: {
            addListener: (listener: (message: unknown) => void) => void;
            removeListener: (listener: (message: unknown) => void) => void;
          };
        };
        storage: {
          local: {
            get: (key: string, callback: (items: Record<string, unknown>) => void) => void;
            set: (_items: Record<string, unknown>, callback?: () => void) => void;
            remove: (_key: string, callback?: () => void) => void;
            clear: (callback?: () => void) => void;
          };
          onChanged: {
            addListener: (listener: (changes: Record<string, unknown>, areaName: string) => void) => void;
            removeListener: (listener: (changes: Record<string, unknown>, areaName: string) => void) => void;
          };
        };
      };
    };

    windowWithMocks.chrome = {
      runtime: {
        sendMessage: (message, callback) => {
          const typedMessage = message as {
            type?: string;
            requestId?: string;
            mutation?: { operation?: 'add' | 'remove'; hiddenKey?: string };
          };

          if (typedMessage.type === 'hide-list/snapshot-request') {
            callback?.({
              type: 'hide-list/snapshot-result',
              source: 'background',
              requestId: typedMessage.requestId ?? 'snapshot-request',
              state: {
                revision: state.revision,
                hiddenKeys: [...state.hiddenKeys]
              }
            });
            return;
          }

          if (typedMessage.type === 'hide-list/mutation-request') {
            const operation = typedMessage.mutation?.operation;
            const hiddenKey = typedMessage.mutation?.hiddenKey ?? '';

            if (operation === 'add' && hiddenKey && !state.hiddenKeys.includes(hiddenKey)) {
              state.hiddenKeys.push(hiddenKey);
              state.revision += 1;
              saveState(state);
            }

            if (operation === 'remove') {
              state.hiddenKeys = state.hiddenKeys.filter((value) => value !== hiddenKey);
              state.revision += 1;
              saveState(state);
            }

            emitSync(typedMessage.requestId ?? 'mutation-request');
            emitStorage();

            callback?.({
              type: 'hide-list/mutation-result',
              source: 'background',
              requestId: typedMessage.requestId ?? 'mutation-request',
              result: 'applied',
              state: {
                revision: state.revision,
                hiddenKeys: [...state.hiddenKeys]
              }
            });
            return;
          }

          callback?.(null);
        },
        onMessage: {
          addListener: (listener) => runtimeListeners.add(listener),
          removeListener: (listener) => runtimeListeners.delete(listener)
        }
      },
      storage: {
        local: {
          get: (key, callback) => {
            if (key === 'hiddenKeysState') {
              callback({
                hiddenKeysState: {
                  version: 2,
                  hiddenKeys: [...state.hiddenKeys],
                  hiddenItems: state.hiddenKeys.map((hiddenKey) => ({
                    hiddenKey,
                    createdAtMs: Date.now(),
                    originalLink: null
                  }))
                }
              });
              return;
            }

            if (key === 'hideListEnabled') {
              callback({ hideListEnabled: true });
              return;
            }

            callback({ [key]: undefined });
          },
          set: (_items, callback) => callback?.(),
          remove: (_key, callback) => callback?.(),
          clear: (callback) => callback?.()
        },
        onChanged: {
          addListener: (listener) => storageListeners.add(listener),
          removeListener: (listener) => storageListeners.delete(listener)
        }
      }
    };
  });
}

async function routeKyoboFixture(page: Page): Promise<void> {
  const distDir = resolve(process.cwd(), 'dist');

  await page.route('https://www.kyobobook.co.kr/**', async (route) => {
    const url = new URL(route.request().url());
    const normalizedPath = url.pathname;

    if (
      normalizedPath === '/content.js' ||
      normalizedPath === '/options.js' ||
      normalizedPath === '/options.html' ||
      normalizedPath.startsWith('/chunks/')
    ) {
      const assetPath = resolve(distDir, `.${normalizedPath}`);
      const assetContent = readFileSync(assetPath);
      const contentType = normalizedPath.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8';
      await route.fulfill({
        status: 200,
        contentType,
        body: assetContent
      });
      return;
    }

    const includeDynamicCard = url.searchParams.get('dynamic') === '1';

    const body = `<!doctype html>
      <html lang="ko">
        <head><meta charset="utf-8" /></head>
        <body>
          <main id="kyobo-root">
            <article id="card-a" class="prod_item" data-prod-id="9791193078116">
              <div class="prod_info"><a href="/product/detailViewKor.laf?productId=S000123456789">A</a></div>
              <div class="prod_btn_area"></div>
            </article>
            ${
              includeDynamicCard
                ? '<article id="card-b" class="prod_item" data-prod-id="9791193078116"><div class="prod_info"><a href="/product/detailViewKor.laf?productId=S000123456789">B</a></div><div class="prod_btn_area"></div></article>'
                : ''
            }
          </main>
        </body>
      </html>`;

    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body
    });
  });
}

test('kyobo happy-path flow covers hide, reload, dynamic add, and options unhide', async ({ page }) => {
  await installMockRuntime(page);
  await routeKyoboFixture(page);

  await page.goto('https://www.kyobobook.co.kr/search?keyword=test');
  await page.addScriptTag({ type: 'module', url: 'https://www.kyobobook.co.kr/content.js' });

  await page.waitForSelector('[data-kyobo-hide-list-hide-button="true"]', { timeout: 10000 });
  await page.click('[data-kyobo-hide-list-hide-button="true"]');
  await expect(page.locator('#card-a')).toHaveAttribute('data-kyobo-hide-list-hidden', 'true');

  await page.reload();
  await page.addScriptTag({ type: 'module', url: 'https://www.kyobobook.co.kr/content.js' });
  await expect(page.locator('#card-a')).toHaveAttribute('data-kyobo-hide-list-hidden', 'true');

  await page.goto('https://www.kyobobook.co.kr/search?keyword=test&dynamic=1');
  await page.addScriptTag({ type: 'module', url: 'https://www.kyobobook.co.kr/content.js' });
  await expect(page.locator('#card-b')).toHaveAttribute('data-kyobo-hide-list-hidden', 'true');

  const optionsPage = await page.context().newPage();
  await installMockRuntime(optionsPage);
  await routeKyoboFixture(optionsPage);
  await optionsPage.goto('https://www.kyobobook.co.kr/options.html');
  await optionsPage.waitForSelector('#hidden-items-body tr', { timeout: 10000 });
  await optionsPage.click('button:has-text("삭제")');
  await optionsPage.close();

  await page.reload();
  await page.addScriptTag({ type: 'module', url: 'https://www.kyobobook.co.kr/content.js' });

  await expect(page.locator('#card-a')).not.toHaveAttribute('data-kyobo-hide-list-hidden', 'true');
  await expect(page.locator('#card-b')).not.toHaveAttribute('data-kyobo-hide-list-hidden', 'true');
});
