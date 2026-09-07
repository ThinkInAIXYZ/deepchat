# MCP v2 Dual-Era Protocol Architecture

Status: implemented and repository-validated; external manual interoperability verification
remains pending.

## Decision

DeepChat runs its host-owned MCP runtime on the MCP TypeScript SDK v2 and supports both the
MCP 2026-07-28 stateless wire and the legacy wire. External `stdio` and Streamable HTTP servers use
SDK negotiation with modern-first probing and legacy fallback. DeepChat-owned in-memory servers
remain explicitly legacy-wire because the v2 SDK does not provide a modern in-memory serving
transport.

Legacy compatibility must preserve the same transport, auth, schema, cache, result, and error
semantics as modern negotiation.

## Standard Baseline

The implementation targets:

- MCP core specification `2026-07-28`;
- `@modelcontextprotocol/client@2.0.0`;
- `@modelcontextprotocol/server@2.0.0`;
- `@modelcontextprotocol/core@2.0.0`, provided transitively by the split client/server packages;
- Zod `>=4.2`, already satisfied by DeepChat;
- `@modelcontextprotocol/sdk@1.30.0`, required as a peer by the MCP Apps SDK and isolated to the
  Apps boundary.

Versions remain pinned. A dependency refresh requires a separate compatibility review.

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

## Implemented State

- `src/main/mcp/mcpClient.ts` uses the v2 split client package. External stdio and Streamable HTTP
  use SDK `auto` negotiation; SSE and DeepChat in-memory pairs use explicit legacy mode.
- DeepChat-owned main MCP code is guarded from importing the monolithic v1 SDK.
- Tool input/output schemas, annotations, icons, `_meta`, arbitrary JSON `structuredContent`, and
  raw bounded results survive discovery, execution, and assistant-block persistence.
- SDK response caching, discovery, list-change subscriptions, multi-round input, cancellation,
  sampling, elicitation, and truthful empty roots replace host-owned modern session/cache logic.
- Every configured server receives an immutable `serverId`, `configGeneration`, and non-secret
  `bindingHash`. Persisted Apps and credentials require an exact binding.
- Typed diagnostics expose redacted negotiation, implementation, extension, cache, subscription,
  ownership, and authorization state.
- ACP agents continue to own their declared MCP connections and remain outside this runtime.
- The upstream Tasks gate is blocked; DeepChat advertises no Tasks extension and contains no
  private transport bypass.

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
- A remote binding is finalized after protected-resource and authorization-server discovery.
  Pending OAuth state may exist under the provisional binding only for the active flow; it is
  atomically moved to the finalized host configuration before it becomes reusable.
- Persisted App descriptors and credentials carry `serverId`, `configGeneration`, and
  `bindingHash`. A mismatch makes an App descriptor inert and invalidates a credential; it never
  silently rebinds.

Migration assigns IDs transactionally without changing display names or connection behavior.
Server rename preserves identity. Re-pointing or an identity-bearing auth change increments the
generation and creates a new binding. Imported records never choose an existing server by name.

Model tool authorization also carries the resolved final name, original MCP name, server ID,
generation, and binding hash through dispatch. Main rechecks that immutable target and the active
client after every awaited preparation step; a collision or reconfiguration cancels the call
instead of executing whichever target currently owns the model-visible name.

### Schemas, Metadata, And Headers

Modern tool input and output schemas are arbitrary JSON Schema 2020-12 documents. DeepChat
preserves the raw schema and metadata alongside any provider-specific projection.

Validate a declared schema dialect and support JSON Schema 2020-12 for modern connections and
DeepChat-owned packaged catalogs. Do not network-dereference external `$ref` values. Modern and
packaged definitions reject unresolved external references instead of treating them as permissive.

User-configured external legacy connections preserve schema documents as opaque bounded JSON and
must not acquire modern-only dialect, remote-reference, or composition-shape rejection after the
legacy SDK accepts the response. This compatibility does not permit network dereferencing or relax
the structural and size boundaries on an individual schema or metadata value.

Apply byte, depth, key-count, node-count, and composition-expansion limits before projection,
persistence, or renderer delivery. Collection envelopes also have a total byte limit, but member
key and node counts do not accumulate into one fixed catalog-wide quota; validate those limits on
each independently consumed member.

The model-provider projection may simplify a schema only at the final provider adapter boundary.
For modern connections and DeepChat-owned catalogs, the original MCP definition must still be
available when calling the tool so the SDK can:

- validate output;
- mirror fields annotated by `x-mcp-header`;
- emit standard `Mcp-Method` and `Mcp-Name` headers;
- preserve tool `_meta`, including MCP Apps metadata.

