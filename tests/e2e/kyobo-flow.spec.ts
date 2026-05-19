import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function installMockRuntime(page: Page, initialHiddenKeys: string[] = []): Promise<void> {
  await page.addInitScript((mockInitialHiddenKeys: string[]) => {
    const STATE_KEY = '__kyobo_flow_runtime_state__';

    const loadState = (): { revision: number; hiddenKeys: string[] } => {
      const rawState = window.localStorage.getItem(STATE_KEY);

      if (!rawState) {
        return {
          revision: 0,
          hiddenKeys: [...mockInitialHiddenKeys]
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
          hiddenKeys: [...mockInitialHiddenKeys]
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
  }, initialHiddenKeys);
}

async function routeKyoboFixture(page: Page): Promise<void> {
  const distDir = resolve(process.cwd(), 'dist');
  const createFixtureCard = (idNumber: number): string => {
    const id = `S${String(idNumber).padStart(12, '0')}`;
    return `<li id="card-${id}" class="prod_item" data-id="${id}"><div class="prod_area"><div class="prod_info_box"><a class="prod_info" href="https://product.kyobobook.co.kr/detail/${id}"><span class="prod_name">Book ${idNumber}</span></a></div></div><div class="prod_btn_wrap"><div class="btn_wrap full"></div></div></li>`;
  };

  await page.route(/https:\/\/(?:www|search)\.kyobobook\.co\.kr\/.*/, async (route) => {
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
    const includeGridCard = url.searchParams.get('grid') === '1';
    const includeGridCardWithHiddenActions = url.searchParams.get('gridHiddenActions') === '1';
    const includeReplenishmentList = url.searchParams.get('replenish') === '1';
    const pageNumber = Number(url.searchParams.get('page') ?? '1');
    const firstCardNumber = Number.isInteger(pageNumber) && pageNumber > 0 ? (pageNumber - 1) * 20 + 1 : 1;
    const replenishmentCards = Array.from({ length: 20 }, (_value, index) => createFixtureCard(firstCardNumber + index)).join('');

    const body = `<!doctype html>
      <html lang="ko">
        <head><meta charset="utf-8" /></head>
        <body>
          <main id="kyobo-root">
            ${
              includeReplenishmentList
                ? `<ul class="prod_list">${replenishmentCards}</ul>`
                : includeGridCardWithHiddenActions
                ? '<li id="grid-card-hidden-actions" class="prod_item" data-id="S000987654322"><div class="prod_area"><div class="prod_thumb_box"><a class="prod_link" href="https://product.kyobobook.co.kr/detail/S000987654322">Grid cover</a></div><div class="prod_info_box"><a class="prod_info" href="https://product.kyobobook.co.kr/detail/S000987654322"><span class="prod_name">Grid hidden actions</span></a><div class="prod_bottom"></div></div></div><div class="prod_btn_wrap" style="display:none"><div class="btn_wrap full"></div></div></li>'
                : includeGridCard
                  ? '<div id="grid-card-a" class="prod_area" data-id="S000987654321"><div class="prod_thumb_box"><a class="prod_link" href="https://product.kyobobook.co.kr/detail/S000987654321">Grid cover</a></div><div class="prod_info_box"><a class="prod_info" href="https://product.kyobobook.co.kr/detail/S000987654321"><span class="prod_name">Grid A</span></a><div class="prod_bottom"></div></div></div>'
                  : '<li id="card-a" class="prod_item" data-id="S000123456789"><div class="prod_area"><div class="prod_info_box"><a class="prod_info" href="https://product.kyobobook.co.kr/detail/S000123456789">A</a></div></div><div class="prod_btn_wrap"><div class="btn_wrap full"></div></div></li>'
            }
            ${
              includeDynamicCard
                ? '<li id="card-b" class="prod_item" data-id="S000123456789"><div class="prod_area"><div class="prod_info_box"><a class="prod_info" href="https://product.kyobobook.co.kr/detail/S000123456789">B</a></div></div><div class="prod_btn_wrap"><div class="btn_wrap full"></div></div></li>'
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
  await page.addScriptTag({ url: 'https://www.kyobobook.co.kr/content.js' });

  await page.waitForSelector('[data-kyobo-hide-list-hide-button="true"]', { timeout: 10000 });
  await page.click('[data-kyobo-hide-list-hide-button="true"]');
  await expect(page.locator('#card-a')).toHaveAttribute('data-kyobo-hide-list-hidden', 'true');

  await page.reload();
  await page.addScriptTag({ url: 'https://www.kyobobook.co.kr/content.js' });
  await expect(page.locator('#card-a')).toHaveAttribute('data-kyobo-hide-list-hidden', 'true');

  await page.goto('https://www.kyobobook.co.kr/search?keyword=test&dynamic=1');
  await page.addScriptTag({ url: 'https://www.kyobobook.co.kr/content.js' });
  await expect(page.locator('#card-b')).toHaveAttribute('data-kyobo-hide-list-hidden', 'true');

  const optionsPage = await page.context().newPage();
  await installMockRuntime(optionsPage);
  await routeKyoboFixture(optionsPage);
  await optionsPage.goto('https://www.kyobobook.co.kr/options.html');
  await optionsPage.waitForSelector('#hidden-items-body tr', { timeout: 10000 });
  await optionsPage.click('button:has-text("삭제")');
  await optionsPage.close();

  await page.reload();
  await page.addScriptTag({ url: 'https://www.kyobobook.co.kr/content.js' });

  await expect(page.locator('#card-a')).not.toHaveAttribute('data-kyobo-hide-list-hidden', 'true');
  await expect(page.locator('#card-b')).not.toHaveAttribute('data-kyobo-hide-list-hidden', 'true');
});

test('grid-style product area receives a hide button without a prod_item wrapper', async ({ page }) => {
  await installMockRuntime(page);
  await routeKyoboFixture(page);

  await page.goto('https://www.kyobobook.co.kr/search?keyword=test&grid=1');
  await page.addScriptTag({ url: 'https://www.kyobobook.co.kr/content.js' });

  const gridHideButton = page.locator('#grid-card-a [data-kyobo-hide-list-hide-button="true"]');
  await expect(gridHideButton).toBeVisible();

  await gridHideButton.click();

  await expect(page.locator('#grid-card-a')).toHaveAttribute('data-kyobo-hide-list-hidden', 'true');
});

test('grid card uses a visible insertion area when action buttons are hidden by layout', async ({ page }) => {
  await installMockRuntime(page);
  await routeKyoboFixture(page);

  await page.goto('https://www.kyobobook.co.kr/search?keyword=test&gridHiddenActions=1');
  await page.addScriptTag({ url: 'https://www.kyobobook.co.kr/content.js' });

  const gridHideButton = page.locator('#grid-card-hidden-actions .prod_info_box [data-kyobo-hide-list-hide-button="true"]');
  await expect(gridHideButton).toBeVisible();
});

test('replenishes one next-page card after a visible card is hidden', async ({ page }) => {
  await installMockRuntime(page);
  await routeKyoboFixture(page);

  await page.goto('https://search.kyobobook.co.kr/search?keyword=test&replenish=1');
  await page.addScriptTag({ url: 'https://www.kyobobook.co.kr/content.js' });

  await expect(page.locator('[data-kyobo-hide-list-hide-button="true"]')).toHaveCount(20);

  await page.locator('#card-S000000000003 [data-kyobo-hide-list-hide-button="true"]').click();

  await expect.poll(async () => {
    return page.evaluate(() => {
      return Array.from(document.querySelectorAll<HTMLElement>('li.prod_item, article.prod_item')).filter(
        (element) => element.style.display !== 'none'
      ).length;
    });
  }).toBe(20);
  await expect(page.locator('[data-kyobo-hide-list-replenished="true"]')).toHaveCount(1);
  await expect(page.locator('[data-id="S000000000021"]')).toHaveCount(1);
});
