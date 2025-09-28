# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DeepChat is a feature-rich open-source AI chat platform built with Electron + Vue 3 + TypeScript. It supports multiple cloud and local LLM providers, advanced MCP (Model Context Protocol) tool calling, and multi-window/multi-tab architecture.

## Development Commands

### Package Management

Use `pnpm` as the package manager (required Node.js >= 20.19.0, pnpm >= 10.11.0):

```bash
# Install dependencies
pnpm install

# Install runtime dependencies for MCP and Python execution
pnpm run installRuntime

# Note: If you encounter "No module named 'distutils'" error on Windows:
pip install setuptools
```

### Development

```bash
# Start development server
pnpm run dev

# Start development with inspector for debugging
pnpm run dev:inspect

# Linux development (disable sandbox)
pnpm run dev:linux
```

### Code Quality

```bash
# Lint with OxLint
pnpm run lint

# Format code with Prettier
pnpm run format

# Type checking
pnpm run typecheck
# or separately:
pnpm run typecheck:node  # Main process
pnpm run typecheck:web   # Renderer process
```

### Testing

```bash
# Run all tests
pnpm run test

# Run tests with coverage
pnpm run test:coverage

# Run tests in watch mode
pnpm run test:watch

# Run tests with UI
pnpm run test:ui

# Run specific test suites
pnpm run test:main      # Main process tests
pnpm run test:renderer  # Renderer process tests
```

### Building

```bash
# Build for development preview
pnpm run build

# Build for production (platform-specific)
pnpm run build:win      # Windows
pnpm run build:mac      # macOS
pnpm run build:linux    # Linux

# Build for specific architectures
pnpm run build:win:x64
pnpm run build:win:arm64
pnpm run build:mac:x64
pnpm run build:mac:arm64
pnpm run build:linux:x64
pnpm run build:linux:arm64
```

### Internationalization

```bash
# Check i18n completeness (Chinese as source)
pnpm run i18n

# Check i18n completeness (English as source)
pnpm run i18n:en
```

## Architecture Overview

### Multi-Process Architecture

- **Main Process**: Core business logic, system integration, window management
- **Renderer Process**: UI components, user interactions, frontend state management
- **Preload Scripts**: Secure IPC bridge between main and renderer processes

### Key Architectural Patterns

#### Presenter Pattern

Each functional domain has a dedicated Presenter class in `src/main/presenter/`:

- **WindowPresenter**: BrowserWindow lifecycle management
- **TabPresenter**: WebContentsView management with cross-window tab dragging
- **ThreadPresenter**: Conversation session management and LLM coordination
- **McpPresenter**: MCP server connections and tool execution
- **ConfigPresenter**: Unified configuration management
- **LLMProviderPresenter**: LLM provider abstraction with Agent Loop architecture

#### Multi-Window Multi-Tab Architecture

- **Window Shell** (`src/renderer/shell/`): Lightweight tab bar UI management
- **Tab Content** (`src/renderer/src/`): Complete application functionality
- **Independent Vue Instances**: Separation of concerns for better performance

#### Event-Driven Communication

- **EventBus** (`src/main/eventbus.ts`): Decoupled inter-process communication
- **Standard Event Patterns**: Consistent naming and responsibility separation
- **IPC Integration**: EventBus bridges main process events to renderer via IPC

### LLM Provider Architecture

The LLM system follows a two-layer architecture:

1. **Agent Loop Layer** (`llmProviderPresenter/index.ts`):
   - Manages conversation flow with multi-turn tool calling
   - Handles tool execution via McpPresenter
   - Standardizes events sent to frontend

2. **Provider Layer** (`llmProviderPresenter/providers/*.ts`):
   - Each provider handles specific LLM API interactions
   - Converts MCP tools to provider-specific formats
   - Normalizes streaming responses to standard events
   - Supports both native and prompt-wrapped tool calling

### MCP Integration

- **Server Management**: Lifecycle management of MCP servers
- **Tool Execution**: Seamless integration with LLM providers
- **Format Conversion**: Bridges MCP tools with various LLM provider formats
- **Built-in Services**: In-memory servers for code execution, web access, file operations
- **Data Source Decoupling**: Custom prompts work independently of MCP through config data source

## Code Structure

### Main Process (`src/main/`)

- `presenter/`: Core business logic organized by functional domain
- `eventbus.ts`: Central event coordination system
- `index.ts`: Application entry point and lifecycle management

### Renderer Process (`src/renderer/`)

- `src/`: Main application UI (Vue 3 + Composition API)
- `shell/`: Tab management UI shell
- `floating/`: Floating button interface

### Shared Code (`src/shared/`)

- Type definitions shared between main and renderer processes
- Common utilities and constants
- IPC contract definitions

## Development Guidelines

### Code Standards

