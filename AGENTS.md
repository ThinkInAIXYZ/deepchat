# Repository Guidelines

## Project Structure & Module Organization
- `src/main/`: Electron main process; presenters in `presenter/` (Window/Tab/Thread/Mcp/Config/LLMProvider), `eventbus.ts` for app events.
- `src/preload/`: Secure IPC bridge (contextIsolation on).
- `src/renderer/`: Vue 3 app. App code in `src/renderer/src` (`components/`, `stores/`, `views/`, `i18n/`, `lib/`). Shell UI lives in `src/renderer/shell/`.
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
- Test: `pnpm test`, `test:main`, `test:renderer`, `test:coverage`, `test:watch`, `test:ui`.
- Build: `pnpm run build` then `build:win|mac|linux` (add `:x64|:arm64`).

## Coding Style & Naming Conventions
- TypeScript + Vue 3 Composition API; Pinia for state; Tailwind for styles.
- i18n: all user-facing strings use vue-i18n keys in `src/renderer/src/i18n`.
- Prettier: single quotes, no semicolons, width 100. Run `pnpm run format`.
- OxLint for JS/TS; hooks run `lint-staged` and `typecheck`.
- Names: Vue components PascalCase (`ChatInput.vue`); variables/functions `camelCase`; types/classes `PascalCase`; constants `SCREAMING_SNAKE_CASE`.

## Testing Guidelines
- Framework: Vitest (+ jsdom) and Vue Test Utils.
- Location mirrors source under `test/main/**` and `test/renderer/**`.
- Names: `*.test.ts`/`*.spec.ts`. Coverage: `pnpm run test:coverage`.

## Commit & Pull Request Guidelines
- Conventional commits enforced by hook: `type(scope): subject` ≤ 50 chars; types: `feat|fix|docs|dx|style|refactor|perf|test|workflow|build|ci|chore|types|wip|release`.
- Do not include AI co-authoring footers in commits.
- PRs: clear description, link issues (`Closes #123`), screenshots/GIFs for UI, pass lint/typecheck/tests. Keep changes focused.
- UI changes: include BEFORE/AFTER ASCII layout blocks to communicate structure.

## Architecture Notes & Security
- Patterns: Presenter pattern in main; EventBus for inter-process events; two-layer LLM provider (Agent Loop + Provider); integrated MCP tools.
- Secrets: use `.env` (see `.env.example`); never commit keys.
- Toolchains: Node ≥ 20.19, pnpm ≥ 10.11 (pnpm only). Windows: enable Developer Mode for symlinks.
