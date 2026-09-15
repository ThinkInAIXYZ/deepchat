# Standalone Agent Service Development Plan

This is the only execution tracker for [Standalone Agent Service Architecture](./spec.md).
Each stage is one reviewable implementation slice. A stage ends with its listed acceptance checks and
one commit. Do not start the next stage until the preceding commit is green and the owner boundary is
stable.

## Global rules

- Preserve unrelated worktree changes; never stage broad globs.
- Use the existing `src/main`, `src/preload`, `src/renderer`, and `src/shared` conventions while the
  workspace package boundary is being introduced.
- Keep Electron/native capabilities behind typed host or preload/IPC ports.
- Do not weaken authentication, caller policy, approval, input validation, or fail-closed launcher
  behavior for headless CLI.
- Keep the current Desktop path working throughout migration. A standalone service may become the
  authority only after the stage-specific cutover acceptance passes.
- No TUI, CLI scrollback UI, interactive shell, or Desktop-dependent plugin support is part of this
  plan.
- Use Node `>=24.18.0 <25` and pnpm `>=10.34.5 <11` from the repository package engines.
- Run the smallest relevant checks after each stage; run the full quality gate at the end.

## Documentation stage — Architecture and delivery plan

**Purpose:** establish the RFC, implementation order, stage boundaries, acceptance bars, and commit
policy before production changes begin. This stage is documentation-only; the Stage 0 inventory is
still required before implementation and is not claimed as complete by this commit.

### Acceptance

- [x] [spec.md](./spec.md) defines Client, built-in Agent Service, external ACP Service, Harness,
  Host, protocol binding, transport, ownership, compatibility, capability classes, and security
  invariants.
- [x] This plan defines ordered implementation slices, attention points, observable acceptance
  criteria, and a commit boundary for every slice.
- [x] The final target is explicit: Desktop behavior remains unchanged, while headless CLI supports
  multi-turn supported-agent interaction without TUI or scrollback UI.
- [x] Desktop-only capabilities such as CUA are classified as unavailable without a live capability
  provider, not silently included in headless mode.

### Commit boundary

`docs(agent-service): define standalone architecture`

## Stage 0 — Baseline and service capability inventory

**Purpose:** freeze current behavior and decide what headless mode actually promises before moving
ownership.

Baseline evidence: [baseline.md](./baseline.md) records the checked revision and environment, both
execution flows, the identifier and ownership matrices, the capability classification with its
contract-id mapping and first-version allowlist, the portable-import probes, and the unproven headless
scenario with its blocker, owner, and resolution path.

### Work

- [x] Record current Desktop and direct ACP flows from the existing backend/session-handle seams.
  Evidence: `baseline.md` "Current execution paths", traced through
  `src/main/agent/manager/agentManager.ts` into `DeepChatAgentBackendPort` (implemented by the harness,
  assembled with `runtime`/`port` by the composition root at `src/main/app/composition.ts:1922-1927`)
  and into `DirectAcpSessionBackend`, including the `sessionState: deepChatAgentHarness` host seam the
  composition root injects at `src/main/app/composition.ts:1928-1930` and Stage 2/3 must untie.
- [x] Define the public distinction between `sessionId`, `submissionId`, internal execution `runId`,
  and legacy CLI run identifiers. Evidence: `baseline.md` "Identifier and ownership matrix",
  including the renderer-scoped cancellation semantics of today's `submissionId`.
- [x] Inventory every built-in tool/plugin and classify it as `headless-required`, `headless-optional`,
  `desktop-capability`, or `out-of-scope`. Evidence: `baseline.md` "Capability inventory and
  first-version allowlist", which names the first-version allowlist, maps every one of the 15
  `AGENT_SERVICE_CAPABILITIES` ids to a class, and names every unsupported class.
- [x] Trace provider credentials, database/config writes, MCP/process children, memory/skills/hooks,
  approvals, event recovery, and shutdown ownership. Evidence: `baseline.md` "Resource ownership",
  which includes the Hooks row (`src/main/app/composition.ts:1768` construction, `hookService.stop`
  teardown at 2651) and the recorded critical-dependency teardown order in
  `src/main/app/composition.ts`, quoted as a subset rather than as the complete sequence.
