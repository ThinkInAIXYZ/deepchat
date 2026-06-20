# Plugin Shutdown Lifecycle Plan

## Design

Add a public `PluginPresenter.shutdown()` method for app-exit cleanup. It will:

- inspect configured MCP servers;
- select servers with `ownerPluginId` or `source === 'plugin'`;
- stop only the running plugin-owned servers through `IMCPPresenter.stopServer()`;
- close plugin settings windows;
- clear in-memory plugin tool policies for installed plugins;
- avoid `disableByOwner()` because shutdown must not remove config, resources, skills, or enabled
  installation records.

Add `IMCPPresenter.shutdown()` and `McpPresenter.shutdown()` as a general final cleanup pass for all
remaining running MCP clients after plugin shutdown.

Make MCP stdio disconnect await transport cleanup. For stdio transports, use the existing
`terminateProcessTree()` helper against the SDK transport's child process when available, then call
`transport.close()` to clear SDK buffers. This matches the stronger process-tree behavior already used
by exec cleanup.

Update `Presenter.destroy()` order:

1. `pluginPresenter.shutdown()`
2. `mcpPresenter.shutdown()`
3. existing presenter cleanup

## Test Strategy

- PluginPresenter test: shutdown stops running plugin-owned MCP servers, skips regular servers, and
  does not remove MCP server config.
- McpPresenter test: shutdown stops all running clients and continues after individual failures.
- McpClient test: disconnect awaits stdio transport close and invokes process-tree termination for
  stdio child processes.

## Compatibility

Saved plugin installation and MCP config state are preserved across shutdown. On next app launch,
enabled plugins will activate using existing startup behavior.
