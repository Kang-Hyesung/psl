# SaaS UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Kyobo Hide List popup and options screens into a quiet, readable SaaS-style management UI without changing extension behavior.

**Architecture:** Keep the current static HTML entry points and TypeScript behavior modules. Move shared visual language into a small shared stylesheet, then let popup/options each keep screen-specific layout CSS and existing DOM IDs so current logic remains stable.

**Tech Stack:** Chrome Extension MV3, Vite, TypeScript, plain HTML/CSS, Vitest, Playwright.

---

## File Structure

- Create: `src/shared/saas-theme.css`
  - Shared design tokens and reusable primitives: colors, font stack, focus ring, button styles, badges, metric rows, table basics.
- Modify: `popup.html`
  - Root extension popup entry. Link the shared theme, replace MVP-style inline CSS with SaaS popup layout, keep existing element IDs.
- Modify: `src/popup/index.html`
  - Dev/source mirror of popup UI. Keep it aligned with `popup.html`, but preserve `./index.ts` script path.
- Modify: `options.html`
  - Root options page entry. Link the shared theme, add dashboard-style header/summary/table layout, keep existing element IDs.
- Modify: `src/options/index.html`
  - Dev/source mirror of options UI. Keep it aligned with `options.html`, but preserve `./index.ts` script path.
- Modify: `tests/e2e/popup.spec.ts`
  - Add assertions that catch broken markup/text and verify core SaaS UI landmarks.
- Modify: `tests/e2e/options.spec.ts`
  - Add assertions for new options summary/table landmarks while preserving existing behavior tests.
- Modify: `tests/e2e/domain-safety.spec.ts`
  - No planned change unless shared CSS routing affects local asset serving.

## Design Decisions

- Use `system-ui`, `Segoe UI`, `Apple SD Gothic Neo`, and `Noto Sans KR`, not serif fonts.
- Keep cards restrained: 8px radius, subtle borders, no decorative gradients/orbs.
- Use neutral SaaS colors with one blue primary accent and red danger actions.
- Preserve all current IDs used by TypeScript:
  - Popup: `hidden-count`, `recent-hidden-list`, `recent-empty-message`, `tab-status`, `hide-enabled-status`, `refresh-button`, `toggle-hide-enabled-button`, `open-hidden-list-button`, `open-options-button`
  - Options: `hidden-items-body`, `hidden-items-empty`, `refresh-options-button`, `clear-all-button`
- Fix broken text `Checking??/strong>` by rendering valid HTML: `<strong id="tab-status" class="status-value">Checking...</strong>`.
- Do not add new runtime dependencies or icon libraries for this pass. Use text labels and CSS status dots to keep scope small.

---

### Task 1: Add E2E Safety Assertions Before Redesign

**Files:**
- Modify: `tests/e2e/popup.spec.ts`
- Modify: `tests/e2e/options.spec.ts`

- [ ] **Step 1: Add popup markup/readability assertions**

In `tests/e2e/popup.spec.ts`, update the first test after `await page.goto('/popup.html');` with these assertions:

```ts
await expect(page.getByRole('heading', { name: 'Kyobo Hide List' })).toBeVisible();
await expect(page.locator('body')).not.toContainText('??');
await expect(page.locator('#tab-status')).toHaveText('Kyobo supported');
await expect(page.getByRole('button', { name: 'Open options' })).toBeVisible();
await expect(page.getByRole('button', { name: 'Refresh status' })).toBeVisible();
```

Expected behavior before implementation: this may fail because the popup HTML currently contains broken text around `Checking??/strong>`.

- [ ] **Step 2: Add options page landmark assertions**

In `tests/e2e/options.spec.ts`, update `options page removes an item through row action` after `await page.goto('/options.html');`:

```ts
await expect(page.getByRole('heading', { name: 'Hidden List Management' })).toBeVisible();
await expect(page.getByText('Saved hidden items')).toBeVisible();
await expect(page.getByRole('table')).toBeVisible();
await expect(page.locator('body')).not.toContainText('??');
```

Expected behavior before implementation: this should fail until the new summary label `Saved hidden items` is added.

- [ ] **Step 3: Run focused E2E tests and confirm failures**

Run:

```bash
npm.cmd run test:e2e -- tests/e2e/popup.spec.ts tests/e2e/options.spec.ts
```