- [x] Define the minimum real headless scenario: at least two turns and one supported tool call whose
  result is fed into the next model request. Evidence: `baseline.md` "Minimum headless scenario";
  defining the scenario is complete, executing it is not.
- [x] Add no production code and no speculative protocol implementation. Evidence: this slice is a
  documentation-only commit.

### Attention points

- Do not infer filesystem support from terminal support in ACP.
- Do not call a tool “supported” merely because its type or route exists.
- Identify tools that require BrowserWindow, WebContents, `app.getPath`, `safeStorage`, PTY, OCR,
  CUA, or a live renderer.
- Keep external ACP direct; it is a peer Agent Service, not a hidden provider inside the built-in loop.

### Acceptance

- [x] A reviewed inventory names every first-version headless capability and every explicitly unsupported
  Desktop capability. Status: the inventory is recorded in `baseline.md`, covers every class, and maps
  every one of the 15 contract capability ids to a class; independently reviewed at commit
  `af471dda5e59bad24816b59b0e8127e4a4f3ec47`; Stage 0 evidence accepted.
- [x] The two-turn/tool-call scenario is executable as a manual or temporary probe against current code,
  or the blocker is recorded with an owner and a concrete resolution path. Evidence: the scenario was
  **not** completed and is not claimed as passing — `baseline.md` records the blocker, its owner, and
  the resolution path, which is the second branch this criterion allows.
- [x] No behavior or source file changes are required for acceptance. Evidence: the Stage 0 commit adds
  documentation only.

### Commit boundary

`docs(agent-service): define headless baseline`

## Stage 1 — Freeze the client-facing contract

**Purpose:** define the minimum operations shared by Desktop, CLI, and future runners without exposing
runtime objects.

Stage 1 status: **closed**. The submission/interaction/cancellation semantic freeze is integrated
at `b17577182` and independently accepted. 1D was independently accepted and integrated at
`66cbb25fd`; the mapping is documentation only and does not claim runtime, transport, Desktop, or
CLI integration. This plan is the sole status tracker.

Stage 1 sub-slice rule: 1A DTO-only; 1B events/interaction/cancellation; 1C client adapters; 1D
compatibility mapping. Sub-slices land as separate reviewable commits; a sub-slice that cannot meet
its own acceptance is recorded as a blocker instead of being folded into the next one. 1D is additive
documentation: it maps the maintained V1 surface onto this contract, and it may not extend a V1 strict
payload, add an event name, add an error code, or widen the client operation vocabulary to make a
route fit. See [baseline.md](./baseline.md) "Stage 1 handoff".

### Delivery record

| Boundary | Accepted evidence | Deliverable |
| --- | --- | --- |
| 1A/1B/1C | reviewed 1C tree `7f3e1977f`, integrated as `15d7f9c63` | Serializable DTOs, event recovery, interactions, layered cancellation, client adapters and scoped contract type gate |
| Contract semantics | `b17577182`; independent Miles PASS: 46 client tests / 123 contract tests | Submission identity, duplicate/retention rules, interaction and cancellation semantics; `not_found` never authorizes resend |
| 1D | `66cbb25fd`; independent Emma PASS; Node 24 verification passed | [compatibility.md](./compatibility.md): V1 routes, 14 events, identities, cursor/resync, errors, and cutover obligations |

Reported controller verification at `b17577182` used Node 24: 384 tests plus typecheck, format,
lint, and i18n passed. This is completed evidence, not a pending semantic review, and is not a local
rerun claim. These checks remain DTO- and fake-level evidence, not a service, transport, Desktop,
CLI, or end-to-end result. Coverage boundaries and non-blocking risks are listed below.

### Work

- [x] Create typed service DTOs for handshake, capabilities, session snapshot, submission receipt,
  events, interaction, cancellation, artifacts, and structured errors. Evidence: 1A `common.ts` plus
  1B `events.ts`/`interactions.ts`, listed in the delivery record above; no host or runtime type
  appears in any of them.
