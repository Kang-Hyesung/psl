import { expect, test, type Page } from '@playwright/test';
import { routeLocalDistAssets } from './static-assets';

async function mockPopupRuntime(
  page: Page,
  input: {
    hiddenKeys: string[];
    activeTabUrl: string | null;
    hideEnabled?: boolean;
  }
): Promise<void> {
  await page.addInitScript(({ hiddenKeys, activeTabUrl, hideEnabled = true }) => {
    const state = {
      revision: hiddenKeys.length,
      hiddenKeys
    };
    const settings = {
      hideListEnabled: hideEnabled
    };

    const windowWithMocks = window as Window & {
      chrome?: {
        runtime: {
          sendMessage: (message: unknown, callback?: (response?: unknown) => void) => void;
          openOptionsPage: () => void;
          onMessage: {
            addListener: () => void;
            removeListener: () => void;
          };
        };
        tabs: {
          query: (
            queryInfo: { active: boolean; currentWindow: boolean },
            callback: (tabs: Array<{ id: number; url?: string }>) => void
          ) => void;
        };
        storage: {
          local: {
            get: (keys: string | string[] | Record<string, unknown> | null, callback: (items: Record<string, unknown>) => void) => void;
            set: (items: Record<string, unknown>, callback?: () => void) => void;
          };
        };
      };
      __optionsPageOpened?: boolean;
    };

    windowWithMocks.chrome = {
      runtime: {
        sendMessage: (message, callback) => {
          const typedMessage = message as { type?: string; requestId?: string };

          if (typedMessage.type !== 'hide-list/snapshot-request') {
            callback?.(null);
            return;
          }

          callback?.({
            type: 'hide-list/snapshot-result',
            source: 'background',
            requestId: typedMessage.requestId ?? 'popup-snapshot-e2e',
            state
          });
        },
        openOptionsPage: () => {
          windowWithMocks.__optionsPageOpened = true;
        },
        onMessage: {
          addListener: () => {},
          removeListener: () => {}
        }
      },
      tabs: {
        query: (_queryInfo, callback) => {
          callback(activeTabUrl ? [{ id: 1, url: activeTabUrl }] : [{ id: 1 }]);
        }
      },
      storage: {
        local: {
          get: (_keys, callback) => {
            callback({
              hideListEnabled: settings.hideListEnabled
            });
          },
          set: (items, callback) => {
            if (typeof items.hideListEnabled === 'boolean') {
              settings.hideListEnabled = items.hideListEnabled;
            }

            callback?.();
          }
        }
      }
    };
  }, input);
}

test('popup happy state shows hidden count, recent keys, and kyobo support status', async ({ page }) => {
  await routeLocalDistAssets(page);
  await mockPopupRuntime(page, {
    hiddenKeys: ['A-11111', 'B-22222', 'C-33333', 'D-44444'],
    activeTabUrl: 'https://www.kyobobook.co.kr/product/detailViewKor.laf?barcode=12345'
  });

  await page.goto('/popup.html');

  await expect(page.getByRole('heading', { name: '교보 숨김 목록' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('??');
  await expect(page.locator('#tab-status')).toHaveText('교보문고 지원됨');
  await expect(page.getByRole('button', { name: '옵션 열기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '상태 새로고침' })).toBeVisible();
  await expect(page.locator('#hidden-count')).toHaveText('4');
  await expect(page.locator('#tab-status')).toHaveText('교보문고 지원됨');
  await expect(page.locator('#hide-enabled-status')).toHaveText('켜짐');
  await expect(page.getByRole('button', { name: '숨김 끄기' })).toBeVisible();
  await expect(page.locator('#recent-hidden-list li')).toHaveCount(3);
  await expect(page.locator('#recent-hidden-list li').first()).toHaveText('D-44444');
  await expect(page.locator('#recent-empty-message')).toBeHidden();
});

test('popup empty state shows explicit empty message and unsupported tab status', async ({ page }) => {
  await routeLocalDistAssets(page);
  await mockPopupRuntime(page, {
    hiddenKeys: [],
    activeTabUrl: 'https://example.com/not-kyobo'
  });

  await page.goto('/popup.html');

  await expect(page.locator('#hidden-count')).toHaveText('0');
  await expect(page.locator('#tab-status')).toHaveText('교보문고 아님');
  await expect(page.locator('#hide-enabled-status')).toHaveText('켜짐');
  await expect(page.locator('#recent-hidden-list')).toBeHidden();
  await expect(page.locator('#recent-empty-message')).toHaveText('아직 숨긴 항목이 없습니다.');
});

test('popup toggle button updates hide-engine status label', async ({ page }) => {
  await routeLocalDistAssets(page);
  await mockPopupRuntime(page, {
    hiddenKeys: ['A-11111'],
    activeTabUrl: 'https://www.kyobobook.co.kr/search?keyword=test',
    hideEnabled: true
  });

  await page.goto('/popup.html');

  await expect(page.locator('#hide-enabled-status')).toHaveText('켜짐');
  await page.getByRole('button', { name: '숨김 끄기' }).click();
  await expect(page.locator('#hide-enabled-status')).toHaveText('꺼짐');
  await expect(page.getByRole('button', { name: '숨김 켜기' })).toBeVisible();
});
