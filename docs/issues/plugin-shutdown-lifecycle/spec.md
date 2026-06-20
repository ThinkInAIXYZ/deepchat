# Plugin Shutdown Lifecycle

## Problem

Plugin-owned MCP servers can launch long-running helper processes such as the CUA driver. Disabling a
plugin stops its managed MCP server, but application shutdown currently does not run a plugin-specific
shutdown lifecycle before the main process exits.

## Goal

When DeepChat quits, enabled plugin runtime resources must be explicitly shut down so helper
processes owned by plugin MCP servers do not survive the app.

## Acceptance Criteria

- App shutdown invokes a PluginPresenter lifecycle method before the presenter tears down shared
  infrastructure.
- The plugin shutdown lifecycle stops every running MCP server whose config is owned by a plugin.
- Shutdown does not persistently disable plugins or remove their saved MCP server config.
- MCP stdio disconnect waits for transport close and terminates the spawned process tree when a child
  process is available.
- Failures to stop one plugin-owned server are logged and do not block cleanup of the remaining
  plugin-owned servers.

## Non-Goals

- No UI changes.
- No plugin manifest schema changes.
- No CUA-specific special cases.
- No change to user plugin enablement state.

## Open Questions

None.
