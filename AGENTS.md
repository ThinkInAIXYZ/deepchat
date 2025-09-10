# Repository Guidelines

## Project Structure & Module Organization
- `src/main/` Electron main process; `src/preload/` isolated preload; `src/renderer/` Vue 3 app (HTML in `index.html`, code in `src/renderer/src/`).
- `src/shared/` cross‑process utilities and types; `src/types/` project typings.
- `test/` Vitest suites (`test/main/**`, `test/renderer/**`).
- `build/`, `resources/`, `scripts/`, `runtime/` packaging assets, helpers, embedded runtimes.
- `docs/`, `out/`, `dist/` generated artifacts.

## Build, Test, and Development Commands
- Install: `pnpm i` (enforced via `preinstall`). Node ≥ 20.19, pnpm ≥ 10.11.
- Dev (watch): `pnpm dev` (Electron + Vite), debug: `pnpm dev:inspect`.
- Preview: `pnpm start` (production preview).
- Type check: `pnpm typecheck` (Node + Web configs).
- Lint: `pnpm lint` (oxlint). Format: `pnpm format` / check: `pnpm format:check`.
- Test all: `pnpm test`; main: `pnpm test:main`; renderer: `pnpm test:renderer`; coverage: `pnpm test:coverage`.
- Build app: `pnpm build`; platform targets: `pnpm build:mac`, `:win`, `:linux` (see variants like `:x64`, `:arm64`).

## Coding Style & Naming Conventions
- Prettier: single quotes, no semicolons, width 100, no trailing commas.
- EditorConfig: 2‑space indent, LF, final newline, trim trailing whitespace.
- TypeScript across main/renderer; Vue SFCs in `src/renderer/src/**`. Use PascalCase for components, camelCase for variables/functions, kebab‑case filenames for Vue components if already present.

## Testing Guidelines
- Framework: Vitest; environments: Node (main) and jsdom (renderer). Vue Test Utils for components.
- File naming: `*.test.ts`/`*.spec.ts` mirroring source; place under `test/main/**` or `test/renderer/**`.
- Coverage thresholds: 80% global (branches, functions, lines, statements). Report in `coverage/` and `coverage/renderer/`.

## Commit & Pull Request Guidelines
- Conventional Commits enforced: `type(scope): subject` (≤ 50 chars). Types: feat, fix, docs, dx, style, refactor, perf, test, workflow, build, ci, chore, types, wip, release.
- PRs: use `.github/pull_request_template.md`. Include description, linked issues, screenshots/GIFs for UI, and platform notes (Win/macOS/Linux) when applicable.

## Security & Configuration Tips
- Start from `.env.example`; never commit secrets. Brand configs: `brand-config.*.json`.
- Native deps: use `pnpm install` hooks; for image/DB runtimes see `pnpm installRuntime:*` and `scripts/` installers.
