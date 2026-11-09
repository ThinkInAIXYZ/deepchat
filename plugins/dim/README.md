# DeepChat's dim plugins

The pinned Rust host runs these plugins through rutis. Desktop calls their protected-local
management methods; the plugin calls dim services directly. ACP is not part of this connection.
The existing application backend has not switched to dim yet.

Install the host, standalone Node and plugin runtime from the repository root:

```sh
pnpm run installRuntime:dim
```

The installer verifies the six-platform release lock in `resources/dim-runtime-lock.json`, rejects
unsafe archive entries, retains release notices, and installs the pinned rutis dependency tree
with `resources/dim-plugin-runtime/pnpm-lock.yaml`. Native hosts use versioned directories under
`runtime/dim/releases/`. Plugin runtime packages and modules live under `runtime/dim/plugins/`,
outside app.asar. Install/update while the host is stopped; the binary is immutable, while plugin
installation refreshes its Node dependencies and sources. Re-running installation verifies the
existing binary against the release before reuse.

`--js-runtime` takes the rutis-runtime **package directory**, not its runner script. The runtime
installer records that location; it also includes esbuild's six platform packages so packaging
for another supported architecture does not retain only the build machine's executable.

## Current modules

- `deepchat-host` exposes `deepchat.host.capabilities`, `launch`, `input`, `lookup`, `stop`, `idle`
  `withdraw` and `delete`. These delegate to dim's `sessions` service. Inputs keep their submission ID;
  a disconnected caller must query the outcome rather than blindly send again.
- Branch part `DeepChatDesktopEvents` provides bounded live subscriptions; slow readers catch up from the last committed cursor. Session parts in `deepchat-storage` expose raw timeline query pages and branch identities.
- `deepchat-storage` exposes `deepchat.storage.capabilities` and bounded `history` reads. Its
  explicit `limit` is 1–200, and the request includes dim's session/branch identity and cursors.
  It uses dim's storage-backed service, never private SQLite tables. This trusted content interface
  is not an Inspector DTO and must not be forwarded wholesale to a renderer.

Product capabilities use `DimProductGateway`, a private desktop socket/pipe passed to the host
plugin. Session parts register their schemas and handlers in dim's `toolRegistry`; dim owns tool
selection, permissions, scheduling, results and cancellation. The gateway resolves the durable
native identity and current product authorization on every call, checks the catalog version, and
never retries an effect. Catalog refresh withdraws a scoped service so rutis unloads the previous
tool part before mounting the new definitions. Connection loss aborts pending product work.
Native tools, MCP, Skills, agent loops and model requests must not be routed through this gateway.
Code Mode is temporarily disabled during migration; the previous Code Mode, ToolSearch and
programmatic dispatch are not ported. Equivalent DeepChat built-in tools are removed in favor of
dim's own tools.

`DimSessionRuntime` persists the app/native binding and input intent before sending. Its event
reader applies desktop messages and its cursor in one SQL transaction, without a new Tape. Its
optional preparation callback mounts product configuration/tools before accepting new input.
The main application has not switched to this backend. Queue UI, product service wiring and
old-session migration remain tracked in the migration plan.

## Native integration check

After installation, run `pnpm run smoke:dim`. It uses the managed standalone Node and real dim
release, verifies both injected plugins, completes a deterministic mock-model turn through the
host plugin, checks history and submission lookup through dim, restarts the host and compares
committed history. Other checks verify real SQLite admission and restart, atomic projection recovery, live subscriptions, and actual product tool execution/catalog replacement/cancellation/restart. Another check boots the product profile and verifies plugin readiness without
logging into an account; it does not make a real provider request. Profiles are temporary.

The transport and installer regression suites run with the ordinary Main tests. Native smoke is
explicit so ordinary tests neither download runtimes nor require an installed Rust executable.

## Native model calls

The host plugin's `model-calls.mjs` is a separate process row in product profiles. It calls dim's
`auxiliaryModel` service for standalone completions and only native provider management methods
for configuration. The pinned release exposes provider editing as management methods rather
than a cross-language editing service, so this row uses the private local host endpoint for the
fixed `provider.management` / `provider.create` operations. It exposes no arbitrary RPC relay.

`DimModelBridge` configures immutable native connection/model identities, then uses them in agent
launches and auxiliary requests. Credentials go through the native provider's configuration
boundary, never plugin row configuration or timeline content. These identities do not alter
native OAuth accounts. Retained native provider records and credentials follow dim's store
lifecycle; wiring desktop credential policy and all provider settings remains part of integration.
Each auxiliary call owns a separate local connection. Abort closes that connection; the plugin
combines the connection's close signal with its own lifetime and asks the Rust owner to cancel
and join that invocation. Accepted agent input is governed by its durable submission receipt.

## Session controls and queue projection

`deepchat.session.*` exposes a fixed set of native commands for queue reads, atomic
withdraw-with-steer, permissions, model/context, questions/approvals and fork. These are explicit
operations rather than an arbitrary method relay. Native owner validation is preserved. The
release's v3 commands accept JSON safe-integer cursors; the plugin validates decimal desktop
cursors before conversion. Content history continues to use the lossless u64 service boundary.

A queued input is cached for projection after `input/message`, and becomes a desktop message
only after dim publishes `input/applied`. This cache neither releases input nor decides its order;
`input/consumed`/`input/deleted` remove it. Messages use native session/branch identities so forked
history never overwrites another conversation when native event IDs are shared. Tool blocks also
retain the native request identity, because a model may reuse a call ID in another request.