- **Language**: Use English for logs and comments (Chinese text exists in legacy code)
- **TypeScript**: Strict type checking enabled
- **Vue 3**: Use Composition API for all components
- **State Management**: Pinia for frontend state
- **Styling**: Tailwind CSS with scoped styles
- **Internationalization**: All user-facing strings must use i18n keys via vue-i18n

### IPC Communication

- **Renderer to Main**: Use `usePresenter.ts` composable for direct presenter method calls
- **Main to Renderer**: Use EventBus to broadcast events via `mainWindow.webContents.send()`
- **Security**: Context isolation enabled with preload scripts

### Testing

- **Framework**: Vitest for unit and integration tests
- **Test Files**: Place in `test/` directory with corresponding structure
- **Coverage**: Run tests with coverage reporting

### File Organization

- **Presenters**: One presenter per functional domain
- **Components**: Organize by feature in `src/renderer/src/`
- **Types**: Shared types in `src/shared/`
- **Configuration**: Centralized in `configPresenter/`

## Common Development Tasks

### Adding New LLM Provider

1. Create provider file in `src/main/presenter/llmProviderPresenter/providers/`
2. Implement `coreStream` method following standardized event interface
3. Add provider configuration in `configPresenter/providers.ts`
4. Update UI in renderer provider settings

### Adding New MCP Tool

1. Implement tool in `src/main/presenter/mcpPresenter/inMemoryServers/`
2. Register in `mcpPresenter/index.ts`
3. Add tool configuration UI if needed

### Managing Custom Prompts

Custom prompts are managed independently of MCP through the config data source:

1. **Config Storage**: Prompts stored via `configPresenter.getCustomPrompts()`
2. **UI Management**: Use `promptsStore` for CRUD operations in settings
3. **@ Operations**: Mention system loads from both config and MCP sources
4. **MCP Independence**: @ prompt functionality works even when MCP is disabled

### Creating New UI Components

1. Follow existing component patterns in `src/renderer/src/`
2. Use Composition API with proper TypeScript typing
3. Implement responsive design with Tailwind CSS
4. Add proper error handling and loading states

### UI Changes and Layout Documentation

When making UI/layout changes that affect the visual structure or user interface:

1. **Before Implementation**: Create ASCII diagrams to show the current layout
2. **After Implementation**: Create ASCII diagrams to show the proposed/new layout
3. **Visual Comparison**: Use BEFORE/AFTER format to clearly demonstrate changes
4. **Seek Approval**: Present ASCII mockups to user before implementing changes

Example format:
```
BEFORE:
┌─────────────────────────────────────────────┐
│ [Icon] Component Name    [Button] [Hidden]  │
└─────────────────────────────────────────────┘

AFTER:
┌─────────────────────────────────────────────┐
│ [Icon] Component Name    [Button] [Visible] │
└─────────────────────────────────────────────┘
```

This ensures UI changes are clearly communicated and approved before implementation.

### Debugging

- **Main Process**: Use VSCode debugger with breakpoints
- **Renderer Process**: Chrome DevTools (F12)
- **MCP Tools**: Built-in MCP debugging window
- **Event Flow**: EventBus logging for event tracing

## Key Dependencies

### Core Framework

- **Electron**: Desktop application framework
- **Vue 3**: Progressive web framework
- **TypeScript**: Type-safe JavaScript
- **Vite**: Fast build tool via electron-vite

### State & Routing

- **Pinia**: Vue state management
- **Vue Router**: SPA routing

### UI & Styling

- **Tailwind CSS**: Utility-first CSS
- **Radix Vue**: Accessible UI components
- **Monaco Editor**: Code editor integration

### LLM Integration

- **Multiple SDK**: OpenAI, Anthropic, Google AI, etc.
- **Ollama**: Local model support
- **MCP SDK**: Model Context Protocol support

### Development Tools

- **OxLint**: Fast linting
- **Prettier**: Code formatting
- **Vitest**: Testing framework
- **Vue DevTools**: Vue debugging support

## Security Considerations

- Context isolation enabled for secure IPC
- Preload scripts provide controlled API exposure
- Configuration encryption interfaces available
- Network proxy support for privacy
- Screen capture hiding capabilities

## Performance Optimization

- Lazy loading for application startup
- Efficient event handling via EventBus
- Optimized build with tree-shaking
- Monaco Editor worker separation
- Streaming responses for real-time chat

## Platform-Specific Notes

### Windows

- Enable Developer Mode or use admin account for symlink creation
- Install Visual Studio Build Tools for native dependencies

### macOS

- Code signing configuration in `scripts/notarize.js`
- Platform-specific build configurations

### Linux

- AppImage and deb package support
- Sandbox considerations for development

## Git Commit Guidelines

- Do not include AI co-authoring information (e.g., "Co-Authored-By: Claude") in commits
- Follow conventional commit format where applicable
- Keep commit messages concise and descriptive
