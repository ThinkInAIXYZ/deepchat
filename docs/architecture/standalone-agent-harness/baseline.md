# Standalone Agent Service Headless Baseline

Stage 0 record for [Standalone Agent Service Architecture](./spec.md) and its
[development plan](./plan.md). It freezes the execution owner, the identifier boundary, the capability
classification, the portable-import boundary, and the environment state that decides what Stage 0 can
and cannot claim. It adds no production code and no protocol implementation.

## Scope

In scope: what is true at the checked revision — who owns execution today, which capabilities can be
promised headlessly in the first version, which identifiers a client may see, what the import boundary
actually permits, and the exact status of the minimum headless scenario.

Out of scope: package layout, transport selection, wire encoding, credential migration UX, and every
Stage 1–7 implementation. Those remain in [spec.md](./spec.md) and [plan.md](./plan.md).

## Checked revision and environment

| Item | Value |
| --- | --- |
| Checked commit | `7e758abee08e3926b69a3dc8aed42f0fb7f5e69c` — `fix(agent-service): harden detail value reads` |
| Architecture baseline in that history | `4c07c5bb0` — `docs(agent-service): define standalone architecture` |
| Stage 1A contract in that history | `1a228768a`, `864e950c8`, `4a4ac1e54`, `7e758abee` |
| Branch carrying this record | `docs/standalone-agent-stage0` — documentation only |

Environment observed on the recording machine:

| Component | Required by the repository | Observed | Assessment |
| --- | --- | --- | --- |
| Node | `>=24.18.0 <25` (`package.json` `engines`) | `v22.22.0` | not compliant |
| pnpm | `>=10.34.5 <11` | `10.34.5` | compliant |
| Electron (declared) | `43.6.0` (`devDependencies`) | `43.6.0` in `pnpm-lock.yaml` | compliant |
| Electron (installed) | `43.6.0` | `41.10.4` in `node_modules` | drift |

The installed tree does not match the lockfile. Three consequences matter for this stage:

1. A headless run on this machine is not a compliant validation, because Node is two majors below the
   declared range.
2. Native module resolution is not in the state the repository describes. The application database is
   `better-sqlite3-multiple-ciphers`, so an ABI mismatch is a plausible cause of any failure that
   looks like a code defect.
3. Any scenario result produced here would be attributable to the environment rather than to the code
   under test, so it cannot be reported as a pass.

## Current execution paths

### Desktop built-in path

```text
renderer composer submit
  -> preload typed bridge
  -> main route (sessions / chat)
  -> AgentManager.resolveSessionBackend(sessionId)      src/main/agent/manager/agentManager.ts
       kind 'deepchat'
  -> DeepChatAgentBackendPort implementation            src/main/agent/manager/deepChatAgentBackend.ts
  -> harness public barrel                              src/main/agent/deepchat/harness/index.ts
  -> DeepChatAgentHarness                               .../harness/deepChatAgentHarness.ts
  -> DeepChatLoopEngine + context/queue/interaction     .../loop/deepChatLoopEngine.ts
  -> provider runtime + session DB + tools + MCP + memory + skills
  <- typed events back to the renderer
```

Every element above runs in the Electron main process. The single composition root is
`src/main/app/composition.ts` (3597 lines), reached only through `src/main/app/mainProcess.ts`, and it
constructs the provider runtime, the credential store, the application database, MCP, memory, skills,
plugins, notifications, tray, native previews, and the V1 local-control CLI surface, and tears them
down again.

### Direct ACP path

```text
renderer -> main route -> AgentManager.resolveSessionBackend -> kind 'acp'
  -> DirectAcpSessionBackend                      src/main/agent/manager/directAcpAgentBackend.ts
  -> ACP runtime (process, PTY, persistence, registry)
       src/main/agent/acp/runtime/acpProcessManager.ts    (imports app from electron)
       src/main/agent/acp/runtime/acpTerminalManager.ts   (imports app from electron)
       src/main/agent/acp/runtime/acpSessionPersistence.ts (imports app from electron)
  <- external ACP agent owns its loop, model requests, and tool execution
  <- permission request: the agent asks, the Desktop UI decides, the decision returns
```

`DirectAcpSessionBackend` is a peer. It never enters `DeepChatLoopEngine`, and the built-in service
must never route an external ACP agent through its own loop.

### Current CLI path (V1, unchanged by this plan)

