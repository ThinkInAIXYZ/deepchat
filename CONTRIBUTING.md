# Contributing to DeepChat

We love your input! We want to make contributing to DeepChat as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Development Process

We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

### Internal Team Contributors

#### Bug Fixes and Minor Feature Improvements

- Develop directly on the `dev` branch
- Code submitted to the `dev` branch must ensure:
  - Basic functionality works
  - No compilation errors
  - Project can start normally with `pnpm run dev`

#### Major Features or Refactoring

- Create a new feature branch named `feature/featurename`
- Merge the feature branch back to `dev` branch upon completion

#### Maintainer Release Flow

- Keep `dev` as the integration branch and `main` as the stable mirror.
- Cut a short-lived `release/<version>` branch from an existing commit on `dev`.
- Open `release/<version> -> main` for review and CI, but do not use the GitHub merge button to land it.
- macOS and Linux maintainers can land the approved release with `pnpm run release:ff -- release/<version> --tag v<version>`.
- Windows maintainers must use the documented manual release steps instead of `pnpm run release:ff`.
- Create the release tag on the same commit after `main` has been fast-forwarded.
- See [docs/release-flow.md](./docs/release-flow.md) for the full maintainer procedure, manual fallback, and guardrails.

### External Contributors

1. Fork this repository to your personal account
2. Create your development branch from `dev`
3. Develop in your forked repository
4. Submit a Pull Request to the `dev` branch of the original repository
5. Describe the Issues fixed in your PR description (if applicable)

