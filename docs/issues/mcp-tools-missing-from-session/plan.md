# Plan

## Diagnosis

The provider request is assembled from `AgentRuntimePresenter.loadToolDefinitionsForSession()`.
That path calls `ToolPresenter.getAllToolDefinitions()` with agent extension policy. Historical
`enabledMcpServerIds` can be an empty allowlist, which filters out all MCP tools even though the MCP
store and chat popover can still show a running server and tool count.

Separately, `ToolManager` clears its MCP definition cache on `MCP_EVENTS.CLIENT_LIST_UPDATED`, but
`AgentRuntimePresenter` does not currently treat the same event as a session tool-profile change.

## Implementation

1. Stop passing `enabledMcpServerIds` from agent policy into session tool discovery and tool-call
   routing.
2. Remove `enabledMcpServerIds` from the session tool-profile fingerprint so historical MCP policy
   no longer affects cache keys.
3. Register `MCP_EVENTS.CLIENT_LIST_UPDATED` with `handleToolRegistryChanged`.
4. Keep plugin and skill policy behavior unchanged.

## Test Strategy

- Add a main presenter test that verifies MCP client-list updates invalidate the cached session tool
  profile.
- Add a main presenter test that verifies historical `enabledMcpServerIds: []` is ignored for
  session tool discovery.
- Update any renderer wrapper test that still expects the old MCP agent-scope route.

## Risks

- Old tests may still encode agent-scoped MCP selection. Update only the expectations affected by
  the already-changed MCP plugins page.
