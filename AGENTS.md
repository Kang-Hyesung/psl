# Agent Instructions

## Start Here

Before starting follow-up work, read:

- `docs/session-handoff.md`
- `docs/task-completion-test-checklist.md`

Use `docs/session-handoff.md` to understand the current project state, recent fixes, verification results, and suggested next work.

Before claiming work is complete, run the relevant checks from `docs/task-completion-test-checklist.md`.

## Project Boundaries

- Keep site-specific behavior in `src/adapters/*`.
- Keep generic runtime, DOM, replenishment, and messaging behavior in `src/content/*` or shared modules.
- When adding another shopping site, add or extend an adapter instead of hard-coding selectors into generic runtime files.

## Verification Expectations

For extension behavior changes, run at minimum:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run build
```

For Kyobo UI behavior changes, also manually verify the affected live page modes:

- search grid view
- search list view
- category grid view
- category list view
- switching between list and grid after buttons are injected
- hiding multiple products while keeping the expected visible count

Save relevant screenshots under `qa-captures/`.

## Git Notes

- Do not revert user changes unless explicitly requested.
- Keep commits focused and include documentation updates when workflow or verification expectations change.

