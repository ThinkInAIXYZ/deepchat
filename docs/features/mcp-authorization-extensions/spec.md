# MCP Authorization Extensions

Status: implemented and repository-validated; controlled external authorization interoperability
remains pending.

## User Need

Remote MCP authorization must cover static bearer compatibility, interactive OAuth, unattended
service credentials, and an enterprise identity provider that centrally authorizes access to
multiple MCP servers.

DeepChat will support three explicit authorization profiles for Streamable HTTP:

1. core interactive authorization code + PKCE;
2. `io.modelcontextprotocol/oauth-client-credentials`;
3. `io.modelcontextprotocol/enterprise-managed-authorization`.

The extension identifiers are advertised only when the corresponding provider is fully configured
where the SDK exposes capability metadata. Authorization provider selection itself happens before
an authenticated MCP connection and therefore uses protected-resource and authorization-server
metadata, not only `server/discover`. Authorization extensions never apply to stdio.

## Standard Baseline

- MCP 2026-07-28 authorization:
  https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- Authorization extensions:
  https://modelcontextprotocol.io/extensions/auth/overview
- OAuth Client Credentials:
  https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials
- Enterprise-Managed Authorization:
  https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization
- Reference implementation:
  https://github.com/modelcontextprotocol/ext-auth
- TypeScript client:
  https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md

As of commit `fb374c7db2b34f18ca9183882e0beecdf661892b`, OAuth Client Credentials is
an official-repository draft and Enterprise-Managed Authorization is stable. The v2 TypeScript
client provides
`ClientCredentialsProvider`, `PrivateKeyJwtProvider`, and `CrossAppAccessProvider`; DeepChat should
compose those providers rather than reproduce token exchange code.

## Implemented State

- `McpOAuthManager` and `McpOAuthProvider` use the v2 client APIs for protected-resource and
  authorization-server discovery, PKCE, callbacks, refresh, and runtime providers.
- Callback issuer handling uses the official SDK validator before code or error processing.
- Interactive registration/tokens and machine/enterprise credentials are discriminated and bound
  to immutable server generation, binding, endpoint, protected resource, issuer, and client ID.
- Secure persistence uses a versioned `safeStorage` envelope. Unavailable encryption and Linux
  `basic_text` are memory-only; legacy plaintext envelopes are removed after bounded migration.
- Explicit client-secret, private-key JWT, and cross-app-access modes compose the v2 SDK providers.
- Enterprise OIDC profiles keep IdP credentials separate from each target MCP authorization-server
  client credential.
- Typed routes and renderer forms expose only non-secret configuration, status, fingerprints, and
  write-only secret/key operations.

## Authorization Modes

```ts
type McpAuthorizationMode =
  | 'none'
  | 'interactive'
  | 'client_credentials'
  | 'private_key_jwt'
  | 'cross_app_access'

interface McpAuthorizationConfig {
  mode: McpAuthorizationMode
  protectedResourceUrl?: string
  authorizationServerIssuer?: string
  clientMetadataUrl?: string
  clientId?: string
  scopes?: string[]
  identityProfileId?: string
  keyAlgorithm?: 'RS256' | 'ES256'
}
```

This structure contains no token, secret, private key, authorization code, verifier, or identity
assertion.

### Selection Rules

1. An existing explicit `customHeaders.Authorization` remains the highest-priority legacy input.
   The UI states that it overrides the selected authorization mode.
2. An explicitly selected extension mode is used only after its local configuration is complete and
   authorization metadata permits it.
3. `interactive` always uses the core authorization-code flow.
4. `none` disables managed authorization. It does not inspect or select another credential class.
5. A mode mismatch stops with a structured configuration error. It does not fall through to a
   different credential class.

Machine credentials represent an application, not the current human. DeepChat must not infer
client-credentials mode merely because a client ID and secret happen to exist.

## Core Interactive Hardening

The existing interactive flow must:

- identify DeepChat as an OIDC native application;
- prefer Client ID Metadata Documents;
- use Dynamic Client Registration only as a legacy fallback;
- validate callback `state`, path, method, and host, then apply all four authorization-response
  issuer cases before processing or displaying code/error fields;
- compare `iss` to the discovered issuer by simple exact string equality with no normalization;
- bind client registration, tokens, and refresh tokens to the exact issuer, protected resource, and
  MCP endpoint;
