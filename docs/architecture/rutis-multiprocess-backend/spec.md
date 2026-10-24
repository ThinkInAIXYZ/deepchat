# DeepChat Everywhere Runtime

## Status and decision

Status: module-by-module Harness migration through the application execution path.
Evidence date: 2026-10-24. Inspected DeepChat commit: `3e9948b7201c83c07dcf4903dbebce44065a39de`.
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
Performance improvement and cross-device operation remain unmeasured.

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

The Rust host exposes only the admission method allowlist over inherited pipes. Frames are limited to 64 KiB, buffered application writes to 1 MiB, and concurrent calls to 1024.
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
| Scheduler writes                 | [`schedulerUtilityHost.ts`](../../../src/main/scheduler/schedulerUtilityHost.ts) updates schedules and inserts run claims through its own database connection               | A single database mutation authority requires moving these transactions, not merely moving the main database constructor                  |
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

The bootstrap spike must demonstrate the actual launcher and runtime protocol. Successful direct
Electron execution alone is insufficient. If supported Rutis APIs cannot complete this integration,
stop at the feasibility gate and report the missing boundary before selecting a different host.

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

Move scheduler claim/update transactions into backend-owned batch operations. Its utility process
may retain timers and schedule calculation, but receives snapshots and requests durable claims
from the backend. Preserve existing misfire and duplicate-run behavior. Inventory all other
connections before cutover; read-only imports and vector stores have separate explicit owners.

Desktop consumers receive a versioned snapshot of the configuration fields they need. Mutations
are acknowledged by the backend before snapshots/events advance. Keep synchronous reads local to
that snapshot; do not turn every `SettingsStore.get` into RPC. Bootstrap-only legacy settings and
encryption metadata retain a documented file owner, without two processes writing the same key.

Split crypto from persistence: the backend stores wrapped credentials; Electron main performs
authorized wrapping/unwrapping. Send unlock material only through the private transient channel
to the approved core generation. It must not enter command arguments, environment variables,
persisted loader configuration, logs, or crash diagnostics.

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

First-party configuration selects the core entry and service exports. Rutis dependency injection
and scopes are not authorization. This migration introduces no arbitrary third-party Rutis code
loading or untrusted peer access. Existing `.dcplugin` and portable user-plugin behavior retain
their reviewed package, consent, ownership, and execution contracts.

### Gateway and event flow

The application gateway carries request, reply, cancel, event, and readiness/control messages.
Every message identifies a protocol version and host epoch; requests/replies also identify a
request ID. A core generation change invalidates outstanding requests, subscriptions, and desktop
capability leases from that generation. Keep Session IDs, Run IDs, message IDs, and Tape
incarnations as their existing separate identities.

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

Begin with one core backend plugin wrapping a genuine extracted backend composition. Keep
ordinary classes, pure modules, and narrow ports inside it. Introduce additional plugin boundaries
only when they have independent startup/replacement/cleanup responsibilities and allow an old
manual lifecycle path to be removed.

Optional feature runtimes may restart independently of active Sessions when their existing
contracts permit it. A core replacement first closes admission and settles or cancels active work
through the existing lifecycle owners. Do not hot-reload the whole core on an ordinary model or
settings update. A runtime's process is a shared failure domain for the plugins inside it.

### Failure and restart

On core loss, main remains alive, revokes old-generation capability leases, and marks business
operations unavailable. Pending transport calls fail with a distinction between unavailable and
unknown mutation outcome. Never automatically retry a side-effecting request because its reply
was lost. Existing durable mutation identities and recovery records decide whether work committed.

Before restarting, establish that the previous database owner and its owned descendants have
terminated. An unresponsive but live core is not a safe reason to create a second owner. Reuse
existing child-process identity checks and bounded termination. If ownership cannot be established,
remain unavailable with a diagnostic instead of opening the profile concurrently.

Only the designated supervisor applies bounded restart/backoff to each child. A recovered core
uses existing Tape, pending-input, interaction, plugin-hook, and delegation recovery contracts.
Uncertain hook/tool outcomes and held historical queue items are not automatically executed again.
Do not promise uninterrupted generation across a process crash.

### Shutdown and database maintenance

Close new admission before cancelling or draining active work. Complete business settlement while
its storage is available, release owned tasks/connections, checkpoint/close the database, and then
stop the runtime and host. Apply bounded deadlines with explicit failure outcomes. Rutis invokes
registered cleanup; it does not implement business drain/fence semantics.

Database maintenance uses the same ownership boundary: quiesce all writers and relevant helpers,
drain/fence Memory and Runs, perform the operation in the backend, reopen/reconcile, refresh
snapshots, and restore admission only after readiness. Preserve current rollback and failed-state
behavior. The four Agent fence semantics and deterministic pending-input feedback loop remain.

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

| Gate                | Required evidence                                                                                                                     | Current evidence                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Runtime launch      | Rust host loads a compiled plugin through the upstream runner using packaged Electron, exchanges async calls, cancels, and shuts down | Actual app admission E2E and isolated artifact-closure checks passed; signed/packaged launcher validation pending |
| Platform extraction | OAuth, crypto, MCP Apps, helper launch, and desktop snapshots work through narrow ports without backend Electron-main imports         | Dependency locations identified; extraction pending                                                               |
| Storage ownership   | One mutation authority, preserved transactions, scheduler claims, encryption, backup/rekey/import and maintenance recovery            | Shared database and secondary scheduler writer identified; migration pending                                      |
| Failure behavior    | Core/host loss, lost replies, stale callbacks, full queues, and shutdown cannot create duplicate execution or two profile owners      | Admission runtime-loss regression passes with no replacement owner; whole-core/storage fault validation pending   |
| Responsiveness      | Repeated baseline/spike measurements show improvement beyond baseline variance under the same backend-heavy workload                  | No performance measurements                                                                                       |
| Distribution        | Offline, signed/packaged launch and cleanup work on every supported target                                                            | Local macOS arm64 builds and copied closure validated; signed release targets pending                             |

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

Use the same build, profile fixture, local Provider fixture, and machine for at least five paired
baseline/spike runs. Measure idle and active workloads, including simultaneous Sessions and a
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
- [Rutis nodes, remote runtimes, security and disconnect semantics](https://github.com/arcships/rutis/blob/v0.16.0/docs/guide/nodes.en.md)
- [Electron Node-mode environment variable](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node)
- [Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [DeepChat local control plane](../local-control-plane/spec.md)
- [DeepChat external plugin runtime lifecycle](../plugin-external-runtime-lifecycle/spec.md)
- [DeepChat Tape layering](../tape-layering/spec.md)
- [DeepChat structured logging](../main-process-structured-logging/spec.md)
- [DeepChat device data sync](../../features/cloudflare-tunnel-sync/spec.md)
