# Plan

1. Replace awaited automatic startup in MCP initialization with handled background starts.
2. Make plugin auto-start fire-and-forget after plugin enablement.
3. Add tests that initialization and plugin enablement do not wait on a hanging start.
4. Run format, i18n, lint, typecheck, and focused tests.
