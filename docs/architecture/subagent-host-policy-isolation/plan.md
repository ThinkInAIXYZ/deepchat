# Subagent Host Policy Isolation — Plan

## Approach

1. Pass `parentAgentId` into subagent assignment resolution.
2. Expand `ResolvedSubagentAssignment` with `permissionMode`.
3. In `SessionAgentAssignmentPolicy.resolveSubagentAssignment`:
   - self: inherit input surface
   - cross-agent DeepChat: load target config for permission/tools/prompt/skill filter
4. Lifecycle initializes runtime with resolved `permissionMode`.
5. Lifecycle clones non-MCP approvals only when the resolved child agent matches `parentAgentId`.
6. Orchestrator supplies `parentAgentId` from the parent session.

## Tests

- Policy unit: self vs cross-agent vs ACP
- Lifecycle mock: uses resolved permissionMode
- Lifecycle permission inheritance: self-target clones; cross-agent starts clean
