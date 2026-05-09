# Plugin MCP Lifecycle Isolation

## User Story

As a user with the CUA plugin enabled, I want the plugin MCP runtime to follow plugin state rather
than the global MCP switch, so Computer Use remains available when I disable normal MCP tools and
does not spam global connection failure toasts.

## Acceptance Criteria

- The global MCP switch starts and stops only non-plugin MCP servers.
- Plugin-owned MCP servers are identified by `ownerPluginId` or `source: plugin`.
- Enabled plugin MCP servers start when the plugin is active even if global MCP is disabled.
- Plugin MCP connection and tool-list failures do not show global MCP error toasts.
- Plugin MCP failures are visible from plugin status surfaces.
- DeepChat agent tools can still include plugin MCP tools while global MCP is disabled.

## Non-goals

- Redesigning plugin installation or runtime detection.
- Changing ACP agent MCP selection behavior.
- Migrating existing MCP settings.

## Open Questions

None.
