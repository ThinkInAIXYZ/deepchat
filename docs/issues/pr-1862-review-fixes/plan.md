# PR 1862 Review Fixes Plan

## Approach

- Keep fixes at existing ownership points: dispatch heuristics, reviewer decision normalization, SQLite table read path, and `ChatPage` delete confirmation.
- Update existing tests near each affected behavior.
- Keep docs in sync with the runtime envelope instead of changing the envelope contract late in the PR.

## Affected Areas

- Main runtime: `agentRuntimePresenter/index.ts`, `dispatch.ts`.
- Persistence: `deepchatSessions.ts`.
- Renderer: `ChatPage.vue`, i18n typing/locales.
- Tests: focused runtime, persistence, and renderer component tests.

## Verification

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- Focused Vitest files for changed behavior.
