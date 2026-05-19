import { expect, test } from '@playwright/test';
import { routeLocalDistAssets } from './static-assets';

test('content runtime keeps non-kyobo domain as no-op without page errors', async ({ page }) => {
  await routeLocalDistAssets(page);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  await page.addInitScript(() => {
    const windowWithMocks = window as Window & {
      chrome?: {
        runtime: {
          lastError?: { message: string };
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
          onChanged: {
            addListener: () => void;
            removeListener: () => void;
          };
        };
      };
      __storageSetCallCountForTest__?: number;
    };

    windowWithMocks.__storageSetCallCountForTest__ = 0;
    windowWithMocks.chrome = {
      runtime: {
        sendMessage: (_message, callback) => {
          callback?.(null);
        },
        onMessage: {
          addListener: () => {},
          removeListener: () => {}
        }
      },
      storage: {
        local: {
          get: (_key, callback) => {
            callback({});
          },
          set: (_items, callback) => {
            windowWithMocks.__storageSetCallCountForTest__ = (windowWithMocks.__storageSetCallCountForTest__ ?? 0) + 1;
            callback?.();
          },
          remove: (_key, callback) => {
            callback?.();
          },
          clear: (callback) => {
            callback?.();
          }
        },
        onChanged: {
          addListener: () => {},
          removeListener: () => {}
        }
      }
    };
  });

  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/options.html');
  await page.evaluate(() => {
    document.body.innerHTML = `
      <main>
        <article class="prod_item">
          <div class="prod_btn_area"></div>
        </article>
      </main>
    `;
  });

  await page.addScriptTag({
    url: '/content.js'
  });

  await expect(page.locator('[data-kyobo-hide-list-hide-button="true"]')).toHaveCount(0);
  const storageSetCallCount = await page.evaluate(() => {
    const testWindow = window as Window & { __storageSetCallCountForTest__?: number };
    return testWindow.__storageSetCallCountForTest__ ?? 0;
  });

  expect(storageSetCallCount).toBe(0);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
