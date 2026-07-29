# MCP v2 Dual-Era Protocol Architecture

Status: planned on 2026-07-29.

## Decision

DeepChat will migrate its host-owned MCP runtime to the MCP TypeScript SDK v2 and support both the
MCP 2026-07-28 stateless wire and the legacy wire. External `stdio` and Streamable HTTP servers use
SDK negotiation with modern-first probing and legacy fallback. DeepChat-owned in-memory servers
remain explicitly legacy-wire because the v2 SDK does not provide a modern in-memory serving
transport.

The migration must preserve observable behavior before modern negotiation is enabled. The official
codemod changes source and package boundaries; it is not evidence that transport, auth, schema,
cache, result, or error semantics are correct.

## Standard Baseline

The implementation targets:

- MCP core specification `2026-07-28`;
- `@modelcontextprotocol/client@2.0.0`;
- `@modelcontextprotocol/server@2.0.0`;
- `@modelcontextprotocol/core@2.0.0`;
- `@modelcontextprotocol/codemod@2.0.0`;
- Zod `>=4.2`, already satisfied by DeepChat;
- `@modelcontextprotocol/sdk@1.30.0`, required as a peer by the MCP Apps SDK and isolated to the
  Apps boundary.

Versions are pinned during the migration. A later dependency refresh is a separate change with its
own compatibility review.

Authoritative references:

- https://modelcontextprotocol.io/specification/2026-07-28
- https://modelcontextprotocol.io/specification/2026-07-28/changelog
- https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports
- https://modelcontextprotocol.io/specification/2026-07-28/server/discovery
- https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- https://github.com/modelcontextprotocol/typescript-sdk
- https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2
- https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28

## Current Evidence

The current runtime is a stateful v1 client:

- `src/main/mcp/mcpClient.ts` imports the monolithic
  `@modelcontextprotocol/sdk`, owns `initialize`-era handlers, manual list caches, session recovery,
  sampling, and transport restarts.
- `src/main/mcp/index.ts` flattens tool input schemas into `properties` and `required`. This loses
  arbitrary JSON Schema 2020-12 structure, `$ref`, composition keywords, tool `_meta`, and
  `x-mcp-header` annotations.
- `src/main/mcp/toolManager.ts` preserves `structuredContent` while a call is in flight, but the
  assistant block persistence path stores only the formatted response, image previews, and server
  display metadata.
- `src/main/session/data/tables/deepchatAssistantBlocks.ts` has an extensible `extra_json` column,
  so raw MCP result metadata can be added without a new SQL column.
- `src/shared/contracts/routes/mcp.routes.ts`,
  `src/shared/contracts/events/mcp.events.ts`, the preload bridge, and
  `src/renderer/api/McpClient.ts` already form the typed renderer/main boundary.
- The current HTTP recovery path infers session failure from error strings. Modern MCP has no
  `Mcp-Session-Id`, session lifecycle, or SSE resumability.
- Configured servers are keyed by mutable display name. That is insufficient for persisted Apps,
  Tasks, and credentials because a name can be renamed or re-pointed.
- ACP agents receive MCP configuration through ACP and own those MCP connections. They are outside
  the host-owned runtime migrated here.

## Core Changes DeepChat Must Support

### Stateless Requests

Modern requests are self-contained. The SDK owns per-request protocol version, client information,
capabilities, and extension metadata. DeepChat must not add a second session abstraction around
modern transports.

Remove modern-path dependence on:

- `initialize` / `notifications/initialized`;
- `Mcp-Session-Id`;
- session termination and session-expired string matching;
- `Last-Event-ID` resumability;
- keepalive `ping`;
- root-list change notifications;
- logging level negotiation.

Legacy behavior remains inside the SDK compatibility path, not in parallel DeepChat protocol code.
On modern HTTP, cancellation closes the request's response stream; DeepChat must use the SDK
cancellation API and must not send a legacy cancellation notification. Modern logging is an
explicit per-request option and the client does not opt in automatically. Preserve existing legacy
compatibility without adding a new Logging UI.

`clientInfo` and `serverInfo` are self-reported diagnostics. They may be displayed after redaction,
but they never select a server record, authorize an action, or establish trust.

### Discovery And Change Delivery

Modern capability discovery uses `server/discover`. Change delivery uses
`subscriptions/listen`. DeepChat consumes the SDK's typed discovery and list-change facilities,
invalidates affected views, and lets the SDK own response caching and subscriptions.

The host may retain a renderer presentation cache, but it must be derived from the current SDK
catalog and invalidated by SDK change events. It must not become a second protocol cache.

### Results And Multi-Round Tool Requests

