# MCP Authorization Extensions Tasks

Status: implementation and repository validation complete; controlled external interoperability
validation remains pending.

## Interactive OAuth Hardening

- [x] Port interactive authorization to v2 public client APIs.
- [x] Prefer Client ID Metadata Documents and retain issuer-bound DCR fallback.
- [x] Identify DeepChat as a native application.
- [x] Validate all four authorization-response `iss` cases with the official exact-string SDK
      validator before code/error processing.
- [x] Bind registration/tokens to immutable server identity, generation, binding, endpoint,
      protected resource, issuer, and client ID.
- [x] Persist discovered issuer/resource/client ID into the host binding before reuse and verify
      stored interactive credentials against live discovery.
- [x] Preserve accumulated scopes and refresh-token handling.
- [x] Keep static `Authorization` header precedence explicit.

## Secret Storage

- [x] Replace plaintext fallback with memory-only behavior.
- [x] Treat Linux `safeStorage` `basic_text` as non-persistent.
- [x] Add a bounded versioned, credential-class-discriminated `safeStorage` envelope.
- [x] Separate interactive, client secret, private key, enterprise identity, enterprise IdP client
      secret, and target authorization-server secret records.
- [x] Import bounded legacy records only when the issuer/binding is unambiguous and remove legacy
      plaintext storage.
- [x] Remove server-bound credentials on deletion or identity mutation.
- [x] Keep secret material out of renderer state, MCP config, sync, events, routine logs, and
      diagnostics.

## Configuration And Typed Routes

- [x] Add secret-free authorization mode/config, credential binding/status, and enterprise profile
      types.
- [x] Normalize imported and historical server configuration.
- [x] Add bounded credential status, write-only secret/key, removal, enterprise profile, profile
      sign-in, and target authorization-server credential routes.
- [x] Bind credential mutation to immutable current server state and settings-window route context.
- [x] Add secret-free status events and renderer wrappers.

## OAuth Client Credentials

- [x] Integrate v2 `ClientCredentialsProvider`.
- [x] Integrate v2 `PrivateKeyJwtProvider`.
- [x] Pin and expose the OAuth Client Credentials draft revision in diagnostics.
- [x] Require compatible token-endpoint authentication methods and avoid DCR.
- [x] Validate bounded PKCS#8 RSA/EC keys for `RS256`/`ES256` and expose only the public-key
      fingerprint.
- [x] Keep machine mode explicit; never infer it from stored credentials.
- [x] Advertise `io.modelcontextprotocol/oauth-client-credentials` only for a complete selected
      configuration.

## Enterprise-Managed Authorization

- [x] Add bounded non-secret enterprise OIDC profile storage and localized management UI.
- [x] Keep IdP client credentials/tokens separate from each target MCP authorization-server client
      credential.
- [x] Add external-browser PKCE sign-in through the shared loopback callback helper.
- [x] Validate ID-token issuer, signature, audience, nonce, expiry, and subject.
- [x] Require the ID-JAG grant profile in authorization-server metadata.
- [x] Integrate v2 `CrossAppAccessProvider` and pass only the target authorization-server client
      ID/secret to it.
- [x] Use IdP credentials only inside the identity-assertion callback.
- [x] Bind servers to an enterprise profile ID and fail closed when either credential domain is
      incomplete.
- [x] Advertise `io.modelcontextprotocol/enterprise-managed-authorization` only for a complete
      selected configuration.

## Renderer

- [x] Add HTTP authorization mode selection, issuer/resource/client/scope inputs, write-only
      secret/key fields, fingerprints, and storage status.
- [x] Keep secret input component-local and clear it after submission.
- [x] Add enterprise profile management, sign-in/out, and target credential configuration.
- [x] Add localized keyboard/screen-reader labels and non-color status/error text.

## Verification

- [x] Run the repository final validation matrix recorded in the MCP v2 architecture tasks.
- [ ] Run local interactive, client secret, private key JWT, and enterprise OIDC integrations.
- [ ] Run issuer/resource/client/profile mutation and secret-leak boundary cases.
- [ ] Run packaged external-browser and secure-storage smokes on supported platforms.
- [ ] Execute `MV-AUTH-01` through `MV-AUTH-05` from
      `docs/architecture/mcp-v2-protocol/manual-verification.md`.
- [ ] Keep private-key JWT and enterprise interoperability claims pending until controlled
      compatible environments produce archived evidence.
