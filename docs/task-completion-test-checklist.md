# Task Completion Test Checklist

Use this checklist before reporting that any task is complete. Keep the final response concise, but include the specific checks that were run and any manual pages/screenshots that were verified.

## 1) Always run the baseline gates

Run from the project root:

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run build
```

Expected result: every command exits with code `0`.

## 2) Extension reload hygiene

When testing in Chrome after a code change:

1. Run `npm.cmd run build`.
2. Open `chrome://extensions`.
3. Reload the unpacked extension.
4. Clear existing extension errors with **모두 삭제** before retesting.
5. Reload the target Kyobo page.

Do not treat old Chrome extension error pages as fresh failures until the extension and page have both been reloaded.

## 3) Kyobo page coverage

For changes that touch card detection, hide buttons, layout, or replenishment, verify all of these page types:

- Search page: `https://search.kyobobook.co.kr/search?keyword=javascript`
- Category page: `https://product.kyobobook.co.kr/category/KOR/330101#?page=1&type=all&sort=new`
- Grid view on category/search result
- List view on category/search result
- Popup page
- Options page
- Non-Kyobo page safety

## 4) Card and layout checks

On every Kyobo list-like page:

- Hide buttons appear on all visible product cards.
- Hide buttons do not overlap text, prices, ratings, wish icons, cart buttons, or buy buttons.
- Switching grid/list view does not break spacing.
- Re-running the content flow does not duplicate hide buttons.
- Dynamic page changes still receive hide buttons.

## 5) Replenishment checks

For pages with 20 products per page:

- Before hiding: visible product card count is `20`.
- After hiding one card: hidden count increases by `1`.
- After hiding one card: visible product card count remains `20`.
- After hiding one card: total DOM card count becomes `21` or more because one replacement card was appended.
- Replacement cards do not duplicate existing visible product IDs.
- Repeated hiding does not cause the grid/list layout to collapse or drift.

Known page-specific behavior:

- Search pages fetch replacement cards from next-page HTML.
- Kyobo category pages fetch replacement cards from `/api/gw/pdt/category/all`.

## 6) Screenshot evidence

For UI or behavior changes, save screenshots under `qa-captures/live-debug/`.

Recommended names:

- `kyobo-search-grid-<issue>.png`
- `kyobo-search-list-<issue>.png`
- `kyobo-category-grid-<issue>.png`
- `kyobo-category-list-<issue>.png`
- `kyobo-popup-<issue>.png`
- `kyobo-options-<issue>.png`

Screenshots are ignored by git, but the final response should state the saved path when manual visual verification was performed.

## 7) Final response format

Every completion response should include:

- What changed
- Which files changed
- Which automated checks passed
- Which live/manual pages were verified
- Screenshot path if UI was checked
- Any remaining risk or page type not verified