`src/main/cli/**` is a transport, formatting, and local file-I/O client hosted by the running Desktop
application: HTTP semantics over a Unix domain socket on POSIX and a named pipe on Windows, with a
launcher that fails closed when the application is not running. It is a migration input for a
compatibility adapter, not the target architecture.

## Identifier and ownership matrix

| Identifier | Definition site | Scope today | Client-visible | Target owner |
| --- | --- | --- | --- | --- |
| `AppSessionId` | `src/main/agent/shared/agentSessionIds.ts` | one app session; selects the backend kind | yes, through session routes | service; semantics unchanged |
| `submissionId` | `src/shared/contracts/routes/chat.routes.ts`, `sessions.routes.ts` | renderer-scoped: namespaced per `webContents`, at most 32 active per owner, used for cancellation only (`src/main/session/submissionCancellationRegistry.ts`) | yes | service submission identity with an explicitly defined idempotency scope |
| internal execution `runId` | `src/main/agent/deepchat/loop/loopRun.ts`, `loop/ports.ts` | one loop execution inside the harness; used for generation fencing and stale-snapshot rejection | **no** | stays internal; never crosses the contract |
| legacy CLI run identifier | detached-run identity of the V1 local-control surface (`../local-control-plane/spec.md`) | Desktop-hosted CLI runs | yes, V1 only | compatibility adapter only; must not become the new protocol's run identity |

Rule for Stage 1: `submissionId` cannot be reused as a durable service idempotency key without
redefining its scope, because today it is created and cancelled per renderer rather than per service.
A renderer-scoped cancellation token is not evidence that a submission was or was not executed.

## Capability inventory and first-version allowlist

The classification is of capabilities, not of interfaces that merely exist.

### `headless-required`

| Capability | Owner today | Notes |
| --- | --- | --- |
| provider/model request, streaming, usage | `src/main/provider/**` | includes provider and model settings resolution |
| agent loop, context assembly, compaction | `src/main/agent/deepchat/loop/**`, `.../runtime/**` | |
| multi-turn session state | `src/main/session/**` | |
| session lifecycle create/read/list/delete | `src/main/session/**`, `src/main/agent/deepchat/instance/**` | |
| text and file tools | `src/main/tool/agentTools/agentFileSystemHandler.ts`, `agentFffSearchHandler.ts` | host-safe only after a real execution test in Stage 3 |
| controlled bash/process | `src/main/tool/agentTools/agentBashHandler.ts`, `src/main/agent/shared/process/**` | the service owns authorization and results even when execution happens in a child process |
| cancel, queue, steer | `DeepChatAgentBackendPort` (`cancelGeneration`, `queuePendingInput`, `steerActiveTurn`) | |
| event persistence, transcript, Tape | `src/main/events/**`, `src/main/tape/**` | |
| interaction and approval state | `src/main/agent/deepchat/runtime/interactionCoordinator.ts`, `interactionParkingRegistry.ts`, `src/main/tool/permission/**` | the service validates, blocks, and continues; a trusted client supplies the decision |

### `headless-optional`

Not promised in the first version. Each entry joins the allowlist only after a service-host dependency
audit and a real execution test without Desktop.

memory (`src/main/memory/**`, `src/main/agent/deepchat/memory/**`, `agentMemoryTools.ts`), skills
(`src/main/skill/**`), MCP (`src/main/mcp/**`), cron (`cronJobTool.ts`), question (`questionTool.ts`),
image generation (`agentImageGenerationTool.ts`), code mode (`src/main/tool/codeMode/**`), tool search
(`toolSearchTool.ts`), editor and apply-patch (`minimalEditorAdapter.ts`), plan (`agentPlanTool.ts`),
Tape tools (`agentTapeTools.ts`), chat settings tools (`chatSettingsTools.ts`), live delegation
(`liveDelegationTool.ts`).

### `desktop-capability`

Must report unavailable, and must fail closed when invoked. Never silently succeed.

CUA and previews (`computerUsePreviewPresenter`, `yoBrowserPresenter`, `agentPreviewCoordinator`,
torn down in `src/main/app/composition.ts`), native window interaction and renderer approval
presentation, OAuth through a BrowserWindow (`acpAuthService`, MCP OAuth), desktop notifications
(`WindowNotificationRouter` and the semantic notification projections), tray (`TrayPresenter`),
global shortcuts, and native OCR assets (`src/main/ocr/lightOcrProcessHost.ts`,
`src/main/ocr/ocrRuntimeAssetResolver.ts`).