All modern wire results carry `resultType`, but the v2 SDK deliberately consumes that discriminator
before returning public result types. DeepChat must not read a private/raw wire field. The SDK
returns complete values, auto-fulfills `input_required` through registered handlers, and rejects an
unsupported discriminator with a typed SDK error.

Modern tool, prompt, and resource requests can require additional input. Register existing sampling
and new typed elicitation handlers once through the v2 client so the SDK can continue a multi-round
request. Form/URL elicitation uses host-owned UI and explicit consent. A roots request receives a
truthful empty list because DeepChat exposes no client roots. Deprecated legacy Sampling remains
supported for compatibility; DeepChat adds no root configuration or Logging feature.

Treat multi-round `requestState` as opaque untrusted protocol state. Return it through the SDK
without interpretation or mutation; do not log or persist it. Keep the SDK's bounded default of 10
rounds unless a future standard or measured interoperability issue requires a smaller explicit
bound. Cancelling a host interaction cancels the original SDK request rather than starting another
tool call.

Tasks are not implemented as private core behavior. They are handled by the separate
`io.modelcontextprotocol/tasks` extension described in `docs/features/mcp-tasks/`. The current v2
SDK rejects the draft extension's `task` result type and `tasks/*` methods on the modern era, so
Tasks stays disabled until an upstream public extension adapter or dispatch API exists.

### Stable Server Identity

Add a host-owned identity before persisting extension or credential state:

```ts
interface McpServerIdentity {
  serverId: string
  configGeneration: number
  bindingHash: string
}
```

- `serverId` is a locally generated immutable ID assigned on add/import/migration. Display names are
  mutable labels only.
- `configGeneration` increments whenever transport, endpoint, command, arguments, environment,
  protected resource, authorization issuer, or authorization mode changes.
- `bindingHash` is a SHA-256 digest of canonical non-secret identity material: transport kind,
  normalized endpoint or command identity, protected resource, and authorization issuer. It never
  contains credentials, environment values, headers, or tokens.
- A remote binding is finalized after protected-resource and authorization-server discovery. Until
  then, state that requires a resumable remote identity is not created.
- Persisted App, Task, and credential records carry `serverId`, `configGeneration`, and
  `bindingHash`. A mismatch makes an App descriptor inert, pauses a Task, and invalidates a
  credential; it never silently rebinds.

Migration assigns IDs transactionally without changing display names or connection behavior.
Server rename preserves identity. Re-pointing or an identity-bearing auth change increments the
generation and creates a new binding. Imported records never choose an existing server by name.

### Schemas, Metadata, And Headers

Tool input and output schemas are arbitrary JSON Schema 2020-12 documents. DeepChat preserves the
raw schema and metadata alongside any provider-specific projection.

Validate a declared schema dialect and support JSON Schema 2020-12. Do not network-dereference
external `$ref` values by default; reject an unresolved external reference instead of treating it
as permissive. Apply byte, depth, key-count, and composition-expansion limits before projection,
persistence, or renderer delivery.

The model-provider projection may simplify a schema only at the final provider adapter boundary.
The original MCP definition must still be available when calling the tool so the SDK can:

- validate output;
- mirror fields annotated by `x-mcp-header`;
- emit standard `Mcp-Method` and `Mcp-Name` headers;
- preserve tool `_meta`, including MCP Apps metadata.

Structured content, result `_meta`, and the original content array remain available to extension
handlers and durable assistant blocks. The text projection shown to the model remains bounded and
provider-compatible.

### Cache Semantics

Use the v2 SDK response cache. Honor server `ttlMs` and `cacheScope`. Use the SDK's bounded
per-client default unless measurement justifies a different limit.

Do not persist the modern-versus-legacy negotiation verdict in the first implementation. A fresh
connection probes again, avoiding stale host-owned era state after server upgrades. Any later
persistent verdict needs an expiry and an explicit invalidation rule.

### Error Semantics

Code must distinguish:

- protocol failures through `ProtocolError` and `ProtocolErrorCode`;
- SDK failures through `SdkError` and `SdkErrorCode`;
- HTTP failures through `SdkHttpError`;
- cancellation and user rejection;
- unsupported result types, including the current experimental Tasks draft.

An HTTP `401` or `403` enters authorization handling. A `5xx` remains a server failure. None of
those statuses is evidence that a server is legacy.

On modern HTTP, an addressed JSON-RPC error returned with HTTP `400` is a `ProtocolError`; a generic
HTTP failure remains `SdkHttpError`. Modern resource-not-found is `-32602`; accept legacy `-32002`
only through the SDK compatibility path.

Unknown tool calls reject under v2. DeepChat maps that rejection into the existing tool error block
without changing it into a successful response with `isError`.

