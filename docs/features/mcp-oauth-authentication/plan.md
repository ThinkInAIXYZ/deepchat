# MCP And Codex OAuth Loopback Authentication Plan

## Design Stance

Do not build a general OAuth platform. The useful shared piece is only loopback callback handling:
local listener, state/path validation, completion HTML, timeout cleanup, and pasted callback URL
parsing. MCP OAuth and OpenAI Codex OAuth keep separate presenters, routes, statuses, and token
stores.

## Research Summary

- MCP requires clients to discover protected resource metadata from `WWW-Authenticate` 401
  challenges, falling back to well-known metadata URLs.
- MCP clients must send the OAuth `resource` parameter in both authorization and token requests.
- MCP 2026-07-28 requires issuer-aware authorization behavior and identifies native clients through
  client metadata. Client ID Metadata Documents are preferred; DCR is a legacy fallback.
- Codex documents OAuth for Streamable HTTP MCP servers through `codex mcp login <server-name>`.
- OpenAI Codex provider auth already has PKCE/state/token refresh/storage; only its browser
  transport changes from embedded `BrowserWindow` redirect interception to external browser +
  loopback callback.
- Linear's observed endpoint supports the existing happy path: 401 challenge, protected resource
  metadata, authorization server metadata, PKCE S256, and `read write` scopes.
- The installed MCP SDK already exposes:
  - `OAuthClientProvider`
  - `auth(provider, { serverUrl, authorizationCode })`
  - `UnauthorizedError`
  - `StreamableHTTPClientTransport.finishAuth(code)`
  - automatic token attachment/refresh when an auth provider is present.

## Affected Modules

- `src/main/provider/auth/oauthLoopbackCallback.ts` or equivalent small helper
  - Own `node:http` loopback listener, callback-page HTML, timeout cleanup, and pasted URL parsing.
  - Must not know about MCP tokens, OpenAI Codex tokens, providers, or server configs.
- `src/main/mcp/`
  - Add a small OAuth manager, credential store, and SDK provider.
  - Wire auth status into `ServerManager` and `McpClient`.
- `src/main/provider/auth/openaiCodex/index.ts`
  - Replace embedded `BrowserWindow` auth with `shell.openExternal` + loopback callback.
  - Add fallback completion from pasted callback URL while a pending browser flow exists.
- `src/shared/types/mcp.ts`
  - Add auth status/result types and `McpServicePort` methods.
- `src/shared/contracts/routes/mcp.routes.ts`
  - Add typed routes for auth status/start/logout.
- `src/shared/contracts/events/mcp.events.ts`
  - Add typed auth-status changed event.
- `src/shared/types/openai-codex.ts`
  - Keep existing status shape unless a pending paste hint needs an extra non-secret flag.
- `src/shared/contracts/routes/oauth.routes.ts`
  - Add an OpenAI Codex route for pasted callback URL completion.
- `src/renderer/api/McpClient.ts`
  - Add client wrappers for the new routes/events.
- `src/renderer/api/OAuthClient.ts`
  - Add OpenAI Codex callback URL fallback wrapper.
- `src/renderer/src/stores/mcp.ts`
  - Merge auth status into server list.
- `src/renderer/src/components/mcp-config/components/McpServerCard.vue`
  - Render authenticate action and status.
- `src/renderer/settings/components/OpenAICodexOAuth.vue`
  - Keep the primary browser sign-in action.
  - Show paste-callback-url fallback only while status is `pending-browser`.
- `src/renderer/src/i18n/*/mcp.json` or `settings.json`
  - Add user-facing strings.

## Shared Loopback Callback Helper

Add one small helper used by both MCP OAuth and OpenAI Codex OAuth.

Responsibilities:

- Bind `node:http` to `127.0.0.1` with a provider-specific preferred loopback port and fall
  back to an OS-assigned port if the preferred port is busy.
- Use a stable provider callback path and a random OAuth state per auth attempt.
- Accept only `GET`.
- Require exact host, path, and state.
- Return parsed callback data to the caller.
- Render the same English completion page copy:

