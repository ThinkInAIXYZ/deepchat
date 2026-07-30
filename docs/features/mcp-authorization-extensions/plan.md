# MCP Authorization Extensions Implementation Plan

Status: implemented and repository-validated; controlled external authorization interoperability
is tracked in `tasks.md` and the ecosystem runbook.

## Dependency Order

1. Complete the MCP v2 legacy-wire parity checkpoint.
2. Harden the existing interactive OAuth flow and credential store.
3. Introduce the authorization-mode contract without enabling extensions.
4. Add OAuth Client Credentials providers.
5. Add enterprise OIDC identity profiles and Cross-App Access.
6. Advertise each extension only after its focused conformance tests pass.

## Phase 1: Replace The Credential Store Contract

Update the existing MCP OAuth store instead of adding one store per provider.

Use a versioned envelope with records discriminated by credential class:

```ts
type StoredMcpCredential =
  | InteractiveOAuthCredential
  | ClientSecretCredential
  | PrivateKeyCredential
  | EnterpriseIdpCredential
  | EnterpriseResourceClientSecretCredential
```

Key server-bound records by:

```text
sha256(
  credentialClass + "\n" +
  serverId + "\n" +
  configGeneration + "\n" +
  bindingHash + "\n" +
  endpoint + "\n" +
  protectedResource + "\n" +
  issuer + "\n" +
  clientId
)
```

Key the organization-scoped enterprise IdP credential separately:

```text
sha256(
  credentialClass + "\n" +
  enterpriseProfileId + "\n" +
  idpIssuer + "\n" +
  idpClientId
)
```

No key or migration substitutes a server-bound resource authorization-server credential for a
profile-bound IdP credential.

Migration:

1. decrypt current safeStorage entries;
2. bind entries whose issuer can be proven from discovery state;
3. invalidate entries whose issuer cannot be proven;
4. delete the plaintext fallback after a one-time in-process import;
5. never write plaintext again.

The migration must be transactional: write and verify the new encrypted envelope before removing the
old file. A failed migration leaves the original data readable by the current version and reports a
redacted status.

## Phase 2: Interactive OAuth Conformance

- Port `McpOAuthProvider` and `McpOAuthManager` to v2 public auth APIs.
- Carry the discovered issuer through pending flow state.
- After outer callback/state checks, implement the four issuer cases:
  - support flag true + `iss`: exact compare;
  - support flag true + no `iss`: reject;
  - support flag false/absent + `iss`: exact compare;
  - support flag false/absent + no `iss`: continue.
- Perform simple string comparison with no normalization, and do it before processing/displaying
  `code`, `error`, `error_description`, or `error_uri`.
- Add OIDC `application_type: 'native'`.
- Prefer Client ID Metadata Documents.
- Preserve DCR only for a server that advertises/requires the legacy path.
- Re-register when issuer changes.
- Add refresh-token and accumulated-scope tests.
- Keep `customHeaders.Authorization` precedence for compatibility.

## Phase 3: Shared Configuration And Typed Routes

Add non-secret configuration to `MCPServerConfig` and normalize imported legacy configs.

Typed routes:

```text
mcp.credentials.getStatus
mcp.credentials.setClientSecret
mcp.credentials.setPrivateKey
mcp.credentials.setEnterpriseResourceSecret
mcp.credentials.remove
mcp.enterpriseProfiles.list
mcp.enterpriseProfiles.save
mcp.enterpriseProfiles.remove
mcp.enterpriseProfiles.startLogin
mcp.enterpriseProfiles.logout
```

Use precise request/result types. All secret/key setters are write-only from the renderer's
perspective. Server-bound operations accept immutable `serverId`, not display name, and main
verifies current config generation/binding. Use bounded structural Zod schemas, not `z.custom`, and
restrict credential mutation to the expected settings-window route context. Events contain status
changes only.

Do not add a generic `getSecret`, `setSecret`, or arbitrary credential-name route.

## Phase 4: Client Credentials Providers

### Client Secret

1. Discover protected-resource and authorization-server metadata.
2. Verify the configured issuer if present.
3. Require a supported client-secret token endpoint authentication method.
4. Construct `ClientCredentialsProvider` in main without DCR.
5. Request the smallest configured scope set and exact protected resource.
6. connect the v2 Streamable HTTP transport with the provider;
7. normalize `invalid_client`, `invalid_scope`, expiry, and network failures.

### Private Key JWT

1. Parse PKCS#8 PEM with Node crypto.
2. Verify the selected algorithm matches the key type.
3. store the key through safeStorage;
4. construct `PrivateKeyJwtProvider`;
5. verify assertion `iss`, `sub`, `aud`, `iat`, `exp`, and unique `jti` in a local test
   authorization server;
6. keep access tokens in memory and renew before expiry.

Provider instances are scoped to one server client. Do not create a global provider registry.

