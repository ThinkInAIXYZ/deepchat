# Repository Guidelines

This guide orients contributors (and agents) to the repository’s structure, workflows, and conventions. Follow these rules for any changes within this repo.

## Project Structure & Module Organization
- `src/main/`: Electron main process; presenters in `presenter/` (Window/Tab/Thread/Mcp/Config/LLMProvider); `eventbus.ts` for app events.
- `src/preload/`: Secure IPC bridge (contextIsolation on).
- `src/renderer/`: Vue 3 app. App code in `src/renderer/src` (`components/`, `stores/`, `views/`, `i18n/`, `lib/`). Shell UI in `src/renderer/shell/`.
- `src/shared/`: Shared TypeScript types/utilities.
- `test/`: Vitest suites under `test/main` and `test/renderer` (mirrors source).
- `scripts/`: Build/signing/runtime installers; commit checks.
- Outputs/assets: `build/`, `resources/`, `out/`, `dist/`.

## Build, Test, and Development Commands
- `pnpm install && pnpm run installRuntime` — first-time setup.
- `pnpm run dev` — Electron + HMR; `dev:inspect` for inspector; Linux: `dev:linux`.
- `pnpm start` — preview packaged app.
- `pnpm run typecheck` — TS checks (`typecheck:node` / `typecheck:web`).
- `pnpm run lint` and `pnpm run format` (`format:check` to verify only).
- `pnpm test` — run tests. Variants: `test:main`, `test:renderer`, `test:coverage`, `test:watch`, `test:ui`.
- `pnpm run build` then `build:win|mac|linux[:x64|:arm64]`.

## Coding Style & Naming Conventions
- Tech: TypeScript, Vue 3 (Composition API), Pinia, Tailwind.
- Prettier: single quotes, no semicolons, width 100. Run `pnpm run format` before PRs.
- Lint: OxLint for JS/TS; hooks run `lint-staged` and `typecheck`.
- Names: Vue components `PascalCase` (e.g., `ChatInput.vue`); vars/functions `camelCase`; types/classes `PascalCase`; constants `SCREAMING_SNAKE_CASE`.
- i18n: all user-facing strings use vue-i18n keys in `src/renderer/src/i18n`.

## Testing Guidelines
- Frameworks: Vitest (+ jsdom) and Vue Test Utils.
- Location mirrors source under `test/main/**` and `test/renderer/**`.
- Filenames: `*.test.ts` or `*.spec.ts`. Coverage via `pnpm run test:coverage`.

## Commit & Pull Request Guidelines
- Conventional commits: `type(scope): subject` ≤ 50 chars. Types: `feat|fix|docs|dx|style|refactor|perf|test|workflow|build|ci|chore|types|wip|release`.
- PRs: clear description, link issues (`Closes #123`), screenshots/GIFs for UI, pass lint/typecheck/tests, keep changes focused.
- Do not include AI co-authoring footers. UI changes: include BEFORE/AFTER ASCII layout blocks.

## Architecture & Security
- Patterns: Presenter pattern in main; EventBus for inter-process events; two-layer LLM provider (Agent Loop + Provider); integrated MCP tools.
- Secrets in `.env` (see `.env.example`); never commit keys.
- Toolchains: Node ≥ 20.19, pnpm ≥ 10.11 (pnpm only). Windows: enable Developer Mode for symlinks.

