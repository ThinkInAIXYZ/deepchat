# Plan

## Implementation

1. Patch the smallest root locations:
   - `mcpOAuthManager.ts` for OAuth error shape checks and stale-flow guard.
   - `mcpOAuthProvider.ts` for authorization URL scheme validation.
   - `oauthCredentialStore.ts` for scoped deletion persistence.
   - renderer OAuth callback handlers for in-flight guards.
   - `McpServerCard.vue` for the auth-error label.
   - shared contracts for stricter callback/status validation.
2. Replace the source-text sheet test with a mounted DOM assertion.
3. Update the new OpenAI Codex/MCP auth strings in affected locale JSON files.

## Test Strategy

- Extend MCP OAuth manager tests for HTTP status classification.
- Add a credential store scoped-clear test.
- Update the SheetContent drag test to mount the component.
- Run focused tests for MCP OAuth/store/renderer components plus format, i18n, lint, and typecheck.
