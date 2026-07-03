# Plan

- Remove the accidental agent scope from `McpPluginsPage.vue`.
- Add the missing `mcp.saveSuccess` and `mcp.saveFailed` keys to locale `settings.json` files.
- Treat OAuth-required startup as a handled MCP toggle result when the auth status becomes
  `required` or `authenticating`.
- Cover the OAuth-required toggle path in the existing MCP store tests.
- Run formatting, i18n, lint, typecheck, and focused MCP store tests.
