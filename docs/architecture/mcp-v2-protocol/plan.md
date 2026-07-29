# MCP v2 Dual-Era Protocol Migration Plan

## Delivery Rule

Each phase ends with a green, reviewable checkpoint. Do not enable modern negotiation in the same
checkpoint that performs the codemod. The first checkpoint must run the v2 SDK in its default
legacy-wire mode and prove parity.

## Phase 0: Freeze The Baseline

1. Record the current package versions, MCP fixtures, and focused test commands.
2. Add fixture coverage for:
   - legacy stdio;
   - legacy Streamable HTTP;
   - existing SSE compatibility;
   - DeepChat in-memory transport;
   - OAuth-required HTTP;
   - sampling;
   - prompts/resources/tools and list-change notifications;
   - structured content and image previews.
3. Record current startup timeout and child-process cleanup behavior.
4. Confirm the worktree contains no unrelated changes before applying a repository-wide codemod.

The baseline tests assert observable behavior, not internal v1 call sequences.

## Phase 1: Run The Official Codemod

From the package root, use the pinned official codemod through pnpm:

```bash
pnpm dlx @modelcontextprotocol/codemod@2.0.0 v1-to-v2 .
```

Then:

1. inspect the entire diff;
2. search for unresolved diagnostics:

   ```bash
   rg -n "@mcp-codemod-error|@modelcontextprotocol/sdk" src test
   ```

3. install the pinned split packages;
4. retain `@modelcontextprotocol/sdk@1.30.0` only as the
   `@modelcontextprotocol/ext-apps@1.7.5` peer dependency;
5. add an import restriction for project-owned core MCP code;
6. resolve renamed errors, schemas, transports, and typed handler changes manually;
7. run format and typecheck before changing behavior.

The codemod must not be run against `src` alone. It needs package, source, and test context.

## Phase 2: Restore Legacy-Wire Parity On v2

Keep the v2 `Client` default wire behavior. Do not set `versionNegotiation: { mode: 'auto' }` yet.

### Client And Transport

- Replace monolithic imports with `@modelcontextprotocol/client` and public
  `@modelcontextprotocol/core` exports.
- Recreate stdio, Streamable HTTP, SSE compatibility, and in-memory connections from v2 public
  APIs.
- Ensure an in-memory transport pair comes from one package instance.
- Preserve DeepChat lifecycle statuses and the 45-second soft / 5-minute hard startup envelope.
- Apply the SDK stdio buffer limit and handle overflow as a normal server failure.

### Handlers

- Port sampling and register it through the v2 client.
- Add a typed form/URL elicitation interaction through the existing renderer/main interaction
  boundary.
- Return an empty root list without adding root configuration.
- Let the SDK drive multi-round retries and enforce its bounded round count.
- Round-trip opaque `requestState` only through the SDK and keep it out of persistence and logs.
- Preserve legacy sampling approval and provider selection behavior.
- Do not add root configuration or Logging handlers.
- Map v2 typed errors into existing server and tool error states.
- Use SDK cancellation so modern HTTP closes the response stream without a legacy cancellation
  notification.

### Regression Gate

All baseline fixtures must pass before the next phase. Production behavior remains legacy wire.

## Phase 3: Establish Stable Server Identity

Add `serverId`, `configGeneration`, and `bindingHash` to the normalized server registry before
Apps, Tasks, or authorization credentials use durable server-bound state.

Migration:

1. assign a random immutable `serverId` to every existing/add/imported server;
2. initialize `configGeneration` to `1`;
3. compute `bindingHash` from canonical non-secret transport identity and discovered
   protected-resource/issuer identity;
4. increment the generation on any identity-bearing configuration change;
5. preserve the ID across rename;
6. reject name-based import matching;
7. expose only the display name and redacted binding status to the renderer.

Discovery may finalize a remote binding after connection/auth metadata is known. Do not create a
resumable App, Task, or credential record until the binding is finalized. Add migration and
re-pointing fixtures before continuing.

## Phase 4: Preserve Full Protocol Data

### Tool Definition

Introduce a lossless internal MCP definition:

```ts
interface McpRawToolDefinition {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
  _meta?: Record<string, unknown>
}
```

The existing provider-facing `MCPToolDefinition` remains a projection. Attach the raw definition by
stable server/tool identity instead of embedding an unbounded duplicate in every provider request.

When executing, pass the raw tool definition to the v2 SDK call so header mirroring and output
validation remain available.

### Tool Result

Normalize a bounded durable result descriptor into assistant block `extra_json`:

```ts
interface PersistedMcpToolResult {
  version: 1
  serverId: string
  serverGeneration: number
  bindingHash: string
  serverName: string
  toolName: string
  content?: unknown
  structuredContent?: unknown
  meta?: Record<string, unknown>
  app?: McpAppDescriptor
  task?: McpTaskDescriptor
}
```

Binary payloads remain in existing attachment/image storage paths. Apply size limits before
persistence and record truncation explicitly. Never persist executable Apps HTML in a message.

### Projection Boundary

Provider adapters may reduce unsupported JSON Schema features for a particular model API. The
projection must:

- be deterministic;
- retain a reference to the raw definition;
- report unsupported reduction in diagnostics;
- never mutate the raw schema.

