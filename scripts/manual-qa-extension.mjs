import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

import { waitForManualQaCloseGate } from './manual-qa-close-gate.mjs';
import { parseManualQaOptions } from './manual-qa-options.mjs';

const projectRoot = process.cwd();
const distDir = resolve(projectRoot, 'dist');
const evidenceDir = resolve(projectRoot, '.sisyphus', 'evidence');
const manualQaLogPath = resolve(evidenceDir, 'manual-qa-extension.log');
const manualQaOptions = parseManualQaOptions();

const logLines = [];

function log(message) {
  const line = `[manual-qa] ${message}`;
  console.log(line);
  logLines.push(line);
}

async function screenshot(page, fileName) {
  await page.screenshot({ path: resolve(evidenceDir, fileName), fullPage: true });
  log(`screenshot: ${fileName}`);
}

async function annotateCheckpoint(page, label) {
  await page.evaluate((checkpointLabel) => {
    const badgeId = '__manual-qa-checkpoint__';
    let badge = document.getElementById(badgeId);

    if (!(badge instanceof HTMLElement)) {
      badge = document.createElement('div');
      badge.id = badgeId;
      badge.setAttribute('data-manual-qa-checkpoint', 'true');
      badge.style.position = 'fixed';
      badge.style.top = '16px';
      badge.style.right = '16px';
      badge.style.zIndex = '2147483647';
      badge.style.maxWidth = '320px';
      badge.style.padding = '10px 12px';
      badge.style.borderRadius = '10px';
      badge.style.background = 'rgba(17, 24, 39, 0.92)';
      badge.style.color = '#ffffff';
      badge.style.font = '600 14px/1.4 system-ui, sans-serif';
      badge.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.28)';
      badge.style.pointerEvents = 'none';
      document.body.appendChild(badge);
    }

    badge.textContent = checkpointLabel;
  }, label);
}

async function pauseAtCheckpoint(page, label) {
  if (manualQaOptions.pauseMs <= 0) {
    return;
  }

  await annotateCheckpoint(page, `${label} (pausing ${manualQaOptions.pauseMs}ms)`);
  log(`pause: ${label} (${manualQaOptions.pauseMs}ms)`);
  await page.waitForTimeout(manualQaOptions.pauseMs);
}

async function captureCheckpoint(page, fileName, label) {
  await annotateCheckpoint(page, label);
  await screenshot(page, fileName);
}

async function flushEvidence() {
  await writeFile(manualQaLogPath, `${logLines.join('\n')}\n`, 'utf8');
}

function findExtensionServiceWorker(context) {
  return context.serviceWorkers().find((worker) => worker.url().startsWith('chrome-extension://'));
}