### `out-of-scope` for this architecture

TUI and terminal scrollback, interactive shell, TCP listener or multi-tenant daemon, CLI
self-approval (`--yes`), migration of every existing plugin, two database owners for one profile, and
merging direct ACP into the built-in loop.

### First-version allowlist

The first-version allowlist is exactly the `headless-required` set above, and every entry in it is a
release decision that must pass a real headless execution test. Nothing in `headless-optional` is
promised by the existence of a type, a route, or a tool registration.

Stage 1A already fixes the vocabulary: `AGENT_SERVICE_CAPABILITIES` in
`src/shared/contracts/agent-service/common.ts` names 15 capability ids, and an unavailable capability
must appear in the set with an explicit reason and an optional `requiredClient` — an omitted
capability is rejected, because a client that only inspects the set could not tell an omission from
support.

## Resource ownership

| Concern | Current owner | Target owner | Evidence |
| --- | --- | --- | --- |
| Provider runtime, upstream calls, usage | composition root | Agent Service | `providerRuntime.shutdown` step in `src/main/app/composition.ts` |
| Credentials | composition root through `SecretStore` | Agent Service through a host `CredentialStore` | `src/main/config/secretStore.ts` imports `safeStorage` from `electron` at module scope |
| Application database | `src/main/app/databaseInitializer.ts` — the only production construction site of `MainDatabase` (tests open `:memory:` instances) | Agent Service, one owner per profile | `src/main/data/mainDatabase.ts` |
| Execution-affecting config and settings | composition root through the settings store | Agent Service; Desktop-only window preferences may stay local | |
| MCP servers | composition root through `McpService` | Agent Service, helper processes allowed | `src/main/mcp/index.ts`; `mcpService.shutdown` step in composition |
| Child processes and PTY | composition root through `backgroundExecSessionManager`, the ACP process/PTY managers, and the code runtime | Agent Service | `toolService.shutdownCodeRuntime`, `backgroundExecSessionManager.shutdown` steps in composition |
| Memory | composition root through the memory service | Agent Service, after the dependency audit | `memoryService.dispose` step in composition |
| Skills | composition root through the skill service | Agent Service, after the dependency audit | |
| Approvals | Electron main plus renderer presentation | Agent Service validates and blocks; a trusted client decides | `src/main/tool/permission/**` |
| Events and recovery | composition root through the typed event hub and session event router | Agent Service owns epoch, cursor, and resync | `src/main/events/typedEventHub.ts`, `src/main/events/sessionEventRouter.ts` |
| Shutdown | `src/main/app/mainShutdownCoordinator.ts` drives an ordered teardown list owned by composition | Agent Service owns its own teardown | see below |

Recorded teardown order in `src/main/app/composition.ts`: code runtime, plugin service, MCP service,
semantic notification projections, CUA preview, browser preview, agent preview coordinator,
background exec sessions, memory service, provider runtime, ACP runtime, then ACP auth last. Ownership
of shutdown follows ownership of construction, so moving the composition root in Stage 3 moves this
entire list with it, and any capability that stays behind must be an explicit lease.

The single-ownership invariant follows from the database row: one profile has exactly one composition
root today, and Stage 3 must preserve that property when the root moves out of Electron.

## Portable import boundary evidence

Two read-only probes were run against the checked revision to answer "can a clean Node consumer import
this?".

| Probe entry | Resolved modules | Reached Electron | External packages |
| --- | --- | --- | --- |
| Harness public barrel — `src/main/agent/deepchat/harness/index.ts` | 323 | **yes**, through `@electron-toolkit/utils` into `electron` | application graph |
| Loop Engine module — `src/main/agent/deepchat/loop/deepChatLoopEngine.ts` | 45 | **no** | `zod`, `tokenx` |

Provenance: the module counts are bundler-resolution results from the Stage 0 probe, resolved with the
repository path aliases (`@/`, `@shared`) and `node_modules` treated as external. The probe was
temporary and has been removed, so the numbers are recorded here rather than reproducible from a file
in this commit, and they shift with resolver configuration. The structural conclusions are
corroborated at source level below.

What that means:

