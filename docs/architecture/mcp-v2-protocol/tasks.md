# MCP v2 Dual-Era Protocol Migration Tasks

Status: implementation and repository validation complete; human interoperability remains
pending.

## Packages And Codemod

- [x] Pin `@modelcontextprotocol/client`, `server`, and `core` to `2.0.0`.
- [x] Pin `@modelcontextprotocol/ext-apps@1.7.5` and keep
      `@modelcontextprotocol/sdk@1.30.0` only for its renderer compatibility boundary.
- [x] Run `pnpm dlx @modelcontextprotocol/codemod@2.0.0 v1-to-v2 .` from the repository root.
- [x] Resolve every codemod diagnostic and review the affected MCP ownership boundaries.
- [x] Prevent DeepChat-owned main MCP code from importing the monolithic v1 SDK.

## Dual-Era Runtime

- [x] Port the host-owned MCP client and in-memory servers to v2 split packages.
- [x] Use modern-first SDK `auto` negotiation for external stdio and Streamable HTTP.
- [x] Keep SSE and DeepChat in-memory pairs on explicit legacy wire.
- [x] Keep ACP-agent-owned MCP outside the host migration.
- [x] Use an 8-second probe below the 45-second soft and 5-minute hard startup limits.
- [x] Preserve bounded stdio buffering, stderr handling, transport closure, and process-tree cleanup.
- [x] Ensure authentication and HTTP server failures are not interpreted as legacy evidence.
- [x] Remove host-owned modern session IDs, resumability, ping recovery, and manual protocol cache.

## Protocol Behavior

- [x] Register v2 sampling, form/URL elicitation, truthful empty roots, SDK cancellation, and
      bounded 10-round `input_required` continuation.
- [x] Preserve opaque `requestState` inside SDK dispatch.
- [x] Use SDK response TTL/scope cache, discovery, list-change invalidation, and subscription state.
- [x] Map protocol, SDK, HTTP, cancellation, user rejection, and unknown-tool failures without
      converting errors into success.
- [x] Preserve legacy tools, prompts, resources, sampling, OAuth, SSE, and in-memory behavior.

## Identity, Schemas, And Results

- [x] Assign immutable `serverId`, `configGeneration`, and non-secret `bindingHash` to every
      configured server.
- [x] Preserve identity across rename and invalidate extension/credential state on identity-bearing
      configuration changes.
- [x] Carry the authorized immutable tool target through final dispatch and cancel on mapping,
      client, generation, or binding drift.
- [x] Preserve arbitrary JSON Schema 2020-12 tool schemas, annotations, icons, `_meta`, and
      `x-mcp-header` data until the final provider projection.
- [x] Bound schema bytes/depth/keys/composition and reject unsupported dialects or unresolved
      external references without network dereferencing.
- [x] Preserve raw content, arbitrary JSON `structuredContent`, result `_meta`, and App descriptors
      in bounded assistant-block `extra_json`.
- [x] Keep model-visible text and binary persistence projections bounded.
- [x] Replace permissive changed-route validation with bounded structural schemas.

## Diagnostics And Configuration

- [x] Add typed redacted diagnostics for ownership, transport, lifecycle, era, protocol/server
      version, probe outcome, server/client extensions, cache, subscriptions, and auth.
- [x] Add the localized server-card diagnostics dialog with refresh and redacted JSON copy.
- [x] Keep SSE available for compatibility configs with a localized compatibility badge and
      migration hint.
- [x] Keep the temporary `forceLegacyWire` compatibility diagnostic out of new-server UI.

## Tasks Gate

- [x] Re-check the official Tasks repository, schema, package availability, and v2 client public
      dispatch API at the pinned revisions.
- [x] Record that the v2 client exports Task schemas but exposes no public result/dispatch API for
      `resultType: "task"` or reserved `tasks/*` methods.
- [x] Stop with no Tasks code, schema vendoring, setting, persistence, UI, or advertisement.
- [x] Keep `MV-TASK-01` explicitly blocked until an official public adapter exists.

## Final Repository Validation

- [x] Run Oxfmt and regenerate i18n types.
- [x] Run i18n validation, lint, and typecheck.
- [x] Run focused MCP client, identity, schema, result persistence, Apps, OAuth, routes, session,
      and permission-broker suites.
- [x] Run the relevant broader main/renderer suites and production build.
- [x] Run `git diff --check` and confirm no codemod marker or forbidden core v1 import.
- [x] Record the exact commands and results below.

### Validation Record

Recorded on 2026-07-29:

- `pnpm run format && pnpm run i18n:types && pnpm run i18n && pnpm run lint && pnpm run typecheck`
  — PASS.
- Focused MCP/Apps/OAuth/routes/session/broker matrix — PASS:

  ```bash
  pnpm exec vitest run \
    test/main/mcp \
    test/main/provider/auth/oauthLoopbackCallback.test.ts \
    test/main/routes/dispatcher.test.ts \
    test/main/session/data/tables/deepchatAssistantBlocks.test.ts \
    test/main/tool/toolPermissionBroker.test.ts \
    test/main/tool/toolService.test.ts \
    test/main/agent/acp/runtime/acpMcpPassthrough.test.ts \
    test/renderer/components/McpBuiltinMarket.test.ts \
    test/renderer/components/McpIndicator.test.ts \
    test/renderer/components/McpServerCard.test.ts \
    test/renderer/components/McpServerForm.test.ts \
    test/renderer/components/McpServers.test.ts \
    test/renderer/components/McpSettings.test.ts \
    test/renderer/components/McpToolPanel.test.ts \
    test/renderer/components/ModelScopeMcpSync.test.ts \
    test/renderer/components/message/MessageBlockToolCall.test.ts \
    test/renderer/stores/mcpSampling.test.ts \
    test/renderer/stores/mcpStore.test.ts
  ```

- `pnpm exec vitest run --reporter=dot --silent=passed-only` — PASS: 682 test files passed,
  21 skipped; 7,275 tests passed, 280 skipped.
- `pnpm run build` — PASS, including node/web typecheck and the production Electron Vite build.
- `git diff --check` — PASS.
- Codemod/core-boundary scans — PASS: no executable `@mcp-codemod-error` marker and no
  `@modelcontextprotocol/sdk` import under `src/main/mcp`.

## Human Interoperability

- [ ] Execute the required core, Apps, and authorization cases in `manual-verification.md`.
- [ ] Run same-day public modern and OAuth/legacy read-only smokes without adding public endpoints
      to CI.
- [ ] Archive redacted per-platform evidence using the runbook template.
- [ ] Remove `forceLegacyWire` after one documented compatibility window.
