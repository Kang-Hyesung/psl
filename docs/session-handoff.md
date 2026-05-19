# Session Handoff

Last updated: 2026-05-19

## Current State

The project is a Chrome MV3 extension for hiding products from Kyobo Book listing pages. The latest work focused on Kyobo product/search/category pages, especially grid/list view behavior and replenishing hidden cards so that a page still shows 20 visible products after items are hidden.

The working branch is `main`, remote is `origin` at `https://github.com/Kang-Hyesung/psl.git`.

## Completed Work

- Bundled `src/content/index.ts` into a classic Chrome content script artifact through Vite/esbuild so Chrome no longer throws `Cannot use import statement outside a module`.
- Expanded manifest host permissions for Kyobo `www`, `search`, and `product` subdomains.
- Added a site adapter extension point for card replenishment:
  - `CardReplenishmentHook`
  - `containerSelectorCandidates`
  - `cardSelector`
  - page URL creation
  - optional API/HTML card extraction
- Added Kyobo search page replenishment using next-page HTML.
- Added Kyobo category page replenishment using the category JSON API.
- Added `src/content/card-replenishment.ts` to append non-hidden, non-duplicate replacement cards.
- Fixed Chrome background sync errors from `Could not establish connection. Receiving end does not exist`.
- Fixed grid/list view hide button insertion:
  - Hidden `0x0` action containers are no longer treated as valid insertion anchors.
  - Existing hide buttons only count as present when they are actually visible.
  - Compact buttons are absolute-positioned so they do not change card layout height.
  - Reapply now responds to hash changes, clicks, and relevant class/style mutations.
- Added task completion checklist documentation to avoid repeating regressions.

## Most Recent Bug And Fix

Bug:

On `https://product.kyobobook.co.kr/category/KOR/330101#?page=1&type=all&per=20&sort=new`, grid cards could become uneven or the hide button could disappear after switching list/grid views. The cause was that `.prod_btn_wrap .btn_wrap.full` existed in the DOM but rendered as a `0x0` box in grid mode. The extension inserted a full-width hide button there, then `hasHideButton()` returned true because the DOM node existed, so the runtime never tried to relocate it.

Fix:

`src/content/dom-runtime-cards.ts` now checks whether an injected button is actually visible before treating it as present. If an existing button is not visible, it is removed and reinserted into a visible anchor or as a compact overlay. `src/content/dynamic-reapply.ts` and `src/content/index.ts` also schedule reapply after UI mode-changing events.

## Verification Already Run

Automated checks passed:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run build
```

Observed results:

- Unit tests: 52 passed
- E2E tests: 13 passed
- Build: passed

Live Kyobo verification was also run with the built extension loaded in Chromium.

Test URL:

```text
https://product.kyobobook.co.kr/category/KOR/330101#?page=1&type=all&per=20&sort=new
```

Live result after switching to grid view and hiding 5 products:

- Before hiding: visible cards `20`, total cards `20`, visible hide buttons `20`
- After hiding: visible cards `20`, total cards `25`, replenished cards `5`, hidden cards `5`
- Overlap check: `false`

Screenshots:

```text
qa-captures/live-debug/kyobo-category-grid-spacing-before-hide.png
qa-captures/live-debug/kyobo-category-grid-spacing-fixed.png
```

## Before Claiming Future Work Is Done

Run the checklist in `docs/task-completion-test-checklist.md`.

Minimum for extension behavior changes:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run build
```

For Kyobo UI changes, also manually verify:

- Search result grid view
- Search result list view
- Category grid view
- Category list view
- Toggle list/grid after buttons are inserted
- Hide multiple products and confirm the visible count stays at 20 where replenishment is supported
- Confirm no card overlap or row collapse

## Next Suggested Work

- If expanding beyond Kyobo, add a new adapter rather than hard-coding selectors into runtime files.
- Keep site-specific logic in `src/adapters/*`.
- Keep generic DOM/runtime behavior in `src/content/*`.
- For Aladin, Musinsa, Amazon, first define adapter selectors and product key extraction, then add replenishment only after the baseline hide flow is stable.

