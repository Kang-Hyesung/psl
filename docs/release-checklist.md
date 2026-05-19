# Release Checklist (Kyobo Hide List)

For every individual task, use `docs/task-completion-test-checklist.md` before reporting completion. This release checklist is the broader release gate.

## 1) Pre-release quality gates

Run the full gate chain from project root:

```bash
npm run lint && npm run typecheck && npm run test:unit && npm run test:e2e && npm run build
```

Expected result: all commands exit with code `0`.

## 2) Build artifact checks

- Confirm `dist/manifest.json` exists.
- Confirm `dist/content.js`, `dist/background.js`, `dist/popup.html`, and `dist/options.html` exist.
- Confirm manifest permissions are minimal (`storage` + Kyobo host only).

## 3) Manual QA checklist

Use `npm run manual:qa` as the canonical visible observation command. This path runs `npm run build` before launching the browser flow, keeps the browser session open for review, and waits for terminal confirmation by default.

```bash
npm run manual:qa
```

Default operator flow:

1. Start `npm run manual:qa` from the project root.
2. Let the script finish the visible browser checks and flush `.sisyphus/evidence/manual-qa-extension.log`.
3. Review the generated evidence artifacts in `.sisyphus/evidence/`, including:
   - `.sisyphus/evidence/manual-qa-extension.log`
   - `.sisyphus/evidence/manual-qa-kyobo-hide.png`
   - `.sisyphus/evidence/manual-qa-kyobo-reload-hidden.png`
   - `.sisyphus/evidence/manual-qa-kyobo-dynamic-hidden.png`
   - `.sisyphus/evidence/manual-qa-kyobo-unhidden.png`
4. Press Enter in the terminal when you are ready to close the session.

For automated verification, set `MANUAL_QA_AUTO_CONFIRM_AFTER_MS` to a non-negative integer so the same visible observation path auto-confirms after the requested delay instead of waiting for Enter.

`npm run test:e2e` remains part of the automated regression gate chain in Section 1. It is not the visible observation path.

### Kyobo happy path

1. Open a Kyobo list/search page.
2. Hide a book card with the injected button.
3. Refresh page.
4. Verify the same card stays hidden.

### Dynamic re-apply

1. Trigger additional card rendering (pagination/infinite-style DOM append).
2. Verify hidden keys are still re-applied to newly rendered cards.

### Popup

1. Open extension popup.
2. Verify hidden count and recent keys are shown.
3. Verify tab status reflects Kyobo / non-Kyobo tab correctly.

### Options CRUD

1. Open options page.
2. Verify hidden keys table is rendered.
3. Remove a single key and verify table updates.
4. Click clear-all and cancel confirmation; verify data is unchanged.
5. Click clear-all and accept confirmation; verify table is empty.

### Negative domain safety

1. Open a non-Kyobo page.
2. Verify no hide buttons are injected.
3. Verify no runtime errors are produced by content script.

## 4) Load extension package (local)

1. Build project: `npm run build`.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `dist/` directory.

## 5) Go / No-Go

- **Go** only when all quality gates pass and manual QA checklist is complete.
- **No-Go** on any failing gate or reproducible regression.