- [x] Define capability negotiation and explicit `capability_unavailable` behavior. Evidence: the
  complete-set advertisement with an availability discriminator (1A), the handshake consistency
  check and `resolveCapabilityRefusal`/`resolveClientOperationRefusal` (1C, `client.ts`), which refuse
  with `requiredClient: null` unless a single consistent `unavailable` entry names a client.
- [x] Define submission identity, idempotency scope, cancellation layers, event epoch/cursor recovery,
  bounded backpressure, and resync rules. Evidence: contract semantics integrated at `b17577182`
  and independently accepted (46 client tests / 123 contract tests). The contract fixes:
  scope is `(serviceInstanceId, sessionId, submissionId)` with authorization decided first; a
  retaining binding answers the same key with the same text as the same acceptance and the same key
  with different text as `duplicate_submission` with no execution; identity and acceptance are
  retained through the queued and running lifetime, and a post-prune `not_found` never authorizes a
  resubmission; `receipt_not_retained` promises no deduplication; `running_run` cancellation does not
  delete queued submissions; `active_turn` stops the named request only and does not settle the run;
  `messagesTruncated` still requires a paged read, and the seven operations do not expose pagination
  today.
- [x] Define client adapters for built-in DeepChat service and direct ACP without pretending they have
  identical feature sets. Evidence: 1C `AgentServiceClientAdapter` with one closed operation
  vocabulary and per-capability refusals, exercised by fake in-process service and fake ACP bindings
  in the client contract test. This is the boundary and its fakes, not two runtime adapters.
- [x] Keep `AbortSignal`, callback, class instance, DB connection, Electron object, provider client,
  and absolute service paths out of serializable contracts. Evidence: the DTOs carry none, and
  `typecheck:contracts` compiles the client contract test together with the contract sources so a
  public request type that gains a host type fails the build.
- [x] Document compatibility mapping to the current CLI surface; do not replace the maintained CLI
  contract accidentally. Evidence: [compatibility.md](./compatibility.md), which maps
  `sessions.runDetached`, `runs.get`, `runs.cancel`, and `events.subscribe` with all 14
  `RUN_STREAM_EVENT_NAMES` onto this contract, names the missing client vocabulary each route needs,
  and leaves [local-control-plane/spec.md](../local-control-plane/spec.md) authoritative.

### Attention points

- The common contract is a minimum, not a union of every DeepChat method and every ACP feature.
- A lost response must be queryable, not blindly retried.
- Authentication identity comes from the transport/host, never from a request `principal` field.
- Do not add `--yes`, CLI self-approval, renderer self-assertion, or a broader route tunnel.
- The seven operations already provide `querySubmission`, `snapshot.queuedSubmissions`, and `cancel`
  with `queued_submission`. They do not provide session create/list/delete, steering, explicit queue
  management, or paged transcript/artifact reads. Each consuming stage must add a reviewed typed
  extension before depending on a missing operation; existing receipt lookup is not such a gap.
- Do not satisfy a V1 route by inventing an operation, a capability id, an event name, or an error
  code in a documentation slice. Record the gap as a blocker with an owner.

### Acceptance

- [x] Typecheck proves all public DTOs are serializable and contain no forbidden host/runtime types.
  Evidence: `typecheck:contracts` (`scripts/typecheck-agent-service-contracts.mjs`) compiles the client
  contract test together with the contract sources and fails when a public request type gains an
  `AbortSignal`, options bag, or other host type; the type gate has its own suite
  (`test/main/scripts/agentServiceContractTypeGate.test.ts`).
- [x] A fake in-process service and a fake ACP adapter can express send, cancel, snapshot, event
  recovery, interaction, and unavailable capability using the same client-facing result vocabulary.
  Evidence: `test/main/contracts/agentServiceClientContract.test.ts` (46 tests) over the 1C adapter
  surface. Scope: fakes and DTOs only — this is not a runtime transport or an end-to-end result.
- [x] Contract review confirms Desktop compatibility and headless scope are explicit. Evidence:
  independent Emma PASS for `66cbb25fd`, with the V1 routes/events and Desktop-vs-headless boundaries
  recorded in [compatibility.md](./compatibility.md); Node 24 contract checks and quality gates passed.
  This closes Stage 1's contract review only; it does not claim runtime migration.

