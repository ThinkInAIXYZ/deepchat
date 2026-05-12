# MCP Toggle Opens Detail

## Problem

Clicking a MCP server enable/disable switch also opens the MCP server detail/debug sheet.

## User Story

As a user managing MCP servers, I want the enable/disable switch to only toggle that server, so I can quickly start or stop servers without an unrelated detail panel opening.

## Acceptance Criteria

- Clicking a server switch emits the toggle action and does not trigger the card click/detail action.
- Clicking the card body still opens the server detail sheet.
- Other interactive controls inside the card do not accidentally trigger the card detail action.

## Non-goals

- No changes to MCP server start/stop behavior.
- No changes to the detail/debug sheet content.
