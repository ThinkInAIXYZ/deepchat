# MCP And Codex OAuth Loopback Authentication

Status: implemented and repository-validated; external browser interoperability remains pending.

## User Need

OAuth-protected Streamable HTTP servers expose a visible authentication action on the MCP server
card, a system-browser authorization flow, and a local callback page that says:

`Authentication complete. You can return to DeepChat. If DeepChat does not update, copy the full URL from your browser and paste it into DeepChat.`

OpenAI Codex sign-in uses the same external-browser + loopback-callback pattern, with a fallback
that lets the user paste the full callback URL back into DeepChat if the browser could not reach the
local listener.

## Implemented Evidence

- `McpClient` creates the v2 Streamable HTTP transport with the selected runtime authorization
  provider; a configured static `Authorization` header retains precedence.
- `McpOAuthManager`, `McpOAuthProvider`, and `McpOAuthCredentialStore` own v2 discovery, native
  client metadata, PKCE/state, issuer validation, callback lifecycle, refresh, exact server
  binding, encrypted persistence, and memory-only fallback.
- MCP and OpenAI Codex share the bounded loopback callback helper while retaining separate
  credential domains.
- Typed routes/events and the server card expose secret-free authentication state and explicit
  start/complete/logout actions.

## External References

- MCP authorization spec:
  https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- MCP authorization changes:
  https://modelcontextprotocol.io/specification/2026-07-28/changelog
- OpenAI Codex MCP docs:
  https://developers.openai.com/codex/mcp
- Linear Codex MCP integration:
  https://linear.app/integrations/codex-mcp
- OpenCode MCP OAuth docs:
  https://opencode.ai/docs/mcp-servers/
- MCP TypeScript SDK v2 client:
  https://github.com/modelcontextprotocol/typescript-sdk

## Goals

- Detect OAuth-required Streamable HTTP MCP servers during normal startup without opening a browser.
- Show a first-class authenticate button on the affected MCP card.
- Start a loopback callback server only when the user clicks authenticate/sign in.
- Open the provider authorization URL in the user's external browser.
- Complete the authorization code + PKCE flow, persist tokens securely, and reconnect the server.
- Reuse the installed MCP SDK OAuth flow instead of hand-rolling discovery, client metadata, token
  exchange, refresh, and resource-indicator behavior.
- Move OpenAI Codex OAuth from embedded `BrowserWindow` auth to external browser loopback auth.
- Add a paste-callback-url fallback for OpenAI Codex and MCP auth attempts while a matching pending
  flow still exists.
- Use one shared callback-page helper for completion HTML copy.

## Non-Goals

- No new OAuth framework for every provider in the app.
- No cloud sync of MCP OAuth tokens.
- No device-code flow.
- No new OAuth behavior for deprecated SSE. Existing SSE credentials remain a legacy compatibility
  concern while new authorization modes target Streamable HTTP.
- Machine and enterprise authorization are specified separately in
  `docs/features/mcp-authorization-extensions/`.
- No shared token store across MCP and OpenAI Codex; only the loopback callback page/listener helper
  is shared.

## Acceptance Criteria

- Adding and enabling `linear` with `type: "http"` and `baseUrl:
  "https://mcp.linear.app/mcp"` does not auto-open a browser.
- If startup receives an OAuth challenge, the server card shows an authenticate action and a clear
  authentication-required state.
- Clicking authenticate starts a localhost callback server, opens the authorization URL, and waits
  for the callback.
- The callback accepts only the expected loopback host, path, method, and state.
- After method/host/path/state validation, the callback applies the authorization-response issuer
  matrix before processing or displaying `code`, `error`, `error_description`, or `error_uri`:
  - metadata says `authorization_response_iss_parameter_supported: true` and `iss` is present:
    require simple exact string equality with the discovered authorization-server issuer;
  - metadata says `true` and `iss` is absent: reject;
  - metadata says `false` or omits the flag and `iss` is present: require the same simple exact
    string equality;
  - metadata says `false` or omits the flag and `iss` is absent: continue.