### Commit boundary

`feat(agent-service): define client contract`

## Stage 2 — Extract the built-in execution kernel

**Purpose:** make the Harness independently constructible without changing Desktop behavior.

Starts only when: Stage 1 is closed — 1D independently accepted and integrated, with integration
green. The semantic freeze is already integrated and independently accepted at `b17577182`.

### Work

#### Stage 2.0 — ownership and transaction inventory

Before production extraction, record the owner and boundary for the loop engine, Harness facade,
`SessionStateResolver`, transcript/Tape, pending input, provider/tool runtime, event hub, memory
ingestion, ACP instance dependencies, and Desktop projection. Each item must be classified as
`kernel`, `host`, `Desktop projection`, or `ACP peer`; every new port has one implementation owner.
The inventory must also classify each operation as an awaited semantic boundary, a transactional
persistence boundary, or a non-authoritative projection invalidation. At minimum, review submission
acceptance, queued/running transitions, turn settlement, assistant persistence, Tape append, pending
interaction settlement, cancellation, invalidation failure, and restart recovery. This is a design
record, not a second runtime or repository.

#### Stage 2A — neutral runtime edges and invalidation

- [ ] Cut confirmed Electron/application value edges without moving host implementations: logger,
  ACP compatibility barrels, programmatic command-launch error identity, provider catalog source URL,
  usage-stat provider labels, and generation-settings diagnostics.
- [ ] Replace the Harness-facing `SessionUiPort.refreshSessionUi()` callback with a typed internal
  invalidation carrying the session and reason. Desktop adapts it to the existing widget refresh;
  renderer/wire events and authoritative execution events remain separate.
- [ ] Preserve provider/tool authorization, path/process semantics, generation fences, status/event
  ordering, and the existing Tape/projection transaction behavior.

#### Stage 2C — ACP state ownership seam

- [ ] Before kernel composition changes, remove `sessionState: deepChatAgentHarness` from the direct
  ACP backend (`src/main/app/composition.ts:1928-1930`). Give ACP a smallest neutral
  `SessionStatePort` implementation or adapter for the methods it actually uses. ACP retains its
  peer-specific runtime, permissions, transcript, and process lifecycle and never enters the built-in
  loop or creates a second database owner.

#### Stage 2B — portable built-in kernel

- [ ] Extract the existing facade/coordinators around `DeepChatLoopEngine`, turn/run lifecycle,
  context, queue, interaction, compaction, Tape, transcript, and recovery.
- [ ] Narrow concrete `SessionDatabase`/`SessionData` dependencies to ports that preserve required
  transaction and atomic settlement boundaries; do not expose a generic repository or database
  transaction object.
- [ ] Extract the compatibility handler's narrow projection ports as neutral host-side contracts, so
  V1 surfaces can be served outside Desktop: session metadata, text-only message keyset pagination,
  in-flight assistant messages, and root/descendant waiting. These stay out of wire DTOs; see
  [`compatibility.md`](./compatibility.md) for their obligations.
- [ ] Move CLI authority and programmatic tool authority interfaces to neutral contracts; keep CLI
  parsing/discovery and concrete authorization in adapters.
- [ ] Build a workspace-private package artifact with an alias-free public entry. Its package metadata,
  emitted declaration closure, and runtime dependency closure must be checked by a clean Node consumer;
  package naming remains an open decision until the artifact is implemented.
- [ ] Keep provider/tool execution ports real; do not extract types while leaving the loop in Desktop.
- [ ] Keep Desktop embedding the same kernel during this stage.
- [ ] Prove a fake two-round tool-continuation scenario: provider request, tool admission/execution,
  tool result in the next provider request, final settlement, durable transcript, and observable event
  order, without a client callback between rounds.

### Sequence and acceptance gates

