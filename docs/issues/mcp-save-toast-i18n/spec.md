# MCP Server Toggle Feedback

## User Need

The MCP settings page in the plugins surface must start or stop MCP servers when the user clicks a
server switch. It must not save the current agent MCP policy and show a save toast.

When a Streamable HTTP MCP server requires OAuth, enabling the server should put the card into the
authentication-required state without showing a generic operation-failed toast.

## Acceptance Criteria

- The `plugins-mcp` page uses the global MCP toggle path.
- Clicking a server switch no longer triggers `handleToggleAgentServer`.
- The previous i18n key leak remains fixed if the agent-scoped path is used elsewhere.
- Enabling an OAuth-required MCP server does not show the generic operation failed toast.
- OAuth-required startup keeps the server enabled so authentication can restart it after completion.
- Non-auth startup failures still roll back the enabled state and report failure.
