# Repository Guidelines

- Prefer the smallest correct change; add no abstraction or dependency without a real need.
- Preserve unrelated worktree changes; avoid destructive Git unless explicitly requested.
- Use pnpm only; require Node >=24.18.0 <25 and pnpm >=10.34.5 <11.
- Core code: `packages/desktop/src/{main,preload,renderer}`, `packages/shared`, and
  `packages/agent-kernel`; stack: Electron/Vue 3/TS.
- CLI code lives in `packages/cli`; root `scripts/` and configuration remain repository tooling.
- Tests: use Vitest in `packages/desktop/test/main`, Vitest with Vue Test Utils in
  `packages/desktop/test/renderer`, and Playwright in `packages/desktop/test/e2e`; run the smallest
  relevant suite.
- Default to implementation-first development: inspect and design, complete the planned code change,
  then decide what new verification is needed. Do not default to TDD unless explicitly requested or
  a minimal executable reproduction is required to understand a complex failure.
- Existing checks may run at any time. Treat new tests as regression protection, not implementation
  scaffolding; remove temporary probes and tests before handoff.
- Commit only the smallest durable tests for user-visible behavior, documented contracts,
  persistence or migration, lifecycle or concurrency, recovery, security boundaries, or proven
  regressions. Prefer no new test to implementation-coupled coverage.
- Keep native capabilities behind typed preload/IPC boundaries with context isolation enabled.
- Use vue-i18n for user copy; prefer existing shadcn-vue primitives and VueUse utilities.
- Follow Oxfmt: single quotes, no semicolons, 100 columns.
- Before editing, inspect ownership, callers, tests, and nearby patterns; fix the root cause.
- Before handoff run format, i18n, lint, typecheck, and relevant test suites.
- Keep provider and ACP registry refreshes produced by normal builds.
- Use Conventional Commits (`type(scope): subject`, <=50 chars); never add AI co-authors.
- Target routine PRs to `dev`; only release branches target `main`.
- Assess scope first; use SDD only for large features or complex changes, never small local work.
- For UI changes, include concise BEFORE/AFTER ASCII layouts in the PR.
