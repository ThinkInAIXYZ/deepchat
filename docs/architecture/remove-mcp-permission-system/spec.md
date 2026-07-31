# Remove MCP Permission System

Status: implemented and repository-validated.

## User Need

DeepChat should have one permission owner for tool execution: the agent/session permission system.
MCP should provide transports, tool discovery, tool execution, authentication, and server selection,
but it should not maintain a second permission layer.

The removed design stored and checked per-server `autoApprove` permissions. That created duplicated
policy:

- agent/session permission mode decides whether a tool action needs review;
- MCP `autoApprove` can independently bypass or request permission;
- historical MCP permission settings survive upgrades and keep affecting behavior.

## Goal

Remove MCP-specific permission handling so MCP does no extra approval, denial, or auto-approval
processing. After upgrade, historical MCP permission settings are cleared or ignored.

The implementation uses one main-process, source-aware `ToolPermissionBroker`.
`SessionPermissionPort` delegates MCP decisions into that broker, and MCP composition contains no
`mcpService.grantPermission` path. MCP App calls can occur outside an active model turn, so they
enter the same broker with an App-bound request instead of relying on `ToolManager`.

The broker is the only entry point for host-owned tool consent. It receives immutable execution
context:

```ts
interface ToolPermissionRequest {
  requestId: string
  conversationId: string
  serverId: string
  toolName: string
  arguments: unknown
  argumentsHash: string
  source: 'model' | 'mcp-app'
}
```

It evaluates the current agent/session policy, creates a host-owned pending request when user input
is required, presents a bounded/redacted argument view, resumes exactly one caller, and supports
denial, cancellation, renderer destruction, conversation deletion, and timeout. The canonical
arguments remain main-owned and their hash is rechecked immediately before execution. An App
request supplies none of these identities; main derives them from its bound App descriptor and
execution context.

## Acceptance Criteria

- MCP tool execution no longer checks `MCPServerConfig.autoApprove`.
- MCP no longer persists new per-server approval settings.
- Existing persisted MCP permission settings are removed during migration or normalized away on read.
- MCP add/edit/import/sync paths do not reintroduce `autoApprove`.
- MCP UI no longer displays per-server auto-approve controls.
- MCP permission request/session-cache code paths are removed from the MCP presenter.
- One main-process `ToolPermissionBroker` owns evaluate/request/resume/cancel/timeout behavior for
  host-owned model and MCP App tool calls.
- Agent/session permission mode remains the policy evaluated by that broker.
- MCP App-origin tool calls enter the broker with main-derived conversation/server/tool/argument
  identity and cannot restore an App-level or server-level auto-approval path.
- A response is matched by opaque request ID and sender context, resolves one pending request, and
  cannot approve another conversation or changed argument payload.
- MCP OAuth authentication remains separate and unchanged; authentication is not a permission gate.
- Agent-scoped MCP server/plugin selection remains unchanged; selection is not a permission system.

## Non-Goals

- Do not remove agent/session permission modes such as `default`, `full_access`, or `auto_approve`.
- Do not change ACP `session/request_permission` handling.
- Do not change plugin installation trust or plugin ownership metadata.
- Do not change MCP OAuth credential storage or authentication prompts.
- Do not grant an MCP App durable permission from its iframe origin, resource URI, or server
  identity.
- Do not add a persistent App grant, MCP grant, or parallel permission cache to the broker.
- Do not change server enablement, agent server selection, or plugin server selection.

The main-owned MCP App host may suspend that App instance's tool channel after a denial so automatic
polling cannot reopen the dialog. The suspension stores no approval, rejects all App-origin tool
calls until a host-owned retry, and disappears on teardown. It is execution lifecycle state, not a
permission grant or cache.

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
