# Remove MCP Permission System

## User Need

DeepChat should have one permission owner for tool execution: the agent/session permission system.
MCP should provide transports, tool discovery, tool execution, authentication, and server selection,
but it should not maintain a second permission layer.

Today MCP stores and checks per-server `autoApprove` permissions. That creates duplicated policy:

- agent/session permission mode decides whether a tool action needs review;
- MCP `autoApprove` can independently bypass or request permission;
- historical MCP permission settings survive upgrades and keep affecting behavior.

## Goal

Remove MCP-specific permission handling so MCP does no extra approval, denial, or auto-approval
processing. After upgrade, historical MCP permission settings are cleared or ignored.

## Acceptance Criteria

- MCP tool execution no longer checks `MCPServerConfig.autoApprove`.
- MCP no longer persists new per-server approval settings.
- Existing persisted MCP permission settings are removed during migration or normalized away on read.
- MCP add/edit/import/sync paths do not reintroduce `autoApprove`.
- MCP UI no longer displays per-server auto-approve controls.
- MCP permission request/session-cache code paths are removed from the MCP presenter.
- Agent/session permission mode remains the only tool-execution permission gate.
- MCP OAuth authentication remains separate and unchanged; authentication is not a permission gate.
- Agent-scoped MCP server/plugin selection remains unchanged; selection is not a permission system.

## Non-Goals

- Do not remove agent/session permission modes such as `default`, `full_access`, or `auto_approve`.
- Do not change ACP `session/request_permission` handling.
- Do not change plugin installation trust or plugin ownership metadata.
- Do not change MCP OAuth credential storage or authentication prompts.
- Do not change server enablement, agent server selection, or plugin server selection.

## Compatibility

Historical config may contain:

```json
{
  "mcpServers": {
    "linear": {
      "autoApprove": ["all"]
    }
  }
}
```

After migration/read normalization, DeepChat should behave as if the field does not exist:

```json
{
  "mcpServers": {
    "linear": {}
  }
}
```

The implementation may keep a temporary optional type field only as a read-compatibility shim, but
runtime logic must not use it.

## Open Questions

None.
