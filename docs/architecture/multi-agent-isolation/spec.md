# Multi-Agent Isolation Contract

## User Need

DeepChat is a multi-host-agent application. Users configure independent DeepChat agents with
different Skills, MCP servers, tools, memory, and default permissions. Runtime behavior must match
those host-agent policies when sessions run concurrently or when history is transferred.

## Goal

Define the durable isolation matrix for host agents and the enforcement seams that keep Skills, MCP,
tools, memory, permissions, and workspace boundaries aligned with the session's host `agent_id`.

## Isolation Matrix

| Resource | Install / process | Policy owner | Runtime enforce |
| --- | --- | --- | --- |
| Skills catalog | global | agent `enabledSkillNames` | prompt / list / view / activate / catalog fingerprint |
| MCP servers | global process | agent `enabledMcpServerIds` | catalog + call + pre-check + fingerprint |
| Plugins | global | none (always global for DeepChat) | plugin lifecycle only |
| Plugin-owned MCP | global | exempt from agent MCP allow-list | always available when plugin enabled |
| Built-in agent tools | process | session `disabledAgentTools` | catalog filter + execution membership check |
| Memory | per-agent storage | agent memory settings | agentId-keyed rows / vectors |
| Permission approvals | session | session `permissionMode` + caches | conversation-scoped; all caches cleared on transfer |
| Workspace | session `project_dir` | session | tool allowed dirs from call workdir only |
| Tape / messages | session | session | session-scoped |
| ACP MCP | ACP process | ACP `agent_mcp_selections` | ACP session/call path |

## Acceptance Criteria

1. Two DeepChat agents with different `enabledMcpServerIds` expose different MCP tool catalogs at
   runtime and cannot call disallowed servers.
2. Concurrent sessions with different workdirs do not widen each other's filesystem allow lists.
3. Transferring a session to another agent clears permission approvals, refilters active skills to
   the target allow-list, clears plan/runtime skill activation, and invalidates tool caches.
4. Skills allow-list enforcement remains intact.
5. Plugins remain globally enabled for DeepChat agents; UI/docs distinguish global plugins from
   agent-scoped Skills/MCP.
6. ACP agents continue using ACP MCP selections, not DeepChat `enabledMcpServerIds`.
7. Tool calls absent from the current session's tool definitions are rejected before dispatch, even
   when a process-global tool mapper contains the same name.

## Constraints

- Do not copy skill files or MCP definitions per agent.
- Do not introduce per-agent plugin process isolation in this goal.
- Keep null/`undefined` allow-list semantics: inherit resolved builtin policy; `[]` disables the
  category for normal (non-plugin) MCP servers.
- Preserve Presenter boundaries and existing route/event schemas.

## Non-goals

- Subagent target-agent full policy resolution (separate architecture slice).
- Process-level sandboxing between agents.
- Removing the DeepChat + `providerId=acp` compatibility path.
- Changing ACP Memory absence.

## Decisions

- DeepChat runtime must pass effective `enabledMcpServerIds` from
  `resolveDeepChatAgentConfig(session.agentId)` into tool discovery and MCP call paths.
- Historical `enabledPluginIds` remains omitted from tool discovery forever.
- Tool workspace allow lists trust the conversation workdir argument, not a shared mutable manager
  workspace field. A missing or failed conversation workdir lookup uses the isolated default
  workspace and never falls back to the manager's last synchronized workspace.
- Transfer is a security boundary: command, file, settings, and MCP session approvals plus pinned
  skills do not silently survive host change.
