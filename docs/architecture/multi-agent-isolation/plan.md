# Multi-Agent Isolation — Phase 0 Plan

## Approach

1. Treat host-agent allow-lists as runtime contracts, not settings-only metadata.
2. Reuse existing MCP `enabledServerIds` filters in `McpPresenter` / `ToolManager`.
3. Pass policy through the same seams already used for Skills (`AgentExtensionPolicy`).
4. Reset session-scoped security state when `agent_id` changes.

## Affected Interfaces

- `AgentExtensionPolicy` gains `enabledMcpServerIds`.
- `ToolDefinitionContext.enabledMcpServerIds` populated for DeepChat sessions.
- `ProcessControlCollaborators` exposes MCP allow-list + agent id for tool execution.
- `setSessionAgentContext` becomes a security boundary for transfer/rebind.

## Compatibility

- `null` / omitted allow-list: unrestricted normal MCP (current default after inheritance).
- `[]`: no normal MCP tools/calls; plugin-owned MCP still exempt.
- Plugin enablement remains global; `enabledPluginIds` stays omitted.
- No schema/IPC changes.

## Test Strategy

- Rewrite agentRuntimePresenter tool-discovery expectations to enforce MCP policy.
- Keep plugin policy omission assertion.
- Workspace allow-list unit coverage for call workdir only.
- Transfer/rebind clears command, file, settings, and MCP permissions and refilters skills.
- Dispatch rejects tool names missing from the current session catalog.