- Issuer comparison performs no URL parsing, normalization, trailing-slash rewriting, case folding,
  or percent-decoding.
- Successful callback returns an HTML page containing exactly:
  `Authentication complete. You can return to DeepChat. If DeepChat does not update, copy the full URL from your browser and paste it into DeepChat.`
- Tokens and dynamic client information are encrypted using Electron `safeStorage`. If secure
  encryption is unavailable, or Linux reports the weak `basic_text` backend, secrets remain
  memory-only for the current process and the UI explains that sign-in will be required again after
  restart.
- Access tokens, refresh tokens, auth codes, and client secrets never go to renderer state, logs,
  config sync, or MCP server config.
- After successful auth, the MCP server restarts or reconnects and its tools/prompts/resources load
  through the existing MCP presenter path.
- Expired access tokens are refreshed through the SDK/provider path when a refresh token exists.
- Invalid/expired credentials clear token status and return the card to the authenticate state.
- Credentials are bound to immutable local server ID/config generation/binding hash, protected
  resource, authorization issuer, and server endpoint. A credential discovered for one binding or
  issuer is never offered to another.
- Protected-resource/authorization-server discovery is written back to the host-owned server
  configuration before a credential becomes reusable. Runtime reuse performs live discovery and
  rejects or clears a record whose issuer/resource no longer matches.
- Client metadata identifies DeepChat as a native application. Client ID Metadata Documents are
  preferred; Dynamic Client Registration remains a legacy fallback only when the authorization
  server requires it.
- Existing bearer-token MCP configs keep working; `customHeaders.Authorization` remains higher
  priority than OAuth auto-detection.
- OpenAI Codex sign-in opens the system browser with `shell.openExternal` and no longer loads the
  OAuth provider in an embedded `BrowserWindow`.
- If the OpenAI Codex loopback listener is unreachable but the provider redirects to the callback
  URL, the user can paste that full URL into DeepChat and DeepChat completes the pending auth flow
  after validating state.
- The pasted URL fallback rejects missing, expired, mismatched, or already-consumed auth states.

## UX Shape

Normal stopped/running cards stay unchanged. Only OAuth-required servers gain the auth action:

```text
+--------------------------------------------------+
| L  linear                         Error   ...    |
|    https://mcp.linear.app/mcp                     |
|    Authentication required        [Authenticate]  |
|                                                  o|
+--------------------------------------------------+
|   wrench 0       prompt 0       resource 0        |
+--------------------------------------------------+
```

After successful auth:

```text
+--------------------------------------------------+
| L  linear                         Running ...    |
|    https://mcp.linear.app/mcp                     |
|    Authenticated                                  |
|                                                  o|
+--------------------------------------------------+
|   wrench 12      prompt 0       resource 0        |
+--------------------------------------------------+
```

OpenAI Codex settings keeps one primary sign-in action and gains a fallback paste action only while
an external browser auth flow is pending:

```text
+--------------------------------------------------+
| OpenAI Codex                                     |
| Not connected                                    |
| [Sign in with browser]                           |
+--------------------------------------------------+

+--------------------------------------------------+
| OpenAI Codex                                     |
| Waiting for browser authentication               |
| [Cancel] [Paste callback URL]                    |
+--------------------------------------------------+
```

## Constraints

- Keep new renderer-main capability on typed routes/events and `src/renderer/api/*Client`.
- Keep user-facing strings in i18n.
- Keep implementation inside the MCP presenter boundary unless a shared route/type is required.
- Prefer `node:http`, Web Crypto/Node crypto, Electron `safeStorage`, and the installed MCP SDK.
- Use loopback only: `127.0.0.1` or `localhost`, never `0.0.0.0`.
- Use a short auth timeout and always close the callback server.
- Keep OAuth callback pages in English:
  - `Authentication complete. You can return to DeepChat. If DeepChat does not update, copy the full URL from your browser and paste it into DeepChat.`
- In-app paste fallback UI still uses the normal renderer i18n path.
- No clarification marker remains; implementation can start from this spec.