The executable order is `2.0 inventory -> 2A -> 2C -> 2B ports/extraction -> 2B clean-Node
import/runtime gate`. 2A and 2C may only overlap when they modify disjoint files and consume the same
frozen neutral contract; 2B composition/wiring waits for both. The clean-Node gate must import the
built package entry, not an application alias or an in-tree `src/main` path, and must prove the
runtime two-round scenario. Existing DeepChat agent/session tests, Desktop typechecks, ACP tests, and
behavior-preserving widget refresh are required; passing DTO/fake contract tests alone is insufficient.

### Attention points

- Preserve status/event ordering, pending-input settlement, interaction association, generation fences,
  Tape/transcript atomicity, and public message results.
- Avoid a generic service locator or a universal repository port.
- The package must not force-install Electron, SQLite, PTY, OCR, watcher, or other native modules.
- The kernel may depend on ports; it must not depend on a transport.

### Acceptance

- A clean Node consumer constructs and runs a minimal built-in kernel with injected fake provider,
  tool, storage, authority, and event ports without importing Electron or application source aliases.
- Existing DeepChat agent/session tests and Desktop typechecks pass.
- The same user-visible Desktop behavior is preserved in the embedded path.

### Commit boundary

`refactor(agent): extract portable harness kernel`

## Stage 3 — Build a real standalone service host

**Purpose:** provide the missing provider/model/tool resource owner so the kernel is a complete Agent
Service rather than a portable shell.

Starts only when: Stage 2's kernel is constructible in a clean Node consumer.

### Work

- [ ] Compose provider runtime, credential store, session/database/config owner, MCP, file/process,
  memory, skills, hooks, and supported tool adapters in a Node-capable host.
- [ ] Implement the Stage 2 ports as the single owner for the profile, and construct the V1
  compatibility handler in that host over the same lifecycle, turn, projection, and admission path the
  service uses for every other client. One owner, one database, one event hub: Desktop must not read a
  second copy of the service's database to keep a UI working. [compatibility.md](./compatibility.md)
  records what the handler must preserve and which mappings are cutover blockers.
- [ ] Move all model request and tool-call continuation into the service process/owned helper
  processes; Desktop is not an intermediate execution step.
- [ ] Implement capability registration/leases for optional Desktop-only callbacks and explicit
  unavailability for CUA, browser preview, native window interaction, and other excluded plugins.
- [ ] Define service startup, discovery, profile lock, instance identity, shutdown, child-process
  cleanup, and failure recovery.
- [ ] Resolve or block on Electron `safeStorage` compatibility through an approved host strategy; no
  plaintext fallback and no hidden Desktop dependency.
- [ ] Keep one database/config owner per profile and preserve current schema in the first migration.
- [ ] Keep direct ACP as a peer adapter; do not route it through this service's loop.

### Attention points

- Verify every promised tool through a real execution, not an import test.
- MCP/shell/PTY may execute in child processes; the service still owns authorization and results.
- Do not automatically repeat uncertain external side effects after a crash.
- A Desktop exit must disconnect its capability lease without killing headless-safe runs.
- Two clients racing to start a missing service must not create two database owners.

### Acceptance

- With Desktop never started, the service completes the minimum two-turn scenario, including a
  supported tool call followed by a model continuation and durable transcript.
- `service status`/discovery identifies one instance and concurrent startup yields one owner.
- Missing Desktop-only capabilities are reported explicitly while headless-safe tools continue working.
- Credential compatibility is either proven in an isolated profile or the release is blocked with a
  recorded migration decision.
- Shutdown releases DB, event subscribers, authority, MCP, and child processes.

### Commit boundary

`feat(agent-service): add standalone host`

## Stage 4 — Add the local client transport

**Purpose:** let independent CLI and Desktop clients use the same service contract without binding the
architecture to HTTP.

Starts only when: the Stage 3 host completes the two-turn/tool-continuation scenario with Desktop
absent.

### Work

- [ ] Implement the in-process adapter through the same application/admission layer.
- [ ] Carry the V1 run surfaces over the same admission path rather than beside it. The CLI keeps
  calling the compatibility handler remotely, and the handler keeps sharing the service's admission,
  cancellation, and idempotency decisions. The transport may change; the V1 surface must not gain a
  second runtime or a second event bus, and the connection-bound wire stream must keep the V1 cursor
  semantics recorded in [compatibility.md](./compatibility.md) (hub cursor authoritative, wire
  sequence per response, restart breaks continuity).