### Packaged Diagnostics

Manual negotiation evidence must be available in a packaged build rather than inferred from
development logs. Add one read-only typed route:

```text
mcp.getServerDiagnostics { serverId } -> { diagnostics }
```

The main-owned response contains only:

```ts
type McpProbeReasonCode =
  | 'modern-accepted'
  | 'valid-legacy-signal'
  | 'authentication-required'
  | 'http-server-error'
  | 'transport-error'
  | 'timeout'

type McpSubscriptionDiagnostic =
  | 'tools-list-changed'
  | 'prompts-list-changed'
  | 'resources-list-changed'
  | 'resource-updated'

interface McpServerDiagnostics {
  serverId: string
  serverName: string
  owner: 'host'
  transport: 'stdio' | 'streamable-http' | 'sse' | 'in-memory'
  connectionState: 'stopped' | 'starting' | 'running' | 'error'
  era: 'modern' | 'legacy' | 'unknown'
  protocolVersion?: string
  probe?: {
    durationMs?: number
    outcome: 'modern' | 'legacy-fallback' | 'failed' | 'not-run'
    reasonCode?: McpProbeReasonCode
  }
  extensions: string[]
  cacheState: 'active' | 'disabled' | 'unsupported' | 'unknown'
  subscriptions: McpSubscriptionDiagnostic[]
  auth: {
    state:
      | 'unsupported'
      | 'none'
      | 'required'
      | 'authenticating'
      | 'authenticated'
      | 'credentials-invalid'
      | 'error'
      | 'unknown'
    persistent?: boolean
  }
  updatedAt: number
}
```

Probe reason, auth state, and subscription names come from bounded host enums, not server error
text. Extension identifiers have explicit count/length limits. The response excludes endpoints,
commands, environment variables, headers, tokens, authorization codes, secrets, raw server errors,
and protocol payloads.

The route serves only host-owned configured servers. ACP keeps its separate status/diagnostics
surface and marks its MCP connections `agent-owned`; this route does not assign them a host
`serverId` or probe them.

Expose the route from a server-card Diagnostics panel. Opening the panel or pressing Refresh reads a
new main-process snapshot; existing server status events invalidate the renderer query. Copying
diagnostics copies the same redacted object.

```text
+--------------------------------------------------+
| MCP Diagnostics                         [Refresh] |
| Server       Local tools                         |
| Owner        host                                |
| Transport    stdio                               |
| Era          modern · 2026-07-28                 |
| Probe        modern · 34 ms                      |
| Extensions   io.modelcontextprotocol/ui          |
| Cache        active                              |
| Subscriptions tools/list_changed                 |
| Auth         authenticated · persistent          |
|                                                  |
|                            [Copy redacted JSON]   |
+--------------------------------------------------+
```

App CSP and browser network denial evidence does not belong in this MCP diagnostics object. The App
details surface shows declared origins; packaged malicious fixtures prove blocked requests.

## Compatibility Matrix

| Connection owner | Transport | Wire mode | Required behavior |
| --- | --- | --- | --- |
| DeepChat host | External Streamable HTTP | `auto` | Probe modern, fall back only on a valid legacy signal |
| DeepChat host | External stdio | `auto` | Probe using the SDK disposable sibling process, then connect |
| DeepChat host | Existing HTTP+SSE config | legacy | Keep edit/runtime compatibility; do not offer SSE for new configs |
| DeepChat host | Built-in/in-memory pair | legacy | Create both transport halves from the same v2 package |
| ACP agent | Agent-declared transport | agent-owned | Do not migrate, probe, wrap, or reinterpret |

The modern probe timeout must be below DeepChat's existing 45-second soft startup timeout. Start at
8 seconds and change it only from measured evidence. A failed disposable stdio probe must not leave
a child process running.

## Package Boundary

DeepChat-owned core code imports only the v2 split packages. No project-owned file under
`src/main/mcp` or shared core MCP types may import the monolithic v1 SDK after the codemod.

`@modelcontextprotocol/ext-apps@1.7.5` currently requires the v1 SDK as a peer. Keep
`@modelcontextprotocol/sdk@1.30.0` installed only for that dependency boundary. The Apps host uses
`AppBridge(null, ...)` and sends plain validated JSON through DeepChat routes; it never gives a v2
client instance to a v1 protocol object.

Add an import restriction so future core code cannot accidentally restore v1 imports. Remove the
compatibility package when the Apps SDK supports v2.

## Ownership

