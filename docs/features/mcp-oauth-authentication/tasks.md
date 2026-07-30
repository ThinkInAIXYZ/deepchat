# MCP OAuth Authentication Tasks

Status: implementation and repository validation complete; external browser interoperability
remains pending.

## Core Interactive Flow

- [x] Use the v2 client authorization APIs.
- [x] Discover protected-resource and authorization-server metadata.
- [x] Prefer Client ID Metadata Documents and retain issuer-bound Dynamic Client Registration as
      the legacy fallback.
- [x] Declare DeepChat as a native application.
- [x] Use external-browser authorization code + PKCE with a bounded loopback callback.
- [x] Support a pasted callback URL only for the exact pending loopback flow.
- [x] Validate state, callback path/host/method, and all four authorization-response `iss` cases
      before processing code or error fields.
- [x] Bind registration and tokens to immutable server identity, generation, binding, endpoint,
      protected resource, issuer, and client ID.
- [x] Finalize discovered authorization metadata in the host server binding and reject stale
      credentials against live discovery before runtime reuse.
- [x] Preserve static `Authorization` header precedence.
- [x] Keep deprecated SSE on the explicit legacy path.

## Secret Storage

- [x] Store persistent credentials only in a versioned Electron `safeStorage` envelope.
- [x] Use memory-only credentials when encryption is unavailable.
- [x] Treat Linux `safeStorage` `basic_text` as non-persistent.
- [x] Remove a legacy plaintext envelope after bounded import instead of retaining a plaintext
      fallback.
- [x] Keep tokens, codes, verifiers, secrets, and keys out of MCP config, renderer state, sync,
      events, and routine logs.
- [x] Remove all credentials bound to a deleted or identity-mutated server.

## Integration

- [x] Wire startup authorization detection without opening a browser automatically.
- [x] Add typed status/start/complete/logout routes and secret-free events.
- [x] Merge authorization status into the MCP server list and card.
- [x] Add external-browser and pasted-callback UI with localized accessible copy.
- [x] Share the bounded loopback callback helper with enterprise identity authorization.

## Verification

- [x] Run the repository final validation matrix recorded in the MCP v2 architecture tasks.
- [ ] Execute the pinned local interactive OAuth and Linear read-only cases in
      `docs/architecture/mcp-v2-protocol/manual-verification.md`.
- [ ] Execute a packaged external-browser smoke on each supported platform.
