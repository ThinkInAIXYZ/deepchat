# MCP OAuth Authentication Tasks

Status: implementation complete, manual external OAuth smoke pending.

- [x] Inspect current DeepChat MCP and OAuth code paths.
- [x] Verify Linear MCP current OAuth challenge and metadata shape.
- [x] Review MCP spec, Codex docs, OpenCode docs, and installed MCP SDK auth APIs.
- [x] Write SDD spec, plan, and implementation tasks.
- [x] Add OpenAI Codex external-browser OAuth and shared callback page requirements.
- [x] Add a shared loopback callback helper for listener lifecycle, completion HTML, and
      pasted URL parsing.
- [x] Add shared MCP OAuth status types, route contracts, and event contract.
- [x] Add OpenAI Codex pasted callback URL route contract.
- [x] Add `McpOAuthCredentialStore` using `safeStorage` with `0600` file fallback.
- [x] Add `McpOAuthProvider` implementing the SDK `OAuthClientProvider`.
- [x] Add `McpOAuthManager` for discovery, status, loopback callback, SDK auth, logout, and event publish.
- [x] Wire `ServerManager`/`McpClient` so startup detects OAuth requirement without opening a browser.
- [x] Wire `McpPresenter` routes: get status, start auth, complete from callback URL, logout auth.
- [x] Move OpenAI Codex OAuth from embedded BrowserWindow to external browser + loopback callback.
- [x] Add OpenAI Codex pasted callback URL fallback while auth is pending.
- [x] Wire renderer `McpClient` API and Pinia MCP store auth-status merge.
- [x] Wire renderer `OAuthClient` API for Codex callback URL completion.
- [x] Add authenticate action and authenticated/error states to `McpServerCard`.
- [x] Add pending Codex paste fallback UI to `OpenAICodexOAuth`.
- [x] Add i18n strings for auth states and actions.
- [x] Add focused main tests for Codex external-browser and pasted callback URL flow.
- [ ] Manual smoke against `https://mcp.linear.app/mcp`.
- [ ] Manual smoke OpenAI Codex sign-in with Google through external browser.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
- [x] Run typecheck and focused Codex auth tests.