- The current public Harness entry is **not** portable. Importing it pulls Electron into a plain Node
  process, so Stage 2 must introduce a package barrel that does not reach `@electron-toolkit/utils` or
  `electron`.
- The loop engine's own graph is lightweight and does not reach Electron directly. Extraction is not
  blocked by third-party dependency weight; it is blocked by the composition and host couplings
  listed under resource ownership.

Source-level corroboration verified directly at the checked revision:

- `src/main/config/secretStore.ts` — module-scope `safeStorage` import from `electron`, with the
  unavailable branch throwing `sync.error.safeStorageUnavailable`.
- Runtime `electron` imports inside the agent and session graph:
  `src/main/agent/acp/runtime/acpTerminalManager.ts`,
  `src/main/agent/acp/runtime/acpProcessManager.ts`,
  `src/main/agent/acp/runtime/acpSessionPersistence.ts`,
  `src/main/agent/acp/catalog/acpRegistryService.ts`,
  `src/main/agent/shared/process/rtkRuntimeService.ts` (`app`);
  `src/main/agent/shared/process/backgroundExecSessionManager.ts` imports `UtilityProcess` as a type.
- `app.getPath('userData')` default-path ownership spread across runtime owners:
  `src/main/plugin/index.ts`, `src/main/sync/index.ts`, `src/main/mcp/oauthCredentialStore.ts`,
  `src/main/remote/conversation/runner.ts`, and `src/main/appMain.ts`.

## Minimum headless scenario

Definition, unchanged from `plan.md`: at least two turns, where the first turn invokes one supported
tool and its result is fed into the next model request, with no Desktop round trip.

Status at the checked revision: **not executed to completion, and therefore not claimed as passing.**

What was attempted: a manually driven, temporary two-turn probe including one tool call, run on the
available machine. No compliant green result was obtained, and none is asserted.

Why the result is not claimed:

1. The toolchain is not compliant. Node `v22.22.0` is outside the declared `>=24.18.0 <25`, so any
   outcome would be attributable to the environment rather than to the code under test.
2. The installed Electron (`41.10.4`) does not match the lockfile (`43.6.0`), so native module
   resolution — including the `better-sqlite3-multiple-ciphers` database — is not in the state the
   repository describes.
3. There is no headless composition root to run the probe against. The only root is
   `src/main/app/composition.ts` inside Electron, and the credential module imports `safeStorage` at
   module scope, so a plain Node process cannot even reach the credential path.

Owner and resolution path:

- **Environment drift (Node, Electron, lockfile).** Owner: the developer-environment owner for this
  repository. Resolution: install the declared Node major, then `pnpm install --frozen-lockfile` so
  `node_modules` matches `pnpm-lock.yaml`, and confirm with `pnpm run typecheck` plus the
  agent/session Vitest suites. Stage 0 acceptance depends on this step.
- **A genuinely headless probe.** Owner: Stage 3, `feat(agent-service): add standalone host`. Until a
  Node-constructible host exists, the two-turn/tool-continuation scenario can only be demonstrated on
  the Desktop path, which proves that the loop performs tool continuation but not that it does so
  without Desktop.
- **A repeatable probe procedure.** No probe is committed, deliberately: the temporary probe was
  removed and the commit policy keeps only durable tests. The procedure to re-run is the Stage 3
  acceptance scenario — Desktop never started, two turns, one supported tool, model continuation,
  durable transcript.

Because the scenario is unproven, it is not reported as a pass. `plan.md` satisfies the Stage 0
criterion only through that criterion's explicit second branch — a recorded blocker with an owner and a
concrete resolution path — and the reviewed-inventory line stays unchecked until third-party review
lands.

## SafeStorage blocker

`safeStorage` is an Electron-only API and is unavailable outside a full Electron runtime. Verified at
the checked revision:

```text
$ node -e "const e = require('electron'); console.log(typeof e, typeof (e && e.safeStorage))"
string undefined

$ ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "<same probe>"
string undefined
```

Outside Electron, `require('electron')` resolves to the CLI path string, so `safeStorage` is
undefined. A no-window Electron process that actually calls `safeStorage.isEncryptionAvailable()`
hangs instead of returning a value; that observation comes from the Stage 0 probe and was not
re-verified in this documentation commit.

Why it blocks: `src/main/config/secretStore.ts` imports `safeStorage` from `electron` at module scope
and throws `sync.error.safeStorageUnavailable` when encryption is unavailable. Existing profiles hold
ciphertext produced by Electron `safeStorage`, so a plain Node service cannot read them.

