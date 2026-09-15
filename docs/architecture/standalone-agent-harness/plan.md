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

Stage 1 sub-slice rule: 1A DTO-only; 1B events/interaction/cancellation; 1C client adapters; 1D
compatibility mapping. Sub-slices land as separate reviewable commits; a sub-slice that cannot meet
its own acceptance is recorded as a blocker instead of being folded into the next one. 1A is delivered
as DTO-only (protocol version, service identity, the capability vocabulary with an availability
discriminator, the structured error DTO, a session reference, and a submission receipt) and is wired
to no service, transport, handler, or client, so the remaining Stage 1 work below stays open. See
[baseline.md](./baseline.md) "Stage 1 handoff".

### Work

- [ ] Create typed service DTOs for handshake, capabilities, session snapshot, submission receipt,
  events, interaction, cancellation, artifacts, and structured errors.
- [ ] Define capability negotiation and explicit `capability_unavailable` behavior.
- [ ] Define submission identity, idempotency scope, cancellation layers, event epoch/cursor recovery,
  bounded backpressure, and resync rules.
- [ ] Define client adapters for built-in DeepChat service and direct ACP without pretending they have
  identical feature sets.
- [ ] Keep `AbortSignal`, callback, class instance, DB connection, Electron object, provider client,
  and absolute service paths out of serializable contracts.
- [ ] Document compatibility mapping to the current CLI surface; do not replace the maintained CLI
  contract accidentally.

### Attention points

- The common contract is a minimum, not a union of every DeepChat method and every ACP feature.
- A lost response must be queryable, not blindly retried.
- Authentication identity comes from the transport/host, never from a request `principal` field.
- Do not add `--yes`, CLI self-approval, renderer self-assertion, or a broader route tunnel.

### Acceptance

- Typecheck proves all public DTOs are serializable and contain no forbidden host/runtime types.
- A fake in-process service and a fake ACP adapter can express send, cancel, snapshot, event recovery,
  interaction, and unavailable capability using the same client-facing result vocabulary.
- Contract review confirms Desktop compatibility and headless scope are explicit.

### Commit boundary

`feat(agent-service): define client contract`

## Stage 2 — Extract the built-in execution kernel

**Purpose:** make the Harness independently constructible without changing Desktop behavior.

### Work

- [ ] Extract the existing facade/coordinators around `DeepChatLoopEngine`, turn/run lifecycle,
  context, queue, interaction, compaction, Tape, transcript, and recovery.
- [ ] Narrow concrete `SessionDatabase`/`SessionData` dependencies to ports that preserve required
  transaction and atomic settlement boundaries.
- [ ] Move CLI authority and programmatic tool authority interfaces to neutral contracts; keep CLI
  parsing/discovery in its adapter.
- [ ] Replace UI refresh callbacks with typed state/event invalidation; Desktop remains responsible for
  rendering its projection.
- [ ] Remove reverse/transitive dependencies on Electron, application aliases, renderer code,
  `safeStorage`, default paths, and global singletons from the package boundary.
- [ ] Keep provider/tool execution ports real; do not extract types while leaving the loop in Desktop.
- [ ] Keep Desktop embedding the same kernel during this stage.
- [ ] Untie the ACP session-state seam: today `createDirectAcpAgentBackend` receives
  `sessionState: deepChatAgentHarness` (`src/main/app/composition.ts:1928-1930`). Give the peer its own
  `SessionStatePort` implementation, or expose a neutral session-state contract that both paths consume,
  so the ACP adapter never depends on the built-in harness.

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

### Work

- [ ] Compose provider runtime, credential store, session/database/config owner, MCP, file/process,
  memory, skills, hooks, and supported tool adapters in a Node-capable host.
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

### Work

- [ ] Implement the in-process adapter through the same application/admission layer.
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

### Work

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

### Work

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