Expected: at least one assertion fails for the missing SaaS landmark or broken text. If the command passes unexpectedly, continue; the assertions still protect against regressions after redesign.

- [ ] **Step 4: Commit test guardrails**

Run:

```bash
git add tests/e2e/popup.spec.ts tests/e2e/options.spec.ts
git commit -m "test: add UI readability guardrails"
```

---

### Task 2: Add Shared SaaS Theme

**Files:**
- Create: `src/shared/saas-theme.css`

- [ ] **Step 1: Create shared CSS tokens and primitives**

Create `src/shared/saas-theme.css` with this content:

```css
:root {
  --app-bg: #f6f7f9;
  --app-surface: #ffffff;
  --app-surface-subtle: #f9fafb;
  --app-border: #d9dee8;
  --app-border-strong: #b8c0cf;
  --app-text: #172033;
  --app-muted: #667085;
  --app-muted-strong: #475467;
  --app-primary: #2563eb;
  --app-primary-hover: #1d4ed8;
  --app-primary-soft: #eff6ff;
  --app-danger: #b42318;
  --app-danger-soft: #fff1f0;
  --app-success: #16803c;
  --app-success-soft: #edfdf3;
  --app-warning: #a15c00;
  --app-warning-soft: #fff7e6;
  --app-radius: 8px;
  --app-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--app-bg);
  color: var(--app-text);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
    "Apple SD Gothic Neo", "Noto Sans KR", Arial, sans-serif;
  font-size: 14px;
  letter-spacing: 0;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  min-height: 32px;
  border: 1px solid var(--app-border);
  border-radius: var(--app-radius);
  background: var(--app-surface);
  color: var(--app-text);
  font-size: 12px;
  font-weight: 600;
  padding: 7px 11px;
  cursor: pointer;
}

button:hover:not(:disabled) {
  border-color: var(--app-border-strong);
  background: var(--app-surface-subtle);
}

button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: 2px;
}

button:disabled {
  opacity: 0.5;
  cursor: default;
}

button.primary {
  border-color: var(--app-primary);
  background: var(--app-primary);
  color: #ffffff;
}

button.primary:hover:not(:disabled) {
  border-color: var(--app-primary-hover);
  background: var(--app-primary-hover);
}

button.danger {
  border-color: #f1b8b2;
  background: var(--app-danger-soft);
  color: var(--app-danger);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  border: 1px solid var(--app-border);
  border-radius: 999px;
  background: var(--app-surface);
  color: var(--app-muted-strong);
  font-size: 12px;
  font-weight: 600;
  padding: 3px 9px;
  white-space: nowrap;
}

.status-badge::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--app-muted);
}

.status-badge.is-on {
  border-color: #b7ebc6;
  background: var(--app-success-soft);
  color: var(--app-success);
}

.status-badge.is-on::before {
  background: var(--app-success);
}

.status-badge.is-off {
  border-color: #ffd59a;
  background: var(--app-warning-soft);
  color: var(--app-warning);
}

.status-badge.is-off::before {
  background: var(--app-warning);
}

.metric-label {
  color: var(--app-muted);
  font-size: 12px;
  font-weight: 600;
}

.metric-value {
  color: var(--app-text);
  font-size: 14px;
  font-weight: 700;
}
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm.cmd run typecheck
```

Expected: PASS. CSS creation should not affect TypeScript.

- [ ] **Step 3: Commit shared theme**

Run:

```bash
git add src/shared/saas-theme.css
git commit -m "style: add shared SaaS theme"
```

---

### Task 3: Redesign Popup Screen

**Files:**
- Modify: `popup.html`
- Modify: `src/popup/index.html`

- [ ] **Step 1: Replace popup HTML structure in root entry**

In `popup.html`, replace the entire `<head>` and `<body>` content with this version. Preserve the root script path `/src/popup/index.ts`:

```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kyobo Hide List Popup</title>
  <link rel="stylesheet" href="/src/shared/saas-theme.css" />
  <style>
    body {
      min-width: 360px;
    }

    .popup-shell {
      padding: var(--space-4);
    }

    .popup-panel {
      display: grid;
      gap: var(--space-4);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      background: var(--app-surface);
      box-shadow: var(--app-shadow);
      padding: var(--space-4);
    }

    .popup-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-3);
    }

    h1 {
      margin: 0;
      font-size: 16px;
      line-height: 1.3;
    }

    .subtitle {
      margin: 3px 0 0;
      color: var(--app-muted);
      font-size: 12px;
      line-height: 1.4;
    }

    .metrics {
      display: grid;
      gap: var(--space-2);
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      background: var(--app-surface-subtle);
      padding: var(--space-3);
    }

    .metric-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
    }

    .recent-panel {
      display: grid;
      gap: var(--space-2);
    }

    .section-heading {
      margin: 0;
      color: var(--app-muted);
      font-size: 12px;
      font-weight: 700;
    }

    .recent-list {
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-1);
      list-style: none;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 12px;
    }

    .recent-list li {
      overflow-wrap: anywhere;
      border: 1px solid var(--app-border);
      border-radius: 6px;
      background: var(--app-surface-subtle);
      padding: 6px 8px;
    }

    .empty {
      margin: 0;
      color: var(--app-muted);
      font-size: 12px;
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-2);
    }

    .actions .primary {
      grid-column: 1 / -1;
    }
  </style>
</head>
<body>
  <main class="popup-shell">
    <section class="popup-panel" aria-live="polite">
      <header class="popup-header">
        <div>
          <h1>Kyobo Hide List</h1>
          <p class="subtitle">Manage hidden Kyobo products from the current tab.</p>
        </div>
        <span class="status-badge is-on" aria-label="Extension ready">Ready</span>
      </header>

      <section class="metrics" aria-label="Hide list status">
        <div class="metric-row">
          <span class="metric-label">Hidden items</span>
          <strong id="hidden-count" class="metric-value">0</strong>
        </div>
        <div class="metric-row">
          <span class="metric-label">Current tab</span>
          <strong id="tab-status" class="metric-value">Checking...</strong>
        </div>
        <div class="metric-row">
          <span class="metric-label">Hide engine</span>
          <strong id="hide-enabled-status" class="metric-value">On</strong>
        </div>
      </section>

      <section class="recent-panel" aria-label="Recent hidden keys">
        <p class="section-heading">Recent hidden keys</p>
        <ul id="recent-hidden-list" class="recent-list"></ul>
        <p id="recent-empty-message" class="empty">No hidden items yet.</p>
      </section>

      <div class="actions">
        <button id="refresh-button" type="button">Refresh status</button>
        <button id="toggle-hide-enabled-button" type="button">Turn off hide</button>
        <button id="open-hidden-list-button" type="button">Open hidden list</button>
        <button id="open-options-button" class="primary" type="button">Open options</button>
      </div>
    </section>
  </main>
  <script type="module" src="/src/popup/index.ts"></script>
</body>
```

- [ ] **Step 2: Mirror popup HTML in source entry**

Apply the same markup to `src/popup/index.html`, but use this script tag:

```html
<script type="module" src="./index.ts"></script>
```

Do not leave `/src/popup/index.ts` in `src/popup/index.html`.

- [ ] **Step 3: Run popup E2E**

Run:

```bash
npm.cmd run test:e2e -- tests/e2e/popup.spec.ts
```

Expected: 3 popup tests pass, including the new broken-text/readability assertions.

- [ ] **Step 4: Commit popup redesign**

Run:

```bash
git add popup.html src/popup/index.html tests/e2e/popup.spec.ts
git commit -m "style: redesign popup as SaaS status panel"
```

---

### Task 4: Redesign Options Management Screen

**Files:**
- Modify: `options.html`
- Modify: `src/options/index.html`

- [ ] **Step 1: Replace options HTML structure in root entry**

In `options.html`, replace the entire `<head>` and `<body>` content with this version. Preserve the root script path `/src/options/index.ts`:

```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Kyobo Hide List Options</title>
  <link rel="stylesheet" href="/src/shared/saas-theme.css" />
  <style>
    .page-shell {
      max-width: 1080px;
      margin: 0 auto;
      padding: 32px var(--space-6) 40px;
    }

    .page-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-5);
      margin-bottom: var(--space-5);
    }

    h1 {
      margin: 0;
      font-size: 24px;
      line-height: 1.25;
    }

    .desc {
      max-width: 620px;
      margin: 6px 0 0;
      color: var(--app-muted);
      font-size: 14px;
      line-height: 1.5;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: var(--space-2);
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-3);
      margin-bottom: var(--space-5);
    }

    .summary-card {
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      background: var(--app-surface);
      box-shadow: var(--app-shadow);
      padding: var(--space-4);
    }

    .summary-card span {
      display: block;
      margin-bottom: var(--space-2);
    }

    .summary-card strong {
      font-size: 22px;
      line-height: 1;
    }

    .table-panel {
      overflow: hidden;
      border: 1px solid var(--app-border);
      border-radius: var(--app-radius);
      background: var(--app-surface);
      box-shadow: var(--app-shadow);
    }

    .table-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      border-bottom: 1px solid var(--app-border);
      padding: var(--space-4);
    }

    .table-header h2 {
      margin: 0;
      font-size: 15px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      text-align: left;
      border-bottom: 1px solid var(--app-border);
      padding: 11px var(--space-4);
      font-size: 13px;
      vertical-align: top;
    }

    th {
      background: var(--app-surface-subtle);
      color: var(--app-muted);
      font-size: 12px;
      font-weight: 700;
    }

    td:first-child {
      max-width: 260px;
      color: var(--app-muted-strong);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      overflow-wrap: anywhere;
    }

    td:nth-child(3) {
      max-width: 420px;
      overflow-wrap: anywhere;
    }

    a {
      color: var(--app-primary);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    .empty {
      margin: 0;
      padding: var(--space-6);
      color: var(--app-muted);
      font-size: 14px;
      text-align: center;
    }

    @media (max-width: 760px) {
      .page-shell {
        padding: var(--space-5) var(--space-4) 32px;
      }

      .page-header {
        display: grid;
      }

      .toolbar {
        justify-content: flex-start;
      }

      .summary-grid {
        grid-template-columns: 1fr;
      }

      .table-panel {
        overflow-x: auto;
      }

      table {
        min-width: 760px;
      }
    }
  </style>
</head>
<body>
  <main class="page-shell">
    <header class="page-header">
      <div>
        <h1>Hidden List Management</h1>
        <p class="desc">Review saved Kyobo product keys, open their source links, and remove entries that should appear again.</p>
      </div>
      <div class="toolbar">
        <button id="refresh-options-button" type="button">Refresh</button>
        <button id="clear-all-button" class="danger" type="button">Clear all</button>
      </div>
    </header>

    <section class="summary-grid" aria-label="Hidden list summary">
      <div class="summary-card">
        <span class="metric-label">Saved hidden items</span>
        <strong id="hidden-items-summary-count">-</strong>
      </div>
      <div class="summary-card">
        <span class="metric-label">Storage scope</span>
        <strong>Local</strong>
      </div>
      <div class="summary-card">
        <span class="metric-label">Supported site</span>
        <strong>Kyobo</strong>
      </div>
    </section>

    <section class="table-panel" aria-live="polite">
      <div class="table-header">
        <h2>Hidden products</h2>
        <span class="status-badge is-on">Synced</span>
      </div>

      <table>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Created at</th>
            <th scope="col">Original link</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody id="hidden-items-body"></tbody>
      </table>

      <p id="hidden-items-empty" class="empty" hidden>No hidden items saved.</p>
    </section>
  </main>
  <script type="module" src="/src/options/index.ts"></script>
</body>
```

- [ ] **Step 2: Mirror options HTML in source entry**

Apply the same markup to `src/options/index.html`, but use this script tag:

```html
<script type="module" src="./index.ts"></script>
```

Do not leave `/src/options/index.ts` in `src/options/index.html`.

- [ ] **Step 3: Run options E2E**

Run:

```bash
npm.cmd run test:e2e -- tests/e2e/options.spec.ts
```

Expected: 4 options tests pass, including the `Saved hidden items` landmark assertion.

- [ ] **Step 4: Commit options redesign**

Run:

```bash
git add options.html src/options/index.html tests/e2e/options.spec.ts
git commit -m "style: redesign options as management dashboard"
```

---

### Task 5: Wire Options Summary Count

**Files:**
- Modify: `src/options/index.ts`
- Modify: `tests/unit/options/index.test.ts`
- Modify: `tests/e2e/options.spec.ts`

- [ ] **Step 1: Extend options DOM type**

In `src/options/index.ts`, update `OptionsDomElements`:

```ts
interface OptionsDomElements {
  tableBody: HTMLElement;
  emptyMessage: HTMLElement;
  summaryCount: HTMLElement;
  refreshButton: HTMLButtonElement;
  clearAllButton: HTMLButtonElement;
}
```

- [ ] **Step 2: Read the summary count element**

In `readOptionsDomElements`, add:

```ts
const summaryCount = rootDocument.getElementById('hidden-items-summary-count');
```

Then update the guard:

```ts
if (
  !tableBody ||
  !emptyMessage ||
  !summaryCount ||
  !(refreshButton instanceof HTMLButtonElement) ||
  !(clearAllButton instanceof HTMLButtonElement)
) {
  return null;
}
```

And return it:

```ts
return {
  tableBody,
  emptyMessage,
  summaryCount,
  refreshButton,
  clearAllButton
};
```

- [ ] **Step 3: Update summary count during refresh**

In `refreshOptionsUi`, after `const rows = createOptionsRowViewModels(snapshot, metadataItems);`, add:

```ts
elements.summaryCount.textContent = String(rows.length);
```

- [ ] **Step 4: Add unit test coverage**

In `tests/unit/options/index.test.ts`, ensure the test document fixture includes:

```html
<strong id="hidden-items-summary-count">-</strong>
```

Add this assertion in the test that verifies row rendering:

```ts
expect(rootDocument.getElementById('hidden-items-summary-count')?.textContent).toBe('1');
```

Add this assertion in the empty-state test:

```ts
expect(rootDocument.getElementById('hidden-items-summary-count')?.textContent).toBe('0');
```

- [ ] **Step 5: Add E2E assertion**

In `tests/e2e/options.spec.ts`, after the first test confirms one row:

```ts
await expect(page.locator('#hidden-items-summary-count')).toHaveText('1');
```

After removing the row:

```ts
await expect(page.locator('#hidden-items-summary-count')).toHaveText('0');
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm.cmd run test:unit -- tests/unit/options/index.test.ts
npm.cmd run test:e2e -- tests/e2e/options.spec.ts
```

Expected: options unit and E2E tests pass.

- [ ] **Step 7: Commit summary count wiring**

Run:

```bash
git add src/options/index.ts tests/unit/options/index.test.ts tests/e2e/options.spec.ts
git commit -m "feat: show options hidden item summary"
```

---

### Task 6: Full Quality Gate And Screenshot QA

**Files:**
- No planned source changes unless verification reveals an issue.

- [ ] **Step 1: Run full automated gate**

Run:

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run build
```

Expected:

```text
lint: exit 0
typecheck: exit 0
unit: all tests pass
e2e: 9 tests pass
build: exit 0
```

- [ ] **Step 2: Capture full flow screenshots**

Reuse the current screenshot QA approach and save results under:

```text
qa-captures/full-flow-saas-ui-YYYYMMDD-HHMMSS/
```

Required screenshots:

```text
01-kyobo-list-with-hide-buttons.png
02-kyobo-after-hide.png
03-kyobo-reload-persists-hidden.png
04-kyobo-dynamic-reapply.png
05-popup-status.png
06-popup-hide-disabled.png
07-options-hidden-list.png
08-options-after-remove.png
09-unsupported-domain-noop.png
summary.md
```

Expected visual result:

```text
Popup: compact SaaS status panel, no broken text, clear primary action
Options: management dashboard layout, readable table, visible summary count
Unsupported domain: no injected hide controls
```

- [ ] **Step 3: Inspect Git status**

Run:

```bash
git status --short --branch
```

Expected: only intentional source/test changes are tracked. `qa-captures/` may be untracked unless the user explicitly asks to commit screenshot artifacts.

- [ ] **Step 4: Push commits**

Run:

```bash
git push
```

Expected:

```text
main -> main
```

---

## Self-Review

- Spec coverage: The plan covers popup readability, options dashboard layout, shared SaaS visual language, preserved behavior, tests, screenshot QA, and push.
- Placeholder scan: No `TBD`, `TODO`, or vague “handle later” instructions remain.
- Type consistency: New `summaryCount` property is defined in `OptionsDomElements`, read in `readOptionsDomElements`, and used in `refreshOptionsUi`.
- Scope check: This is one coherent UI redesign pass. No unrelated extension behavior changes are included.
