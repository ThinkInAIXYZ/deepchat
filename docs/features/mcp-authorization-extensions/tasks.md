# MCP Authorization Extensions Tasks

## Interactive OAuth Hardening

- [ ] Port the existing MCP OAuth provider and manager to v2 public APIs.
- [ ] Implement all four authorization-response `iss` cases with exact string comparison, no
      normalization, and validation before code/error processing or display.
- [ ] Bind registration and tokens to immutable server ID/generation/binding, issuer, protected
      resource, endpoint, and client ID.
- [ ] Identify DeepChat as a native application.
- [ ] Prefer Client ID Metadata Documents and keep issuer-scoped DCR fallback.
- [ ] Cover refresh-token requests and accumulated scopes.

## Secret Storage

- [ ] Replace the plaintext file fallback with memory-only behavior.
- [ ] Treat Linux safeStorage `basic_text` as non-persistent.
- [ ] Add a versioned, credential-class-discriminated safeStorage envelope.
- [ ] Separate enterprise IdP credentials from per-server target authorization-server client
      credentials.
- [ ] Transactionally import valid legacy credentials and invalidate ambiguous issuer bindings.
- [ ] Prove secrets never appear in renderer state, config, sync, logs, or crash metadata.
- [ ] Remove all server-bound credentials when a server is deleted.

## Shared Configuration

- [ ] Add non-secret authorization mode/config types.
- [ ] Normalize imported and legacy server configuration.
- [ ] Add credential status, write-only secret/key, removal, and enterprise profile routes.
- [ ] Add a write-only per-server enterprise target authorization-server secret route.
- [ ] Use bounded structural schemas and settings-window route context for credential mutation.
- [ ] Add secret-free status events and renderer client wrappers.
- [ ] Preserve static Authorization header precedence with an explicit warning.

## OAuth Client Credentials

- [ ] Integrate the v2 `ClientCredentialsProvider`.
- [ ] Integrate the v2 `PrivateKeyJwtProvider`.
- [ ] Pin and display the ext-auth draft revision for Client Credentials.
- [ ] Require compatible token endpoint auth methods and do not use DCR.
- [ ] Validate PKCS#8 RSA/EC keys and `RS256`/`ES256` selection.
- [ ] Add public-key fingerprints and credential rotation.
- [ ] Test token renewal, issuer mismatch, invalid client, invalid scope, and cancellation.
- [ ] Advertise `io.modelcontextprotocol/oauth-client-credentials` only when usable.

## Enterprise-Managed Authorization

- [ ] Add non-secret enterprise OIDC profile storage.
- [ ] Store IdP client ID/auth mode in the profile and optional IdP client secret in the encrypted
      profile credential domain.
- [ ] Store a separate target authorization-server client ID/secret for each enterprise-mode MCP
      server binding.
- [ ] Add external-browser PKCE sign-in through the shared loopback helper.
- [ ] Validate ID-token issuer, signature, audience, nonce, expiry, and subject.
- [ ] Require the ID-JAG grant profile in authorization-server metadata.
- [ ] Integrate `CrossAppAccessProvider` and the ID-JAG/MCP token exchanges.
- [ ] Pass target authorization-server client ID/secret to `CrossAppAccessProvider`; use IdP
      credentials only in its assertion callback.
- [ ] Refuse missing target credentials and prove IdP/resource client credentials are never reused.
- [ ] Bind servers to an enterprise profile by ID.
- [ ] Handle subject replacement and profile removal with confirmation.
- [ ] Advertise `io.modelcontextprotocol/enterprise-managed-authorization` only when usable.

## Renderer

- [ ] Add HTTP authorization mode selection to `McpServerForm.vue`.
- [ ] Add client secret, private key JWT, and enterprise OIDC fields/status.
- [ ] Keep secret input component-local and write-only.
- [ ] Add invalidation confirmation and non-persistent storage warnings.
- [ ] Add enterprise profile management UI.
- [ ] Add i18n, keyboard, screen-reader, and non-color status coverage.

## Verification

- [ ] Run format, i18n validation, lint, typecheck, and focused auth suites.
- [ ] Run local interactive, client secret, private key JWT, and enterprise OIDC integrations.
- [ ] Run issuer/resource/client/profile mutation tests.
- [ ] Run packaged external-browser and secure-storage smokes on supported platforms.
- [ ] Execute `MV-AUTH-01` through `MV-AUTH-05` from the ecosystem manual verification runbook.
- [ ] Keep private key JWT and enterprise claims blocked until controlled compatible environments
      produce archived manual evidence.