Renderer route contracts validate their outer structure with real bounded schemas rather than
`z.custom`. Arbitrary JSON Schema/result fields receive explicit byte, depth, key-count, and value
validation in main before persistence or renderer delivery.

Schema validation additionally:

- accepts JSON Schema 2020-12 and validates any declared dialect;
- rejects unresolved external `$ref` values without network access;
- bounds composition expansion;
- keeps the raw schema immutable.

## Phase 5: Adopt v2 Discovery, Cache, And Subscriptions

1. Replace manual list caches in `McpClient` with the v2 response cache.
2. Honor `ttlMs` and `cacheScope`.
3. Configure SDK list-change behavior for tools, prompts, and resources.
4. Handle modern `subscriptions/listen` through the SDK.
5. Keep one small presentation snapshot per server for renderer delivery.
6. Remove session-expiry string matching and legacy HTTP session recovery code made redundant by
   the SDK.
7. Add tests for expiration, per-client scope, change invalidation, reconnect, and cancellation.

Do not persist protocol cache entries or negotiation verdicts.

## Phase 6: Enable Dual-Era Negotiation

Enable:

```ts
versionNegotiation: {
  mode: 'auto',
  probe: {
    timeoutMs: 8_000,
    maxRetries: 0
  }
}
```

for external stdio and Streamable HTTP clients only.

Keep:

- in-memory clients explicitly legacy;
- existing SSE configurations on the legacy compatibility path;
- ACP connections untouched.

Add diagnostics for:

- connection owner;
- transport;
- negotiated era and protocol version;
- probe duration and fallback reason;
- declared extensions;
- cache/subscription state;
- auth state without secrets.

Add a typed `mcp.getServerDiagnostics` route backed by a bounded main-process snapshot and a
server-card details panel with Refresh and Copy redacted JSON actions. Reuse existing server status
events to invalidate the renderer query; do not add a protocol trace stream or persist diagnostics.
Define the schema in `src/shared/contracts/routes/mcp.routes.ts`, handle it in
`src/main/mcp/routes.ts`, expose it through the existing preload route registry and
`src/renderer/api/McpClient.ts`, and keep the renderer query scoped by immutable `serverId`.

Do not expose raw headers, tokens, authorization codes, client secrets, or untrusted server error
bodies in renderer diagnostics.

## Phase 7: Deprecate SSE Creation

1. Keep existing SSE configurations readable, editable, exportable, and runnable.
2. Remove SSE from the default new-server transport choices.
3. For imported SSE configurations, retain compatibility and show a localized migration hint.
4. Do not auto-rewrite an SSE URL into Streamable HTTP; endpoint semantics cannot be inferred
   safely.
5. Add telemetry-free local diagnostics so users can identify legacy transports.

## Phase 8: Extension Enablement

After core parity and dual-era tests pass:

1. land the single permission-owner architecture;
2. enable MCP Apps;
3. enable MCP Tasks only after the v2 SDK or an official extension package exposes a public modern
   dispatch adapter for its result and methods;
4. enable new authorization providers.

Each extension must advertise support only after its full request/result lifecycle is implemented.
Unknown extensions remain preserved in metadata and otherwise ignored.

## Test Strategy

### Unit

- schema preservation and provider projection;
- result normalization and size limits;
- v2 error mapping;
- stable server identity migration, rename, re-pointing, and binding invalidation;
- diagnostics redaction;
- transport selection;
- extension metadata preservation.

### Contract

- modern and legacy request traces;
- correct fallback classification;
- no fallback on `401`, `403`, or `5xx`;
- response cache TTL/scope;
- list-change subscriptions;
- multi-round input and cancellation;
- opaque `requestState` round-trip and SDK round bound;
- modern HTTP cancellation by response-stream close;
- addressed HTTP `400` protocol errors versus generic HTTP failures;
- modern `-32602` and legacy-compatible `-32002` resource-not-found mapping;
- unknown tool rejection.

### Integration

- stdio disposable probe cleanup;
- HTTP modern connection;
- OAuth challenge and reconnect;
- SSE legacy compatibility;
- built-in in-memory client/server;
- persisted result reload.

### Manual And Packaged Smoke

Follow `manual-verification.md`. Pinned local official examples are the controlled gate; public
servers are same-day interoperability smokes and are never called from CI.

At minimum, complete:

- modern and legacy stdio and Streamable HTTP;
- actual legacy HTTP+SSE;
- raw schema and structured result persistence;
- MRTR, cache, subscriptions, progress, and cancellation;
- interactive OAuth and client credentials;
- stable identity rename/re-pointing;
- app restart and server shutdown with no orphan child process.

MCP Apps, Tasks, and authorization extensions add their feature-specific cases from the same
runbook.

Run:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm test -- <focused MCP suites>
```

Use the repository's actual focused Vitest commands at implementation time; do not add a broad
test runner wrapper.

## Rollback

Before modern negotiation is enabled, rollback is a normal source revert because v2 runs the
legacy wire. After enablement, retain a temporary internal force-legacy diagnostic toggle for one
release cycle. It is not a user-facing permanent setting and must be removed after the compatibility
window.

Database additions are additive inside assistant block `extra_json`; old clients ignore them.
Rollback must not require destructive data migration.