```text
Authentication complete. You can return to DeepChat. If DeepChat does not update, copy the full URL from your browser and paste it into DeepChat.
```

- Expose a `resolvePastedCallbackUrl(rawUrl)` helper that applies the same URL/state/path checks to
  a user-pasted callback URL for the currently pending flow.
- Always close the listener on success, failure, cancel, timeout, and app shutdown.

Non-responsibilities:

- No token exchange.
- No token persistence.
- No OAuth discovery.
- No provider-specific error details in the browser callback page.

## MCP Main Process Flow

### 1. Startup Detection

Normal server start must not open a browser.

```text
ServerManager.startServer(serverId)
  -> McpClient.connect()
     -> no bearer header:
        - if stored OAuth tokens exist, pass McpOAuthProvider to StreamableHTTP transport
        - if no tokens exist, connect unauthenticated
     -> auth challenge / UnauthorizedError
        - McpOAuthManager.discover(serverId, baseUrl)
        - store status: required
        - publish mcp.server.auth.changed
        - keep server stopped with normal last error
```

If `customHeaders.Authorization` exists, keep current bearer behavior and do not switch to OAuth
unless the user removes that header in config.

### 2. User Starts Auth

```text
Renderer Authenticate button
  -> mcp.startServerAuth(serverId)
  -> McpService.startServerAuth(serverId)
  -> McpOAuthManager.startAuth(serverId, serverConfig)
     -> start node:http loopback server on 127.0.0.1 random available port
     -> create MCP SDK OAuthClientProvider with redirect_uri from that port
     -> call SDK auth(provider, { serverUrl })
     -> provider.redirectToAuthorization(url) opens shell.openExternal(url)
     -> wait for callback
     -> validate method, host, path, state
     -> validate callback iss matrix against the discovered authorization issuer
     -> call SDK auth(provider, { serverUrl, authorizationCode })
     -> provider.saveTokens(tokens)
     -> close callback server
     -> update status: authenticated
  -> restart MCP server through existing ServerManager path
```

Use `auth(...)` for the auth route instead of a throwaway MCP `Client.connect(...)`. It is smaller
and lets the SDK own discovery, client metadata, resource indicators, PKCE token exchange, and
refresh-token shape. Prefer a Client ID Metadata Document. Use DCR only when the discovered
authorization server requires the legacy path.

### 3. Runtime Requests

When tokens exist, `McpClient.connect()` creates `McpOAuthProvider` and passes it to
`StreamableHTTPClientTransport`. The provider implements:

- `redirectUrl`
- `clientMetadata`
- `clientInformation()`
- `saveClientInformation()`
- `tokens()`
- `saveTokens()`
- `redirectToAuthorization()`
- `saveCodeVerifier()`
- `codeVerifier()`
- `invalidateCredentials()`
- optional `discoveryState()` / `saveDiscoveryState()`

In non-interactive runtime connection, `redirectToAuthorization()` must not open a browser. It
updates auth status to `required` and returns/throws in a way that lets the startup path fail
cleanly.

### 4. Pasted Callback URL Fallback

```text
Renderer paste callback URL
  -> mcp.completeServerAuthFromCallbackUrl(serverId, callbackUrl)
  -> McpOAuthManager validates against pending flow
  -> calls SDK auth(provider, { serverUrl, authorizationCode })
  -> stores tokens
  -> restarts server
```

Only allow this while that server has a pending interactive auth attempt. Do not accept arbitrary
historical URLs.

## OpenAI Codex Main Process Flow

Replace embedded browser navigation with loopback auth.

```text
OAuthPresenter.startOpenAICodexBrowserLogin()
  -> OpenAICodexAuth.startBrowserLogin()
     -> cancel existing pending flow
     -> create state + PKCE
     -> start shared loopback callback helper
     -> build authorize URL with redirect_uri from helper
     -> shell.openExternal(authorizeUrl)
     -> status: pending-browser
     -> wait for callback
     -> validate method, host, path, state
     -> exchange authorization code with existing token endpoint logic
     -> save tokens in existing OpenAICodexCredentialStore
     -> status: authenticated
```

