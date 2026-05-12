# Implementation Plan

## UI

- Remove the top card grid from `McpSettings`.
- Add a `status-bar` slot to `McpServers` so the page shell can inject compact MCP stats and NPM mirror controls into the existing footer.
- Remove the duplicate MCP market action from the server-list footer because the header already owns that entry.
- Restrict `McpServers` filter options to `all`, `running`, and `stopped`.

## Validation

- Update focused renderer tests that assert footer actions.
- Run focused tests plus required format, i18n, lint, and web typecheck.