- support scope accumulation without silently dropping a previously granted scope;
- request offline access only when the discovered issuer uses the documented OIDC refresh-token
  convention;
- never persist a secret outside encrypted storage.

## OAuth Client Credentials

### Client Secret

Use the SDK `ClientCredentialsProvider`. The renderer may submit a secret once through a typed,
invoke-only route. Main validates immutable server identity, selected mode, client ID, issuer,
scope syntax, and bounded secret size before encrypting it.

Discover the protected resource and authorization server first. Require compatible
`token_endpoint_auth_methods_supported`; do not use Dynamic Client Registration for this profile.
Include the protected resource in the token request.

The renderer receives only:

```ts
interface McpCredentialStatus {
  configured: boolean
  persistent: boolean
  updatedAt?: number
}
```

### Private Key JWT

Use `PrivateKeyJwtProvider`. Prefer this mode over a shared secret when the authorization server
supports it.

- Accept PEM PKCS#8 private keys only.
- Support `RS256` and `ES256` initially because they are interoperable SDK paths.
- Parse and validate the key in main before storage.
- Derive a public-key fingerprint for status and rotation; never return the private key.
- Sign short-lived assertions with a unique `jti`.
- Bind `aud` to the discovered token endpoint and `iss`/`sub` to the configured client ID.
- Clear key material from replaceable buffers where practical after provider construction.

### Token Lifecycle

Machine access tokens remain in memory. The long-lived client credential is encrypted at rest and
used to obtain a fresh token before expiry. Do not persist short-lived access tokens unless the SDK
requires it for a concrete restart contract.

`invalid_client`, issuer changes, scope errors, and key/secret rotation move the server to a
structured authorization error with a separate secret-free credential status. No browser opens.

Because Client Credentials remains draft, its explicit mode label includes **Draft** and records the
pinned ext-auth commit in diagnostics. Explicit selection is its user opt-in; no second global flag
is needed.

## Enterprise-Managed Authorization

DeepChat supports the official OIDC identity-assertion path with two separate client registrations:

- **Enterprise IdP registration:** belongs to the organization profile and contains the IdP issuer,
  IdP client ID, redirect policy, scopes, and an optional IdP client secret when that OIDC
  registration is confidential.
- **Target MCP authorization-server registration:** belongs to one MCP server binding and contains
  the resource authorization-server client ID and client secret. The current v2
  `CrossAppAccessProvider` public constructor requires both; they must be registered with the
  target MCP authorization server.

The IdP client and the target authorization-server client are different credential domains. IDs,
secrets, tokens, and rotation state are never copied or reused between them.

Flow:

1. An organization profile identifies an OIDC issuer, IdP client ID, approved redirect behavior,
   and base scopes.
2. The user signs into that IdP through external-browser PKCE.
3. DeepChat obtains and validates an OIDC ID token and stores refresh material securely.
4. DeepChat loads the target authorization-server client ID/secret bound to this MCP server.
5. `CrossAppAccessProvider` uses those target credentials and requests the Identity Assertion JWT
   Authorization Grant for the target authorization server and resource.
6. The provider exchanges the grant for an MCP access token.
7. MCP requests use that access token; per-server interactive authorization is not opened.

DeepChat validates the enterprise ID token's issuer, audience, nonce, signature, expiry, and subject.
It never exposes the ID token or grant to the renderer.

Require `urn:ietf:params:oauth:grant-profile:id-jag` in
`authorization_grant_profiles_supported` before using the enterprise flow.

An enterprise profile is organization-scoped data, but DeepChat does not currently have a fleet
management plane. Protocol support therefore accepts a locally configured or deployment-provisioned
OIDC profile. Building admin distribution, directory synchronization, group policy authoring, or
auditing infrastructure is outside this feature. SAML assertion acquisition is also outside the
first implementation; OIDC is the supported standard identity assertion path.

## Secret Storage

All long-lived secrets use one main-process credential store backed by Electron `safeStorage`:

- interactive access/refresh tokens and dynamic client data;
- client secrets;
- private keys;
- enterprise IdP client secrets and OIDC access/refresh/ID tokens;
- per-server enterprise target authorization-server client secrets.

The encrypted envelope is keyed by credential class plus immutable local server/profile identity.
Server credentials include `serverId`, config generation, binding hash, endpoint, protected
resource, issuer, and client ID. Profile credentials include profile ID, IdP issuer, and IdP client
ID. It is never synced.

