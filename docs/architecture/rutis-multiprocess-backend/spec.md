# DeepChat Everywhere Runtime

## Status and decision

Status: G0-G4 complete; cohesive Core backend extraction in progress (G5).
Evidence date: 2026-10-31. Published baseline: `356143755` (admission code `ffcd98770`).
Implementation reference: Rutis `v0.16.0`, released on 2026-10-24. Crates and npm packages are pinned
to that version.

Make DeepChat usable through multiple clients, runnable without a desktop window, and able to use
capabilities on explicitly enrolled devices. Separate client presentation, Session authority, and
device execution. Use Rutis to manage runtime dependencies, generations, and approved links between
execution nodes. The first production milestone is a multiprocess desktop backend.

Keep Agent execution, Provider calls, Session state, Memory coordination, and Tape transactions
together in one TypeScript backend process initially. Create additional runtimes only for a concrete
isolation, resource-locality, or replacement requirement. The application core must accept host
ports instead of requiring Electron, even while the desktop distribution uses Electron's Node mode.

The objectives are responsive desktop interaction under backend load, independently recoverable
backend processes, replaceable feature implementations, and access to one authoritative Session
Host from multiple surfaces. Additional processes and plugin counts are not success criteria.
No responsiveness or memory improvement is established; cross-device operation remains unimplemented.

Prefer existing capabilities and dependencies. Composition files and factories are internal
organization, not separate plugins or processes. Split only at a useful ownership or runtime
boundary and preserve behavior while reducing coupling. Keep durable tests focused on behavior,
ownership and recovery; use disposable checks for implementation scaffolding. Update developer
setup and entry-point documentation when their contracts change, preserving sponsor content.