Fallback:

```text
Renderer Paste callback URL
  -> oauth.openaiCodex.completeBrowserLoginFromUrl({ callbackUrl })
  -> OpenAICodexAuth.completeBrowserLoginFromCallbackUrl(callbackUrl)
     -> shared helper validates URL against pending flow
     -> existing exchangeAuthorizationCode(code, verifier)
     -> save tokens
     -> status: authenticated
```

Do not remove `pending-browser`; its meaning changes from "embedded window is open" to "external
browser auth is pending".

## Data Model

Add a shared status type:

```ts
export type McpServerAuthState =
  | 'none'
  | 'required'
  | 'authenticating'
  | 'authenticated'
  | 'error'

export interface McpServerAuthStatus {
  serverId: string
  serverName: string
  state: McpServerAuthState
  resource?: string
  scopes?: string[]
  authorizationServer?: string
  error?: string
  updatedAt: number
}
```

Token store is separate from `MCPServerConfig`:

```text
app.getPath('userData')/mcp-oauth/credentials.json
```

Envelope:

```ts
interface McpOAuthCredentialEnvelope {
  version: 2
  storage: 'safeStorage'
  entries: Record<string, StoredMcpOAuthCredentials>
  updatedAt: number
}
```

Shipped v1 credential key, used only as migration input:

```text
sha256(serverName + "\n" + baseUrl + "\n" + resource + "\n" + issuer)
```

The MCP v2 identity migration replaces that shipped key with:

```text
sha256(
  serverId + "\n" +
  configGeneration + "\n" +
  bindingHash + "\n" +
  baseUrl + "\n" +
  resource + "\n" +
  issuer
)
```

Rename preserves authentication. Re-pointing or an identity-bearing auth change increments the
generation/binding and invalidates the credential. Display name is never authentication identity.

When `safeStorage.isEncryptionAvailable()` is false, or Linux
`safeStorage.getSelectedStorageBackend()` is `basic_text`, keep credentials in a process-local
memory store and expose only a non-secret `persistent: false` status. Do not write tokens, refresh
tokens, client secrets, or private keys to a plaintext file, even with mode `0600`. Store the
encrypted envelope itself with restrictive file permissions as defense in depth.

## Routes And Events

Add routes:

```text
mcp.getServerAuthStatus     { serverId } -> { status }
mcp.startServerAuth         { serverId } -> { status }
mcp.completeServerAuthFromCallbackUrl { serverId, callbackUrl } -> { status }
mcp.logoutServerAuth        { serverId } -> { status }
```

Add event:

```text
mcp.server.auth.changed     { status, version }
```

Renderer never receives tokens or client secrets.

Add OpenAI Codex route:

```text
oauth.openaiCodex.completeBrowserLoginFromUrl { callbackUrl } -> { status }
```

## Callback Server Rules

- Bind only to `127.0.0.1`.
- Let the OS choose a free port with `server.listen(0, '127.0.0.1')`.
- Use one random callback path per auth attempt, e.g. `/mcp/oauth/callback/<nonce>`.
- Accept only `GET`.
- Require exact host and callback path.
- Require exact `state`.
- After those outer checks, apply the issuer matrix before processing or displaying `code`, `error`,
  `error_description`, or `error_uri`:
  - support flag `true` + `iss` present: simple exact string comparison with discovered issuer;
  - support flag `true` + `iss` absent: reject;
  - support flag false/absent + `iss` present: simple exact string comparison;
  - support flag false/absent + `iss` absent: continue.
- Do not normalize, parse/rebuild, case-fold, decode, or add/remove trailing slashes before issuer
  comparison.
- On success, write this HTML body text:

```text
Authentication complete. You can return to DeepChat. If DeepChat does not update, copy the full URL from your browser and paste it into DeepChat.
```

- On invalid callback input, write the same completion-page copy without sensitive details; detailed
  failure state belongs in DeepChat UI.