If `safeStorage.isEncryptionAvailable()` is false, or Linux reports the `basic_text` backend:

- accept a secret for the current process only;
- mark the credential status `persistent: false`;
- require entry/sign-in again after restart;
- do not write a plaintext fallback;
- do not put the secret into server config, environment variables, logs, renderer state, or crash
  metadata.

The ciphertext envelope itself uses restrictive file permissions as defense in depth.

Deleting a server removes all credentials bound to that server after the user confirms deletion;
it does not delete an organization IdP profile used by other servers. Changing endpoint, issuer,
client ID, mode, enterprise profile, config generation, or connection binding invalidates the old
server credential. Display-name rename does not.

## UI Shape

Before:

```text
+------------------------------------------------------+
| MCP Server                                           |
| URL         [https://example.com/mcp              ]  |
| Headers     [Authorization: Bearer ********        ]  |
|                                                      |
|                                   [Cancel] [Save]    |
+------------------------------------------------------+
```

After:

```text
+------------------------------------------------------+
| MCP Server                                           |
| URL         [https://example.com/mcp              ]  |
| Authorization [Interactive OAuth                 v]  |
|                                                      |
| Uses authorization code + PKCE when required         |
|                                                      |
| Advanced headers [collapsed]                         |
|                                   [Cancel] [Save]    |
+------------------------------------------------------+

+------------------------------------------------------+
| Authorization [Private key JWT                   v]  |
| Client ID     [deepchat-prod                       ]  |
| Issuer        [https://id.example.com             ]  |
| Scopes        [mcp.read mcp.write                 ]  |
| Private key   Configured · fingerprint 9A:31:...     |
|               [Replace key] [Remove key]             |
|                                                      |
| Secret stored securely on this device                |
|                                   [Cancel] [Save]    |
+------------------------------------------------------+

+------------------------------------------------------+
| Authorization [Enterprise managed                v]  |
| Organization  [Acme Identity                     v]  |
| Status        Signed in as employee@acme.example     |
|               [Sign out]                             |
| MCP AS client [deepchat-analytics                  ]  |
| MCP AS secret Configured · [Replace] [Remove]        |
|                                   [Cancel] [Save]    |
+------------------------------------------------------+
```

Use existing form, select, password input, dialog, and alert primitives. User-visible copy uses
vue-i18n. Keyboard order follows the visual order. Secret status must not rely on color alone.

## Security Boundaries

- Renderer inputs are untrusted and validated again in main.
- Routes accept a server ID and one credential operation; they do not expose a generic secret API.
- Errors are normalized and redacted before crossing preload.
- Issuer and endpoint URLs must be HTTPS except loopback development fixtures.
- No open redirect, arbitrary token endpoint override, or renderer-provided fetch callback.
- Extension negotiation does not authorize a tool. Agent/session permission remains the only tool
  execution consent owner.
- MCP Apps cannot select or read authorization profiles.

## Non-Goals

- No cloud or multi-device secret sync.
- No environment-variable substitution for stored credentials.
- No general desktop secrets manager.
- No SAML login implementation.
- No enterprise admin console, group sync, or access-policy authoring.
- No machine credentials for stdio servers.
- No automatic conversion of a static Authorization header into another mode.

## Acceptance Criteria

- Interactive OAuth validates issuer and never stores plaintext credentials.
- Interactive callbacks implement all four issuer-presence/support cases with exact string
  comparison before any code/error handling or display.
- A server configured with client secret obtains and refreshes tokens without a browser.
- A server configured with private key JWT signs correct bounded assertions without exposing its
  key.
- Machine mode is never selected implicitly.
- Enterprise OIDC sign-in produces a validated identity assertion; separately provisioned target
  authorization-server client credentials let the SDK complete both required exchanges.
- Enterprise IdP and target MCP authorization-server client credentials are never substituted for
  one another.
- Authorization metadata that does not support the selected profile fails with a clear
  configuration error.
- Changing issuer/resource/endpoint/client/profile/generation/binding invalidates the previous
  credential binding, while rename preserves it.
- Safe-storage unavailability produces memory-only behavior and a visible non-persistent status.
- Renderer routes, events, logs, config export, sync, and crash data contain no secret material.
- Static Authorization headers retain documented precedence.
- OAuth failures never trigger MCP legacy-wire fallback.
- Format, i18n validation, lint, typecheck, focused auth tests, and packaged external-browser smokes
  pass.
