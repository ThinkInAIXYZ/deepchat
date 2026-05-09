# Plugin MCP Lifecycle Isolation Plan

## Architecture

- Treat plugin MCP servers as managed plugin resources when `ownerPluginId` is present or
  `source/sourceId` identifies a plugin.
- Keep plugin-owned server configs in the MCP config store for compatibility, but branch lifecycle
  behavior in `McpPresenter`.
- Store transient per-server runtime errors in `ServerManager` and expose them through
  `IMCPPresenter.getServerLastError`.

## Implementation

- Update MCP initialization and global enable/disable to skip plugin-owned servers when applying the
  global switch.
- Start plugin MCP servers from `PluginPresenter` without checking the global MCP setting.
- Filter tools, prompts, and resources so global MCP disabled hides non-plugin results but keeps
  plugin-owned results.
- Suppress global MCP error notifications for plugin-owned start/listTools failures.
- Surface plugin MCP errors in plugin list and CUA settings status.

## Test Strategy

- Add main-process tests for global switch isolation and plugin start behavior.
- Add error-notification tests for plugin-owned connection and tool-list failures.
- Add renderer tests for disabled-global MCP state with plugin tools still visible.
- Add CUA settings regression coverage for MCP error state.

## Risks

- Moderate. MCP tools are shared across runtime and UI surfaces, so filtering must happen in the
  presenter/store boundaries without changing stored config.
