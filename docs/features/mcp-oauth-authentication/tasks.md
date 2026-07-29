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
- [x] Wire `McpService` routes: get status, start auth, complete from callback URL, logout auth.
- [x] Move OpenAI Codex OAuth from embedded BrowserWindow to external browser + loopback callback.
- [x] Add OpenAI Codex pasted callback URL fallback while auth is pending.
- [x] Wire renderer `McpClient` API and Pinia MCP store auth-status merge.
- [x] Wire renderer `OAuthClient` API for Codex callback URL completion.
- [x] Add authenticate action and authenticated/error states to `McpServerCard`.
- [x] Add pending Codex paste fallback UI to `OpenAICodexOAuth`.
- [x] Add i18n strings for auth states and actions.
- [x] Add focused main tests for Codex external-browser and pasted callback URL flow.
- [ ] Execute the pinned local and Linear read-only OAuth cases in the ecosystem manual verification
      runbook.
- [ ] Manual smoke OpenAI Codex sign-in with Google through external browser.
- [x] Cover unavailable-listener paste fallback in the focused loopback fixture; do not require a
      packaged manual smoke without reviewed fault injection.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
- [x] Run typecheck and focused Codex auth tests.

## MCP 2026-07-28 Conformance

The checked file-fallback task above records the shipped implementation. The following tasks replace
that behavior rather than treating it as acceptable final storage.

- [ ] Move MCP OAuth types and providers to the v2 client SDK.
- [ ] Prefer Client ID Metadata Documents and keep DCR as an issuer-scoped legacy fallback.
- [ ] Declare DeepChat as a native application in client metadata.
- [ ] Implement all four authorization-response `iss` cases with simple exact string comparison,
      no normalization, and validation before code/error processing or display.
- [ ] Bind stored credentials to immutable server ID/generation/binding, server endpoint, protected
      resource, and issuer.
- [ ] Replace the plaintext `0600` fallback with memory-only credentials when `safeStorage` is
      unavailable.
- [ ] Treat Linux safeStorage `basic_text` as unavailable for persistent secrets.
- [ ] Add tests proving secrets never enter config, renderer state, logs, or plaintext files.
- [ ] Keep deprecated SSE OAuth unchanged and target new authorization behavior to Streamable HTTP.
