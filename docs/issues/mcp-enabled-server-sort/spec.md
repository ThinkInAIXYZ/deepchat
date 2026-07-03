# MCP Enabled Server Sort

## User Need

Enabled MCP servers should appear first in the MCP Center so active servers are easy to find.

## Goal

Sort MCP server cards with enabled servers before disabled servers while preserving the existing
built-in-first preference inside each enabled/disabled group.

## Acceptance Criteria

- Enabled MCP servers render before disabled MCP servers.
- Built-in/deepchat servers remain ahead of custom servers within the same enabled state.
- Existing plugin-owned server filtering remains unchanged.

## Constraints

- Keep the change in the MCP store list ordering.
- Do not add new UI state or controls.

## Non-Goals

- Do not change server enable/disable behavior.
- Do not change MCP authentication, tool discovery, or permissions.

## Open Questions

None.
