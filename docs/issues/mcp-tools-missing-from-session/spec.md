# MCP Tools Missing From Session

## User Need

When an MCP server is enabled and exposes tools, DeepChat sessions should include those MCP tool
schemas in the provider request. The chat advanced configuration may show the running MCP server and
tool count, but the actual request trace can still omit MCP tools.

## Goal

Ensure session tool resolution in the main process cannot be blocked by stale or historical
agent-scoped MCP server allowlists, and refresh cached session tool profiles when the MCP client list
changes.

## Acceptance Criteria

- A running MCP server's tools are available to DeepChat agent sessions by default.
- Historical `enabledMcpServerIds: []` or stale agent MCP policy does not filter MCP tools out of
  session requests.
- MCP client list updates invalidate cached session tool profiles.
- Existing agent tool enable/disable behavior remains unchanged.
- MCP OAuth authentication remains unchanged.

## Constraints

- Keep the fix in the main session/tool resolution path.
- Do not introduce a new permission model or new renderer state.
- Preserve MCP global enablement and server running-state checks.

## Non-Goals

- Do not remove the MCP OAuth flow.
- Do not change agent built-in tool toggles.
- Do not complete the broader MCP `autoApprove` permission-system removal in this issue.

## Open Questions

None.
