# Repository Guidelines

- Prefer the smallest correct change; add no abstraction or dependency without a real need.
- Preserve unrelated worktree changes; avoid destructive Git unless explicitly requested.
- Use pnpm only; require Node >=20.19 and pnpm >=10.11.
- Core code: `src/main`, `src/preload`, `src/renderer`, `src/shared`; stack: Electron/Vue 3/TS.
- Tests: `test/main`, `test/renderer`, `test/e2e`; use Vitest and the smallest relevant suite.
- Keep committed tests lean and focused on project reliability, stability, and observable contracts;
  remove temporary checks that only prove an individual function's internals before handoff.
- Keep native capabilities behind typed preload/IPC boundaries with context isolation enabled.
- Use vue-i18n for user copy; prefer existing shadcn-vue primitives and VueUse utilities.
- Follow Oxfmt: single quotes, no semicolons, 100 columns.
- Before editing, inspect ownership, callers, tests, and nearby patterns; fix the root cause.
- Add the smallest regression test for user-visible behavior or a documented contract.
- Before handoff run format, i18n, lint, typecheck, and relevant test suites.
- Keep provider and ACP registry refreshes produced by normal builds.
- Use Conventional Commits (`type(scope): subject`, <=50 chars); never add AI co-authors.
- Target routine PRs to `dev`; only release branches target `main`.
- Assess scope first; use SDD only for large features or complex changes, never small local work.
- For UI changes, include concise BEFORE/AFTER ASCII layouts in the PR.
