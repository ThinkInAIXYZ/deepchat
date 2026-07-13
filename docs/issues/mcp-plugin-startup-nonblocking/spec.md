# MCP Plugin Startup Nonblocking

## User Need

Plugin-owned MCP servers must not block main startup or plugin enablement when a server hangs or times out.

## Goal

Run automatic MCP server starts in the background while preserving explicit manual start behavior.

## Acceptance Criteria

- MCP presenter initialization completes without waiting for enabled server connection attempts.
- A failing enabled plugin MCP server does not prevent other enabled servers from starting.
- Manual `startServer` calls still reject on startup failure.

## Constraints

- Do not add a new startup queue abstraction.
- Keep existing MCP server status and error recording behavior.

## Open Questions

None.
