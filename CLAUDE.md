# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DeepChat is an open-source AI agent platform built with Electron + Vue 3 + TypeScript. It supports multiple cloud and local LLM providers, MCP (Model Context Protocol) tool calling, ACP (Agent Client Protocol) agent integration, and multi-window/multi-tab architecture.

## Development Commands

### Setup

```bash
pnpm install              # Install dependencies (Node.js >= 20.19.0, pnpm >= 10.11.0)
pnpm run installRuntime   # Install runtime binaries (uv, node, ripgrep)
```

### Development

```bash
pnpm run dev              # Start development server with HMR
pnpm run dev:inspect      # Start with debug inspector (port 9229)
pnpm run dev:linux        # Start on Linux (no sandbox)
```

### Code Quality

```bash
pnpm run lint             # Lint with OxLint
pnpm run format           # Format with Prettier
pnpm run typecheck        # Type check all code
pnpm run typecheck:node   # Type check main process only
pnpm run typecheck:web    # Type check renderer process only
```

**After completing a feature, always run:**
```bash
pnpm run format && pnpm run lint
```

### Testing

```bash
pnpm test                      # Run all tests
pnpm test path/to/file.test.ts # Run a single test file
pnpm test:main                 # Main process tests only
pnpm test:renderer             # Renderer process tests only
pnpm test:coverage             # Generate coverage report
pnpm test:watch                # Watch mode
```

### Building

```bash
pnpm run build            # Build for production (includes typecheck)
pnpm run build:win        # Windows
pnpm run build:mac        # macOS
pnpm run build:linux      # Linux
# Architecture-specific: build:win:x64, build:win:arm64, build:mac:x64, build:mac:arm64, etc.
```

### Internationalization

```bash
pnpm run i18n             # Check i18n completeness (source: zh-CN)
pnpm run i18n:en          # Check i18n completeness (source: en-US)
pnpm run i18n:types       # Generate TypeScript types for i18n keys
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main (TS)                       │
│  Presenters: window/tab/thread/config/llm/mcp/knowledge/    │
│  sync/oauth/deeplink/floating button                        │
│  Storage: SQLite chat.db, ElectronStore settings, backups   │
└───────────────┬─────────────────────────────────────────────┘
                │ IPC (contextBridge + EventBus)
┌───────────────▼─────────────────────────────────────────────┐
│                    Preload (strict API)                     │
└───────────────┬─────────────────────────────────────────────┘
                │ Typed presenters via `usePresenter`
┌───────────────▼─────────────────────────────────────────────┐
│      Renderer (Vue 3 + Pinia + Tailwind + shadcn/ui)        │
│  Shell UI, chat flow, ACP workspace, MCP console, settings  │
└─────────────────────────────────────────────────────────────┘
```

### Core Patterns

**Presenter Pattern**: All system capabilities are in main-process presenters (`src/main/presenter/`). The renderer calls them via the typed `usePresenter` hook through the preload bridge.

**Multi-Window Multi-Tab**: WindowPresenter and TabPresenter manage Electron windows/BrowserViews with detach/move support. EventBus fans out cross-process events.

**Data Boundaries**: Chat data in SQLite (`app_db/chat.db`), settings in Electron Store, knowledge bases in DuckDB. Renderer never touches filesystem directly.

### Key Presenters

- **LLMProviderPresenter**: Streaming, rate limits, provider instances (cloud/local/ACP), model discovery, agent loop
- **McpPresenter**: MCP server lifecycle, tool/prompt/resource management, supports StreamableHTTP/SSE/Stdio
- **ThreadPresenter**: Conversation session management and LLM coordination
- **ConfigPresenter**: Unified configuration management
- **WindowPresenter/TabPresenter**: Window and tab lifecycle

### LLM Provider Architecture (Two Layers)

1. **Agent Loop Layer** (`llmProviderPresenter/index.ts`): Multi-turn tool calling, tool execution via McpPresenter, standardized frontend events
2. **Provider Layer** (`llmProviderPresenter/providers/*.ts`): Provider-specific API interactions, MCP tool conversion, streaming normalization

## Code Structure

```
src/main/           # Main process
  presenter/        # Core business logic by domain
  eventbus.ts       # Central event coordination
src/preload/        # Context-isolated IPC bridge
src/renderer/
  src/              # Main app UI (Vue 3 + Composition API)
  shell/            # Tab management shell UI
  floating/         # Floating button interface
src/shared/         # Shared types/utilities and presenter contracts
test/               # Vitest suites (main/, renderer/)
docs/               # Design docs and guides
```

## Development Guidelines

### Code Standards

- **Language**: English for all logs and comments
- **TypeScript**: Strict type checking
- **Vue 3**: Composition API with `<script setup>` syntax
- **State Management**: Pinia stores
- **Styling**: Tailwind CSS (v4) with shadcn/ui (reka-ui)
- **i18n**: All user-facing strings must use i18n keys (supports 12 languages)

### IPC Communication

```typescript
// Renderer → Main: Use usePresenter composable
const presenter = usePresenter()
await presenter.configPresenter.getSetting('key')

// Main → Renderer: Use EventBus
eventBus.sendToRenderer(CONFIG_EVENTS.SETTING_CHANGED, SendTarget.ALL_WINDOWS, payload)
```

### Git Hooks

Pre-commit automatically runs:
- `lint-staged` - Format and lint staged files
- `typecheck` - TypeScript type checking
- Commit message validation

### Specification-Driven Development

For features, use lightweight spec artifacts under `docs/specs/<feature>/` (spec.md, plan.md, tasks.md). Resolve `[NEEDS CLARIFICATION]` markers before coding. See [docs/spec-driven-dev.md](docs/spec-driven-dev.md).

## Common Tasks

### Adding New LLM Provider

1. Create provider in `src/main/presenter/llmProviderPresenter/providers/`
2. Implement `coreStream` method following standardized event interface
3. Add provider config in `configPresenter/providers.ts`
4. Update renderer provider settings UI

### Adding New MCP Tool

1. Implement in `src/main/presenter/mcpPresenter/inMemoryServers/`
2. Register in `mcpPresenter/index.ts`

### UI Changes

When making UI/layout changes, create ASCII diagrams showing BEFORE/AFTER layouts and seek approval before implementation.

## Platform Notes

- **Windows**: Enable Developer Mode for symlink support; install Visual Studio Build Tools
- **macOS**: Code signing in `scripts/notarize.js`
- **Linux**: Use `pnpm run dev:linux` (no sandbox)

## Git Commit Guidelines

- Do not include AI co-authoring information (e.g., "Co-Authored-By: Claude")
- Follow conventional commit format
- PRs should target the `dev` branch