- [ ] Implement framed bidirectional RPC over Unix domain socket and Windows named pipe, or the one
  approved first platform adapter with a typed extension point for the other.
- [ ] Add request correlation, framing/size limits, handshake/version checks, typed errors, event
  subscription, cursor recovery, resync, and cancellation messages.
- [ ] Authenticate endpoint connections and bind identity/scopes from the trusted host; preserve
  human/agent distinction, quotas, workspace/session scope, and deny-by-default surfaces.
- [ ] Ensure disconnect does not cancel accepted work but does cancel/expire connection-bound
  unapproved mutations.
- [ ] Forward the current HTTP-over-local-socket CLI surface only as a compatibility adapter if
  required; never create a second runtime.

### Attention points

- Do not implement a generic route tunnel.
- Do not use absolute paths for artifact reads; use owned bounded file references.
- Do not make slow subscribers block the loop.
- Do not silently downgrade protocol mismatch or capability mismatch.
- Keep ACP protocol binding separate from local transport binding.

### Acceptance

- The same contract-level scenario passes through both in-process and local cross-process adapters.
- Kill/reconnect the client: accepted work continues, snapshot/events recover, and stale cursors request
  resync.
- Invalid token, scope, identity, duplicate submission, oversized frame, and unauthorized approval
  attempts fail closed.
- Multiple clients observe one service instance and one authoritative session.

### Commit boundary

`feat(agent-service): add local rpc transport`

## Stage 5 — Make Desktop a transparent client

**Purpose:** preserve the current Desktop product while changing its execution authority to the service.

Starts only when: the Stage 4 transport passes the contract scenario in-process and cross-process.

### Work

- [ ] Extend the typed client contract for anything Desktop needs that the seven operations do not
  express (session create/list/delete, steering, explicit queue management, paged transcript/artifact
  reads), as reviewable contract changes rather than ad-hoc adapter methods. Until an
  extension lands, that behavior has no client operation and must not be faked downstream.
- [ ] Keep renderer/preload context isolation, typed bridge, native routes, and i18n boundaries.
- [ ] Replace Desktop's built-in execution ownership with a DeepChat Agent Client connection to the
  service; retain a deliberate embedded fallback only when explicitly selected and mutually exclusive.
- [ ] Map service snapshots/events to existing renderer stores and preserve message/status/queue/Tape/
  transcript/permission behavior.
- [ ] Register optional Desktop capabilities and approval presentation through authenticated,
  narrow bridges; never trust a request field claiming `renderer`.
- [ ] Ensure Desktop shutdown only disconnects its client/capability lease when the standalone service is
  running.
- [ ] Keep direct ACP behavior on its ACP client adapter and preserve ACP capability negotiation.

### Attention points

- Desktop running normally must be indistinguishable to the user, not merely type-compatible.
- Do not maintain a hidden second provider/MCP/session owner for UI convenience.
- UI refresh is projection invalidation, not a second execution authority.
- Permission response must remain tied to the expected assistant message/tool call and live approval.

### Acceptance

- Manual Desktop smoke covers new session, existing session, multiple turns, streaming, supported
  tools, queue/steer, compaction, interaction, permission, cancellation, reload, and reconnect.
- Existing main/renderer tests for session, chat event bridge, approvals, and direct ACP pass.
- While Desktop is closed, a CLI run continues and is visible when Desktop reconnects.
- Desktop-only capabilities are unavailable when no Desktop client is connected and work when properly
  registered.

### Commit boundary

`refactor(desktop): consume agent service`

## Stage 6 — Switch CLI to headless Agent Service client

**Purpose:** deliver the first user-visible headless workflow without building a TUI.

Starts only when: Stage 5 keeps Desktop behavior unchanged.

### Work

- [ ] Extend the typed client contract for missing CLI operations: session create/list/delete,
  steering, explicit queue management, and paged transcript/artifact reads, as needed before command
  consumption. Reuse existing `querySubmission`, `snapshot.queuedSubmissions`, and `cancel` with
  `queued_submission`; no private channel may bypass a required typed extension.