## Phase 5: Enterprise OIDC Profile

Add a small organization profile service in main:

```ts
interface EnterpriseIdentityProfile {
  id: string
  label: string
  issuer: string
  idpClientId: string
  scopes: string[]
  clientAuthentication: 'none' | 'client_secret'
}
```

Profile config is non-secret and may be deployment-provisioned. Tokens remain in the credential
store.

Flow:

```text
Settings sign-in
  -> external browser + loopback PKCE
  -> validate issuer, signature, audience, nonce, expiry
  -> encrypted enterprise identity credential
  -> selected MCP server requests auth
  -> load that server binding's target-AS client ID/secret
  -> CrossAppAccessProvider
       -> assertion callback uses the enterprise IdP credential
       -> provider clientId/clientSecret use the target MCP authorization-server registration
       -> discoverAndRequestJwtAuthGrant
       -> exchange grant at MCP authorization server
  -> connect
```

Reuse the existing loopback helper. Do not add an embedded auth browser.
Require the ID-JAG grant profile in authorization-server metadata before exchange.

The organization profile may store an optional IdP client secret under
`EnterpriseIdpCredential`. Each enterprise-mode MCP server separately configures
`enterpriseResourceClientId` and a write-only `EnterpriseResourceClientSecretCredential`. Refuse
provider construction if the target credentials are absent. Never fall back to the IdP client
secret or an interactive/DCR registration.

Support one signed-in subject per enterprise profile. If a login returns a different subject, ask
the user to replace the existing session rather than silently switching all bound MCP servers.

## Phase 6: Renderer

Extend `McpServerForm.vue` after the MCP-specific auto-approve controls have been removed.

- Authorization mode select appears for HTTP only.
- Fields are conditionally rendered and unmounted when their mode is inactive.
- Existing secret/key is represented by status and fingerprint, never by a placeholder value
  posted back on save.
- Changing an identity-bearing field shows a confirmation that current credentials will be
  invalidated.
- Enterprise profiles are managed in a focused settings section and selected by ID on a server.
- Static custom Authorization headers show an override warning.
- Safe-storage unavailability shows a non-persistent warning.

State stays in the form component and existing MCP settings store. No new Pinia store is required
for secret form input.

## Phase 7: Provider Discovery And Capability Metadata

- Discover provider eligibility from protected-resource and authorization-server metadata before
  the authenticated MCP connection.
- Require compatible token endpoint auth methods for Client Credentials.
- Require the ID-JAG grant profile for Enterprise-Managed Authorization.
- Add client extension capability metadata only where required/supported by the SDK and selected
  profile.
- Preserve server extension metadata in diagnostics after connection.
- Do not claim enterprise support merely because an enterprise profile exists; its tokens and
  provider must be usable.
- Do not claim client credentials on interactive-only server configurations.

Modern and legacy wire metadata encoding remains the v2 SDK's responsibility.

## Tests

### Unit

- config normalization and secret-free serialization;
- safeStorage envelope migration and memory-only fallback;
- Linux `basic_text` rejection;
- issuer-bound credential keys;
- callback issuer validation;
- key parsing, algorithm matching, fingerprinting, and assertion claims;
- renderer status projection and error redaction.

### Integration

- local OIDC authorization code + PKCE;
- CIMD and legacy DCR paths;
- client secret token acquisition/renewal;
- private key JWT token acquisition/renewal;
- enterprise ID token to grant to MCP token;
- separation of IdP client and target authorization-server client credentials;
- missing/rotated target authorization-server secret;
- issuer/resource/client/profile changes;
- safeStorage unavailable;
- static Authorization header precedence.

### UI

- keyboard traversal and accessible labels;
- conditional fields;
- replacement/removal confirmation;
- no secret returned to the renderer;
- localized persistent/non-persistent and error states.

### Packaged Smoke

Follow the authorization cases in
`../../architecture/mcp-v2-protocol/manual-verification.md`:

- use the pinned SDK OAuth server for system-browser callback on macOS, Windows, and Linux;
- use the pinned SDK client-credentials server for the shared-secret flow;
- use Linear's read-only endpoint as a real-world OAuth/DCR smoke;
- provision a controlled compatible server for private key JWT;
- provision a controlled IdP and MCP authorization server, with separate client registrations, for
  enterprise authorization;
- verify restart persistence when safeStorage is available and reauthentication when it is not.

The SDK example has no runnable private key JWT leg, and enterprise authorization has no
zero-configuration public test service. Those modes remain blocked from conformance claims until
their controlled manual cases pass.

## Rollout And Failure Handling

Authorization mode is explicit per server, so no global feature flag is required. An incomplete
mode stays disabled with a configuration message and never falls back to another credential type.

If the enterprise provider fails, only servers bound to that profile stop. Interactive and machine
profiles remain unaffected. Removing an enterprise profile requires confirmation and signs out all
bound servers.