Implementation proceeds through
[Draft PR #2465](https://github.com/ThinkInAIXYZ/deepchat/pull/2465). The admission migration is
committed as `ffcd98770` (`feat(harness): route admission through rutis`) and its roadmap as
`f35adff34`. Remaining modules follow the dependencies and acceptance gates in [the live plan](plan.md).
Each validated goal is committed and pushed separately before the next selected goal starts.

Each module migration replaces its real application wiring on the migration branch. Completion
requires running the same end-to-end workload against the baseline and migrated application,
checking lifecycle/failure behavior, and deleting the superseded wiring. A standalone plugin check
is supporting evidence, not a completed module migration. There is no retained local fallback or
parallel production/development owner.

## Admission module migration

The first module is Agent invocation admission: capacity, per-owner fairness, pending bounds,
cancellation, permits, and diagnostics. Keep the tested TS implementation as the Rutis plugin's
single owner. The application retains a typed client and caller-owned lease state; it no longer
constructs an in-process admission queue.

```text
LiveDelegationService / existing admission port
                 |
Electron main: typed admission client + lease state
                 | bounded private stdin/stdout frames
Rust/Rutis host: declared service dependency, cancellation, lifetime
                 | upstream Rutis local runtime transport
Electron Node-mode runtime: first-party admission TS plugin
                 |
One admission queue and permit owner
```

The client preserves synchronous lease suspend/release and asynchronous resume. Commands carry a connection-wide sequence. The TS dispatcher starts operations in caller order
even when concurrent Rutis RPCs arrive out of order; it does not await a queued acquire before
starting a later release. Cancellation during acquire uses an acquisition identity chosen before the call and sends an
ordered release. The RPC remains tracked until it settles; the remote record aborts queued work
or releases a grant even if cancellation races the reply. Repeated release is idempotent. Per-owner limits,
correlation validation, queue bounds, monotonic measurements and bounded diagnostics remain the
existing owner's behavior. Log observers cannot change admission outcomes.

The admission gateway exposes its method allowlist over inherited pipes. Its frames are limited to 64 KiB, buffered application writes to 1 MiB, and concurrent calls to 1024.
Diagnostics carry a separate sequence and use bounded forwarding/reordering; malformed observer
payloads and observer failures cannot change admission accounting. There is no public listener or renderer access to the
host protocol. Child generation loss rejects pending requests and closes admission; the application
does not start another owner or retry unknown operations. Graceful shutdown stops delegation,
closes admission, flushes diagnostics and then shuts down the host/runtime with bounded deadlines.

Build the host, compiled plugin and unmodified Rutis runtime closure as application artifacts.
Application startup uses these artifacts both locally and when packaged, with the packaged Electron
executable in Node mode. Missing artifacts fail startup with an actionable build error. `pnpm harness:build` builds the
locked host and compiled plugin; normal dev, test and application builds call it. The repository
pins Rust 1.95.0 through Rustup. `beforePack` rebuilds the native artifact for the selected target,
and `extraResources` installs the closure under `app.asar.unpacked/harness`. Runtime startup has a
15-second deadline, non-acquire RPCs 10 seconds, host root shutdown 10 seconds, and client force
termination 12 seconds. Queue waits remain caller-cancellable without a new task-duration limit. Runtime
packages are release dependencies through the copied closure, not a boot-time download.

### Rust owner sequence

| Owner                                                  | Current migration direction                                   | Acceptance boundary                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Runtime dependencies and child lifetimes               | Rust/Rutis                                                    | Actual app startup, bounded shutdown and fail-closed disconnect                                         |
| Invocation admission                                   | TS Rutis plugin with a typed application client               | Existing fairness/leases/diagnostics plus end-to-end delegation parity; remove local queue construction |
| Run control, cancellation and pending-input settlement | Extract explicit ports, then migrate as a cohesive Rust owner | Preserve all four fences, synchronous queue feedback, ordering and durable dispositions                 |
| Provider, MCP, Skills and product hooks                | TS plugins where independent resource lifetimes exist         | Retain adapters and use operation-level calls, avoiding token-level RPC                                 |
| Tape, persistence and recovery                         | Dedicated migration after Harness ports                       | Preserve schema, encryption, same-connection transactions, recovery and one mutation authority          |
| UI, OAuth and native capability presentation           | Desktop host adapters                                         | Narrow async ports without Electron-main imports in the Harness                                         |

Every later module follows the same branch workflow: select owner, replace implementation and
callers, run the real application comparison, then remove the old path. Everywhere remains a
product destination; it does not require migrating all modules at once.

## Harness and capability decomposition

### Plugin, process and language are separate decisions

A capability becomes a first-party Rutis plugin when it owns a coherent service, dependencies and
cleanup lifecycle. An ordinary helper, coordinator or memory category does not need its own plugin.
Plugins may share a runtime. Process separation is justified by blocking work, native crash
containment, resource locality or independent recovery; language selection follows measured cost
and deployment requirements. Neither choice follows automatically from making a plugin.

First-party Rust services initially ship with the application-owned host executable. The
[upstream Rust host guide](https://github.com/arcships/rutis/blob/v0.16.0/docs/guide/rust-host.en.md)
also documents dylib plugins, but arbitrary binary loading, cross-version ABI compatibility
and live code replacement are separate distribution contracts, outside this migration. Preserve
the existing external-plugin permission boundary: a first-party Memory or Store service does not
give marketplace plugins unrestricted access to profiles, credentials or execution authority.

Use the existing TS runtime for extracted TS capabilities unless a separate failure domain is
required. Shared-runtime plugins share native crashes and process memory. Rust services also share
the host's failure domain unless deliberately isolated; running blocking database/CPU work on the
host routing task would defeat the responsiveness objective.

### Source-backed capability map

The following are ownership groups, not a required plugin count or a new directory structure.
Names describe proposed capabilities; only admission is currently connected through Rutis.

| Capability                              | Current owners and entry points                                                                                                                                                                         | Proposed service and authority                                                                                                     | Initial placement and Rust direction                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime and admission                   | `src/main/harness/{runtime,admission}.ts`, `src/harness/plugins/admission.ts`, `crates/deepchat-harness`                                                                                                | Required-service readiness, generation lifetime, bounded admission and permits                                                     | Rust host plus existing TS admission plugin; a Rust queue is a structural migration until measured otherwise                                 |
| Run control and interaction             | `RunLifecycleCoordinator`, `PendingInputAdmissionCoordinator`, `PendingInputPump`, `InteractionCoordinator`, `InteractionParkingRegistry`, `ProviderPermissionCoordinator` in `src/main/agent/deepchat` | One owner for run transitions, four fences, queued-input dispositions, cancellation and approval settlement                        | Keep cohesive with the TS Harness first; later one Rust control owner, using atomic transition commands rather than RPC per coordinator      |
| Agent execution and context             | `DeepChatLoopRunner`, `DeepChatLoopEngine`, `TurnCoordinator`, context/input/compaction coordinators, prompt assembly and `src/main/agent/deepchat/runtime/contextBuilder.ts`                           | Execute a turn from an admitted input; assemble bounded context; stream ordered results                                            | TS core with Provider streaming nearby; profile JSON, projection, token estimation and pruning before selecting a batched Rust operation     |
| Session, Store and Tape                 | Session lifecycle/settings/identity, transcript mutation and message projection; `src/main/tape`; shared database composition                                                                           | Durable commands, Tape/projection consistency, recovery and configuration snapshots; exactly one authority for each mutation       | Move existing SQLite-backed owners together into TS core; Rust storage is a separate later compatibility project                             |
| Memory                                  | `src/main/memory/index.ts`, `core/injectionPort.ts`, `ports.ts`; Harness `memory/memoryRuntimeCoordinator.ts`                                                                                           | Recall/injection, extraction, approved directives, management and maintenance; Harness retains turn scheduling and fences          | One first-class TS Memory capability, with an optional vector resource boundary; selectively Rust after profiling                            |
| Knowledge and RAG                       | `src/main/knowledge/{index,knowledgeBase,taskQueue}.ts`, `database/knowledgeDatabase.ts`                                                                                                                | Document/chunk indexing, retrieval, durable file/task status and knowledge-store lifetime                                          | TS capability with its own schema, VSS and file contracts; later evaluate native-worker placement alongside document jobs                    |
| Provider                                | `src/main/provider/providerService.ts`, `aiSdk/runtime.ts`, model/embedding/rate-limit managers and `src/main/app/memoryProviderBindings.ts`                                                            | Model resolution, request execution, embedding, streaming and request admission                                                    | TS ecosystem adapters; credential/OAuth operations through host ports; no per-token cross-language calls                                     |
| Tool execution, MCP and ACP             | Tool resolver/deferred executor/output guard in Harness; `src/main/tool`, `src/main/mcp`, `src/main/agent/acp`                                                                                          | Existing permission checks, operation identities, result/artifact bounds, protocol connections and subprocess leases               | TS protocol adapters; Rust may own generic process resources later; MCP Apps and ACP terminals retain explicit desktop capability ports      |
| Skills and hooks                        | `src/main/skill/{index,skillExecutionService}.ts`, discovery/sync workers, `src/main/hook`; Harness skill materialization and hook sink                                                                 | Discover contributions, resolve trusted context, observe lifecycle, execute approved operations and remove registrations on unload | TS contribution plugins where independently useful; keep pure prompt helpers internal and preserve uncertain hook outcome recovery           |
| Jobs and process resources              | `src/main/scheduler`, `src/main/agent/shared/process`, `src/main/tool/codeMode`, file-watch owners                                                                                                      | Schedule calculation, durable run claims, bounded jobs, process-tree cancellation and cleanup                                      | Reuse existing utility processes; Rust supervision/timers are candidates only when an old process or lifecycle owner can actually be removed |
| Documents, OCR and local search         | `src/main/ocr`, `src/main/platform/fileSearch/fffSearchService.ts`, attachment capability routing                                                                                                       | Bounded extraction/search operations and artifact references, with cache and resource ownership                                    | Reuse existing native engines/helpers; optional isolated job plugin; Rust wrappers alone do not accelerate native work                       |
| Remote channels and device capabilities | `src/main/remote/runtime/manager.ts`, channel runtimes, existing sync and local control plane                                                                                                           | Channel lifecycle and authorized Session ingress; separately scoped device operations and durable sync                             | TS integration plugins; isolate noisy channels when justified; remote Rutis links do not grant application or filesystem authority           |
| Desktop and observability               | `src/main/app`, route/preload boundaries, platform adapters and structured logging                                                                                                                      | Native windows, unlock/crypto/OAuth, authenticated caller creation; bounded content-free diagnostics                               | Electron adapters remain desktop-owned; diagnostics accompany each capability instead of becoming a new central business owner               |

The Harness root is
[`createDeepChatAgentHarness.ts`](../../../src/main/agent/deepchat/harness/createDeepChatAgentHarness.ts).
Its [runtime services](../../../src/main/agent/deepchat/harness/runtimeServices.ts) already name useful
ports, but synchronous repositories, callbacks, `AbortSignal`, closures and object identities are
not remotely usable contracts. Extracting the composition unchanged into a plugin does not solve
those dependencies. The existing [Harness contract](../deepchat-agent-harness-boundaries/spec.md)
remains authoritative for the four fences and synchronous pending-input settlement.

Keep run ownership, approval parking and pending-input feedback under one transition authority.
Do not create a transport round trip for each fence check. Similarly, keep Provider token delivery,
tool permission decisions and loop progress local until an operation-level protocol preserves
ordering and backpressure. Progressively remove Electron dependencies through desktop ports;
moving business code out of `src/main` is an outcome of ownership extraction, not a bulk rename.

## Memory as a first-class capability

### Ownership and first extraction

Memory is a suitable independent capability because it already has a facade, repository ports,
execution identities, provider bindings and vector-store lifetimes. Use one Memory plugin with
internal retrieval, working-memory, extraction, reflection, persona, conflict, merge, directive and
maintenance services. These are not separate processes or independently trusted instruction lanes.
The existing [Memory service boundaries](../memory-service-boundaries/spec.md),
[Memory architecture](../memory-system.md) and [vector v2 contract](../memory-vector-store-v2/spec.md)
continue to define behavior.

The recommended first Memory slice is the vector resource service: query/upsert/delete/list and
open/close/reset/quarantine of per-Agent stores. Its files are separate from the shared database,
and most operations are already asynchronous. Keep the current DuckDB implementation in TS first.
This is a lifecycle and isolation experiment, not a claimed query-speed optimization. Use one
additional TS runtime, started lazily by the existing Rust host when the first store is needed.
Native poison requires a new process; sharing the admission runtime would couple that recovery to
unrelated active Runs. No runtime is created per Agent, and unused Memory starts no extra process.
The additional runtime must pass the G2 resource budgets before adoption.

`IMemoryVectorStore` still exposes synchronous `isUsable()`, and the factory has synchronous
quarantine notification and object-returning creation. A remote service must use generation-bound
resource identities, acknowledged mutations and explicit health/readiness observations. Cached
health may reject work early; it cannot authorize a stale handle. A query/upsert validates the
Agent, embedding model/dimensions and store generation at its actual owner. Do not serialize class
instances or assume that the current interface can be proxied unchanged.

Keep `VectorStoreManager` admission/leases and embedding identity changes coherent with resource
disposal. A local facade can retain policy while the resource owner holds native handles, but
there must be one authority for close/quarantine/reset and no reopening while an old owner lives.
Preserve v2 sidecars, legacy migration, staging/rename, WAL handling and quarantine semantics.
The current recovery contract requires a new process after poisoned native state; same-process
reopen or automatic worker replacement is not established recovery behavior.

### Full Memory service dependencies

The full capability needs the following contracts before its real wiring can move:

| Boundary                    | Existing coupling                                                                                                                      | Required extraction rule                                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable facts and mutations | `MemoryDatabase` uses the same main database as Sessions, Tape, settings and Providers; repository methods are synchronous             | Keep a single storage authority. Introduce coarse business commands for atomic Memory writes/CAS/tombstones/lineage/audit, or move the repositories with Store. No generic SQL gateway or row-by-row remote repository facade   |
| Configuration and execution | `isEnabled`, budgets, directive contribution, execution-token capture/validation and access observation include synchronous operations | Use versioned policy snapshots only for reads that tolerate them; authoritative admission and writes validate execution epochs. Invalidate stale work on Agent delete, config change, clear and shutdown; no synchronous IPC    |
| Tape ingestion              | `MemoryRuntimeCoordinator` owns scheduling, Tape anchors, persisted Session cursors and late-work fences                               | Keep scheduling with Harness. Preserve the atomic observation of Tape/projection heads and acknowledge owned extraction before advancing its cursor; do not replace one database observation with independently timed RPC reads |
| Providers                   | Embedding, extraction, reflection and persona use current model resolution, queues and cancellation                                    | Use the existing Provider execution port; preserve request admission, execution identity, deadlines and cancellation. A lost reply cannot automatically replay a durable write or provider side effect                          |
| Recall and prompt trust     | Vector/FTS candidates require authoritative scope, temporal and tombstone checks; approved directives use a distinct lane              | Revalidate recalled rows at the owner before injection. Facts, persona and working memory remain untrusted content; approved directive policy must survive plugin replacement                                                   |
| Management and maintenance  | Routes, memory tools, backup/rekey/clear/delete, vector rebuild and background maintenance share service lifetimes                     | Retarget every caller, including management UI and tools. Quiesce and fence work before destructive maintenance, drain native/provider jobs and preserve failure/rollback behavior                                              |

[`MemoryRuntimeCoordinator`](../../../src/main/agent/deepchat/memory/memoryRuntimeCoordinator.ts)
must remain an explicit Harness collaborator rather than disappearing inside a generic plugin
lifecycle callback. A Rutis generation cannot replace the Agent execution epoch or persisted Tape
incarnation. Plugin unload must settle or fence extraction, release resources and leave ingestion
recovery deterministic; it cannot silently skip inputs or resurrect forgotten memories.

During staged migration, the existing database owner may serve narrowly defined transactional
commands while it remains the only writer. Its shared repositories do not move merely because
Memory becomes a plugin. The whole-core database cutover moves all remaining facades and scheduler
claim transactions together; main then loses writable shadow access.

After that cutover, the full Memory plugin shares the Core runtime with Store, Provider and
Harness. The Rust host loads it before Core, and Core declares its service dependency. Its
owner-local attachment accepts the existing policy, repository, Provider and vector-resource
ports; it is not a serialized repository API. All prompt, tool, management and Agent consumers
receive the same facade. Existing read epochs, execution tokens and atomic Tape observations stay
local to their authorities rather than becoming cached remote snapshots.

The plugin owns facade construction and the complete Memory lifecycle. Harness explicitly binds
its ingestion observer; pause/drain, resume and final retirement coordinate that observer with
background maintenance and vector disposal. Unload fences ingestion and the facade before awaiting
provider/native retirement. A retired attachment cannot reopen, and stale references cannot revive
its execution epoch. Core's profile release still requires the plugin's retirement receipt.
This extraction adds no worker, data-path RPC, schema or dependency; it makes no performance claim.

### Existing bounds and the actual optimization question

The current implementation already bounds recall materialization to 800 candidates, keeps a vector
store soft cap of 8 with a 15-minute idle TTL and active leases, batches embedding work, and limits
background/query embedding concurrency. Do not describe adding an LRU, batching or bounded queues
as a new Rust benefit. Existing numeric-only diagnostics report repository/materialization cost,
DuckDB statements, open stores, active leases, provider work and extraction outcomes.

[`memoryVectorStore.ts`](../../../src/main/memory/infra/memoryVectorStore.ts) executes cosine queries
in native DuckDB through `@duckdb/node-api`. Writes reuse typed native column buffers, avoiding
one temporary native scalar per embedding component. Query array binding, handle lifetime and
duplicated buffers remain candidates for profiling.
A Rust wrapper using the same engine does not by itself improve the database algorithm. A bounded
800-row score pass is also a weaker candidate than an observed large-history JSON/projection cost.
Model inference and network waits remain Provider costs in either language.

Knowledge/RAG also imports DuckDB in Electron main through
[`knowledgeDatabase.ts`](../../../src/main/knowledge/database/knowledgeDatabase.ts). Moving Memory
vectors alone therefore does not unload the driver from main or eliminate all native crash risk
there. Do not merge Knowledge's schema/VSS migrations into Memory's v2 format; assess its independent
capability and any shared-worker costs in G9.

Evaluate query recall/selection, tombstones, scope, temporal rules and injection budget alongside
latency. Retain FTS/degraded behavior and failure diagnostics. Use the existing Memory performance,
native and quality suites; algorithmic fixtures alone do not measure DuckDB or whole-application
memory. G2 records native and fixture characterization in the live plan; those results do not
establish a whole-application Memory improvement.

### First vector service contract

G3 keeps the current v2 DuckDB engine and files. The Rust host supervises the lazy runtime generation;
one first-party TS plugin owns native handles, file locks and recovery leases. Memory policy, authoritative
rows, embedding scheduling and vector leases remain in their existing owners. There is no schema
migration or fallback to a second native owner in Electron main.

- Negotiate a versioned `memoryVector` service at the private application handshake. Admit only
  open, query, query-by-ID, atomic upsert, delete-by-IDs, list-IDs, close, reset and quarantine
  operations. Validate the Agent and resource identity at both the application adapter and owner;
  callers cannot choose a path, SQL statement, module or service name.
- Choose resource and operation UUIDs before dispatch. Every resource binds Agent, model, dimensions
  and runtime generation. Late open replies must release the known resource; dropped futures cannot
  abandon a native handle. A local `isUsable()` observation may reject early but cannot authorize
  a stale operation. Revocation/quarantine immediately disables the local facade, and subsequent
  open/reset/disposal waits for the authoritative control acknowledgement or proven process exit.
- Hold a private DuckDB ownership database open in the vector process before startup recovery
  or database/WAL/staging mutation. Its native file lock fences an earlier process that outlives its desktop host.
  Persist a per-Agent lease before opening vector files. Remove it only after acknowledged clean
  closure; preserve it for uncertain writes and runtime disposal. After acquiring ownership, recover
  stale leases through the existing quarantine path and require explicit index rebuilding before
  issuing usable grants. Keep database writes, removal and marker consumption in the vector process.
  The application adapter synchronously creates append-only quarantine intents so cleanup can be
  deferred durably even after worker loss, including for previously closed stores. Preserve its
  synchronous marker-error contract, fence the native owner even when marker creation fails, and
  never unlink or recover database files from that adapter.
- Preserve existing admission calls and their 64-KiB limit. Add a distinct vector frame kind with
  a 256-KiB maximum; retain the 1-MiB transport buffer budget and reserve 64 KiB for control. Only
  one bulk chunk awaits acknowledgement at a time. Control frames take precedence over the next
  chunk, and a loaded-vector E2E case must prove admission is not starved.
- Encode embeddings as little-endian Float32 data, matching the native `FLOAT[]` representation.
  Bulk uploads carry raw bytes from Main to Rust: the vector and binary header bits are both set,
  followed by a four-byte big-endian metadata length, JSON request metadata and one bounded byte
  chunk. Only begin/chunk/commit accept this form; reject empty/oversized chunks and metadata that
  already contains data. Rust owns one bounded ephemeral upload and acknowledges received chunks;
  only commit forwards an atomic upsert through Rutis `Value::Bytes`. Native parts are at most
  8 MiB, keeping base64 plus bounded metadata below Rutis's 16-MiB internal message limit.
  Native parts run sequentially under the same logical upload identity; the native owner assembles
  and validates the complete batch before one transaction. Partial transfer failures abort the
  known native upload. Reserve the resource's execution order from the first native part, so
  subsequent reads and mutations cannot overtake the batch. Abort/close releases an incomplete
  reservation; a committing write remains owned until settlement. Keep staging owned until then.
  Rutis's internal base64 encoding remains an SDK detail. Query vectors retain canonical base64.
  Preserve IDs, dimensions and ordering; validate byte lengths and finite values before effects. No dense-vector JSON number arrays or complete histories
  cross this gateway. Verify Float32/native cast parity, including extreme inputs.
- Validate provider response vectors with a finite-number loop and clone the numeric array once,
  preserving the SDK's rejection and raw-response isolation contracts without per-component Zod
  parsing objects. Keep the installed provider versions pinned and patch only their embedding
  response schemas, including Azure's internal OpenAI and Vertex's Node/edge entrypoints.
- Bound one logical upload to 16 MiB of decoded data and 50 records, with one active staged upload
  in Rust until the native operation settles. Use explicit begin/chunk/commit/abort operations:
  validate the complete batch and invoke the existing atomic native upsert once. Chunk acknowledgement is not a durable write
  acknowledgement. Oversized/invalid operations fail before effects; never truncate or split a
  logical transaction silently. Inventory every actual caller against these limits before cutover.
  Begin and commit can each carry one bounded chunk, avoiding empty transport round trips without
  changing the atomic write acknowledgement. Bound the first application chunk to 64 KiB to leave
  room for IDs; bound subsequent chunks to 240 KiB within the unchanged 256-KiB frame limit.
  Retain one outstanding chunk acknowledgement. Pack complete rows with native Float32 array
  conversion and copy partial rows into the current chunk; retain no second full encoded matrix.
- Reuse one typed DuckDB data chunk per store and append bounded pages inside the existing
  delete/insert transaction. Close the appender before commit; invalid dimensions or a failed
  append roll back the whole logical batch. Preserve Float32 values and smaller subsequent batches.
  Keep received Float32 matrices packed through insertion using the pinned DuckDB bindings already
  shipped with the Node API. Validate finite values, exact byte length, little-endian host format,
  actual FLOAT array type and row capacity before native copies. Set parent/child validity and
  honor source byte offsets; never expose an unchecked native memory-copy operation over RPC.
- Keep padded base64 validation strict in the pinned Node runtime. Decode and verify by canonical
  round trip with Node's Buffer implementation. Reuse an exact, independently allocated backing
  buffer; copy pooled or partial buffers so decoded bytes cannot expose unrelated data.
- Launch only the vector runtime with `--max-semi-space-size=8`. Sustained bounded uploads must
  not retain a throughput-grown idle nursery. Preserve the admission runtime's default heap policy
  and validate query/write latency alongside aggregate footprint; no forced GC is used.
- Bound query results to the existing recall ceiling of 800, and list/delete operations to 512
  IDs. Current callers use single-item management deletion, at most 50 embedding-orphan IDs,
  256-row prune batches and 512-row orphan reconciliation; retain atomicity for each call.
  Permit at most 32 pending vector operations and two active native
  jobs; serialize writes and disposal for each store. Backpressure must not occupy admission slots.
  Do not retain a second full encoded upload alongside the source vectors in main.
- Keep model/dimension mismatch, migration/staging/WAL, suspect-store leases, operation deadlines
  and v1 progress/abandon rules from the current implementation. The 15-second runtime handshake
  is separate from a store open/migration; do not impose admission's 10-second RPC deadline on
  native work. Cancellation fences the consumer while the owner retains a running native operation
  until it settles or its process has demonstrably exited.
- On native failure, preserve the existing quarantine marker and FTS degradation. On vector
  runtime loss, invalidate its handles and pending work without replacing admission or replaying
  unknown writes. Preserve new-process recovery semantics; G3 introduces no automatic native-worker
  restart. Quarantine or terminal native recovery failure terminates the vector process before
  native cleanup or GC can release uncertain ownership. The Rust host reaps it before reporting
  loss. Map loss to the existing quarantine contract so clear/delete can report deferred cleanup;
  erased canonical memories cannot reappear after restart. Normal shutdown drains/fences Memory
  work and store leases before terminating that runtime.

These bounds define the first service contract, not measured performance. G3 must prove native and
quality parity, atomicity under interrupted uploads/lost replies, lifecycle cleanup and resource
budgets through the real application before removing the original factory wiring.

## Rust selection and resource evidence

### Candidate ranking

The ranking distinguishes architectural value from a performance hypothesis. No row below is an
observed speed or memory improvement. Existing native engines stay in place unless their actual
algorithm, binding or resource policy is the measured limitation.

| Candidate                                                                                              | Priority and proposed language                                      | Possible benefit to verify                                                                                 | Constraint or rejection condition                                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission and coherent Run control                                                                     | High structural priority; Rust after TS core boundaries             | Headless control authority, compact state/leases, explicit cancellation and fewer JS ownership objects     | Queue work is small. Porting it does not remove V8 while TS adapters remain; preserve all fences and settlement semantics                                       |
| Tape effective-view/replay and context projection                                                      | First CPU-oriented Rust candidate if profiles confirm cost          | Fewer repeated JSON parses, large-history allocations/sorts and GC pauses; batch projection near data      | Preserve UTF-8 binary ordering, retractions/replacements, provenance and canonical hashes. Reject full-history IPC copies or per-helper RPC that erase the gain |
| Tool result scanning/pruning and local document preprocessing                                          | Conditional Rust batch operations                                   | Bound large text/JSON traversal and materialization away from the control loop                             | Existing limits and artifact semantics remain; reuse sharp/OCR/search native work and do not reimplement it based only on language preference                   |
| Process trees, watchers, timers and scheduler calculation                                              | Conditional Rust resource owner                                     | Remove an existing Node utility host, consolidate idle runtime overhead and improve cancellation ownership | Preserve schedule claims/misfires, shell environment, OS process identities and power events. Reject an extra supervisor around the same live owner             |
| Memory vector binding/resource manager                                                                 | TS first; Rust only for measured allocation/engine integration cost | Reduce JS boxing/copies or eliminate a dedicated Node host once its last TS task moves                     | Native DuckDB memory remains. Account for IPC buffers and all handles; independent recovery requires a proven file-owner transition                             |
| Memory ranking, budgeting and pure normalization                                                       | Low/conditional Rust priority                                       | Lower allocation/CPU only if a measured stage is significant under bounded workloads                       | Recall candidates already capped at 800. Preserve selection quality, mixed-language estimates and budget policy; reject noise-level gains                       |
| Shared Store/Tape persistence                                                                          | Later Rust decision                                                 | Potentially remove JS storage objects/runtime overhead and make durable commands available headlessly      | Encryption, migration, SQLite extensions/collation, transaction/recovery and maintenance parity are prerequisites; a new driver is not a free substitution      |
| Provider SDKs, MCP/ACP adapters, Skills/hooks, extraction/reflection orchestration and remote channels | Keep TS by default                                                  | Mature protocol ecosystem and cheaper integration changes                                                  | Mostly I/O or model time. Rust is justified by a proven adapter bottleneck or removal of a runtime, not by a general rewrite objective                          |
| SQLite, DuckDB, native search, sharp and OCR engines                                                   | Reuse existing native implementations                               | Resource lifetime, batch sizes and data movement may improve without rewriting engines                     | Do not count engine time as JavaScript time or claim a native-to-Rust wrapper migration changes its core performance                                            |

Inspect the current Tape folds in
[`effectiveView.ts`](../../../src/main/tape/domain/effectiveView.ts) and
[`replay.ts`](../../../src/main/tape/domain/replay.ts), plus the context builder, as one potential
batch computation. If a remote operation needs the entire history to produce a small view,
co-locate that computation with Store or return a bounded projection from the current owner first.
Durable transaction callbacks and arbitrary synchronous repository calls are not wire protocols.

### Measurement and adoption gates

Establish two baselines: the application before admission extraction and committed `ffcd98770`.
Use the first to account for the total architecture cost and the second to attribute each next
module. Preserve immutable artifacts and isolated profiles, with versions and workload parameters.
For an explicit performance adoption decision, run at least five paired samples on the same
machine and report warm/cold results and baseline variance. This sample count does not apply to
ordinary correctness E2E or every structural extraction. Use a deterministic local Provider
fixture for local CPU/memory comparisons, then separately validate real-provider behavior.
Do not benchmark against a live user database.

| Workload                        | Evidence required                                                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle, cold startup and shutdown | All process identities, readiness time, CPU wakeups, aggregate memory, artifact size and bounded child cleanup                                                                    |
| Streaming/delegation under load | Single and concurrent Sessions, existing 6-active/2-queued delegation case, interrupt/approval/pending input, renderer input-to-paint and main event-loop p95/p99, stream latency |
| Context/Tape scale              | Fixed small/large histories and payload sizes; fold/build timings, CPU, allocation/GC, materialized bytes, transfer bytes and canonical output parity                             |
| Memory recall and maintenance   | Fixed row counts/dimensions, cold/warm native queries, FTS degradation, reindex/clear and more than 8 Agents to exercise store eviction; quality, leases and queues must converge |
| Lifecycle failures              | Lost replies, queue saturation, plugin/runtime death, stale callbacks, poisoned native handles, maintenance and shutdown; no duplicate writer, replay or leaked descendants       |

Reuse [Memory metrics](../memory-quality-gates-and-observability/metrics.md) and the existing
`test/main/performance/memory` workloads before adding another telemetry framework. Separate
orchestrator time, provider wait, native query time and IPC/serialization. Measure CPU seconds and
allocation as well as wall time. Record all process-tree members, not just the main V8 heap.

For memory, report per-process RSS with its shared-page caveat and an appropriate platform measure:
private footprint on macOS, PSS/private memory on Linux, and private committed/working-set values
on Windows. Do not sum incompatible metrics or equate V8 heap reduction with whole-app savings.
The [Electron process API](https://www.electronjs.org/docs/latest/api/process#processgetprocessmemoryinfo)
documents macOS `private` memory as more representative than resident set size; the Rust
host and non-Electron children need corresponding OS measurements. Include native buffers, mapped
databases and retained IPC queues in interpretation.

Before implementing a performance-driven Rust slice, record a numeric target and maximum accepted
startup, memory and responsiveness regressions in the live plan from that baseline. Adopt it only
when repeated end-to-end results exceed baseline variance, preserve output/quality and meet those
budgets. An isolation-driven slice may be accepted for proven failure containment within the same
resource budgets; report that purpose explicitly instead of calling it a speed optimization.

Shared PR runners report wall-clock timing budgets without blocking on an individual overrun.
They still enforce correctness, ownership, bounded work/queues, runtime compatibility, finite
measurements and test timeouts. The explicit test-only `DEEPCHAT_MEMORY_PERF_REPORT_ONLY=1` mode
changes timing assertions only; it must not suppress a failed test or native operation.
Timing checks enforce their unchanged budgets by default when explicitly run for controlled
benchmarking; they are not a mandatory timing gate for each migration slice. Batch adjacent
internal composition changes and their relevant checks. Require matching baseline/migrated
application E2E for a complete capability cutover or affected public/lifecycle behavior, rather
than repeating it for each internal file move. Shared runners may enforce deterministic work,
payload and queue limits; do not add relative wall-clock regression gates to them.
Select targeted fixed-device resource comparisons when a module materially changes process
placement, IPC volume, batching or storage access, or when measured performance is its adoption
objective. Include transport and the whole process tree where those costs change. For a structural
extraction, start with one representative affected workload; expand only when it exposes a concrete
suspected regression. Ordinary port extraction requires no performance rerun solely because it
changes an async call. Reuse verified immutable runtime evidence for documentation or test-only edits.

Choose the affected workloads and measurement budget before running. Report central tendency and
spread against a matching local baseline; do not infer a regression or improvement from one sample
or a noise-level difference. An isolated timing overrun does not block the next slice. Investigate
a material suspected regression with at most one predeclared confirmation batch, retaining every
sample; a reproducible material regression must be resolved before adoption. If that batch remains
inconclusive, stop measuring and record the uncertainty without a speed claim. Further measurement
requires a changed implementation, workload or concrete new evidence. CI timing noise alone cannot
block a structural extraction. Do not retry shared CI until it happens to pass, repeat unchanged whole-app captures, or
optimize production code solely to meet a noisy shared-runner sample.
Size completion waits for the bounded fixture and shutdown work; a fixture timeout is not an
additional adoption latency budget. Production handshake, retrieval and ownership deadlines remain
unchanged when a large benchmark needs more completion headroom.

The present 64-KiB JSON gateway is admission-only. Memory batches, dense vectors, histories and
artifacts cannot be routed through it by simply raising limits. Freeze service-specific schemas,
bounded batch/stream behavior, backpressure and cancellation identities first; keep large data at
its owner and transfer bounded results or authorized artifact references. Consider a binary data
path only when measured copies justify it. Every mutation needs defined acknowledgement,
idempotency/recovery and unknown-outcome behavior, plus stale-generation rejection and shutdown.

The next execution gate is baseline/contract selection, followed by the vector resource slice if
its costs and wire contract are acceptable. The live plan orders full Memory, cohesive Harness,
selective Rust and Everywhere work by their ownership dependencies. Headless availability does
not depend on rewriting every TS adapter in Rust.

## Product destination

"Everywhere" has three independently verifiable meanings:

| Dimension              | Product behavior                                                                                        | Rutis contribution                                                        | DeepChat responsibility                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Access anywhere        | Desktop, browser/mobile web, CLI, and messaging channels can access an authorized Session Host          | Internal services behind the host                                         | Client UI, versioned application API, identity, permissions, event reconnect/resync                |
| Run anywhere supported | The core can run as an embedded desktop backend or an unattended personal/self-hosted service           | Runtime composition, language bridges, process lifecycle                  | Headless host adapter, packaging, configuration, secrets, storage and supervision                  |
| Use enrolled devices   | A Session can request a capability on a selected machine, such as workspace files or desktop automation | Explicit peer services, remote runtimes, reconnect and resource ownership | Device enrollment, capability grants, workspace identity, operation settlement and locality policy |

An example target workflow is opening a phone browser, submitting work to a home machine or server,
using an explicitly selected laptop workspace, and following the same Session from a desktop or
messaging channel. This is a product acceptance scenario, not current functionality.

```text
Desktop     Browser / Mobile web     CLI     Messaging adapters
    \                 |               |             /
     +------- authenticated application API + events -------+
                              |
                     Authoritative Session Host
                     Rust/Rutis + TypeScript core
                     Sessions / Tape / State / Policies
                         |                    |
                   Local capabilities     Approved node links
                                              |
                                  Workspace / Desktop / Compute nodes
```

Rutis's cross-machine service protocol is an internal execution connection. It is not the browser
client protocol, a mobile UI toolkit, a user-account service, a replicated database, or a mechanism
for transferring a live Run between machines. Connecting a service by name also does not establish
equivalent business behavior; DeepChat owns the service's versioned contract and acceptance checks.

### Deployment profiles

| Profile                | Session authority and lifetime                                                               | Client and native capabilities                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Desktop local          | Local profile and backend; desktop application retains its existing quit policy              | Desktop IPC adapter, local OS capability ports, offline operation                                    |
| Personal/headless host | An explicitly installed service owns the profile and continues independently of attached UIs | CLI and later authenticated remote clients; desktop-only capabilities may be absent                  |
| Remote client          | The selected Session Host owns execution and persistent state                                | Desktop, browser or mobile web acts as a client; local device execution requires separate enrollment |

These are architecture/deployment profiles, not three new user-facing configuration systems. The
first implementation remains desktop local. A headless host uses an explicit Node runtime and
server-native dependency build, without installing Electron. Its credential backend and bootstrap
ports must be configured for that host; desktop safeStorage ciphertext is not portable secret
storage. Core startup must not assume a renderer, window, tray, system keychain, or display server.

Clients attach to a Session Host; they do not create another writer for its active Session. A
headless host owns its root lifetime through its service supervisor, not an Electron window or a
phone connection. Losing all viewers does not implicitly stop that host. In desktop-local mode,
closing/quitting behavior remains the current explicit application policy.

### Delivery horizons

1. **Desktop separation:** prove the Rust/Electron launch path and remove business workload from
   main without changing stored data or public behavior.
2. **Headless core:** run the same backend with Node and explicit host ports; attach the existing
   CLI to local business operations without any Electron process or window.
3. **Multiple clients:** expose a deliberate authenticated application surface, then a browser
   client usable on a phone; desktop and web can observe and submit to the same Session Host.
4. **Device capabilities:** enroll one execution device and prove one workspace-bound operation,
   revoke it, and recover correctly from a connection loss during execution.
5. **Selective distributed features:** add independently placed compute or integration runtimes
   only when workload locality, replacement, or recovery requires them.

Native iOS/Android engines, browser-local Node/Rust execution, an unrestricted mesh, multi-user SaaS,
automatic host failover, and live Run migration are outside these delivery horizons. A phone web
client is the initial mobile access path; it does not promise the desktop's native capabilities.

## Current implementation evidence

| Boundary                         | Evidence                                                                                                                                                                    | Consequence                                                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop and business composition | [`composition.ts`](../../../src/main/app/composition.ts) constructs business services, initializes plugins/MCP/Skills, closes services, and suspends/resumes database users | Extraction must move ownership, not copy the same composition into a second process                                                       |
| Shared persistent database       | [`mainProcess.ts`](../../../src/main/app/mainProcess.ts) constructs Settings, Provider, MCP, and Agent database facades from one main database                              | Moving Session/Tape alone leaves shared storage and synchronous configuration dependencies across the boundary                            |
| Configuration access             | [`settingsStore.ts`](../../../src/main/config/settingsStore.ts) switches a synchronous store to a database-backed implementation                                            | A remote proxy cannot preserve arbitrary synchronous property reads; desktop consumers need explicit snapshots and asynchronous mutations |
| Desktop dependencies             | Provider auth, MCP Apps, Skills, ACP, and Remote code import Electron APIs                                                                                                  | These calls require narrow desktop ports before their business owners can move                                                            |
| Public routing                   | [`routeRegistry.ts`](../../../src/main/routes/routeRegistry.ts) has caller identity and output projection; shared contracts define route schemas                            | Preserve the existing renderer/CLI surface while adapting backend-owned handlers                                                          |
| Agent ownership                  | [`Harness boundaries`](../deepchat-agent-harness-boundaries/spec.md) define instance/run/operation/message fences and synchronous queue settlement                          | Framework generations do not replace these business identities or ordering requirements                                                   |
| Existing child processes         | Scheduler, Code Mode, background execution, file watching, OCR, MCP, and ACP already use processes; Skill discovery also uses workers                                       | Reuse their launch, cancellation, and recovery contracts; avoid duplicate supervisors                                                     |
| Scheduler writes                 | [`repository.ts`](../../../src/main/scheduler/repository.ts) owns atomic due-job claims; the utility host receives bounded scan replies without a database connection       | Move this repository with the shared Store; keep the timer helper outside the writer authority                                            |
| Runtime deployment               | [`Managed Toolchains`](../managed-toolchains/spec.md) makes official Node optional; [`build-cli.mjs`](../../../scripts/build-cli.mjs) already uses Electron's Node mode     | The core backend must start offline without downloading or selecting a user Node installation                                             |

The existing [`renderer API core`](../../../src/renderer/api/core.ts) resolves `window.deepchat`,
and preload implements its invocation/event transport. That seam is useful for a web adapter, but
it is not proof that the current renderer is browser-portable. Audit client-level capability and
Electron assumptions before selecting reusable UI code. This RFC introduces no renderer changes.

The existing [`device sync contract`](../../features/cloudflare-tunnel-sync/spec.md) exchanges
portable durable units with LWW conflict resolution. It excludes active executions, approvals,
scheduler state, machine-local configuration, and arbitrary referenced files. Its pairing and
bounded transfer patterns are useful evidence, but sync access grants no Session control or device
execution authority. The current sync endpoint is not a remote application gateway.

### Local feasibility observations

Two ephemeral probes loaded `better-sqlite3-multiple-ciphers`, `@duckdb/node-api`, and `sharp` from the
current dependency tree. SQLite also completed `SELECT 1` against an in-memory database. The probes
did not open a user profile, install dependencies, or rebuild native modules.

| Probe                                  | Actual runtime                                                  | Result                   |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------ |
| Shell Node                             | Node `24.21.0`, module ABI `137`, N-API `10`                    | All three modules loaded |
| Electron with `ELECTRON_RUN_AS_NODE=1` | Electron `43.7.0`, Node `24.21.0`, module ABI `148`, N-API `10` | All three modules loaded |

These results establish a local runtime option, not packaged compatibility or full database/vector
operation. The checkout declares Node `>=24.22.1 <25` and Electron `43.8.3`; the installed versions
used by the probes differ. Verification must be repeated against the declared release runtime and
each packaged target. The admission integration check separately passed the real Rutis-to-Electron
handshake on Electron `43.8.3` / Node `24.22.0` / module ABI `148` on macOS arm64. That check does not
load SQLite, DuckDB, or image dependencies and establishes no packaged native-module compatibility.

## Desktop-local process topology

This is the target core topology. At `ffcd98770`, only admission uses the Rust host and TS runtime;
the remaining business composition and shared database still run in Electron main.

```text
Renderer processes
  Existing UI, typed clients, rendering
          |
Electron main
  Window lifecycle, OS APIs, renderer authorization, unlock UI, crypto
  Renderer/CLI ingress, desktop configuration snapshots, backend availability
          | private application gateway
DeepChat runtime host (Rust + Rutis)
  Runtime ownership, dependency readiness, generation tracking, service routing
          |
          +-- Core backend (packaged Electron executable in Node mode)
          |   Shared database + configuration authority
          |   Agent + Provider + Session + Tape + Memory
          |   Business routes, approval lifecycle, plugin contributions
          |
          +-- Optional first-party feature runtimes, when justified
          |   For example, a separately restartable Remote channel group
          |
          +-- Existing tools/helpers through their existing lifecycle owners
```

In the desktop-local profile, Electron main starts and stops the Rust host. Rutis owns the core
backend process and its plugin
generation. Only one owner may restart a particular child. Existing utility processes may remain
launched by Electron main through a typed helper port when they require Electron's utility API;
their business leases belong to the requesting backend generation. The Rust host does not call
`utilityProcess.fork` directly.

The initial migration adds one Rust host and one core backend process, excluding existing helpers
and renderers. Optional Node/Python/Go runtimes are not started at boot. No per-Session, per-Run, or
per-Service operating-system process is introduced.

## Runtime integration

### Host and launcher

Use a small DeepChat Rust executable linking the pinned `rutis`, `rutis-bridge`, and, where needed,
`rutis-loader` crates. Reuse their runtime/session implementation. Do not implement another plugin
kernel, copy Rutis internals, or treat the upstream `rutis-host` CLI as an Electron integration API.

For desktop-local deployment, the upstream public `Launcher::new`, `arg`, `env`, `cwd`, and
`inherit_fd` builders, together with
`LocalRuntime::launcher`, allow selecting the packaged Electron executable and the unmodified
Rutis Node runner. Set `ELECTRON_RUN_AS_NODE=1` for that child. Compile first-party TypeScript into
JavaScript before packaging; the core does not require a development TypeScript loader at startup.

Use absolute verified paths for the executable, runner, package anchor, and backend entry. Keep
the external runtime dependency closure in an unpacked, application-owned directory readable by
the Rust host. Preserve the installed app's `runAsNode` capability, signing, and native-module
resolution. Never fall back to PATH Node, enable a managed download, or bundle another official
Node solely to make the desktop-local core start. A headless distribution has its own explicit Node
runtime/package and native-module validation; Electron's Node mode is not the core's API contract.

Construct a deliberate launch environment for the host and core. Remove inherited debugger/import
overrides and validate required proxy/certificate settings through existing host policy. Do not
copy application secrets or user-plugin environment declarations into the core launcher.

The admission integration demonstrates the actual launcher and runtime protocol. Each later
capability must also work through that application path; successful direct Electron execution
alone is insufficient. Unsupported native or packaged targets remain feasibility gates before
moving production data or selecting a different host.

### Transport

Use inherited stdin/stdout pipes for the application gateway between Electron main and the Rust
host, with a length-bounded JSON framing layer. Keep protocol output separate from diagnostic
output. Reuse Rutis for host-to-runtime traffic rather than exposing that protocol to renderers.

Rutis `v0.16.0` supports inherited sockets or private Unix sockets on POSIX. Its local runtime
transport on Windows uses loopback TCP with a per-launch token. This internal transport is
distinct from the existing external CLI endpoint, which retains its UDS/named-pipe-only contract.
The Windows spike must verify loopback binding, token rejection, token disposal, and parent/child
termination. The desktop-local milestone does not advertise a public address or enable remote
node access. Later remote deployments require the explicit application/device boundaries below;
they do not expose the private desktop gateway unchanged.

Application requests use asynchronous service calls. Synchronous cross-process business calls and
cycles through Electron main are excluded. In particular, main must not wait synchronously for a
backend operation that needs a desktop capability callback.

## Ownership and interfaces

| Owner                | Responsibilities                                                                                                                     | Cross-process interface                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Electron main        | Windows/tabs, native shell/dialog/browser operations, safeStorage, unlock prompts, app lifecycle, trusted caller creation            | Narrow desktop operations, targeted UI events, crypto operations, configuration snapshots |
| Rust host            | Runtime lifetimes, readiness, routing to approved services, generation invalidation, bounded shutdown                                | Application gateway and upstream Rutis runtime/session protocol                           |
| Core backend         | Persistent domain state, business configuration, Agent/Provider/Session/Tape, Memory, queue and approval decisions, plugin ownership | Audited domain commands/queries, cancellation, ordered domain events                      |
| Renderer             | Existing rendering and user interaction                                                                                              | Existing typed routes/events through preload and main authorization                       |
| CLI ingress          | Existing endpoint authentication, principal/scopes, transport quotas                                                                 | Existing approved domain routes; agent identity and quotas survive forwarding             |
| Feature/helper owner | Connections, listeners, tasks, and processes created for its generation                                                              | The smallest service and cancellation contract required by its consumers                  |

### Database and configuration

The core backend is the normal writer for the existing shared application database. Preserve its
schema, encryption, transaction boundaries, Tape incarnations, projection ownership, and file
location. Do not introduce a data migration solely to support the process split.

All main-process database facades move with their owning business services. Database opening,
schema repair/migrations, import/export, rekey, backup coordination, and reopen logic execute in
the backend. Electron main supplies unlock interaction and platform crypto through asynchronous
ports. It does not retain a writable shadow connection after cutover.

Single-writer authority does not mean one connection for every file and operation. The Store
owner may open maintenance and snapshot connections internally; separate derived-cache/vector
files retain their own owners. A connection used only for reading is still writable-capable when
opened without a read-only option. Do not use that intent as evidence that Main can retain it.

The current connection inventory is:

| Source under `src/`                                                                               | Connection and file role                                                                                                                                                         | G5 ownership requirement                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main/data/databaseConnection.ts`, `main/data/mainDatabase.ts`                                    | Normal shared SQLite writer, reopen and the common writable-capable connection factory; file-repair helper also opens through that factory                                       | Move factory, normal writer, schema and repair with the Store owner; Main receives no connection or password-bearing reopen callback                    |
| `main/app/mainProcess.ts`, `main/app/composition.ts` and domain `data/database.ts` facades        | Settings, Provider, MCP and Agent attach to the same startup database; Session, Memory, Project, delegation, Scheduler and app facades reuse it                                  | Move these facades and synchronous repositories together; constructing a new facade must not open a second shared writer                                |
| `main/app/databaseSecurity.ts`                                                                    | Password validation, source copy, encrypted staged file and target verification open writable-capable handles                                                                    | Execute inside the Store maintenance owner; native wrapping and unlock presentation remain explicit Main capabilities                                   |
| `main/sync/dataImporter.ts`, `main/sync/configImportService.ts`, `main/sync/index.ts`             | Incremental import opens source and target paths; configuration import opens the target; overwrite replaces the closed active file; backup cleanup mutates a private copied file | Keep target opening/replacement and all temporary connections in the exclusive maintenance operation; do not leave Main with a path-based target opener |
| `main/data/backupReadLock.ts`, `main/sync/index.ts`                                               | Backup snapshots pin the active file through a connection opened by the writable-capable factory; the active owner drains/checkpoints WAL; fallback ships the matching WAL       | Keep snapshot lifetime, checkpoint and file copy with the Store owner; a backup receipt cannot release the actual copy lifetime                         |
| `main/provider/providerImportService.ts`, `main/app/startupMigrations/legacyChatImportService.ts` | Provider and legacy chat source files are explicitly read-only; legacy import writes through the shared Session facade                                                           | Preserve read-only sources; run shared-target mutations at the Store owner, including bootstrap import before ordinary admission                        |
| `main/desktop/browser/BrowserProfileImportService.ts`                                             | Read-only browser cookie source and staged snapshot; writes a private backup snapshot, not the application database                                                              | Keep native browser/keychain consent and temporary-file cleanup in the desktop owner; never treat this as a shared-writer exemption                     |
| `main/data/schemaCatalog.ts`                                                                      | Temporary `:memory:` SQLite schema inspection                                                                                                                                    | Keep internal to schema/repair work; no profile writer is created                                                                                       |
| `main/ocr/ocrArtifactStore.ts`, `main/ocr/ocrRuntimeService.ts`                                   | Separate encrypted `ocr/ocr-cache.db`, optional memory fallback and native cache-key provider                                                                                    | Retain the OCR cache owner and explicit crypto/resource lifetime; this file is not the shared application writer                                        |
| `harness/memory-vector.ts`, `main/memory/infra/memoryVectorStore.ts`                              | G3 worker owns the vector-directory lock database and per-Agent writable DuckDB files                                                                                            | Preserve worker ownership, leases, quarantine and generation fences; Main must not reopen those files                                                   |
| `main/memory/infra/legacyV1Reader.ts`                                                             | Temporary in-memory DuckDB attaches the legacy vector file with `READ_ONLY`                                                                                                      | Keep migration source reads under the existing vector owner and abandonment fence                                                                       |
| `main/knowledge/database/knowledgeDatabase.ts`, `main/knowledge/index.ts`                         | Knowledge has independent writable DuckDB files plus temporary extension inspection                                                                                              | Preserve its existing file and initialization owner; G3 did not migrate Knowledge and G5 cannot claim otherwise                                         |

OCR runtime composition requires its asynchronous cache-key provider. Main supplies the existing
safeStorage provider for the fixed `ocr/cache-key.json` path; the runtime does not construct or
import a native provider. Keep that wrapped-key file under one native owner and the independent
encrypted OCR database under its resource owner. Preserve unavailable-key memory fallback,
unreadable-key recovery, helper lifetime and cache clear/close behavior. G5 transports this private
key operation only to the approved core generation; key material never enters public status,
logs, loader configuration or command arguments.

The profile handoff also covers file writers and synchronous configuration readers that do not
open a database connection:

| File or state family                                                                               | Authority and G5 handoff                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app-settings.json`, `mcp-settings.json`, `acp_agents.json` and legacy Provider model/config files | Move the complete configuration authority and its attached adapters together. Main's existing bootstrap/migration stores must stop writing before backend admission; preserve legacy snapshots and formats without a second whole-file writer. |
| `plugin-settings.json`, installed plugin configuration and `plugin-tool-policies.json`             | Keep installation/consent, activation, Hooks/Tape and synchronous tool-policy decisions with their one business owner. Main receives native presentation commands only.                                                                        |
| `database-security.json`, wrapped Sync/Provider secrets and Codex/Grok/MCP OAuth credential files  | Persistence, generation checks and queues follow their existing owners. Main supplies private crypto/unlock/browser effects, never writable stores or general secret snapshots.                                                                |
| OCR wrapped key, OCR derived database, Memory vector files and Knowledge files                     | Keep the native wrapped-key owner distinct from each encrypted/cache/vector resource owner. Transfer their actual lifetimes and maintenance fences; the shared-database handoff cannot imply these files have drained.                         |
| Provider/ACP catalogs, Skills metadata, toolchains, file/Remote/OCR caches and artifact spool      | Preserve their explicit roots, existing cache writers and helper/resource lifetimes. Move business caches with their consumers; device file/image/browser operations retain narrow host capabilities.                                          |
| Native windows, browser profiles, downloads, updater, logging and OS state                         | Main/device owners retain native effects and renderer identity checks. Business configuration reads use committed projections or async queries; native state is not a shared Store replica.                                                    |

The current DeviceService reset implementation can remove shared files after the exclusive
shutdown-action claim. G5 must bind that claim to actual backend and independent-resource teardown
before deletion or relaunch; an RPC timeout or lost reply is not proof that writers have stopped.
Profile startup belongs to Core: construct settings, encryption metadata, the shared database and
its attached adapters in one owner, with schema/repair and legacy migration before normal admission.
Supply absolute profile/home roots, the application version and private crypto/presentation ports.
Logging and unlock/recovery/quit effects acknowledge their native completion. Failed startup closes
its acquired database before releasing the operation. Main retains no writable startup shadow when
the backend opens its files.

Keep public route execution independent of Electron IPC registration. Main authenticates the
current renderer document before invoking the business dispatcher and derives caller identity from
the native sender; input fields cannot replace that context. Only plain route input/output and
caller values cross this boundary. Native window-role checks are awaited queries, not synchronous
window objects or cached permission grants. After an awaited startup classification, recheck
database admission before dispatch so maintenance or shutdown can retire pending work. Debug app
routes require explicit packaged-build identity in addition to the development-build guard.

Compose Harness/ACP execution, Session projection/turn/assignment/deletion, CLI Runs and delegation
feedback as one owner-local graph. Interaction continuation and task-contract callbacks must resolve
the current delegation lifetime after maintenance. Keep Session/Tape transactions and live table
resolution inside this graph; database reopen must not leave captured table or service instances.
Native renderer lifetime/browser effects are supplied ports, not Electron objects in the factory.

Remote session opening uses two Native window operations around owner-local activation. Main
selects or creates a chat window and returns its window/renderer identities; the Core runtime
activates the session and then asks Main to validate and present that same target. Main receives
no session identifier and does not call back into Session business state. Shutdown fences both
continuations. Renderer destruction removes the Core binding through the existing Native lifetime
subscription; registration that observes an already destroyed renderer cannot publish activation.
A late missing-session query cannot clear a newer binding.

The Core settings route map owns language, theme, shortcut, floating-widget and update-channel
configuration. Native desktop and upgrade route maps retain no settings writer or Session binding.
Browser focus and Computer Use preview admission resolve active/draft ownership in the Core
Session route map. Three fixed Native presentation methods receive the authenticated renderer
context, recheck the actual current window/renderer pair and return validated results. Tab teardown
does not mutate Core bindings; the existing renderer-destruction subscription owns that lifetime.

The floating widget reads a typed Session snapshot and opens sessions through the Core dispatcher;
the existing ACP registry icon query uses the same boundary. Core owns regular-session projection,
ordering and activation. Main owns native geometry, appearance and expanded state, authenticates
the exact floating window's top-level document and exposes only its scoped preload API. Snapshot
reads coalesce within that window lifetime; retired replies cannot update or show a replacement
window. Native initialization acknowledges window creation and appearance without awaiting a Core
query, so Core startup cannot deadlock. Display waits for the initial refresh.

Construct the business data facades from the already initialized profile connection. Session/Tape,
Memory tables, Agent/Project/scheduler data and delegation contracts share that connection; moving
their composition must not introduce another database opener. Migration adapters keep live table
getters across maintenance reopen. Renderer polling/delivery remain supplied lifetime/event ports.

Acquire the profile's `.core-owner.lock` SQLite exclusive transaction before constructing settings
or starting crypto/recovery. This independent, data-free handle remains owned while the primary
database closes/reopens for maintenance. Do not infer release from a pending reply, a PID file or
a timeout, and do not unlink a live lock. Process exit releases the OS lock; a later initializer
must acquire it before touching profile state. The existing named backup/import files exclude it.
Retire credential/security operations, drain accepted work and close the primary database before
releasing ownership. Primary-close failure retains the lease and rejects the terminal action.

The boundary follows existing business operations, rather than these connection wrappers:

| Existing owner and source                                                                   | Work that stays indivisible inside the backend                                                                                                                                    | Data crossing the boundary                                                                                                                               |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SessionTranscript`, `SessionSettingsStore`, `SessionTape` and `main/session/data/index.ts` | Message facts, transcript projection/head changes, retry truncation and clear/reset; existing Tape bootstrap reads can also write                                                 | Existing bounded Session/Tape commands and projections with session/incarnation identity; no remote projection-head read followed by a separate mutation |
| `SessionPendingInputs`, `SessionPendingInputStore` and runtime pending-input coordinators   | Claim/consume/release receipts, accepted user facts and steer-message settlement under the existing transaction/runtime authority                                                 | Input/claim identities and acknowledged outcomes; `runInTransaction` closures remain local                                                               |
| `DeepChatMemoryIngestionProjectionTable` and Memory tables                                  | `readCurrentRange` observes Tape and projection heads in one SQL statement; claim/tombstone checks, revisions and ingestion progress retain their existing owner-side consistency | Bounded current-range observations and existing Memory operations, with stale/current results; never split head checks from their rows                   |
| `AgentRepository`, `DeepChatAgentRepository`                                                | Agent deletion checks protected/session state, retires Memory claims/directives, clears audit and deletes the Agent in one transaction                                            | Agent identity and deletion receipt; namespace-retirement callbacks remain in the same owner                                                             |
| `LiveDelegationRepository` and its service/runtime                                          | Capacity observation, contract identity, turn/event writes, effect intent and terminal settlement/CAS                                                                             | Existing authorized delegation commands and correlated outcomes; mutation callbacks and capacity reads do not become independent RPCs                    |
| `CronJobsRepository`                                                                        | Due-run insertion and schedule advancement, run claims and job/run/delivery deletion                                                                                              | Existing bounded Scheduler commands and snapshot; the 100-job scan and owner-side committed dispatch remain unchanged                                    |
| `ProjectService`                                                                            | Environment removal clears Session project assignments and updates project/preferences/projection together; directory selection commits project activation after native selection | Selected path and acknowledged versioned Project snapshot; native dialogs/open-path operations remain desktop capabilities                               |
| `SyncReplicaStore` and composition guards                                                   | Authorization/session-deletion guard, conflict checks, trigger suppression, imported rows, tombstones and peer cursor advancement                                                 | Validated bounded sync batch and result; authenticated transport establishes authority, not a caller-supplied callback                                   |
| Settings, Provider, MCP and ACP database adapters                                           | Configuration identity/CAS and acknowledged mutations remain with their business owners                                                                                           | Explicit public snapshots and mutations; no raw Store, table, row getter or database handle                                                              |

Project bootstrap receives absolute system/profile directories and nullable Documents/Home paths
from Main. Capture these roots before serving snapshots; do not await native directory discovery
between synchronous settings and database reads. Directory selection and open-path operations use
required asynchronous host capabilities. Main supplies the existing DeviceService and shell adapter,
including native lookup failure diagnostics; Project retains candidate ordering, managed-directory
fallback, persisted revisions and its original transaction boundary. No native constructor fallback,
second settings writer or row-level transport is introduced. G5 moves this owner with its shared
database/settings authority and transports only native selection/open commands and plain results.

Hook configuration, subscriptions, event enrichment and command ownership move together. Supply
the application version at composition instead of importing Electron for payload metadata. A
command's bounded diagnostic result is distinct from native child/stdio closure: timeout or an
error report cannot release that lifetime. Stop rejects new commands, kills existing children and
waits for both accepted enrichment and actual child closure. A 30-second drain failure rejects
maintenance/shutdown before Store teardown, and restart rejects while prior work remains owned.
Main must await this critical stop directly. Preserve command timeout results, redaction, event
eligibility/order, cancellation before enrichment completes and no automatic replay of uncertain
effects. Retain Node command execution with the cohesive owner; it needs no Electron launch adapter.

Database readers also move with these owners. `main/session/data/sessionReferences.ts`,
`main/session/sessionHistorySearch.ts` and
`main/mcp/inMemoryServers/conversationSearchServer.ts` query the inherited shared connection;
they do not justify a second desktop read facade with schema/migration access. Keep reference
authorization and bounded search contracts at their existing operation boundary. Tape inspector
subscriptions currently combine backend head reads with renderer lifecycle hooks in Main's
composition: split the committed head data from native subscription ownership, preserving initial
snapshot admission, incarnation identity, revisions and renderer destruction cleanup. The debug
mock-session route also writes through the shared connection and must execute at the writer when
enabled. Table getters that initialize or repair schema remain backend work even on a read path.

This inventory identifies connections and atomic operation groups; it does not establish that
the corresponding owners have moved. Keep the actual Store cutover pending until remaining
configuration/desktop consumers are classified and all Main writable paths are removed.

Move scheduler claim/update transactions into backend-owned batch operations. Its utility process
may retain timers and schedule calculation, but receives snapshots and requests durable claims
from the backend. Preserve existing misfire and duplicate-run behavior. Inventory all other
connections before cutover; read-only imports and vector stores have separate explicit owners.

G4 first removes the scheduler utility process's writable shared-database connection. Its timer
requests a bounded durable operation from the current Store authority; the operation observes
schedule state, reconciles due work and commits run insertion and schedule advancement together.
Keep the existing 100-job scan limit, misfire rules, unique scheduled-run identity and executor
claim semantics. The committed run notification originates at the writer, rather than depending
on a later timer-worker reply. Bind requests and snapshots to the worker generation, allow one
scan in flight and reject stale work before effects. The timer process receives neither database
credentials nor SQL. Main remains the Store authority during G4; G5 moves that authority with
the cohesive business services and removes main's writable access.

System resume is a data-only Scheduler input. Electron main owns the native event subscription
and removes it on shutdown; it suppresses delivery during maintenance and shutdown. The Scheduler
business owner imports no Electron power API, ignores notifications while stopped, and fences
resume reconciliation by its start/stop generation before durable updates or timer dispatch.
Native subscription objects and asynchronous native-loading fallbacks stay outside this owner.

Scheduler construction requires its local manager factory; the manager requires an asynchronous,
cancelable launch capability. Main alone selects the approved timer-helper entry, arguments and
environment. The returned facade permits only Scheduler commands, data events, PID observation
and termination; it exposes no Electron process object or generic native-launch options. Stop
aborts pending startup, while manager epochs reject late completion from a non-cooperative host.
Native startup errors settle once and release their child/listeners. Recheck ownership before
post-launch reconciliation. Factories and callback subscriptions are local composition inputs,
not serialized wire payloads; G5 supplies the capability through its generation-bound adapter.

Session/Tape/Memory Store contracts expose the existing atomic business operations and bounded
projections. Keep internal synchronous repositories, SQL and transaction callbacks local to that
authority. These are not wire operations. In particular, Tape/projection-head observations,
pending-input settlement and Memory cursor/CAS operations cannot become independently timed
remote reads and writes. Maintenance commands own their active/source/staged files explicitly
and fence consumers before changing the active writer or encryption state.

The Session data owner supplies one `clearTranscript` command that deletes pending inputs and
transcript projections and resets Tape in the same transaction. Runtime preparation precedes
that command; runtime cleanup follows its successful commit. Retry truncation retains the atomic
transaction in `SessionTranscript.deleteFromOrderSeq` and invalidates runtime projections only
after it commits. The main composition passes these business operations; transaction callbacks
remain private to the data owner.

Desktop consumers receive a versioned snapshot of the configuration fields they need. Mutations
are acknowledged by the backend before snapshots/events advance. Keep synchronous reads local to
that snapshot; do not turn every `SettingsStore.get` into RPC. Bootstrap-only legacy settings and
encryption metadata retain a documented file owner. Ownership applies to the physical file as
well as its keys: two processes writing different keys through whole-file serialization can still
overwrite each other's updates. Atomic rename does not provide inter-process read/modify/write
serialization.

`AppSettingsDbBackedStore` routes sensitive/portable keys to SQLite and other keys to the existing
legacy `app-settings` file; its `store` getter merges both. G5's profile owner controls that file
along with the database-backed configuration authority. Main may perform the existing default/
migration bootstrap only before an exclusive handoff; it stops file writes before the backend
accepts ownership. During normal operation Main receives allowlisted public snapshots and awaits
acknowledged mutations. It must not keep a second ElectronStore writer, including for unrelated
UI keys. Preserve file format, defaults, migrations and machine-local backup exclusions. Backend
business readers keep owner-local synchronous reads; native UI reads use acknowledged snapshots.

The private native-consumer projection includes resolved language, notification enablement,
close-to-quit, content protection, shortcut mappings, floating enablement/bounds and the logging
flag needed by Main diagnostics. Native system-theme observation stays in Main. Keep the public
settings projection separate from these internal consumers. Derive committed values at the
configuration owner, fence snapshots by owner generation/revision and install the initial snapshot
before dependent native initialization. Existing events alone are insufficient: floating bounds
currently persist without an event, and shortcut changes use their own event. Every affected
mutation must acknowledge its committed value. Convert floating-bound persistence and its error/
shutdown handling together; replacing a synchronous setter with an ignored Promise loses failures
and pending writes. Updater channel defaulting can write configuration, so normalize it at the
configuration owner from an explicit version fact rather than inside a Main snapshot getter.

Construct the application settings file through the same pinned Conf engine used by ElectronStore,
with required absolute profile/home directories and an explicit application version. Main supplies
those bootstrap facts and uses that factory in the actual startup path. Retain `app-settings.json`,
defaults, dot-path semantics, default migration behavior and atomic writes; no replacement JSON
writer or second cache is needed. Declaring the already resolved engine directly makes backend
construction independent of Electron. The database-backed adapter still owns sensitive/portable
keys after attachment. This factory alone does not transfer ownership: G5 must close Main's writable
access and hand the existing file/database authority to the backend before it begins normal work.

Configuration consumers include Agent defaults/prompt/trace/migration state, Provider-specific
options, Session usage backfill, Project preferences, Skill/Knowledge/Hook/Remote settings, Sync,
Nowledge/export, onboarding and file/Tool limits. Some getters normalize or migrate and write
state, and Nowledge cleanup enumerates the merged store; those operations remain owner-local.
Desktop theme/fonts/window/login, proxy application, updater and renderer logging retain their
native effects in Main. The selected AppSettingsService/public-route snapshot remains a public
projection, not a transport for the merged store or credential-bearing Remote/Hook/Nowledge data.
Desktop appearance and login commands share the settings owner's bounded serial queue. Native
theme/login observations and language/theme refreshes return awaited plain data or completion;
the host receives the resolved locale/color rather than calling back into a pending core command.
Resolve system language from the explicit process bootstrap locale. Query login state from the
OS only when requested, and publish a login mutation's observed OS result rather than a stored
preference. Preserve display receipts' previous value inside the same command ordering boundary.
Main owns the system-theme listener; its coalesced observations use that queue and are fenced
during maintenance. Stop admission and drain actual host work before closing configuration
storage; an expired drain cannot authorize teardown or a second owner. Resume observations after
maintenance and remove the native listener at shutdown. These contracts prepare the G5 handoff;
they do not establish a second writable desktop configuration cache.

Font enumeration and logging-folder access are awaited native capabilities. Keep font family
normalization and selection persistence with configuration; preserve the current normalized catalog
cache and empty-catalog degradation. Font queries and folder requests enter the same bounded
settings owner as mutations, so shutdown drains actual native work rather than an abandoned reply.
Main owns the existing font-list implementation and private profile/logs path; no renderer-supplied
path or replacement platform enumerator is needed. Propagate a native folder-open error instead of
acknowledging an unsuccessful launch. Content-protection and logging changes await their native
effects before publishing success. Main coalesces logging and content-protection changes into one delayed restart request,
pauses its timer during maintenance without losing the intent, resumes after successful recovery,
and cancels it on shutdown. Once fired, restart authority belongs to the existing Main shutdown
coordinator; draining configuration must not wait on its own restart teardown.

Storage business owners receive explicit runtime directories rather than importing Electron to
discover them. SyncSettings requires the absolute home directory for its unchanged default folder.
SyncService requires absolute profile and temporary directories for configuration/database files,
archive extraction, staged backup copies and validation. It awaits Main's folder-open capability
and propagates both native rejection and a returned error before acknowledging success. Main keeps
the native shell effect; no database connection or file writer is added there. Backup snapshots,
configuration import, rollback and active/source/staged connection lifetimes remain with the
existing maintenance owner and move with the shared writer at G5.

LegacyChatImportService requires its absolute source path. Main supplies the existing profile
chat.db path; the importer retains read-only source access and writes through the existing shared
target facades. KnowledgeService receives its absolute DuckDB extension directory from Main and
passes it to every database create/open path. Main performs the existing ASAR-unpacked resource
resolution. Preserve VSS loading/fallback, schema/migrations, task recovery and independent Knowledge
files; these files are not Memory's G3 vector stores. These boundaries add no alternate database
engine, implicit native fallback, separate supervisor or second profile owner.

Plugin installation, consent, user-plugin activation, context Hooks and MCP supervision stay with
their business owners in the cohesive core. Hook history and execution share Tape authority;
registration and tool authorization share the same supervisor. Their synchronous internal reads,
update leases and integrity callbacks are local operations, not candidate row-level RPCs.
The plugin owner uses the existing Conf format, defaults and independent `plugin-settings.json`
file with explicit profile/home/application/resource/working directories and application version. It is
the only writer of installation and launch-safety metadata; do not merge it with tool policies or
leave a writable Main shadow at G5 handoff. Supply the resolved command environment locally.

Main owns plugin settings windows and shell presentation through required asynchronous capabilities.
The core awaits native effects; closing a settings window acknowledges its actual closure, and
the renderer-to-plugin ownership lookup remains private to Main. Preserve package validation,
integrity/quarantine, user consent, credential scoping, rollback and uncertain-hook recovery.
Maintenance and shutdown reject new context-hook work, abort and drain accepted work before Tape
teardown; resumption cannot overtake that drain. This preparation does not establish G5 process
ownership or grant third-party Rutis access.

Plugin tool policies have one explicit business owner with a required local persistence adapter.
Main constructs the existing `plugin-tool-policies` file after the effective profile is selected;
PluginService, MCP ToolManager/AppHost and ToolService use that same owner. Preserve the existing
policy array and owner/server replacement, owner-wide removal, allow/ask/deny, undeclared-tool
closure and ambiguous/disabled-owner semantics. Reads expose decisions or denied tool names, not
the backing Store. No module-level native construction or implicit global lookup remains.
Keep current synchronous policy decisions and mutations local to their shared authority; G5 moves
the policy state with its execution consumers and supplies acknowledged commands to any retained
desktop writer. This extraction does not substitute a cached policy shadow or synchronous IPC.

Split crypto from persistence: the backend stores wrapped credentials; Electron main performs
authorized wrapping/unwrapping. Send unlock material only through the private transient channel
to the approved core generation. It must not enter command arguments, environment variables,
persisted loader configuration, logs, or crash diagnostics.

Credential crypto uses an async desktop port with string/boolean results; Electron objects and
native buffers remain in its main-process adapter. The pinned runtime's native async safeStorage
operations must open existing synchronous ciphertext. Retain opaque wrapped-value storage and
keep reads free of credential rewrites. Lifecycle generations fence in-flight crypto results
across maintenance and shutdown, with authoritative checks immediately before sensitive return
or persistence. Await every Sync, MCP, plugin and export consumer; preserve destination binding,
serialized mutations, rollback and cancelled connection-attempt identity.

MCP OAuth receives its private credential path, secure async crypto and browser-open capability
from Main. Interactive and enterprise identity flows share one credential owner. Preserve v1/v2
envelopes, bounded records/payloads, Linux basic-text refusal and memory-only behavior. Serialize
acknowledged writes and binding-key moves; publish the existing decrypted record cache only after
persistence succeeds. Initial decrypt is single-flight, and reads do not rewrite v2 envelopes.
Reserve eight of 32 pending mutations for control commands; ordinary writes use at most 24.
Stop bypasses the queue and fences pending native results. G5 must frame legal large envelopes
within bounded transfers rather than raising the gateway limit or truncating payloads.

Keep loopback callback validation synchronous: expose only the issuer and issuer-parameter policy
from acknowledged public discovery metadata. Never use an asynchronous credential read as a void
callback validator. Finalizing discovered server identity is an owner-local compare-and-set command
against server ID, generation, binding hash and endpoint; preserve concurrent unrelated settings.
Profile updates re-read current metadata after credential cleanup and reject replacement of the same
profile. Runtime stop/restart effects carry the originating server/profile lease through awaits;
logout, replacement and shutdown invalidate old SDK providers and delayed callbacks. Preserve
settings-window credential permissions, registered callback compatibility and exact issuer checks.
Plugin-owned connection changes use their existing supervisor. Carry the originating auth lease
through its probe, integrity/recovery and native launch waits; finish owned cleanup after canceled
startup, and never bypass that owner through generic MCP stop routes.

Provider-specific Codex/Grok credential owners receive explicit private paths and the existing
async string-only crypto port. Preserve their v1 encrypted/plain-file envelopes, corrupted-file
backups, fsync/rename commits and file fallback policy; it differs from MCP's memory-only fallback.
Bound each file/envelope to 16 MiB and each normalized/decrypted payload to 8 MiB. Serialize at most
24 normal and eight reserved control mutations, fence in-flight reads against queued mutations,
and coalesce only pending reads rather than retaining plaintext tokens. Shutdown bypasses queues;
failed durable credential removal cannot produce a successful logout acknowledgement.

Provider auth owners receive browser interaction explicitly and fence pending browser/device login,
refresh, status events and token return across account replacement, logout and stop. Keep endpoint
restrictions, refresh sharing, API-key fallback and single 401 retry. Synchronous runtime-provider
construction carries public configuration only. Resolve Grok credentials in its existing async
fetch adapter or direct trusted request immediately before building request headers; do not add a
plaintext credential snapshot to preserve synchronous helpers. Keep global initialization and
shutdown explicit at the actual composition, without default native Store construction.
Carry the originating auth scope through token acquisition and recheck before request dispatch or
401 refresh; cancellation and replaced owners cannot become API-key fallback. Status reads may retry
once after an observed account transition, and newer status publications supersede delayed reads.
Each auth owner admits at most 32 HTTP requests. Bound auth response bodies to 8 MiB using declared
and streamed sizes, and retain cancellation and the existing request deadline through body reads.

Sync host connector tokens and peer pairing tokens use asynchronous string-only crypto ports
through the same adapter. Their opaque values stay in existing private machine-local files and
remain compatible with legacy ciphertext. Keep Linux basic-text refusal and preflight protection
before consuming a pairing code. Cancelled pairing cannot replace the saved identity before its
atomic commit; stale reads cannot release credentials after re-pairing, forget or shutdown. Transfers
recheck cancellation after unwrap and before authenticated requests. Host lifecycle serialization
and generation checks reject crypto results superseded by stop before starting a connector.
Do not cache plaintext, rewrite credentials during reads or add them to general settings/backups.

Database security receives its database path, owner-local encryption metadata and asynchronous
native crypto explicitly. Its SQLCipher copy, validation and file replacement stay with the
database owner; Main owns unlock presentation and application quit. Metadata keeps the existing
file shape and opaque native ciphertext. At G5 its one writable facade moves with the owner;
it must not become synchronous RPC to a second Main writer. Maintenance-authorized encryption
uses the native crypto adapter independently of the paused ordinary credential store.

Hold the per-file migration lock through native preparation and commit. Prepare wrapped target
metadata before closing the writer, then retain the original database until target reopen and
metadata persistence both succeed. Roll back both on runtime failure; stop fences pending native
results before password validation, return or mutation. A second migration or metadata repair
cannot enter while preparation is pending. This runtime rollback preserves the existing startup
file-recovery policy; it does not provide crash-atomic commit across the database and metadata
files. Durable cross-file recovery belongs to the conditional Store compatibility project.

Live maintenance uses explicit data commands for verified backup-file import, named backup import,
encryption enable/change/disable and schema repair. Keep one exclusive admission through pause,
drain, operation, reopen, reconciliation and resume; caller callbacks, SQL and database handles
cannot cross this boundary. Startup recovery runs before the normal owner exists. Normal business
transactions and maintenance snapshot/staging connections stay internal to the Store owner moved
in G5, including any synchronous closures that never cross an ownership boundary.

Ordinary request admission shares the maintenance owner's state. Refuse new and not-yet-executing
ordinary requests while maintenance is active; retain only audited native presentation/status
operations. Drain admitted finite operations before closing or replacing the writer, with a bounded
failure path that keeps the existing database. Maintenance command requests cannot wait for their
own acknowledgement as ordinary work. CLI alternate ingress paths participate too; an event
subscription's initial database snapshot is finite work, while subsequent in-memory event forwarding
is not a database lease. Detached background effects keep their own explicit lifecycle ownership.
Track actual handler completion independently of a startup task's reply promise: cancellation can
reject that reply before the handler exits. Recheck the original task signal before execution, and
retain running-handler ownership through cancellation. Bound request drain to 30 seconds before
maintenance dispatch; a timeout must leave the current writer in place.

Main startup work has a separate actual-completion lifetime from its reply. Before maintenance
pauses or recreates services, cancel the Main startup target and drain running callbacks, including
callbacks from an already canceled run. Pending work never executes and releases its deduplication
entry. Keep immediate cancellation replies and existing resource-lane limits. A 30-second drain
failure rejects maintenance before service teardown or writer replacement and restores ordinary
admission; it must not revive or duplicate a still-running startup owner. Background migrations are
scheduled again after successful maintenance or on the next launch.

Shutdown closes ordinary admission and background availability before teardown. Cancel and drain
actual startup callbacks before disposing their service dependencies, then drain ordinary requests
and the actual database-maintenance owner before closing the writer. Keep completion-only ownership
for maintenance, including verified-peer commands; do not retain command results or credentials.
The two device commands that await shutdown before restarting or resetting data cannot wait for
their own request lease. Their existing validation and exclusive shutdown-action claim still apply.
CLI authorization completes before dispatch and retains its ordinary lifetime for those commands.

A maintenance operation interrupted by shutdown must not reopen the database, reconcile runtime
state or resume background services. Recovery-triggered shutdown starts only after that operation
releases its own lifetime. Critical completion barriers have bounded failure paths and propagate
failure before writer close or a terminal action; best-effort cleanup must not swallow them or claim
successful ownership release. These are lifecycle deadlines, not performance acceptance budgets.

### Public routes and desktop capabilities

Reuse existing shared route names, schemas, caller types, and output projection. Classify each
route as desktop-owned, backend-owned, or an explicit orchestrated operation. A proxy is registered
only for the audited backend allowlist. Audit `z.custom` and non-JSON values instead of assuming
every current route is already a complete wire validator.

Electron main validates the actual IPC sender/document or CLI connection, constructs the caller,
and forwards that identity. The backend revalidates input and applies domain permissions. Caller
identity, `internal` authority, and approved desktop capability names cannot come from a renderer
payload. Preserve plugin-settings route ownership and renderer-destruction cancellation.

Desktop ports cover real operations such as OAuth browser interaction, crypto, approved helper
launch, and targeted approval presentation. They do not expose an Electron module, a generic
method dispatcher, arbitrary eval, or an unrestricted secret/settings store. Permission and
approval lifecycle state stays with the backend Run; main transports authenticated human answers.

Skills receive explicit home, temporary, user-data and ordered bundled-resource directories at
bootstrap, plus an asynchronous directory-open capability. Settings defaults, temporary imports,
rollback paths and plugin-source checks use those supplied directories. Discovery, filesystem
mutations and scoped operation leases remain local to the Skill owner. Native watcher creation
stays behind its existing injected service; importing its pure request-ID helper must not load
the Electron host. Shared console diagnostics are platform-independent and retain captured sinks;
the desktop entry supplies the development debug flag. Moving a Skill owner must not introduce
Electron imports through logging or utility barrels, a second service instance or a native fallback.

The desktop entry owns legacy settings-file construction and supplies the current application
version to configuration migration and Provider initialization. The shared settings wrapper must
not import Electron or construct a native store. Provider model facts and user overrides require
the existing database-backed stores at construction; no runtime helper may silently create legacy
JSON storage or replace its storage authority after use. Legacy JSON import remains a startup
operation that completes before module settings attach to the one database writer. Catalog-cache
bootstrap and other native configuration domains require separate explicit ownership before G5.

MCP and ACP settings receive their initial storage explicitly; pure default builders retain the
existing platform-specific server defaults and ACP migration format. Main constructs native
bootstrap files before import and database attachment. After attachment, MCP configuration uses
its database adapter. ACP enabled/version/shared MCP selection also use the database; its legacy
registry/manual/install metadata becomes an isolated read-only snapshot for import and fallback
reads. Live Agent changes already use the unified Agent repository. Remove unused legacy mutation
entrypoints and reject writes through the attached legacy projection. Normalize legacy ACP data
before the migration snapshot, and transfer the configuration/database owner together at G5
without retaining a writable Main shadow.

Provider catalog bootstrap receives its profile cache directory and bundled catalog file from
Main. Importing model capability/settings modules performs no native path lookup or cache I/O
before this bootstrap. Packaged catalog bytes live outside ASAR so ordinary Node can read the
same file. Keep one catalog/cache owner, privacy-aware automatic refresh, existing payload/TTL
bounds and single-flight refresh. Initial catalog loading performs no network work. Automatic
refresh belongs to the existing Main idle Provider task, including its maintenance cancellation
and drain; a canceled task cannot publish or write a late response. Shutdown cancels every refresh,
fences late cache writes/events and waits for actual completion before disposing dependent owners.
Provider request metadata
is a plain bootstrap header snapshot beside the existing locale capability. Token exchange and
HTTP failure sanitization must not import the native Copilot device-login window.
Ollama model pulls receive the existing TLS debug policy from Main through the Provider environment
port. Keep the native development/explicit-debug decision at the host; a backend import must not
load Electron to evaluate it. Production certificate-validation policy is unchanged.
Shared image-cache reads/writes use the existing trusted `DEEPCHAT_USER_DATA_DIR` process bootstrap
set by Main, require an absolute profile directory and have no native/home-directory fallback.
Retain all path, symlink, size, cancellation and remote-address checks. This removes an image
mapper's transitive Electron dependency without changing cache location or granting new access.

ACP connection/session execution receives application version, home and temporary directories as
plain host bootstrap values. Thread these through the existing lazy runtime owner to its process,
terminal and persistence owners. Keep shell/environment expansion pure and share it with MCP;
remove native lookups from the shared helper. Preserve workspace containment, controlled temporary
fallbacks, launch/toolchain selection, terminal output bounds, persisted links and process cleanup.
This preparation does not relocate ACP execution or its native PTY binding to another process.

MCP client execution receives an absolute home directory, application version and the existing
toolchain owner explicitly from composition. Preserve command rewriting, live toolchain selection,
PATH precedence, environment binding isolation and process cleanup. Each registry probe batch awaits
the current resolved proxy URL through the host capability, preserving system/custom proxy and
authentication behavior without importing the native proxy module. Neither the client
nor its server manager may construct a native dependency or locate a process-global toolchain.
This boundary does not relocate MCP execution or its AppHost presentation owner.

Core runtime constructs one native-free MCP App registry beside source and tool authorization
owners. Count pending creation against the existing total and per-owner limits. The registry owns
renderer-destruction subscriptions from reservation until its final creation/view retires; an
already destroyed owner cannot publish a reservation. Window/server revocation cancels pending
creation and consent. Maintenance clears them before database drain; terminal close also fences
new reservations. Aborted observation and metadata waits retire without closing the server owner's
shared connection.

Main retains Native owner validation, link opening, protocol responses and session permission
handlers. It receives only asynchronous policy and browser-permission operations, never the
registry or its mutation methods. The fixed private Core protocol validates bounded commands and
results and shares the existing ordinary-call slots and immutable queue with public business
routes. Owner destruction uses the existing reserved Native event lane; cancellation, human answers
and status/stop retain their capacity. Accepted protocol calls join the business drain before
writer release. Native handlers recheck the current owner and deny uncertain or revoked work.
Preserve saved-source/configuration fences, separate sandbox origin/CSP, explicit per-request
consent and the absence of standing browser grants.

Desktop host queries resolve Workspace preview authorization and Provider existence through the
Core owner and its database request gate. Permission-cache clearing and shutdown-confirmation data
use fixed private commands on the existing reserved Native event lane, so ordinary call saturation
cannot prevent quit preparation. The confirmation operation returns data without waiting for a
dialog; Main owns presentation and the user's response. Knowledge has no dialog dependency or
shutdown presentation method. Accepted private operations join the business drain, and a business
denial does not masquerade as Native transport failure. Quit/update preparation awaits permission
retirement; the update request records its shutdown promise before that await. Kernel retirement
also clears permissions before stopping the local CLI server.

Only Main owns interactive message dialogs. Core has no dialog invocation or response capability;
its shutdown-confirmation result remains strictly validated data. Main retirement rejects pending
confirmations and refuses late requests before closing windows. Core loss while a CLI approval is
unanswered must close the application generation without approving or replaying the mutation.

The same Main dialog owner accepts at most 16 native file-picker requests, reusing the Native call
budget. Requests retain their selected parent and enter one FIFO; only one physical picker opens
at a time. Directory/file selection, image saving and context-menu saving use this owner. A stopped
owner or destroyed parent cannot open a queued picker. Main stops accepting dialogs, obtains the
Core shutdown fence, and awaits the native callbacks before releasing their ownership. On macOS,
the active sheet ends before its parent is destroyed; queued requests retire without opening.
Other platforms retire the parent before awaiting native completion. Do not replace a physical
completion receipt with a synthetic canceled result or extend shutdown deadlines.

File-route image save/copy uses the existing Main-owned DesktopImageActions lifetime. Main
shutdown aborts pending HTTP
headers/body and cache reads before waiting for ordinary Core calls. A retired image owner cannot
open a save picker, decode/write the clipboard or start a file write after an awaited read or
picker result. A target-file write already in progress completes before its Native receipt retires;
never cancel it midway. Existing accepted Native calls and business drains still precede writer
release. Do not serialize an AbortSignal across the Core protocol or create another request owner.

ACP installation owns explicit install/repair, enable-triggered preinstallation, uninstall and
binary launch preparation, including their repository and Provider continuations. Identical work
shares one physical download; conflicting same-Agent mutations cannot publish stale state or
recreate files after uninstall. Cancellation covers headers, bodies and extraction boundaries;
drain waits for actual settlement before database maintenance or close. Canceled work restores its
previous acknowledged install state only while it still owns the pending state. Background
admission uses the existing local database gate, which moves with the Store in G5. Prepare,
validate and chmod a replacement in a managed staging directory before activating it; download or
validation failure preserves the installed binary. Keep archive traversal/checksum guards and the
120-second download timeout. Enable acknowledgement remains prompt. This does not establish
power-loss durability across filesystem activation and SQL publication or move synchronous
extraction out of Main.

Background command execution keeps its existing dedicated helper and process/session ownership.
Main supplies an approved absolute helper entry and cancelable launch capability; the business
owner accepts a plain command/event/lifecycle facade with no Electron fallback or path guesses.
Tool, Bash and Skill consumers receive the same owner explicitly. Stop rejects new work before
canceling helper startup, fences requests after asynchronous authority checks, compensates a late
spawn and awaits actual callback settlement. Child identity attestation, conversation isolation,
permission/journal commitment, output offloading and owned Skill package cleanup remain intact.
Root shutdown requests current Harness generation cancellation before stopping the command owner,
so a rejected helper startup cannot begin another model round while the app is already stopping.
Helper loss can restart on subsequent ordinary work; terminal shutdown cannot reopen it. Native
process objects remain inside Main's adapter. G5 supplies the corresponding backend-owned launch
capability without exposing arbitrary process-launch IPC.

Code Mode receives its approved helper launch through a required host capability. Main owns the
absolute helper entry, native events and per-host RSS sampling; preserve the restricted environment,
64 MiB heap, unsigned-library policy, protocol/READY deadline and memory/output limits. Reserve a
session before asynchronous startup. Caller cancellation keeps a prompt receipt while the owner
retains physical startup and compensates a late helper. Shutdown closes admission, cancels pending
startup and waits for actual startup, RSS and nested-tool callbacks before Store teardown. Sampling
coalesces per cell and cannot act after that cell stops. Preserve session-scoped state, permission
retry, capability/journal identities and existing result/yield semantics. No optional native
fallback, process object, raw metric list or generic PID/launch endpoint crosses the boundary.

File watching keeps its existing content and Git helpers, pooling, fallback modes and restart
policy. The Core composition owns Workspace and watcher clients; Main supplies an approved
absolute helper entry and a cancelable command/event/lifecycle capability. The client has no
Electron import, implicit launcher or path search. Register startup ownership before invoking
the Native launcher so synchronous shutdown cannot miss it. Terminal shutdown fences new watches and
restarts, cancels pending startup, ignores retired-host events and waits for actual helper exit.
A shutdown RPC acknowledgement or kill request alone does not prove process retirement.

Workspace retains path authorization, preview grants, file/Git operations and invalidation
production with that Core composition. Main supplies acknowledged reveal/open and installed-app
selection/launch operations; preserve path checks and the installed application allowlist. The
native preview protocol queries the Workspace owner asynchronously and denies unavailable or
revoked authorization. Main owns scheme registration and response streams, without a second
preview registry. Register desktop work before Native dispatch. Stop admission and drain accepted
desktop effects, revoke root/exact-file
grants, and recheck authorization after asynchronous file preparation before returning a preview.

AgentToolManager receives absolute system/profile temporary roots and an asynchronous image-size
operation through its required desktop capability. Main owns app-path discovery and nativeImage;
only width/height values leave the adapter. Preserve the existing allowed runtime directories,
default workspace creation and temporary-root fallback, file/symlink authorization, image preview,
metadata failure fallback and vision selection. Carry cancellation through the image probe and
recheck before image caching or Provider work; a late result cannot start those effects. The
business manager has no native import or implicit native host construction. This capability does
not expose a new generic file-read or root-discovery route to renderers or external plugins.

File preparation remains with its Node-capable business owner: MIME detection, document/image
adapters, validation, generated-name temporary image writes and message-file projections.
Require its absolute profile directory at construction and await temporary-directory creation when
writing. Keep adapter instances internal and expose no arbitrary profile write/delete operation.
Preserve existing size, token, PDF routing and symlink
read checks. Main owns image save dialogs, clipboard decoding/writes and native network image
retrieval as a separate desktop action capability. Route those UI actions directly to Main rather
than looping through the backend. Preserve data-URL/raw/cache/HTTP image handling, MIME and filename
rules, cancellation responses and actual-byte saves; nativeImage values never leave that owner.
Main's image-cache access is read-only, and a save writes only the native dialog's selected target.
This split adds no generic filesystem route, replacement image engine or gateway-size increase.

Remote's channel/session policy, channel clients, attachment handling and binding/configuration
authority move together. RemoteConversationRunner requires its profile image/generated-asset roots
rather than discovering them through Electron. Actual downloads and decryption remain with the
co-located clients/Runner using their existing fetch implementations, timeouts and file-preparation
policies. ChannelAdapter contains lifecycle/events, with no native network dependency or unused
base64 download API. Preserve the active call chain; do not introduce a per-download host RPC or
a new global size cap for methods that no consumer calls.

Keep attachment bytes local to this business owner during G5's process move. A later, actual
cross-host/device transfer must define bounded authenticated artifact/staged operations before
adoption. Do not return a Response, stream or oversized base64 control frame, enlarge the gateway
limit, silently truncate legal files or replay a lost download. CLI ArtifactSpool's human/Agent
principal is not channel authority: never fabricate a human CLI caller or borrow unrelated
artifacts. Bind any selected transfer to its trusted request/channel/backend lifetime, reserve
bounded capacity before reading and retain actual cancellation/cleanup ownership.

Main owns Feishu/Weixin native login windows; the Remote owner retains auth/session state, callback
server, nonce, expiry and credential/configuration commitment. Native capabilities carry plain
operation IDs, URLs and closed/error events, never BrowserWindow/WebContents objects. Preserve
Feishu's brand/redirect navigation rules, popup denial and isolated secure web preferences.
Register an operation before awaiting native startup, fence late opens/close events by generation
and operation identity, compensate a late native open after cancellation, and drain callback-server
and window cleanup before owner teardown. Native events cannot synchronously re-enter a pending
business command. Native module loading alone does not complete Remote's cutover.

The selected desktop login adapter owns Feishu/Weixin BrowserWindows behind asynchronous
operation-ID open/close commands and closed/error events. Authorization starts reuse Remote's
existing serialized runtime queue. Stop closes admission, aborts owner signals, fences late
registration/login results and waits for actual startup, polling, callback and native-close work;
initialization waits for that stop before admitting a new owner lifetime. A late native open is
closed by its original operation identity. No BrowserWindow, Response or app secret crosses this
port. Main also closes any retained native windows during teardown.

Feishu retains its loopback server, nonce, TTL, token/user exchange and pairing commitment in Core.
Cleanup waits for active callbacks and response completion, then closes partial-header connections
and acknowledges server release. User window close remains cancellation even when destruction
rejects navigation before the native closed event; a load failure in an active window remains an
error. Native navigation and popup rules and isolated web preferences remain explicit. Weixin
login polling carries owner cancellation through HTTP timeouts and poll sleeps, retires canceled
QR sessions and cannot commit credentials after stop. Profile image/generated-asset paths are
derived from Main's explicit absolute profile directory; the workspace default is queried through
an asynchronous owner port. The complete Remote module can import and initialize in ordinary Node;
G5 still has to move its actual composition and authenticated host-capability wiring.

ACP registry ownership includes its manifest, icon cache and acknowledged repository/Provider
updates. Main supplies absolute profile/built-in directories and an asynchronous icon-text
capability; the core receives no Electron Response or native object. Retain the existing URL,
SVG, privacy, TTL and request-timeout policies. Package one registry/icon snapshot outside ASAR
and remove implicit app/cwd path lookup. Local initialization performs no network work. The
existing Main startup task owns automatic refresh; manual refresh remains within route ownership.
Keep refresh single-flight, carry cancellation through icon work, and recheck before cache writes,
repository effects and event publication. Terminal stop aborts work; drain waits for actual
completion before database disposal. A canceled startup task cannot write after maintenance,
while a new task or manual request can still use the live owner.

First-party configuration selects the core entry and service exports. Rutis dependency injection
and scopes are not authorization. This migration introduces no arbitrary third-party Rutis code
loading or untrusted peer access. Existing `.dcplugin` and portable user-plugin behavior retain
their reviewed package, consent, ownership, and execution contracts.

Provider OAuth presentation stays in Main while the Core facade owns sign-in target selection,
access validation and acknowledged credential commitment. The private target retains Provider ID,
public client ID and opaque configuration identity at its owner. Native authorization receives only
the public client ID and cancellation scope; it receives no Provider settings mutation capability.
The acquired credential returns to Core for validation and the generation-checked Provider command.

Codex/Grok login controllers, callback/refresh state and credential queues stay with their Provider
consumers. The Core OAuth facade uses their asynchronous status/login/callback/cancel/logout
commands without introducing another controller or writable credential store in Main.
Keep synchronous load-error/revision observations inside each controller's existing authority.
Native browser opening and crypto remain explicit host capabilities, with the existing public
auth status schemas and stop/drain behavior.

Native deep-link actions receive an asynchronous provider-existence query instead of Provider
settings. Validation finishes before the settings preview opens; saved Provider credentials stay
at the business owner. MCP installation deferral uses Main's observation of acknowledged Core
startup, with latest-pending semantics. Reset this observation when stopping, and reject a late
startup acknowledgement after shutdown or maintenance admission closes. Readiness observation is
presentation state; actual MCP configuration and execution authority remain in Core.

Core compares and commits in one command without an await between reading current configuration
and writing. The identity covers Provider ID, protocol, current credential and normalized client
ID using a private per-runtime key. It rejects targets from another runtime, stale concurrent
logins and malformed tokens while merging unrelated current settings. This identity detects stale
configuration; authenticated caller grants remain a separate G5 requirement. Maintenance rotates
the identity key; stopped runtimes reject queries and writes. Main fences late query/validation
results during shutdown and aborts token validation. Existing registered Copilot/Codex/Grok routes
keep their schemas; no generic OAuth fallback or unregistered loopback login server is retained.

### Gateway and event flow

The cohesive Core runtime constructs local-control authorization, the shared approval broker,
command/file/settings permissions, programmatic parent/child dispatch, audit and CLI server wiring.
CLI Run, compute, audio, OCR and Skill requests execute against those same local service owners
and the database request gate. Keep the one Agent token authority and artifact spool shared with
Provider/tool execution. Desktop presentation supplies trusted approval-target discovery and
acknowledged request/close delivery; it does not construct a parallel authorization policy.

Toolchain discovery and demand, OCR execution/attachment routing, startup migrations, deferred
initialization, Provider warmup and background persistence tasks compose with Core's consumers.
Main supplies explicit roots, the wrapped OCR cache-key capability, native floating-window startup
and structured startup-error delivery. Preserve startup task identities, cancellation/drain and
the actual failed run identity, including a new run after database maintenance. Skill and ACP
migrations finish before ordinary renderer/background admission. Native presentation retains its
existing owner; these composition boundaries alone do not prove physical Core adoption or the
headless CLI horizon.

Native Window, Tray, Notification, Shortcut and floating-widget readers use a private committed
configuration projection. Its explicit allowlist contains resolved language, notification,
close-to-quit, content-protection, shortcut, floating-widget, diagnostic logging, privacy and
update-channel values. Nested shortcut and bounds objects are allowlisted too. Never copy the
merged settings Store or credentials into this projection. Publish it immediately after the
configuration write, before native effects or ordinary settings events; native effect callbacks
must not query the pending configuration command again. Main reads native theme state directly.

The projection carries an owner identity and monotonically increasing safe-integer revision,
rejects foreign/stale snapshots and returns defensive copies. These fences do not establish a
cross-process readiness or owner-replacement protocol; G5 must authenticate adoption of a new
backend generation. Main's projection is neither a writer nor a public renderer snapshot.
Floating bounds use an acknowledged owner mutation, with no optimistic cached update. Validate
the current floating window and its main frame before accepting drag writes. Stop native write
admission before draining the configuration queue and outstanding native writes for maintenance
or shutdown. Floating enable/disable awaits actual native completion within the same serialized
configuration command, so a queued disable or Store close cannot overtake window creation.
Update-channel normalization remains with the configuration owner; Main supplies the application
version, native updater and diagnostic-file lifetime explicitly.

The selected sixteen-field application settings projection uses one Main presentation revision
sequence across snapshots, mutation replies and `settings.changed` events. Renderers retain this
revision and accept values per key, so late replies cannot reverse newer fields or discard unrelated
partial values. The sequence lasts for Main's lifetime and its renderer contexts; it is not a durable
database revision. Refresh the allowlisted projection after database maintenance and reject new
operations while maintenance or shutdown is active.

Agent display changes use one validated asynchronous data-only mutation and an acknowledgement
with the native owner's previous/applied value. Keep skill authorization and durable dispatch
commitment at the Agent owner. Settings navigation awaits the Native delivery receipt before
reporting success; a negative or failed receipt reports `open_failed`. This capability carries
only typed settings navigation, without a generic window-channel endpoint.
G5 routes portable preferences directly to the backend configuration
owner and native device effects to Main; a Core-to-Main-to-Core mutation loop must not replace
direct ownership. Other configuration entry domains and host capabilities still require their own
G4 boundaries. Neither a second settings writer nor cached secret values belong in this projection.

The application gateway carries request, reply, cancel, event, and readiness/control messages.
Every message identifies a protocol version and host epoch; requests/replies also identify a
request ID. A core generation change invalidates outstanding requests, subscriptions, and desktop
capability leases from that generation. Keep Session IDs, Run IDs, message IDs, and Tape
incarnations as their existing separate identities.

The initial private Core bootstrap link uses the existing 64-KiB control frames and a separate
one-shot Core generation. Its four work slots reserve one for audited cancellation and human
interaction routes; up to three ordinary calls run concurrently. Main snapshots queued renderer
requests with a combined limit of 64 entries and 64 MiB, and drains the two lanes independently.
Under queue pressure, an incoming control request can reject unsent ordinary work with an explicit
non-admission outcome; accepted work is never displaced or replayed. Main rechecks the original
Native sender/document when accepting queued work and immediately before sending it, including
after an asynchronous carrier write. This local authorization closure is never serialized.
The authenticated Native IPC entry constructs renderer identity; the private link rejects CLI or
internal identities, which remain local to the Core CLI/runtime owners. Core revalidates route
input and lane selection against the owner-local registry. Public business dispatch requires
acknowledged Kernel startup, including migrations and service activation. Cold assembly does not
grant business readiness. Two additional call slots remain reserved for status/stop and one for a
coalesced system-theme observation. Untracked business routes do not query Native window roles;
ordinary presentation queries cannot delay cancellation or approval solely for startup accounting.
Terminal stop fences queued work and drains accepted route continuations, Native effects and
startup activation before releasing profile ownership.
The observation queries Native
theme state, serializes with configuration and repeats once for a notification received during
an active observation; it does not carry a caller-supplied color or retry an unknown outcome.
Up to sixteen reverse Native calls are tracked independently. Native replies
are settled independently of Core request execution, so profile startup can await a Native effect
while stop/status remain callable. A dropped reply does not release a profile or a Native write.
Status has a 5-second observation deadline and stop has a 30-second observation deadline; expiry
does not retire the operation, release its slot or authorize another owner. Status and stop each
have a reserved slot. Profile unlock/recovery may await human input without a timing budget.

Native helper callbacks use one additional reserved Core call, independent of ordinary work and
theme observations. Ordered batches carry at most 32 generation-bound helper events over the
existing carrier transport. The five fixed kinds are background execution, Code Mode, Scheduler
and content/Git watching. Main retains approved launchers and owned-host RSS sampling. Launch
selects a fixed helper kind, not an executable entry; RSS addresses an opaque owned helper instead
of an arbitrary PID. Existing helper messages retain their data/authorization contracts. Track startup before
dispatch, compensate canceled/late startup and await actual process retirement. Queued commands
and events have count/byte bounds; overflow fences the generation without uncertain replay.
An open reply acknowledges admission. A separate opened/failed event settles the original host
capability; cancellation after admission can retire a launcher that has not returned yet. Exec
retirement uses the owned Native host's asynchronous kill receipt, covering physical helper exit
and profile-scoped attestation/recovery of its registered command roots. Keep an exited helper in
the Native owner until this recovery settles, including unexpected helper loss. The execution
service waits for that receipt before shutdown or replacement startup. Owner-scoped registry
reads reject unreadable/corrupted records; age does not authorize discarding live owned records.
Native hosts replay a recorded exit to late subscribers, and register retirement before a
synchronous exit callback can reenter it.
Exec startup awaits durable identity registration before acknowledging a live command. Failed
registration retires the owned command and rejects startup; already exited commands retain their
normal output/completion behavior. Failed retirement rejects command removal and shutdown instead
of treating local output finalization as physical exit. Shutdown rejects subsequent starts,
including starts whose identity observation was still pending.
Legacy POSIX termination keeps the acquired process-group target after the root closes, waits
for group exit and physical stdio closure, and escalates the same group if members survive TERM.
It never falls back to the old root PID after acquiring a group. Unknown liveness is not an exit
receipt. Exec finalization, package cleanup and registry removal wait for this single termination
receipt; root exit/close and inherited-stdio watchdogs cannot bypass it. Failed tree retirement
remains failed when a late root close arrives. This does not authorize later signaling after the
group has been released, or prove containment of descendants that leave that group.
On macOS, the existing Rust artifact also provides a bounded read-only process-identity command
before starting Tokio or Rutis. Main supplies its absolute packaged/development artifact path to
owned workers. Records backed by a live owned child use the boot-session UUID and XNU process unique ID, which survives
exec; executable UUID and pidversion are deliberately excluded. Native identity loss refuses
recovery without downgrading the recorded identity to timestamps. Legacy records and platforms
retain conservative start-time/argv attestation; an argv mismatch alone never clears ownership.
Registration revalidates the owned child after asynchronous inspection and before persisting its
native identity; a reaped child cannot attest a subsequently reused PID. PID-only launch callers
retain legacy attestation until they provide an actual child lifetime.
The XNU identity flavor is defined in Apple's private header and requires native/signed platform
verification. This introduces no resident inspector, alternate supervisor or renderer-facing API.
New macOS Exec roots first enter the same Rust artifact's execution gate before Tokio/Rutis
startup. A dedicated inherited descriptor carries one bounded length-prefixed environment grant
only after durable native identity registration. Command arguments are passed without a shell;
user environment overrides are withheld from the gate and applied after the grant. EOF, malformed
or incomplete grants execute no user command. The gate closes its control descriptor and execs
the requested program at the same registered PID. Caller stdin and output streams remain separate.
Core resolves command overrides against its environment into a complete launch snapshot before
Native dispatch. The reusable utility uses this snapshot as the command environment; it must not
reintroduce deleted variables or utility-only controls from its own older environment. The Rust
gate replaces its bootstrap environment only after admission, preserving shell/PATH preparation,
per-command overrides, independent stdin and same-PID exec.
Stop/timeout during registration cannot release the gate. Startup failure compensates through the
same owned termination receipt, and the pending environment is released after startup settles.
This closes the selected user-code admission window on macOS; observable pre-registration
retirement also requires the utility/owner receipts below. Other platforms remain unverified.
Different owner recoveries serialize without sharing results. Lost ancestry and complete
fd/environment/proxy retirement still require proof before G5 acceptance; registered-root recovery
alone does not establish that contract.
Native macOS termination passes its retained or recorded birth identity to the existing Rust artifact. Rust
captures a bounded group snapshot while revalidating its root and sends signals through
`proc_signal_with_audittoken`, whose kernel lookup checks the captured process version. TERM and
force target only those captured identities; neither phase falls back to numeric PID/group
signaling. Unsupported APIs, uncertain inspection, concurrent exec or surviving/new group
members refuse retirement and retain the registry record. A signal request is not an exit
receipt: termination waits for every captured birth and the group to disappear. Incomplete
captured ancestry and unobservable descendants remain outside this proof.
The system's [audit-token lookup](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_proc.c)
and [signal dispatch](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c)
define the native identity checks; availability still requires supported signed-platform acceptance.
Successful registration returns its observed identity to the existing session owner. Admitted
native commands retain that identity for explicit stop, timeout and shutdown, which use the same
Rust group recovery as helper-loss recovery. A native recovery receipt also waits for the actual
owned child's stdio close before releasing registry or package ownership. Gate admission requires
a native identity; unavailable identity cannot select legacy signaling for an admitted command.
Native root exit joins that same retirement before publishing completed status or watchdog cleanup. When the
root has exited, Rust requires every surviving group member's captured parent-birth chain to
reach the registered root birth. Missing ancestry refuses signaling and retains ownership.
Retirement also takes bounded same-user process snapshots and follows captured parent-birth
chains outside the original process group. UID alone never authorizes a signal. Captured births
remain authoritative across the TERM and force phases; each phase takes a fresh snapshot so
known descendants born during retirement cannot disappear behind a dead intermediate parent.
Final success requires no reachable captured descendant and disappearance of the original group.
Unknown inspection or snapshot overflow refuses retirement. This does not prove containment of
unobservable processes, privilege changes or ancestry lost before capture.
Main captures the Exec utility's native birth before exposing its command channel. Retirement
waits for actual utility exit, then uses that birth to retire observable descendants before command
record recovery can acknowledge closure. The utility need not lead a process group; this owner
scope never observes or signals a numerically matching process group. Missing native identity
refuses readiness, and a failed descendant receipt refuses retirement. Utility-side cancellation
before native identity closes the ungranted control descriptor and waits for actual child/stdio
closure without numeric PID/group signaling. Helper-loss recovery uses the owner birth for
observable pre-registration launches without creating another registry or supervisor.
Native records survive root loss, same-boot root PID reuse and age-based expiration. A valid
identity from another boot can be cleared without signaling a current numeric PID. Missing
ancestry and privilege changes remain separate requirements.
Logical transport failure still admits retirement and settles already accepted Native effects;
ordinary caller outcomes remain fenced and are never replayed.
The existing sixteen reverse Native calls reserve two slots for retirement commands. Ordinary
work queues at fourteen calls, with at most 64 waiting requests and 64 MiB of queued values.
Coalesce helper termination identities into batches of 32, so many cancellations cannot consume
all control slots. Stop rejects queued ordinary work and waits for accepted Native calls to settle.

Browser tool dispatch uses a fixed Native command and callback protocol on the same reserved event
lane. Core retains the dispatch-commit callback; Main supplies normalized arguments and awaits its
acknowledgement immediately before the native target. A rejected commit is a call outcome, not a
generation failure. Unknown identities or repeated authorization attempts fence the generation.
Preserve recoverable Browser-unavailable payloads and the original Core commit error. No functions,
live Browser objects or arbitrary native method names cross the link.

Register Browser ownership before admission, retain cancellation across a late admission reply and
compensate failed admission. Cancellation and close use the reserved Native retirement capacity.
Main must provide a physical retirement receipt covering Browser closure and native effects that
outlived a canceled client wait; releasing a waiting promise alone is insufficient.
Kernel shutdown retires Main's Browser owner even when no Agent Browser tool was called: public
desktop routes can own pages independently. Profile-only SDK operations do not acquire this desktop
owner. Main fences new page/preview allocation during retirement, joins each page's existing close
receipt and waits for actual WebContents destruction without a before-unload veto. A failed close
retains failed ownership and prevents profile release; a late event cannot clear a replacement page.
Main's cookie reader owns its temporary WebContents for one operation and awaits destruction even
if debugger detachment fails. Application windows and floating UI retain their Main application
owners. A floating-window registration in `TabPresenter` is a borrowed lookup for capture/context,
not another view owner or Core resource. The unused browser download service has no typed route or
Agent-tool consumer; browser-origin downloads retain their Chromium/Main application ownership.
Synchronous dispatch commits retain their current timing; asynchronous commits are acknowledged before target
dispatch, followed by fresh cancellation and target-lifetime checks. Helper and Browser events
share a serialized, count/byte-bounded queue with value snapshots, rather than competing for the
single reserved slot. Business authorization denial does not retire the event transport.

Client projections invalidate the affected model catalog cache before forwarding catalog or status
facts to consumers. A fact-triggered refresh cannot reuse a snapshot captured before that fact.

The cohesive Kernel root owns the event hub/session router, startup work, CLI token/artifact
authority and MCP Apps registry with its data, Provider and runtime composition. Profile closure
follows its terminal drain, Native-effect retirement and shared admission/Memory retirement.
Partial construction is not a successful close receipt. Configuration events share the owner's
version source, and an ordinary renderer session's `null` CLI ownership must remain distinct from
unknown/deleted ownership.

Native proxy resolution publishes a revisioned effective URL and merged `no_proxy` snapshot.
Main owns current and gracefully draining proxy dispatchers until physical retirement. Stopping
fences queued/late proxy resolutions, aborts both current and draining transport, and joins accepted
Electron resolution without allowing late dispatcher/environment changes. The Native desktop
retirement receipt includes this HTTP owner before profile release. Client references survive
Undici Agent graceful close until completion, so forced retirement can still address active clients.
Start Main transport retirement before awaiting Core shutdown: a Native request that ignores caller
cancellation must not prevent shutdown from reaching the desktop retirement receipt. OAuth acceptance
must exercise Core-owned validation through real certificate-verified HTTPS, with a disposable local
trust root rather than Main-only fetch interception. These receipts cover global fetch transports;
Chromium session networking and independently owned descriptors require their own lifetime evidence.
The SDK Kernel installs its own Undici dispatcher and proxy environment before Provider/runtime
construction, and acknowledges setting changes only after applying that snapshot. Older revisions
cannot replace newer state. Preserve the existing system resolver's single probe and first HTTP
proxy result; this is not per-destination PAC evaluation. Custom URL credentials and inherited
bypass rules remain effective, and failed resolution preserves the last committed snapshot.
Equal effective policies reuse the current pool. Replaced pools drain accepted requests while new
requests use the new policy. Kernel stop destroys current and draining pools, and awaits their
retirement before writer release. This ownership covers the global fetch dispatcher; separately
owned library/native transports keep their existing cancellation and retirement contracts.

The default application opens its profile and assembles this root in the SDK worker through
private lifecycle requests. Business readiness remains false until startup and owner activation
are acknowledged. Default handoff requires real application and Native acceptance. Its
route dispatcher and import/rekey/repair controller use the same local data/Provider/runtime owners;
Main dispatches its fixed Native route maps locally and supplies presentation effects without
database-maintenance RPC. Business routes cross bounded Core ingress with the original sender
guard. Native settings-window lifecycle and system-resume events reach the same Core startup and
scheduler owners; the Native configuration projection writes only through exact typed commands.
Startup-tracked routes retain a distinct work identity for each request. Shared progress labels
and resource lanes cannot merge business results across arguments or caller identities. Unsent full Native startup-progress snapshots may supersede the previous snapshot for the same
target. Full delegation projections may supersede an older queued revision for the same parent/
delegation identity; canonical business/CLI events retain their history. Presentation holds at
most 256 entries and 64 MiB, with one delivery receipt per accepted entry. Renderer publishers
retain no waiter per superseded snapshot. The 64-entry business ingress queue and existing Native
callback/control capacities remain unchanged. Each
accepted request executes its own authorization and handler under the maintenance/lifetime gate.
Native desktop methods come from a fixed capability table with validated arguments and event
payloads. Abort signals stay
local to each process; cancellation identifies the accepted effect and waits for actual settlement.
Completed cancellation identities are released after their original call settles. Renderer watches
share one Native subscription per renderer and retain registration and unsubscription receipts.
Native closure fences new effects and acknowledges physical retirement before profile release. An explicit Core
shutdown fence pauses credential/security mutations and execution before Main closes windows;
final profile release still waits for accepted Native effects. Activation queues public business
requests under the existing bounds until readiness is acknowledged.
The standalone harness includes its Node module closure, platform native packages and separately
bundled Skill scan worker; it must not rely on the development checkout's node_modules.

Plugin route ownership queries await a typed Native result. Main's sender authorizer reads its
synchronous native window registry and accepts only a concrete owner identity; promise/object
results cannot establish renderer authority. Copilot credential-target selection, access validation
and commitment stay in Core. Native browser/device authorization returns its acquired credential,
and physical cancellation/closure must be acknowledged before default Core adoption. Each Copilot
login owns its window, timers and HTTP work. Core fences new logins and drains target reads,
authorization, access validation and accepted credential writes, including when sibling account
retirement fails. Native cancellation propagates into requests and waits for actual owned-window
closure and underlying response-stream cancellation. A destroyed frame's closure receipt retires
its local navigation/script effects when their replies are lost; external browser effects retain
their own acknowledgement. No timeout or abort flag substitutes for either receipt.
Device flows use independent operation state and serial polling with one expiry lifetime. Polling
honors the minimum interval and server slowdown from the
[GitHub device-flow contract](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).
The temporary instruction page can copy only its current code or the fixed GitHub device URL and
can open only that URL. Browser callbacks require the configured endpoint and nonce; authorization
codes and nonce-bearing URLs are not logged. Both native windows retain context isolation and web
security. Existing native window presentation deadlines and transport limits remain unchanged.

Accepted login-shell initialization belongs to runtime shutdown. Concurrent reads share its
process, stopping fences late environment/state refresh and timeout waits for actual process/stdio
closure. An asynchronous Native storage-availability check must settle before Sync token wrapping.
Optional Computer Use preview eligibility may await Native state without holding the completed
tool response; validate current policy and cancellation again before its private snapshot dispatch.

Bootstrap values use Node V8 serialization, preserving `undefined`, dates and binary values. Values
up to 16 KiB stay inline in control frames. Larger values use authenticated AES-256-GCM carriers in
a generation-private 0700 temporary directory, with 0600 exclusive files, unpredictable identities,
direction/operation binding, a 64-MiB value limit and at most four retained files per sender. The
ephemeral key crosses only the private control link and is never written to disk or command-line
arguments. Carriers are first-party local IPC resources, not CLI artifact grants or renderer paths.
This bootstrap limit does not lower public route limits: legal larger history/tool results require
service-specific paging or transfer adaptation before public route cutover. It is not an Everywhere
network protocol. Core reports profile ownership separately from business readiness; opening the
profile alone cannot admit renderer/CLI business work. Stop must await actual initialization and
profile close. A timed-out or lost stop reply cannot authorize replacement of a live owner.

The same private Core owner composes configuration, defaults and command-shell preferences. Its
configuration commands read/update validated public settings, return the allowlisted Native
snapshot or initialize desktop presentation. Main supplies a fixed configuration capability for
theme, locale, login, content protection, floating presentation, logging, font enumeration and
snapshot/event delivery; it receives no settings store. Settings writes await the Native projection
receipt before publishing ordinary events or acknowledging success. Failed projection delivery
does not roll back a committed setting or permit an automatic retry of that mutation. Configuration
commands serialize within the existing ordinary-call budget, and their events cross as a bounded
batch of at most 64 validated envelopes. Stop fences queued configuration work and awaits active
commands and Native effects before closing the profile. These administrative commands do not
establish complete Harness readiness or grant a renderer/CLI caller direct access to the link.

Core obtains admission from the existing Rust/Rutis host over the SDK link, using the same typed
client and TS quota owner as Main. Main and the one Core generation have independent bounded
command sequences, while global capacity, per-owner fairness and permit accounting remain shared.
The host binds the Core caller row/key and generation, allows only existing admission methods and
reports its actual capacity/queue limits. Core requests stay within 64 KiB and 1,024 in-flight calls;
acquisition leaves sixteen slots for control work. Overflow retires Core admission authority and
fences new execution rather than skipping an uncertain command and continuing its sequence.
The bridge neither starts a second host nor forwards admission through Electron or file carriers.

Core shutdown closes admission before releasing its profile. Physical Core loss closes the shared
quota, rejects queued work and prevents another grant while already accepted Native work may still
be settling. Unknown permits stay fenced until supervisor retirement; a live control/status path
does not authorize replacement. Internal retirement preserves the current observation policy, and
an explicit observation flag can use the supervisor's observer without a local duplicate callback.
A transport-error reply from a lost Core is an unknown outcome for a posted mutation, even if it
arrives before the runtime-loss notification. It must not be treated as a retryable definite failure.

Core's lazy vector client uses the same Memory bootstrap and native worker through its SDK link.
The Rust host authenticates the Core row/key and generation and admits one Memory owner per host
generation: Main or Core. Another owner cannot start a second worker or take over the directory.
Core requests keep the existing 32 pending slots, eight reserved control slots, 64-KiB control and
256-KiB data bounds, staged 16-MiB uploads and 8-MiB native parts. Binary chunks use SDK byte values;
metadata must omit absent fields because SDK `undefined` becomes JSON null. This removes the Main
relay and file-carrier hop without claiming zero-copy transport or changing public payload limits.
Core-owned readiness and replies return on that SDK link; actual native death marks the client
unavailable through the host event bus. There is no automatic replay, replacement or restart.

Core shutdown drains its vector stores and asks the host to retire Memory before closing admission
and releasing the profile. Retirement fences late startup and waits for accepted startup settlement
and actual child exit; an observation timeout cannot release ownership. Physical Core loss also
retires its Memory worker. A Main-owned generation survives Core retirement. Default business
composition uses Core; Main must not create a shadow writer or replay an unknown operation. A Core
connection loss or an internal helper/Browser/desktop/HTTP owner failure retires the Native owners
and ends that application generation. Internal failure uses a single component-only Native
notification through reserved capacity. Shutdown fences and bounded lifecycle event delivery
remain available after failure; business requests do not. Expected host exit after acknowledged
retirement must not be classified as a new failure. A terminal reset or
restart action requires acknowledged Core and physical Native retirement. The complete G5 writer,
route and lifecycle cutover still requires application, fault and signed-package acceptance.

Frames and queues have finite byte/count budgets checked before allocation and parsing. Establish
production values from the route payload inventory and benchmark. Oversized legal results must
use existing paging/artifact capabilities or an explicitly bounded transfer contract; never
silently truncate a result or reduce an existing public limit. Cancellation and shutdown have
reserved capacity so progress traffic cannot block control messages.

Keep Provider streaming, tool execution, context assembly, Tape writes, queue settlement, and
Memory coordination inside the backend. Forward UI-visible progress in bounded batches where
the existing event contract permits coalescing. Ordered facts, approvals, terminal state, and
errors cannot be coalesced away. Do not publish full transcript snapshots for every token or add
per-token service calls through the Rust host.

Main fans backend events out through existing renderer and CLI projections. Streams carry a
generation and monotonic sequence. A gap or backend change triggers authoritative bounded
resynchronization; it does not create a second durable event store or infer success from a missing
reply. Main and renderer state remain projections of backend facts.

## Everywhere application and execution boundaries

### Application clients

Keep one application command/query/event contract with transport adapters. Desktop local uses
preload/IPC; a headless local CLI uses the existing UDS/named-pipe policy; remote web/CLI clients
use an explicitly enabled HTTPS application gateway and authenticated event stream. Reuse existing
bounded event/SSE patterns where appropriate instead of requiring another protocol for ordinary
chat interaction. No public endpoint is enabled by extracting the desktop backend.

Remote exposure is an allowlist of application capabilities, not publication of every Electron
route or of the Rutis bus. Establish the authenticated client principal, profile/Session grants,
quotas, origin rules for browser access, credential expiry/revocation, and cancellation ownership
before dispatch. Network clients cannot claim a `webContentsId` or become an internal caller.
Existing local-control, sync-transfer, and native IPC credentials are not interchangeable tokens.

The renderer bridge must be supplied by the selected client adapter rather than unconditionally
read from `window.deepchat`. Reuse domain clients/types and UI code only after auditing their
desktop assumptions. Capability discovery tells clients which operations the selected host and
device can perform. Native windows, shell APIs, file pickers, CUA permissions, and OAuth presentation
need an explicit supported adapter or an unavailable result; they cannot be simulated by a browser
transport. Network input receives full validation; trusted same-app validation shortcuts do not
automatically apply to remote events.

Several authenticated clients may observe one Session. Submissions still pass through the same
backend admission/queue and permission owner. On disconnect, do not cancel an accepted Run solely
because one viewer disappeared. Cancel client-owned in-flight presentation/transfer requests
according to their contracts; explicit Run cancellation remains a separate authorized operation.
On reconnect, resume an ordered event cursor or read an authoritative bounded snapshot. Lost
replies retain the existing unknown-outcome and durable-identity rules.

### Session authority and offline behavior

Address a live Session by its authoritative Host and Session identity. One host owns its current
execution, queue, approvals, database mutation, and Tape lineage. Connecting another client does
not copy that authority. Keep the database on host-local storage; do not share a writable SQLite
file over a network filesystem or let browser clients write it.

Existing LWW device sync remains a separate mechanism for portable durable records between
independent profiles. It does not replicate active permissions, pending execution, tool processes,
or provide distributed consensus. A thin client's event cache is a projection, not a writable sync
replica. Imported history never executes tools, and reconnect never imports a client history over
an active host Session. Preserve existing sync safe-application gates.

Desktop-local operation continues offline. A client disconnected from a remote host can retain
its local view and unsent input, but cannot claim its task was accepted or executed remotely.
Reconnection requires explicit admission/deduplication of unsent work, not blind replay of a
transport queue. Starting a local offline Session creates its own authority; transferring an active
Session's ownership or merging two active executions is outside this design.

### Device capabilities and locality

An execution device is separately enrolled for a bounded capability set. Its registration identifies
the device, allowed services/workspaces, current connection generation, and availability. Reuse
existing pairing/transfer primitives where their contracts fit, but issue separate execution grants
with revocation; a paired sync device is not automatically an authorized executor.

Keep a stable backend-owned capability directory/tool boundary and bind each admitted operation
to the selected device generation. The entire core must not inject every optional device service
as a required Rutis dependency: losing a laptop must not unload the Session Host. Individual feature
plugins and resource owners may depend on their required device service. Reuse existing tool/MCP
ownership patterns rather than making all business services dynamically discoverable.

Workspace operations identify the enrolled device and registered workspace as well as a path
within its allowed root. A server path, phone attachment, and laptop project directory are not the
same resource. The authoritative host owns explicit uploads/artifacts; referenced local files stay
on their device unless an authorized transfer copies them. Do not infer file replication from a
synced absolute path. Keep local computation near its workspace/data and return bounded artifacts
or results; avoid remote calls for individual tokens, SQL statements, or internal loop functions.

Native permission checks and execution constraints run on the device that performs the action.
An approval from a remote client cannot grant OS accessibility/screen-recording permission, unlock
another device's keychain, or make an offline workspace available. Provider credentials remain with
their chosen host; unrelated execution devices do not receive the profile's secret store.

Prefer explicit direct links to the Session Host, including outbound device connections for NAT
where supported. Reuse Rutis peer/runtime transports with TLS for non-loopback links and explicit
service exports/imports. Rutis peer events travel one hop; the Session Host intentionally projects
application state to clients instead of relying on a transparent event mesh.

Keep remote plugin loading (`host: true`) disabled for ordinary device enrollment. Rutis's static
token examples and reconnect are not a complete device identity/authorization system. An embedded
identity/revocation adapter must close the matching active connection and reject re-enrollment
with revoked credentials without restarting unrelated devices. Validate every operation against
the current grant and generation, including operations already queued when revocation arrives.

A remote runtime disconnect unloads its rows; reconnect creates another runtime session and loads
them again. This is resource recovery, not continuation of its old function stack. Record remote
operation identity and settlement in the authoritative backend. A lost device reply can mean an
unknown side-effect outcome; query available durable evidence before an explicit retry. Device
loss marks the affected operation/capability unavailable and leaves unrelated Sessions usable.

## Lifecycle, replacement, and recovery

### Startup and readiness

For the desktop-local milestone, create the desktop shell and private gateway first. Establish the protocol/build compatibility
handshake and desktop capabilities, then start the core runtime. The core opens/unlocks the
database, runs existing startup recovery, and publishes readiness only after required owners are
usable. Renderers may show the existing bootstrap/loading state before business readiness.

Treat runtime process existence, plugin activation, database readiness, and model/tool availability
as distinct states. A missing required service is visible as blocked startup, with a bounded
diagnostic; it cannot leave a request waiting indefinitely.

### Replacement boundaries

The extracted Harness composition forms one core backend plugin. Admission and the bounded
vector-resource slice can move independently before that composition. Keep ordinary classes,
pure modules, and narrow ports inside their capability. Introduce additional plugin boundaries
only when they have independent startup/replacement/cleanup responsibilities and allow an old
manual lifecycle path to be removed.

Optional feature runtimes may restart independently of active Sessions when their existing
contracts permit it. A core replacement first closes admission and settles or cancels active work
through the existing lifecycle owners. Do not hot-reload the whole core on an ordinary model or
settings update. A runtime's process is a shared failure domain for the plugins inside it.

### Failure and restart

On Core loss, Main fences old-generation calls and retires the desktop generation's Native
resources before exiting with failure. The default desktop does not automatically replace the
Core or leave a partially available window running. Pending transport calls distinguish unavailable
from unknown mutation outcomes. Never automatically retry a side-effecting request because its reply
was lost. Existing durable mutation identities and recovery records decide whether work committed.

Before restarting, establish that the previous database owner and its owned descendants have
terminated. An unresponsive but live core is not a safe reason to create a second owner. Reuse
existing child-process identity checks and bounded termination. If ownership cannot be established,
refuse replacement with a diagnostic instead of opening the profile concurrently.

Only the designated supervisor may apply bounded restart/backoff to a child whose contract permits
independent replacement; the default desktop Core requires application restart. A recovered Core
uses existing Tape, pending-input, interaction, plugin-hook, and delegation recovery contracts.
Uncertain hook/tool outcomes and held historical queue items are not automatically executed again.
Do not promise uninterrupted generation across a process crash.

### Shutdown and database maintenance

Native quit cancels pending and future startup unlock/recovery requests before awaiting startup
completion and resolving its shutdown owner, including the splash-close transition. Intentional
startup cancellation releases the profile without a startup-failure dialog. Update-install preflight
also waits for startup before retiring Core. An interactive window must not permit startup timing
to bypass the Core shutdown owner.

Close new admission before cancelling or draining active work. Complete business settlement while
its storage is available, release owned tasks/connections, checkpoint/close the database, and then
stop the runtime and host. Apply bounded deadlines with explicit failure outcomes. Rutis invokes
registered cleanup; it does not implement business drain/fence semantics.

Database maintenance uses the same ownership boundary: quiesce all writers and relevant helpers,
drain/fence Memory and Runs, perform the operation in the backend, reopen/reconcile, refresh
snapshots, and restore admission only after readiness. Preserve current rollback and failed-state
behavior. The four Agent fence semantics and deterministic pending-input feedback loop remain.

Fence credential operations before awaiting Native configuration pause or Provider/ACP preparation.
Preparation recovery reopens credentials and admission only after Native resume acknowledges;
concurrent shutdown keeps the old generation fenced. An uncertain pause fails the owner rather than
restoring writes against an unacknowledged Native state.

## Deployment and compatibility

- Pin the compatible Rutis crate/SDK/runtime versions together; never fetch a runtime at app boot.
- Package the Rust host and first-party runtime closure as release-owned artifacts with integrity
  verification. Apply existing macOS signing/notarization to the added executable and test the
  packaged Electron launcher, its fuses, ASAR paths, and native modules.
- Preserve six Electron targets: macOS arm64/x64, Windows arm64/x64, and Linux arm64/x64. Upstream
  `v0.16.0` provides no Windows ARM64 host binary. Building and exercising the application-owned
  Rust host/runtime on that target is a release gate, not assumed support.
- Preserve the existing offline core startup and profile isolation. Optional language runtimes
  continue to use explicit existing toolchain selection when a feature needs them.
- Validate headless artifacts independently with their declared Node/native dependencies, host-local
  storage, credential backend, and service supervision. They must boot and operate without an
  Electron installation; desktop packaging tests do not establish this property.
- Keep remote application ingress, Rutis device links, data sync, and local IPC as separately
  authenticated surfaces. Remote deployment is explicitly configured and adds no automatic public
  listener, tunnel, credential sharing, or hosted service requirement to desktop local mode.
- Keep public renderer/CLI contracts and stored data compatible. Update maintained contracts only
  when their implementation actually crosses the new boundary.
- After successful cutover, remove the obsolete main business composition and duplicate lifecycle
  paths. Do not ship two concurrently usable database owners or a permanent implementation switch.

## Feasibility gates and acceptance

| Gate                | Required evidence                                                                                                                     | Current evidence                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Runtime launch      | Rust host loads a compiled plugin through the upstream runner using packaged Electron, exchanges async calls, cancels, and shuts down | Default SDK Kernel and six-target packaged application checks pass at `1719f8075`                                        |
| Platform extraction | OAuth, crypto, MCP Apps, helper launch, and desktop snapshots work through narrow ports without backend Electron-main imports         | Default Native bindings/lifetimes and six-target package checks pass; original integrated foreground case passes locally               |
| Storage ownership   | One mutation authority, preserved transactions, scheduler claims, encryption, backup/rekey/import and maintenance recovery            | Default profile/writer/routes/lifecycle run in Core; local exclusivity, maintenance and recovery checks pass                 |
| Failure behavior    | Core/host loss, lost replies, stale callbacks, full queues, and shutdown cannot create duplicate execution or two profile owners      | Core loss, shutdown/helper/Browser faults and profile exclusion pass at their recorded application/package scopes        |
| Responsiveness      | Repeated baseline/spike measurements show improvement beyond baseline variance under the same backend-heavy workload                  | Fixed-Mac sustained pair records input-paint/EventTiming and Main loop samples; lower Main footprint, higher total footprint/CPU; no speedup claim |
| Distribution        | Offline, signed/packaged launch and cleanup work on every supported target                                                            | All six verification packages pass; signed/notarized and complete offline distribution remain release gates                                 |

Everywhere delivery has additional gates beyond desktop separation:

| Horizon             | Acceptance scenario                                                                                                                                              | Current evidence                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Headless host       | Boot without Electron, submit/query/cancel through the local CLI, close all clients, and observe the host continue according to service policy                   | Required host-port and runtime boundaries designed; no headless build                 |
| Multiple clients    | Desktop and phone browser observe one Session; a client reconnects without duplicate input, lost terminal state, or authority escalation                         | Current typed bridge seam identified; no remote application client                    |
| Device capabilities | A host performs an explicitly authorized workspace operation on one enrolled device; disconnect/revoke affects only that capability and prevents stale callbacks | Rutis remote-link behavior inspected; current sync pairing confers no execution grant |

Use the existing desktop baseline for the first milestone. Later horizons also measure WAN event
lag, reconnect/resync cost, transfer bounds, device-operation settlement, and headless idle resource
cost. Do not present browser availability as proof of mobile native execution or data sync as proof
of live Session control.

For an explicit performance adoption decision, use the same build, profile fixture, local Provider
fixture and machine for at least five paired baseline/spike runs. Other changes follow the affected
workload selection and bounded confirmation rules above. Measure idle and active workloads for the
selected comparison, including simultaneous Sessions and a
background scan. Record main event-loop delay p95/p99, renderer input-to-paint latency p95, startup
to business readiness, stream latency, aggregate and per-process RSS/CPU, IPC bytes/queue depth, and
restart-to-readiness. Reuse existing performance logging where applicable; never log request bodies,
credentials, tokens, SQL parameters, or arbitrary protocol frames.

Select numeric release budgets after establishing the baseline and before judging the spike. A
result inside baseline variance is not a performance improvement. Report memory/startup costs
alongside responsiveness, and reject a topology that buys negligible isolation at disproportionate
cost. Renderer-local layout/rendering bottlenecks require their own work.

## Remaining engineering questions

1. Does the exact packaged Electron/Rutis runner combination preserve local transport, crypto,
   cancellation, and native-module loading on all targets? Prove it before moving production data.
2. Which desktop configuration fields need bootstrap snapshots, and which route payloads need
   bounded transfer? Resolve the inventory before defining the production wire budgets.
3. Does one core process provide sufficient isolation, or does measured background work justify
   a separate feature runtime? Additional processes require measurement or an independent recovery
   requirement.
4. Can the same core boot under the headless Node host with a real secret/configuration adapter
   and no Electron imports? Prove this before promising unattended server deployment.
5. What exact application capabilities are exposed to remote clients and to each enrolled device?
   Freeze the grant, resource-locality, and disconnect contracts before enabling network access.

These are bounded technical investigations, not permission placeholders or assumed capabilities.

## References

- [Rutis v0.16.0 release](https://github.com/arcships/rutis/releases/tag/v0.16.0)
- [Rutis runtime launcher](https://github.com/arcships/rutis/blob/v0.16.0/crates/rutis-bridge/src/runtime/process.rs)
- [Rutis LocalRuntime](https://github.com/arcships/rutis/blob/v0.16.0/crates/rutis-bridge/src/runtime/local.rs)
- [Rutis local transport](https://github.com/arcships/rutis/blob/v0.16.0/crates/rutis-bridge/src/runtime/spawn.rs)
- [Rutis plugin lifecycle and boundary rules](https://github.com/arcships/rutis/blob/v0.16.0/docs/guide/plugin-api.en.md)
- [Rutis Rust services and plugin exports](https://github.com/arcships/rutis/blob/v0.16.0/docs/guide/rust-host.en.md)
- [Rutis nodes, remote runtimes, security and disconnect semantics](https://github.com/arcships/rutis/blob/v0.16.0/docs/guide/nodes.en.md)
- [Electron Node-mode environment variable](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node)
- [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [Electron process memory measurement](https://www.electronjs.org/docs/latest/api/process#processgetprocessmemoryinfo)
- [DuckDB Node client](https://duckdb.org/docs/stable/clients/node_neo/overview)
- [DuckDB array distance functions](https://duckdb.org/docs/stable/sql/functions/array)
- [DeepChat local control plane](../local-control-plane/spec.md)
- [DeepChat external plugin runtime lifecycle](../plugin-external-runtime-lifecycle/spec.md)
- [DeepChat Tape layering](../tape-layering/spec.md)
- [DeepChat structured logging](../main-process-structured-logging/spec.md)
- [DeepChat device data sync](../../features/cloudflare-tunnel-sync/spec.md)