```text
McpServerManager
  owns lifecycle and one host client per configured server
        |
        v
McpClient (v2 SDK boundary)
  owns negotiation, transport, discovery, cache, subscriptions, auth hooks
        |
        v
McpService / ToolManager
  owns catalog projection, execution context, result normalization
        |
        +--> session persistence: durable result/task/app descriptors
        |
        +--> typed routes/events: renderer presentation and user interaction
```

Extension implementations may consume the raw protocol definition and result, but they do not own
transport negotiation or create parallel clients.

## Goals

- Run the host-owned MCP client on the official v2 split SDK packages.
- Preserve legacy server compatibility while supporting the modern stateless wire.
- Use the official codemod and retain a reviewable migration boundary.
- Preserve complete MCP schemas, metadata, content, and structured results.
- Replace manual protocol caches and session recovery with v2 SDK behavior.
- Keep current tools, prompts, resources, sampling, OAuth, built-in servers, and plugin-owned
  catalog behavior working during the transition.
- Expose negotiated era, protocol version, and extension capabilities as diagnostics.
- Give every configured server an immutable local identity and invalidate persisted extension state
  when its connection binding changes.
- Deprecate HTTP+SSE without breaking existing configurations.

## Non-Goals

- No DeepChat MCP server product or public server SDK.
- No custom protocol negotiation implementation.
- No migration of ACP-agent-owned MCP connections.
- No new Roots or Logging implementation for deprecated features.
- No new telemetry pipeline. If trace context is supported later, `baggage` remains untrusted and
  is never persisted or written to routine logs.
- No permanent compatibility wrapper around both SDK APIs.
- No silent conversion of arbitrary MCP schemas into a reduced internal schema.
- No removal of legacy wire support while supported user servers still require it.

## Cross-Goal Dependencies

The ecosystem rollout is split into independently verifiable goals:

1. This architecture migrates the core and enables dual-era transport.
2. `docs/architecture/remove-mcp-permission-system/` establishes one permission owner.
3. `docs/features/mcp-apps/` adds sandboxed interactive UI.
4. `docs/features/mcp-tasks/` adds durable asynchronous work.
5. `docs/features/mcp-authorization-extensions/` adds hardened interactive, machine, and
   enterprise authorization.

Upstream readiness is not uniform:

| Surface | Upstream status on 2026-07-29 | DeepChat gate |
| --- | --- | --- |
| MCP 2026-07-28 core + TypeScript SDK v2 | Stable | Codemod, legacy parity, then `auto` negotiation |
| MCP Apps 2026-01-26 | Stable; host implementation remains DeepChat-owned | Double-iframe security and full lifecycle |
| Enterprise-Managed Authorization | Stable | Enterprise OIDC profile and metadata discovery |
| OAuth Client Credentials | Draft in ext-auth; public v2 providers exist | Explicit user-selected draft profile |
| MCP Tasks | Experimental; no package; v2 SDK currently blocks modern task dispatch | No advertisement until an upstream public adapter exists |

Core parity is required before Apps, Tasks, or new Auth providers are enabled. The permission
system removal is required before Apps may invoke a tool, so Apps cannot resurrect a second MCP
approval layer.

## Acceptance Criteria

- The official codemod runs from the repository root, leaves no unresolved
  `@mcp-codemod-error` marker, and is followed by manual review.
- No DeepChat-owned MCP core module imports the v1 SDK.
- Existing legacy stdio, Streamable HTTP, SSE, and in-memory fixtures retain their current
  observable behavior.
- Existing servers receive immutable local IDs without losing configuration; renames preserve the
  ID, while re-pointing invalidates the prior binding.
- Modern stdio and HTTP fixtures connect without initialize/session assumptions.
- External dual-era fixtures negotiate modern first and fall back only on a valid legacy response.
- Authentication errors and server errors do not trigger legacy fallback.
- A failed stdio probe leaves no sibling process.
- JSON Schema 2020-12 features and tool/result metadata survive discovery, provider projection,
  call execution, and persistence.
- Declared dialects are validated, unresolved external references fail closed, and schema
  composition remains within explicit limits.
- `ttlMs`, `cacheScope`, discovery changes, and subscriptions update the rendered catalog without a
  manual protocol cache.
- Multi-round input requests complete or cancel without issuing a duplicate tool call.
- Opaque multi-round request state is neither interpreted, persisted, nor logged.
- The packaged Diagnostics panel identifies `modern` or `legacy` for host-owned servers, negotiated
  extensions, probe outcome, cache/subscription state, and redacted auth state through a typed
  route; ACP's separate diagnostics identify agent-owned connections.
- Existing SSE configurations run and can be edited, while new server creation directs users to
  Streamable HTTP.
- Format, i18n validation, lint, typecheck, focused MCP tests, and packaged Electron smokes pass.