For user-configured external legacy connections, retain the original schema in DeepChat's tool
record but do not opt the call into v2-only output-schema compilation that the v1 client did not
perform. This exception does not relax DeepChat's bounded result validation.

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
  owner: 'deepchat' | 'plugin'
  transport: 'stdio' | 'http' | 'sse' | 'inmemory'
  connectionState: 'stopped' | 'starting' | 'running' | 'error'
  era: 'modern' | 'legacy' | 'unknown'
  protocolVersion?: string
  serverImplementation?: { name: string; version: string }
  probe: {
    outcome: 'modern' | 'legacy-fallback' | 'failed' | 'not-run'
    reasonCode?: McpProbeReasonCode
  }
  extensions: string[]
  clientExtensions: Array<{ id: string; revision?: string }>
  cacheState: 'active' | 'unknown'
  subscriptions: Array<McpSubscriptionDiagnostic | 'modern-listen'>
  auth: {
    state:
      | 'unsupported'
      | 'none'
      | 'required'
      | 'authenticating'
      | 'authenticated'
      | 'error'
    persistent?: boolean
    mode?: McpAuthorizationMode
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
| Owner        deepchat                            |
| Transport    stdio                               |
| Era          modern · 2026-07-28                 |
| Probe        modern                              |
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
| DeepChat host | HTTP+SSE | legacy | Keep selectable for existing and new configs with a compatibility warning |
| DeepChat host | Built-in/in-memory pair | legacy | Create both transport halves from the same v2 package |
| ACP agent | Agent-declared transport | agent-owned | Do not migrate, probe, wrap, or reinterpret |

The HTTP modern probe uses a 20-second timeout with one retry so a transiently slow remote router can
recover while repeated timeouts still fail within DeepChat's existing 45-second soft startup
budget. Stdio keeps its eight-second probe without a retry. A failed disposable stdio probe must not
leave a child process running.

## Package Boundary

DeepChat-owned core code imports only the v2 split packages. No project-owned file under
`src/main/mcp` or shared core MCP types may import the monolithic v1 SDK.

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
        +--> session persistence: durable result/app descriptors
        |
        +--> typed routes/events: renderer presentation and user interaction
```

Extension implementations may consume the raw protocol definition and result, but they do not own
transport negotiation or create parallel clients.

## Goals

- Run the host-owned MCP client on the official v2 split SDK packages.
- Preserve legacy server compatibility while supporting the modern stateless wire.
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
4. `docs/features/mcp-tasks/` records the blocked upstream Tasks gate.
5. `docs/features/mcp-authorization-extensions/` adds hardened interactive, machine, and
   enterprise authorization.

Upstream readiness is not uniform:

| Surface | Upstream status on 2026-07-29 | DeepChat gate |
| --- | --- | --- |
| MCP 2026-07-28 core + TypeScript SDK v2 | Stable | Legacy parity and modern-first `auto` negotiation |
| MCP Apps 2026-01-26 | Stable; host implementation remains DeepChat-owned | Double-iframe security and full lifecycle |
| Enterprise-Managed Authorization | Stable | Enterprise OIDC profile and metadata discovery |
| OAuth Client Credentials | Draft in ext-auth; public v2 providers exist | Explicit user-selected draft profile |
| MCP Tasks | Experimental; no package; v2 SDK currently blocks modern task dispatch | No advertisement until an upstream public adapter exists |

Core parity and permission-system removal are complete. Apps use the shared permission broker and
cannot resurrect a second MCP approval layer. Tasks remain unadvertised until their separate
upstream gate opens.

## Acceptance Criteria

- No DeepChat-owned MCP core module imports the v1 SDK.
- Existing legacy stdio, Streamable HTTP, SSE, and in-memory fixtures retain their current
  observable behavior, including schemas previously accepted by the legacy SDK subject to
  per-value host bounds.
- External legacy tool calls do not acquire v2-only output-schema compilation before dispatch.
- Existing servers receive immutable local IDs without losing configuration; renames preserve the
  ID, while re-pointing invalidates the prior binding.
- Modern stdio and HTTP fixtures connect without initialize/session assumptions.
- External dual-era fixtures negotiate modern first and fall back only on a valid legacy response.
- Authentication errors and server errors do not trigger legacy fallback.
- A failed stdio probe leaves no sibling process.
- JSON Schema 2020-12 features and tool/result metadata survive discovery, provider projection,
  call execution, and persistence.
- Modern and packaged schemas validate declared dialects, fail closed on unresolved external
  references, and keep schema composition within explicit limits. External legacy references stay
  opaque and are never network-dereferenced.
- `ttlMs`, `cacheScope`, discovery changes, and subscriptions update the rendered catalog without a
  manual protocol cache.
- Multi-round input requests complete or cancel without issuing a duplicate tool call.
- Opaque multi-round request state is neither interpreted, persisted, nor logged.
- The packaged Diagnostics panel identifies `modern` or `legacy` for host-owned servers, negotiated
  extensions, probe outcome, cache/subscription state, and redacted auth state through a typed
  route; ACP's separate diagnostics identify agent-owned connections.
- SSE remains selectable for existing and new configurations with a compatibility badge and a
  recommendation to use Streamable HTTP.
- Format, i18n validation, lint, typecheck, focused MCP tests, and packaged Electron smokes pass.