- [ ] Make CLI use the typed Agent Client and service discovery rather than loading agent runtime,
  provider, credentials, MCP, or database code.
- [ ] Expose non-interactive commands for session selection/creation, multi-turn send, event/result
  observation, cancellation, and supported interaction responses.
- [ ] Keep deterministic JSON/JSONL output, bounded output/artifacts, stable exit codes, timing, usage,
  and explicit capability errors.
- [ ] Preserve the current launcher fail-closed behavior: Electron-bundled Node path only, no silent
  system-Node fallback, correct not-running and auth errors.
- [ ] Do not implement TUI, scrollback, interactive shell, arbitrary raw MCP invocation, CUA, or
  Desktop-only plugins.
- [ ] Ensure a client can perform several turns without Desktop and without pretending to be a human
  renderer for approvals.

### Attention points

- “Interactive response” means a command/API can answer a supported pending interaction; it does not
  mean a terminal UI.
- CLI may observe pending approval but cannot self-resolve renderer-only approval.
- Headless capability errors must identify the unavailable plugin/capability and required client.
- Never put credentials in CLI logs, arguments, environment output, or event payloads.

### Acceptance

- Desktop is not running; CLI creates/selects one session, performs multiple turns, invokes at least
  one supported tool, receives the continuation/final answer, and exits with durable state intact.
- CLI can cancel an active run, reconnect, and read the authoritative result.
- Unsupported CUA/browser/native capabilities return stable explicit errors.
- Invalid agent token, unauthorized session/workspace, fake human/renderer identity, and self-approval
  are rejected.
- No TUI or scrollback UI is shipped.

### Commit boundary

`feat(cli): run headless agent sessions`

## Stage 7 — Cutover, regression hardening, and release gate

**Purpose:** remove duplicate ownership and prove the final compatibility target.

### Work

- [ ] Make standalone service ownership the default for the selected profile after backup/migration
  checks pass.
- [ ] Remove or quarantine the old same-profile embedded owner; fallback requires an explicit service
  stop and cannot run concurrently.
- [ ] Add only durable tests for user-visible behavior, lifecycle/concurrency, persistence/migration,
  recovery, protocol compatibility, and security boundaries.
- [ ] Verify child-process cleanup, native ABI/packaging, credentials, event backpressure, shutdown,
  crash recovery, and uncertain side effects.
- [ ] Update directly affected maintained architecture specs and regenerate normal provider/ACP registry
  outputs where the build owns them.
- [ ] Remove temporary probes and verify no credentials or secrets entered docs, logs, fixtures, or
  commits.

### Attention points

- The release bar is “Desktop feels unchanged” plus “CLI works headlessly,” not merely “the service
  starts.”
- Do not accept a partial migration where Desktop writes or reads a second mutable authority.
- Preserve external ACP direct behavior while testing built-in service behavior separately.
- Treat credential compatibility, native ABI, and database ownership as release blockers.

### Acceptance

- Full Desktop regression passes with no user-visible behavior change for supported features.
- Headless CLI passes the complete multi-turn/tool/interaction/reconnect scenario with Desktop absent.
- Desktop and CLI can connect to the same profile without duplicate owner creation.
- All unsupported Desktop-dependent plugins fail explicitly and all promised headless capabilities pass
  real execution tests.
- Full quality gate passes: `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`,
  relevant Vitest suites, and required build/package/import checks.
- The final diff, commit history, and docs describe the same ownership and capability model.

### Commit boundary

`chore(agent-service): complete standalone cutover`

## Remaining ownership and startup conditions

Required capabilities are tracked here with an owner and a start condition. None of them is
non-blocking, and none may be quietly dropped or replaced by a weaker claim later:

| Capability or decision | Owner | Start condition |
| --- | --- | --- |
| Compatibility mapping of the V1 run surfaces (1D) | Stage 1 | delivered as [compatibility.md](./compatibility.md); closes with Stage 1 acceptance |
| Submission/interaction/cancellation semantic freeze | Stage 1 | satisfied: integrated and independently accepted at `b17577182` |
| Narrow projection ports (session metadata, text-only keyset pagination, in-flight assistant, root/descendant waiting) | Stage 2 | Stage 1 closed |
| Single-owner host implementing those ports, including the V1 compatibility handler | Stage 3 | Stage 2 kernel constructible in a clean Node consumer |
| Same admission path for the compatibility handler and the local transport | Stage 4 | Stage 3 host runs the two-turn scenario with Desktop absent |
| Typed client extensions (session create/list/delete, steering, explicit queue management, paged transcript/artifact reads); receipt query and queued cancellation already exist | Stage 5 for Desktop, Stage 6 for CLI | before the consuming stage uses each missing operation |
| `safeStorage` compatibility or controlled reauthorization | Stage 3 | release blocker: a Node host must not fall back to plaintext, and must not require Desktop to stay online |
| Windows named-pipe transport, Electron native-module packaging, dev/build/e2e wrapping | Stage 4 / Stage 7 | explicitly unverified today; no stage may claim them until they are exercised |

The toolchain is available: this stage ran on Node `v24.18.0` and pnpm `10.34.5` with an installed
Electron matching the lockfile, so "no compliant Node is available" is not a blocker and must not be
recorded as one. The Stage 0 environment drift in [baseline.md](./baseline.md) is a historical record
of that revision.

## Non-blocking verification risks

These existing P3 limits are not Stage 1 blockers and do not expand the 1D documentation scope.

| Limit | Actual boundary / follow-up |
| --- | --- |
| Empty scoped source directory | `scripts/typecheck-agent-service-contracts.mjs:18-25` discovers `.ts` roots but has no minimum source-count assertion; preserve a fail-closed lower bound in later gate hardening. |
| Global configuration diagnostics | The same gate intentionally retains `parsed.errors` and file-less diagnostics (`:85-90`); scoped file filtering is not configuration isolation. |
| Child timeout exceeds test timeout | `test/main/scripts/agentServiceContractTypeGate.test.ts:23` permits 120 seconds for a child; `vitest.config.ts:17` sets 10 seconds per test. A slow child can outlive the test timeout. |
| ACP type assertions outside contract gate | `test/main/contracts/acpProviderPorts.test.ts:30-36` has four `expectTypeOf` calls (five textual occurrences including the import), none selected by the contract gate; Vitest runtime success does not compile those assertions. |
| Formatter/lint coverage | `.oxfmtrc.json` excludes docs/Markdown and scripts, but not tests or shared contracts generally. `.oxlintrc.json` excludes scripts, tests, docs, and shared sources except four explicit MCP files. Guard scripts have their own narrow scopes. Green gates do not prove formatting/lint coverage of ignored files. |

## Claim boundary

Passing this stage's checks does not complete the product. Stage 1D is documentation: the V1 run
surfaces are mapped, not served by a service, and everything after Stage 1 is still unbuilt. The
following claims are unavailable until their stage's acceptance passes, however green the current
suites are:

- the client contract is wired to a service, transport, or handler (it is not);
- Desktop runs on the service, or Desktop behavior is preserved through the service (Stage 5);
- the CLI works headlessly against a standalone service (Stage 6);
- any end-to-end, Windows, packaged, or native-module behavior (Stage 4/7, unverified).

Intermediate suites are DTO- and fake-level. They protect contract shape; they are not evidence of
runtime, transport, or user-visible behavior.

## Commit and review policy

Every stage commit must contain only that stage's durable source/docs/tests. Do not mix a transport
change with a database migration, or a client UI migration with a new host capability. If a stage
cannot meet acceptance, do not commit a partial “done” state; split the work into a follow-up slice or
record the blocker in this plan.

Recommended sequence:

```text
docs baseline
  -> client contract
  -> portable kernel
  -> standalone host
  -> local RPC
  -> Desktop client
  -> headless CLI
  -> final cutover
```

The exact commit subjects above are recommendations. Use Conventional Commits, keep subjects at most
50 characters, target `dev` for routine PRs, and never add AI co-authors.
