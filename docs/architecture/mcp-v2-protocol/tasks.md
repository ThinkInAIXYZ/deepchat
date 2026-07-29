# MCP v2 Dual-Era Protocol Migration Tasks

## Baseline

- [ ] Record exact MCP package and runtime versions.
- [ ] Add observable legacy stdio, HTTP, SSE, in-memory, OAuth, sampling, and list-change fixtures.
- [ ] Add structured content, metadata, arbitrary schema, and image-result persistence fixtures.
- [ ] Record startup timeout and child-process cleanup behavior.

## Official Codemod

- [ ] Run `pnpm dlx @modelcontextprotocol/codemod@2.0.0 v1-to-v2 .` from the repository root.
- [ ] Review every codemod change and resolve all `@mcp-codemod-error` diagnostics.
- [ ] Add pinned v2 client, server, and core packages.
- [ ] Keep `@modelcontextprotocol/sdk@1.30.0` only for the
      `@modelcontextprotocol/ext-apps@1.7.5` peer boundary.
- [ ] Add an import restriction preventing v1 SDK imports from DeepChat-owned MCP core code.
- [ ] Format and typecheck the codemod checkpoint.

## Legacy-Wire Parity

- [ ] Port `McpClient` transports and public types to v2.
- [ ] Port sampling and add typed form/URL elicitation handlers.
- [ ] Return empty roots and let the SDK drive bounded multi-round retries.
- [ ] Round-trip opaque `requestState` without interpreting, persisting, or logging it.
- [ ] Port cancellation behavior.
- [ ] Port protocol, SDK, HTTP, and unknown-tool error mapping.
- [ ] Preserve DeepChat lifecycle status and startup timeout behavior.
- [ ] Enforce the v2 stdio buffer bound and process cleanup.
- [ ] Keep in-memory transport explicitly legacy and sourced from one package instance.
- [ ] Pass all baseline tests before enabling modern negotiation.

## Stable Server Identity

- [ ] Assign an immutable local `serverId` and initial `configGeneration` to every existing, new,
      and imported server.
- [ ] Compute a non-secret binding hash from canonical transport and discovered auth identity.
- [ ] Preserve identity across rename and increment generation on every identity-bearing config
      change.
- [ ] Make App, Task, and credential records reject or pause on generation/binding mismatch.
- [ ] Prove imports never bind an existing server by mutable display name.

## Lossless Data

- [ ] Preserve raw JSON Schema 2020-12 tool input/output schemas and metadata.
- [ ] Validate declared schema dialects, reject unresolved external `$ref` without network access,
      and bound composition expansion.
- [ ] Limit schema reduction to provider adapters and keep the raw definition immutable.
- [ ] Pass the raw tool definition into tool execution.
- [ ] Preserve result content, structured content, `_meta`, and extension descriptors.
- [ ] Add bounded result metadata to assistant block `extra_json`.
- [ ] Keep binary payloads in existing attachment/image storage and record truncation.
- [ ] Replace no-op MCP route validation at changed boundaries with structural and bounded JSON
      validation.

## Stateless Core

- [ ] Replace manual protocol caches with the v2 SDK response cache.
- [ ] Honor `ttlMs` and `cacheScope`.
- [ ] Adopt SDK discovery and list-change subscription behavior.
- [ ] Remove modern-path session IDs, initialize lifecycle, resumability, ping, and session-error
      string matching.
- [ ] Do not add new deprecated Roots or Logging support.

## Dual-Era Negotiation

- [ ] Enable modern-first `auto` negotiation for external Streamable HTTP.
- [ ] Enable modern-first `auto` negotiation for external stdio.
- [ ] Use an 8-second probe timeout below the existing soft startup timeout.
- [ ] Prove failed stdio probes leave no child process.
- [ ] Prove auth and `5xx` failures do not trigger legacy fallback.
- [ ] Keep SSE and in-memory connections on explicit legacy paths.
- [ ] Keep ACP-agent-owned MCP connections outside the migration.

## Diagnostics And SSE

- [ ] Expose redacted owner, transport, era, version, extensions, probe, cache, and subscription
      diagnostics.
- [ ] Add a typed read-only `mcp.getServerDiagnostics` route and server-card Diagnostics panel.
- [ ] Refresh from main on demand, invalidate through existing status events, and copy only the
      redacted diagnostics object.
- [ ] Add localized keyboard/screen-reader labels for Diagnostics, Refresh, and Copy actions.
- [ ] Prove packaged diagnostics contain no endpoint, command, environment, header, token, secret,
      raw server error, or protocol payload.
- [ ] Remove SSE from new-server defaults.
- [ ] Preserve existing and imported SSE configurations.
- [ ] Add a localized SSE migration hint without automatic endpoint rewriting.

## Extension Gate

- [ ] Keep Tasks unadvertised until an upstream public v2 adapter can handle modern task results,
      `tasks/*`, and task notifications without bypassing SDK dispatch.

## Verification

- [ ] Run format, i18n validation, lint, typecheck, and focused MCP suites.
- [ ] Run modern/legacy stdio and HTTP integration fixtures.
- [ ] Run OAuth, sampling, multi-round input, cancellation, cache, and subscription fixtures.
- [ ] Run persisted-result reload tests.
- [ ] Execute the required core cases in `manual-verification.md` against exact pinned local
      servers.
- [ ] Run same-day public modern and OAuth/legacy smokes without adding public endpoints to CI.
- [ ] Archive redacted per-platform evidence using the runbook template.
- [ ] Remove the temporary force-legacy diagnostic toggle after one release compatibility window.
