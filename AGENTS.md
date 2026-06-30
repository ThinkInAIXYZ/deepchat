# Repository Guidelines

## Project Structure & Module Organization
- `src/main/`: Electron main process; presenters in `presenter/` (Window/Tab/Thread/Mcp/Config/LLMProvider), `eventbus.ts` for app events.
- `src/preload/`: Secure IPC bridge (contextIsolation on).
- `src/renderer/`: Vue 3 app. App code in `src/renderer/src` (`components/`, `stores`, `views`, `i18n`, `lib`). Secondary renderers live in `src/renderer/browser`, `src/renderer/settings`, `src/renderer/floating`, and `src/renderer/splash`.
- `src/shared/`: Shared TS types/utilities.
- `test/`: Vitest suites (`test/main`, `test/renderer`) with setup files.
- `scripts/`: Build/signing/runtime installers, commit checks.
- Build outputs/assets: `build/`, `resources/`, `out/`, `dist/`.

## Build, Test, and Development Commands
- Install: `pnpm install` + `pnpm run installRuntime` (first time).
- Dev: `pnpm run dev` (HMR). Inspect: `pnpm run dev:inspect`; Linux: `pnpm run dev:linux`.
- Preview: `pnpm start`.
- Type check: `pnpm run typecheck` (or `typecheck:node` / `typecheck:web`).
- Lint/format: `pnpm run lint`, `pnpm run format`, `pnpm run format:check`.
- After completing a feature, always run `pnpm run format`, `pnpm run i18n` and `pnpm run lint` to keep formatting and lint status clean.
- Test: `pnpm test`, `test:main`, `test:renderer`, `test:coverage`, `test:watch`, `test:ui`.
- Build: `pnpm run build` then `build:win|mac|linux` (add `:x64|:arm64`).
- Build preflight refresh: `pnpm run build` runs scripts that refresh
  `resources/model-db/providers.json` and `resources/acp-registry/registry.json`. When these files
  change during normal build/test work, include the refresh in the same change instead of reverting
  it; keeping provider and ACP registry data current is expected maintenance.

## Coding Style & Naming Conventions
- TypeScript + Vue 3 Composition API; Pinia for state; Tailwind for styles.
- i18n: all user-facing strings use vue-i18n keys in `src/renderer/src/i18n`.
- Oxfmt: single quotes, no semicolons, width 100. Run `pnpm run format`.
- OxLint for JS/TS; the tracked `commit-msg` hook runs `commitlint`.
- Names: Vue components PascalCase (`ChatInput.vue`); variables/functions `camelCase`; types/classes `PascalCase`; constants `SCREAMING_SNAKE_CASE`.

## Testing Guidelines
- Framework: Vitest (+ jsdom) and Vue Test Utils.
- Location mirrors source under `test/main/**` and `test/renderer/**`.
- Names: `*.test.ts`/`*.spec.ts`. Coverage: `pnpm run test:coverage`.

## Commit & Pull Request Guidelines
- Conventional commits enforced by hook: `type(scope): subject` ≤ 50 chars; types: `feat|fix|docs|dx|style|refactor|perf|test|workflow|build|ci|chore|types|wip|release`.
- Do not include AI co-authoring footers in commits.
- PRs: clear description, link issues (`Closes #123`), screenshots/GIFs for UI, pass lint/typecheck/tests. Keep changes focused.
- Default PR base is `dev`; use `gh pr create --base dev` for routine feature, bugfix, docs, test, and refactor branches. Target `main` only for `release/<version>` branches following `docs/release-flow.md`.
- UI changes: include BEFORE/AFTER ASCII layout blocks to communicate structure.

## Architecture Notes & Security
- Patterns: Presenter pattern in main; EventBus for inter-process events; two-layer LLM provider (Agent Loop + Provider); integrated MCP tools.
- Secrets: use `.env` (see `.env.example`); never commit keys.
- Toolchains: Node ≥ 20.19, pnpm ≥ 10.11 (pnpm only). Windows: enable Developer Mode for symlinks.

## Specification-Driven Development

Follow the SDD methodology before changing code, tests, configuration, documentation, build scripts, or project structure. See [docs/spec-driven-dev.md](docs/spec-driven-dev.md).

Pure release metadata work does not require SDD. Version bumps, `CHANGELOG.md` updates, release branch management, tags, and release PR preparation should follow [docs/release-flow.md](docs/release-flow.md) without creating
`docs/features/*release*` folders.

Create one kebab-case folder per goal and keep `spec.md`, `plan.md`, and `tasks.md` together:

- `docs/features/<goal>/` for new features, user-visible capabilities, integrations, and tools.
- `docs/issues/<goal>/` for bug fixes, regressions, failing tests, CI failures, reliability issues, and prompt/runtime problems.
- `docs/architecture/<goal>/` for refactors, migrations, dependency boundaries, shared contracts, runtime architecture, and cross-module design.

Resolve every `[NEEDS CLARIFICATION]` item before implementation. Move completed or stale goal folders to `docs/archives/<goal>/`; delete documents that only describe removed code and have no reusable decision record.

Core principles: specification-first, architectural consistency, minimal complexity, compatibility/migration awareness.
