# Plan

- Make stored OAuth tokens take precedence over stale MCP auth errors.
- Make callback URL completion idempotent when credentials already exist.
- Refresh the selected auth status when DeepChat regains focus during the callback dialog.
- Add focused tests for the manager and renderer store/component behavior.
- Run format, i18n, lint, typecheck, and focused tests.