- Timeout and close server after 5 minutes.
- If the listener never receives the callback, the browser may show a loopback connection error.
  The user can copy the full `http://127.0.0.1:...` URL from the address bar and paste it into
  DeepChat while the auth attempt is still pending.

## UI Details

Server card state comes from structured auth status, not string parsing of the last error.

```text
states:
  required       -> show [Authenticate]
  authenticating -> show disabled [Authenticating...]
  authenticated -> show "Authenticated" secondary text
  error          -> show [Authenticate] and error tooltip
```

OpenAI Codex settings:

```text
states:
  signed-out       -> show [Sign in with browser]
  pending-browser  -> show [Cancel] and [Paste callback URL]
  authenticated    -> show account summary and [Logout]
  error            -> show error and [Sign in with browser]
```

MCP card sketch:

```text
+---------------------------------------------+
| icon name                         status ... |
| description                                 |
| auth text                 [Authenticate]    |
|                                      toggle |
+---------------------------------------------+
| tools | prompts | resources                 |
+---------------------------------------------+
```

## Tests

- `test/main/mcp/mcpOAuthManager.test.ts`
  - parses Linear-shaped `WWW-Authenticate`
  - saves required/authenticated/error status
  - validates callback state/path/host
  - covers all four authorization-response issuer matrix cases
  - proves issuer mismatch/missing-required issuer is rejected before OAuth error or code handling
  - proves superficially equivalent but non-identical issuer strings are rejected
  - does not leak tokens in status
- `test/main/mcp/oauthCredentialStore.test.ts`
  - saves/loads safeStorage envelope
  - uses memory-only storage when safeStorage is unavailable
  - treats Linux `basic_text` as non-persistent
  - never emits a plaintext secret envelope
  - separates credentials by issuer
  - removes one server credential on logout
- `test/main/mcp/mcpClient.test.ts`
  - passes OAuth provider only when stored tokens exist or interactive auth is explicit
  - preserves bearer header priority
  - marks auth required on OAuth 401 without opening browser
- `test/main/provider/auth/openaiCodexCallback.test.ts`
  - binds only to loopback
  - validates method/host/path/state
  - renders the shared completion copy
  - parses pasted callback URLs with the same validation
- `test/main/provider/auth/openaiCodex.test.ts`
  - opens external browser instead of creating `BrowserWindow`
  - completes auth from loopback callback
  - completes auth from pasted callback URL
  - rejects mismatched or expired pasted callback URL
- `test/main/routes/contracts.test.ts`
  - validates new route/event contracts
- `test/renderer/stores/mcpStore.test.ts`
  - merges auth status into server list
- `test/renderer/components/McpServerCard.test.ts`
  - shows authenticate button only for required/error states
  - emits authenticate click
- `test/renderer/components/OpenAICodexOAuth.test.ts`
  - shows paste fallback only while pending
  - calls the new callback URL completion route

Manual smoke after implementation uses `MV-AUTH-01` and `MV-AUTH-03` from
`../../architecture/mcp-v2-protocol/manual-verification.md`. The MCP-specific sequence covers the
local pinned browser flow before the public Linear smoke. The remaining Codex-specific checks are:

```text
1. Start OpenAI Codex sign-in and confirm the system browser opens
2. Complete Google login and confirm DeepChat authenticates
```

The unavailable-listener paste fallback remains a focused loopback fixture unless a reviewed
packaged-build fault injection exists. The normal product flow binds the listener before opening
the browser, so manually killing it can consume or invalidate the pending OAuth state.

## Risks

- Some legacy servers require DCR. Keep it as an issuer-scoped compatibility fallback after CIMD
  discovery, and never reuse registered client information across issuers.
- Some providers require a fixed redirect URI. Use random loopback first; add an advanced fixed port
  only if a real provider needs it.
- Existing SDK behavior may auto-redirect when an auth provider is passed. Keep runtime provider
  non-interactive and make browser opening explicit in `startServerAuth`.
- External browser auth can leave users on a browser error page if the loopback listener is not
  reachable. The paste fallback is the recovery path; keep it pending-flow-only to avoid accepting
  stale callback URLs.