async function waitForExtensionServiceWorker(context, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const existingWorker = findExtensionServiceWorker(context);

    if (existingWorker) {
      return existingWorker;
    }

    const remainingMs = deadline - Date.now();

    try {
      return await context.waitForEvent('serviceworker', {
        predicate: (worker) => worker.url().startsWith('chrome-extension://'),
        timeout: Math.min(remainingMs, 1000)
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        await sleep(Math.min(remainingMs, 250));
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for extension service worker.`);
}

async function main() {
  await mkdir(evidenceDir, { recursive: true });
  log(
    `options: demo=${manualQaOptions.demoMode} slowMoMs=${manualQaOptions.slowMoMs} pauseMs=${manualQaOptions.pauseMs} finalHoldMs=${manualQaOptions.finalHoldMs}`
  );

  const profileDir = await mkdtemp(resolve(tmpdir(), 'manual-qa-profile-'));
  let context;

  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: false,
      ignoreDefaultArgs: ['--disable-extensions'],
      slowMo: manualQaOptions.slowMoMs,
      args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`]
    });

    await context.addInitScript(() => {
      const STATE_KEY = '__manual_qa_runtime_state__';

      const loadState = () => {
        const rawState = window.localStorage.getItem(STATE_KEY);

        if (!rawState) {
          return {
            revision: 0,
            hiddenKeys: []
          };
        }

        try {
          const parsed = JSON.parse(rawState);
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

      const saveState = (state) => {
        window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
      };

      const state = loadState();
      const runtimeListeners = new Set();
      const storageListeners = new Set();

      const emitSync = (requestId) => {
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

      const emitStorage = () => {
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

      window.chrome = {
        runtime: {
          sendMessage(message, callback) {
            const typedMessage = message;

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
            addListener(listener) {
              runtimeListeners.add(listener);
            },
            removeListener(listener) {
              runtimeListeners.delete(listener);
            }
          }
        },
        storage: {
          local: {
            get(key, callback) {
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
            set(_items, callback) {
              callback?.();
            },
            remove(_key, callback) {
              callback?.();
            },
            clear(callback) {
              callback?.();
            }
          },
          onChanged: {
            addListener(listener) {
              storageListeners.add(listener);
            },
            removeListener(listener) {
              storageListeners.delete(listener);
            }
          }
        }
      };
    });

    await context.route('https://www.kyobobook.co.kr/**', async (route) => {
      const url = new URL(route.request().url());
      const normalizedPath = url.pathname;

      if (
        normalizedPath === '/content.js' ||
        normalizedPath === '/options.js' ||
        normalizedPath === '/options.html' ||
        normalizedPath.startsWith('/chunks/')
      ) {
        const assetPath = resolve(distDir, `.${normalizedPath}`);
        const assetContent = await readFile(assetPath);
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
        <head><meta charset="utf-8" /><title>Kyobo Fixture</title></head>
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

    const backgroundWorker = await waitForExtensionServiceWorker(context);

    const extensionUrl = new URL(backgroundWorker.url());
    const extensionId = extensionUrl.hostname;
    log(`extension id: ${extensionId}`);

    const page = await context.newPage();
    await page.goto('https://www.kyobobook.co.kr/search?keyword=test');
    await page.addScriptTag({ type: 'module', url: 'https://www.kyobobook.co.kr/content.js' });
    log('opened kyobo fixture page');

    await page.waitForSelector('[data-kyobo-hide-list-hide-button="true"]', { timeout: 10000, state: 'attached' });
    log('hide button injected by real content script');
    await pauseAtCheckpoint(page, 'Hide button ready on fixture page');

    await page.evaluate(() => {
      const button = document.querySelector('[data-kyobo-hide-list-hide-button="true"]');

      if (!button) {
        return;
      }

      button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await page.waitForSelector('#card-a[data-kyobo-hide-list-hidden="true"]', { timeout: 10000, state: 'attached' });
    log('card hidden after real button click');
    await pauseAtCheckpoint(page, 'Card A hidden after hide action');
    await captureCheckpoint(page, 'manual-qa-kyobo-hide.png', 'Card A hidden after hide action');

    await page.reload();
    await page.addScriptTag({ type: 'module', url: 'https://www.kyobobook.co.kr/content.js' });
    await page.waitForSelector('#card-a[data-kyobo-hide-list-hidden="true"]', { timeout: 10000, state: 'attached' });
    log('hidden card persisted after reload');
    await pauseAtCheckpoint(page, 'Card A still hidden after reload');
    await captureCheckpoint(page, 'manual-qa-kyobo-reload-hidden.png', 'Card A still hidden after reload');

    await page.goto('https://www.kyobobook.co.kr/search?keyword=test&dynamic=1');
    await page.addScriptTag({ type: 'module', url: 'https://www.kyobobook.co.kr/content.js' });
    await page.waitForSelector('#card-b[data-kyobo-hide-list-hidden="true"]', { timeout: 10000, state: 'attached' });
    log('dynamic card auto-hidden by reapply engine');
    await pauseAtCheckpoint(page, 'Dynamic card B auto-hidden after reapply');
    await captureCheckpoint(page, 'manual-qa-kyobo-dynamic-hidden.png', 'Dynamic card B auto-hidden after reapply');

    const optionsPage = await context.newPage();
    await optionsPage.goto('https://www.kyobobook.co.kr/options.html');
    log('opened options UI page');

    await optionsPage.waitForSelector('#hidden-items-body tr', { timeout: 10000 });
    await pauseAtCheckpoint(optionsPage, 'Options page shows hidden item before removal');
    await optionsPage.click('button:has-text("Remove")');
    log('removed hidden key from options page');

    await page.bringToFront();
    await page.reload();
    await page.addScriptTag({ type: 'module', url: 'https://www.kyobobook.co.kr/content.js' });
    await page.waitForSelector('#card-a:not([data-kyobo-hide-list-hidden])', { timeout: 10000 });
    await page.waitForSelector('#card-b:not([data-kyobo-hide-list-hidden])', { timeout: 10000 });
    log('unhide reflected back to kyobo page');
    await pauseAtCheckpoint(page, 'Cards visible again after options removal');
    await captureCheckpoint(page, 'manual-qa-kyobo-unhidden.png', 'Cards visible again after options removal');

    log('manual QA completed successfully');
    await flushEvidence();
    await waitForManualQaCloseGate(manualQaOptions, {
      annotate: async (message) => annotateCheckpoint(page, message),
      log
    });
  } finally {
    try {
      await context?.close();
    } finally {
      await rm(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(resolve(evidenceDir, 'manual-qa-extension-error.log'), `${message}\n`, 'utf8');
  console.error(message);
  process.exit(1);
});