Consequence and required decision, unchanged from [spec.md](./spec.md): this is a **Stage 3 release
blocker**. The service must reach credentials through a host `CredentialStore` and either prove
compatibility in an isolated profile or choose a reviewed path — a compatibility helper, controlled
reauthorization, or a minimal credential helper. A plaintext fallback is not an option, and requiring
the Desktop to stay online is not an option.

This document records categories only: credential source, ciphertext location, and blocked status. No
secret, token, key, or ciphertext appears here.

## Invariants carried into implementation

These are inherited from [spec.md](./spec.md) and are not renegotiated by this baseline:

- One authoritative service owner per profile. A client must not create a second provider, MCP,
  database, session runtime, or approval authority for the same profile.
- Human and agent callers stay distinct; an invalid agent credential never falls back to a human
  descriptor.
- CLI access stays deny-by-default and scoped by session, workspace, token lifetime, quota, and
  effect policy. No `--yes`, no CLI self-approval, no fake renderer identity.
- An accepted run survives client disconnect. Unapproved connection-bound mutations are cancelled or
  expire.
- A lost submission response is not proof of non-execution, so submission identity and queryable
  receipts precede any retry of side effects.
- Event buffers are bounded; overflow, expired cursors, and restarts produce an explicit resync
  through an authoritative snapshot.
- A restart does not replay expired authority, credentials, process handles, or uncertain external
  side effects.
- Clients never read arbitrary absolute service paths; artifacts are owned, bounded, and expiring.
- A missing Desktop capability is visible in the capability set and fails closed when invoked.
- Direct ACP stays a peer and keeps its own capability negotiation.

## Stage 1 handoff

### Delivered as Stage 1A, DTO-only

Across the four commits `1a228768a` through `7e758abee`, the Stage 1A delivery is exactly one
production file and one test file; the three commits after the first only amend them.

- `src/shared/contracts/agent-service/common.ts` (460 lines): protocol version 1, service identity,
  the 15-id capability vocabulary with an availability discriminator and `requiredClient: 'desktop'`,
  the structured error DTO with bounded `message` and `details` budgets, an explicit total mapping
  onto the local-control error codes, `defineAgentServiceResultSchema`, a session reference, and a
  submission receipt.
- `test/main/contracts/agentServiceContract.test.ts` (716 lines).

It is DTO-only in the strict sense: no production module imports `src/shared/contracts/agent-service/**`
— the only importer in the repository is the contract test. There is no service, transport, handler, or
client. The three commits that follow 1A harden the schema against acceptance that would otherwise be
weaker than the contract claims: a partial or empty capability set, `capability_unavailable` without a
capability identity, unbounded error payloads, and accessor- or proxy-bearing values that escaped the
size budget.

### Remaining for Stage 1

Sub-slice rule, also recorded in `plan.md`: **1A DTO-only; 1B events/interaction/cancellation; 1C client
adapters; 1D compatibility mapping.**

| Sub-slice | Remaining work | Explicitly not included |
| --- | --- | --- |
| 1A | done — DTOs only | service, transport, handlers |
| 1B | event subscription with epoch and cursor, bounded backpressure and resync; interaction and permission DTOs; cancellation layers, submission idempotency scope, duplicate-submission semantics | execution |
| 1C | a built-in service client adapter and a direct ACP client adapter expressed in one result vocabulary, without pretending the two have identical feature sets | a merged feature union |
| 1D | additive compatibility mapping onto the maintained V1 CLI surface (`../local-control-plane/spec.md`) | replacing or redefining the V1 contract |

Stage 1 acceptance is unchanged: typecheck proves the public DTOs are serializable and free of
forbidden host and runtime types, and a fake in-process service plus a fake ACP adapter can express
send, cancel, snapshot, event recovery, interaction, and unavailable capability as one vocabulary.

## Open items carried forward

- The exact safeStorage compatibility strategy, still undecided and blocking Stage 3.
- The initial `headless-optional` allowlist and the order in which its entries are audited.
- Whether the headless host includes ACP filesystem, terminal, OAuth, and media capabilities.
- Package naming, visibility, and the wire framing library.
- Whether a separately reviewed terminal human approver is required. No `--yes` behavior is assumed.
