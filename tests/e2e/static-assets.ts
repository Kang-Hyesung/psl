import { existsSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { Page } from '@playwright/test';

const LOCAL_BASE_URL_PATTERN = 'http://127.0.0.1:4173/**';

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8']
]);

export async function routeLocalDistAssets(page: Page): Promise<void> {
  const distDir = resolve(process.cwd(), 'dist');

  await page.route(LOCAL_BASE_URL_PATTERN, async (route) => {
    const url = new URL(route.request().url());
    const pathname = decodeURIComponent(url.pathname);
    const assetPath = resolve(distDir, `.${pathname}`);
    const relativeAssetPath = relative(distDir, assetPath);

    if (relativeAssetPath.startsWith('..') || isAbsolute(relativeAssetPath) || !existsSync(assetPath)) {
      await route.fulfill({
        status: 404,
        contentType: 'text/plain; charset=utf-8',
        body: 'Not found'
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: mimeTypes.get(extname(assetPath)) ?? 'application/octet-stream',
      path: assetPath
    });
  });
}