## Local Development Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/ThinkInAIXYZ/deepchat.git
   cd deepchat
   ```

2. Install required development tools:

   - Install [Node.js](https://nodejs.org/) (Latest LTS version recommended)

3. Additional setup based on your operating system:

   **Windows:**

   - Install Windows Build Tools:
     GUI Installation:
     - Install [Visual Studio Community](https://visualstudio.microsoft.com/vs/community/)
     - Select "Desktop development with C++" workload during installation
     - Ensure "Windows 10/11 SDK" and "MSVC v143 build tools" components are selected（Vistual Studio 2022 recommended)
   - Install Git for Windows

   **macOS:**

   - Install Xcode Command Line Tools:
     ```bash
     xcode-select --install
     ```
   - Recommended: Install Homebrew package manager:
     ```bash
     /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
     ```

   **Linux:**

   - Install required build dependencies:
     ```bash
     # Ubuntu/Debian
     sudo apt-get install build-essential git
     # Fedora
     sudo dnf groupinstall "Development Tools"
     sudo dnf install git
     ```

4. Install project dependencies:

   ```bash
   pnpm install
   pnpm run installRuntime
   ```

5. Start the development server:
   ```bash
   pnpm run dev
   ```

## Project Structure

- `src/main/`: Electron main process. Presenters, typed route handlers, runtime orchestration, and storage owners live here (window/tab/thread/config/llmProvider/mcp/knowledge/sync/floating button/deeplink/OAuth, etc.).
- `src/preload/`: Context-isolated bridge. Exposes typed `window.deepchat` APIs plus a minimal legacy compatibility surface.
- `src/renderer/`: Vue 3 + Pinia app. Business/UI code lives under `src/renderer/src` (components, stores, views, lib, i18n). Shell UI lives in `src/renderer/shell/`.
- `src/renderer/api/`: Renderer-main boundary layer. Put typed `*Client` classes, event subscriptions, and named runtime wrappers here. `src/renderer/api/legacy/` is quarantine-only compatibility code.
- `src/shared/`: Shared route contracts, event contracts, types, and utilities used by both processes. Legacy presenter typings still exist for main internals and quarantine adapters.
- `runtime/`: Bundled runtimes used by MCP and agent tooling (Node/uv).
- `scripts/`, `resources/`: Build, packaging, and asset pipelines.
- `build/`, `out/`, `dist/`: Build outputs (do not edit manually).
- `docs/`: Design docs and guides.
- `test/`: Vitest suites for main/renderer.

## Architecture Overview

### Design Principles

- **Single-track renderer-main boundary**: New renderer business code should go through typed route contracts, typed event contracts, `src/renderer/api/*Client`, and named runtime wrappers. Do not treat presenter names as a public renderer API.
- **Presenters stay in main**: Presenters still own most main-process capabilities, but on active paths they are an implementation detail behind routes, events, and wrappers. `src/renderer/api/legacy/**` is quarantine-only compatibility code.
- **Multi-window + multi-tab shell**: WindowPresenter and TabPresenter manage true Electron windows/BrowserViews with detach/move support; an EventBus fans out cross-process events.
- **Clear data boundaries**: Chat data lives in SQLite (`app_db/chat.db`), settings in Electron Store, knowledge bases in DuckDB, and backups via SyncPresenter. Renderer never touches the filesystem directly.
- **Tooling-first runtime**: LLMProviderPresenter handles streaming, rate limits, and provider instances (cloud/local/ACP agent). MCPPresenter boots MCP servers, router marketplace, and in-memory tools with a bundled Node runtime.
- **Safety & resilience**: `contextIsolation` is on; renderer-side OS/file/network access is gated behind typed bridges or quarantined wrappers; backup/import pipelines validate inputs; rate-limit guards prevent provider overload.

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main (TS)                       │
│  Presenters + routes + runtime owners + persistence         │
│  window/tab/thread/config/llm/mcp/knowledge/sync/...        │
│  Storage: SQLite chat.db, ElectronStore settings, backups   │
└───────────────┬─────────────────────────────────────────────┘
                │ Typed routes/events + limited legacy IPC
┌───────────────▼─────────────────────────────────────────────┐
│         Preload (`window.deepchat` + compat whitelist)      │
└───────────────┬─────────────────────────────────────────────┘
                │ typed clients / runtime wrappers / quarantine
┌───────────────▼─────────────────────────────────────────────┐
│ Renderer boundary: `src/renderer/api/*Client` + wrappers    │
│ quarantine: `src/renderer/api/legacy/**`                    │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│  Renderer business: `src/renderer/src/**`                   │
│  Shell UI, chat flow, ACP workspace, MCP console, settings  │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│ Runtime add-ons: MCP Node runtime, Ollama controls, ACP     │
│ agent processes, DuckDB knowledge, sync backups             │
└─────────────────────────────────────────────────────────────┘
```

### Domain Modules & Feature Notes

- **LLM pipeline**: `LLMProviderPresenter` orchestrates providers with rate-limit guards, per-provider instances, model discovery, ModelScope sync, custom model import, Ollama lifecycle, embeddings, and the agent loop (tool calls, streaming states). Session persistence for ACP agents lives in `AcpSessionPersistence`.
- **MCP stack**: `McpPresenter` uses ServerManager/ToolManager/McpRouterManager to start/stop servers, choose npm registries, auto-start default/builtin servers, and surface tools/prompts/resources. Supports StreamableHTTP/SSE/Stdio transports and a debugging UI.
- **ACP (Agent Client Protocol)**: ACP providers spawn agent processes, map notifications into chat blocks, and feed the **ACP Workspace** (plan panel with incremental updates, terminal output, and a guarded file tree that requires `registerWorkdir`). PlanStateManager deduplicates plan items and keeps recent completions.
- **Knowledge & search**: Built-in knowledge bases use DuckDB/vector pipelines with text splitters and MCP-backed configs; search assistants auto-select models and support API + simulated-browser engines via MCP or custom templates.
- **Shell & UX**: Multi-window/multi-tab navigation, floating chat window, deeplink handling, sync/backup/restore (SQLite + configs zipped with manifest), notifications, and upgrade channel selection.

## Best Practices

- **Use typed clients and runtime wrappers from renderer business code**: In `src/renderer/src/**`, prefer `src/renderer/api/*Client`, typed event helpers, and named runtime wrappers. Do not import `@api/legacy/presenters` or add new presenter-name-based transport there.
- **Do not use Node APIs in the renderer**: All OS/network/filesystem work should go through `window.deepchat`, typed clients, or explicitly named wrappers. Keep features multi-window-safe by scoping state to `tabId`/`windowId`.
- **i18n everywhere**: All user-visible strings belong in `src/renderer/src/i18n`; avoid hardcoded text in components.
- **State & UI**: Favor Pinia stores and composition utilities; keep components stateless where possible and compatible with detached tabs. Consider artifacts, variants, and streaming states when touching chat flows.
- **LLM/MCP/ACP changes**: Respect rate limits; clean up active streams before switching providers; prefer typed events on migrated paths instead of adding new raw IPC or presenter reflection. For MCP, persist changes through main-owned config/runtime layers and surface server start/stop events. For ACP, always call `registerWorkdir` before reading the filesystem and clear plan/workspace state when sessions end.
- **Data & persistence**: Route conversation/settings/provider/backup changes through main-owned clients or compatibility adapters; do not write directly into `appData` or other local stores from the renderer.
- **Testing & quality gates**: Before sending a PR, run `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, and relevant `pnpm test*` suites. Use `pnpm run i18n` to validate locale keys when adding strings.

## Code Style

- TypeScript + Vue 3 Composition API + Pinia; Tailwind + shadcn/ui for styling.
- Oxfmt enforces single quotes, no semicolons, and width 100; `pnpm run format` before committing.
- OxLint is used for linting (`pnpm run lint`). Type checking via `pnpm run typecheck` (node + web targets).
- Tests use Vitest (`test/main`, `test/renderer`). Name tests `*.test.ts`/`*.spec.ts`.
- Follow naming conventions: PascalCase components/types, camelCase variables/functions, SCREAMING_SNAKE_CASE constants.

## Pull Request Process

1. Keep PRs focused; describe what changed and which issues are addressed.
2. Include screenshots/GIFs for UI changes and note any docs updates (README/CONTRIBUTING/docs).
3. Verify format + lint + typecheck + relevant tests locally; note anything not run.
4. Target the `dev` branch; external contributors should fork-first and open PRs against `dev`.
5. At least one maintainer approval is required before merge.
6. PRs targeting `main` are reserved for `release/<version>` branches and are review-only; maintainers land them with the documented `ff-only` flow in [docs/release-flow.md](./docs/release-flow.md).

## Any Questions?

Feel free to open an issue with the tag "question" if you have any questions about contributing.

## License

By contributing, you agree that your contributions will be licensed under the project's license.
