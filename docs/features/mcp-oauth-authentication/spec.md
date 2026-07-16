# MCP And Codex OAuth Loopback Authentication

## User Need

DeepChat can add Streamable HTTP MCP servers today, but OAuth-protected servers fail during
startup and only surface as connection errors. A user who adds a server such as
`https://mcp.linear.app/mcp` needs a visible authentication action on the MCP server card, then a
browser authorization flow, then a local callback page that says:

`Authentication complete. You can return to DeepChat. If DeepChat does not update, copy the full URL from your browser and paste it into DeepChat.`

OpenAI Codex sign-in currently uses an embedded Electron browser window. That breaks for providers
such as Google login that reject or degrade embedded browser auth. Codex sign-in should use the same
external-browser + loopback-callback pattern, with a fallback that lets the user paste the full
callback URL back into DeepChat for parsing if the browser could not reach the local listener.

## Current Evidence

- DeepChat already creates `StreamableHTTPClientTransport` in
  `src/main/mcp/mcpClient.ts`, but its current `SimpleOAuthProvider` only wraps
  an existing `Authorization: Bearer ...` header.
- DeepChat already has reusable local auth pieces:
  - PKCE/state helpers in `src/main/provider/auth/openaiCodex/pkce.ts`.
  - Safe token persistence pattern in `src/main/provider/auth/openaiCodex/credentialStore.ts`.
  - Existing OpenAI Codex OAuth status/routes/events in `src/main/provider/auth/openaiCodex/`,
    `src/shared/contracts/routes/oauth.routes.ts`, and
    `src/shared/contracts/events/oauth.events.ts`.
  - Loopback callback validation and completion HTML pattern in
    `src/main/remote/index.ts`.
- On 2026-07-03, `https://mcp.linear.app/mcp` returned `401` with
  `WWW-Authenticate: Bearer ... resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp"`.
- Linear protected resource metadata returned:
  - `resource: "https://mcp.linear.app/mcp"`
  - `authorization_servers: ["https://mcp.linear.app"]`
  - `scopes_supported: ["read", "write"]`
- Linear authorization server metadata returned `authorization_endpoint`, `token_endpoint`,
  `registration_endpoint`, `code_challenge_methods_supported: ["S256"]`, and
  `client_id_metadata_document_supported: true`.

## External References

- MCP authorization spec:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- OpenAI Codex MCP docs:
  https://developers.openai.com/codex/mcp
- Linear Codex MCP integration:
  https://linear.app/integrations/codex-mcp
- OpenCode MCP OAuth docs:
  https://opencode.ai/docs/mcp-servers/
- MCP TypeScript SDK OAuth client interfaces:
  `node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.d.ts`
- MCP TypeScript SDK Streamable HTTP auth behavior:
  `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.d.ts`

## Goals

- Detect OAuth-required Streamable HTTP MCP servers during normal startup without opening a browser.
- Show a first-class authenticate button on the affected MCP card.
- Start a loopback callback server only when the user clicks authenticate/sign in.
- Open the provider authorization URL in the user's external browser.
- Complete the authorization code + PKCE flow, persist tokens securely, and reconnect the server.
- Reuse the installed MCP SDK OAuth flow instead of hand-rolling discovery, DCR, token exchange,
  refresh, and resource-indicator behavior.
- Move OpenAI Codex OAuth from embedded `BrowserWindow` auth to external browser loopback auth.
- Add a paste-callback-url fallback for OpenAI Codex and MCP auth attempts while a matching pending
  flow still exists.
- Use one shared callback-page helper for completion HTML copy.

## Non-Goals

- No new OAuth framework for every provider in the app.
- No cloud sync of MCP OAuth tokens.
- No device-code flow.
- No first increment for SSE OAuth unless it falls out naturally from the same provider with no
  extra UI or storage surface.
- No enterprise static OAuth client UI in the first increment. Add it only when a real supported
  server needs pre-registered client credentials and DCR/client metadata is insufficient.
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
- Successful callback returns an HTML page containing exactly:
  `Authentication complete. You can return to DeepChat. If DeepChat does not update, copy the full URL from your browser and paste it into DeepChat.`
- Tokens and dynamic client information are stored under app user data using `safeStorage` when
  available, with a `0600` file fallback.
- Access tokens, refresh tokens, auth codes, and client secrets never go to renderer state, logs,
  config sync, or MCP server config.
- After successful auth, the MCP server restarts or reconnects and its tools/prompts/resources load
  through the existing MCP presenter path.
- Expired access tokens are refreshed through the SDK/provider path when a refresh token exists.
- Invalid/expired credentials clear token status and return the card to the authenticate state.
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
