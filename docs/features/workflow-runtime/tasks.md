# Workflow Runtime Tasks

## Specification

- [x] Inspect current DeepChat child-session, Tape, permission, tool, utility-process, event, and
  database paths.
- [x] Verify the sync QuickJS deferred-promise direction and reject Asyncify for concurrent waits.
- [x] Replace hash-occurrence replay identity with stable logical call paths plus input hashes.
- [x] Replace Tape-only effect inference with write-ahead effect state plus Tape evidence.
- [x] Require an immutable executed source snapshot for cross-restart resume.
- [x] Write the feature specification and implementation plan.
- [x] Complete the pre-commit SDD review and fix findings.
- [x] Commit the specification slice.

## Runtime Contracts And QuickJS Spike

- [x] Add versioned Zod domain and utility-process protocol contracts.
- [x] Add canonical bounded JSON serialization and hashing.
- [x] Add minimal sync QuickJS dependencies.
- [x] Add workflow utility-process build entry and minimal environment.
- [x] Implement the guest driver and deterministic global restrictions.
- [x] Reject unsupported direct promise scheduling and dynamic code.
- [x] Implement deferred promise settlement with serialized pending-job drains.
- [x] Implement keyed `agent`, `parallel`, `pipeline`, `phase`, and `log`.
- [x] Enforce guest CPU, memory, stack, IPC, log, result, and invocation limits.
- [x] Prove concurrent `Promise.all` progress.
- [x] Prove cancellation and handle disposal.
- [x] Prove development and packaged WASM resolution.
- [x] Prove utility-process exit notification.
- [x] Prove active-run and queued-run bounds.
- [x] Complete the pre-commit runtime review and focused validation.
- [x] Commit the runtime slice.

Validation evidence (2026-07-31):

- `pnpm run typecheck:node`
- 49 focused main/build tests
- `pnpm exec electron-vite build`
- packaged ASAR inspection, unpacked WASM size check, and Electron `utilityProcess` end-to-end
  execution returning a settled QuickJS result
- `electron-builder --dir` reached `afterPack`; the outer command then failed because this worktree
  lacks the pre-existing OCR `runtime/node/bin/node` asset

## Persistence And Recovery

- [x] Add schema version 53.
- [x] Add schema version 54 for the durable workspace and capability scope.
- [x] Add `workflow_runs`.
- [x] Add `workflow_invocations`.
- [x] Store immutable source, hashes, statuses, attempts, effects, usage, and delivery state.
- [x] Persist stable child correlation slots.
- [x] Add repository parsing and transactional sequence allocation.
- [x] Add startup and utility-exit interruption reconciliation.
- [x] Add stable call-path replay and downstream invalidation.
- [x] Add timeout replay and explicit retry attempts.
- [x] Add migration, constraint, replay, and reconciliation tests.
- [x] Complete the pre-commit persistence review and focused validation.

Validation evidence (2026-07-31):

- 63 workflow, schema repair, schema catalog, and database connection tests passed under
  Electron's Node ABI.
- `pnpm run typecheck:node`
- The broader `test/main/data` run passed 81 tests and exposed 8 pre-existing
  `mainDatabase.test.ts` failures against removed presenter APIs or incomplete legacy fixtures;
  none touched workflow code or failed in the workflow migration tests.

## Shared Admission

- [x] Add cancellation-aware owner-fair `AgentInvocationAdmission`.
- [x] Apply the process-wide default limit of four active children.
- [x] Add a separate bounded workflow utility-process admission gate.
- [x] Gate both workflow and `subagent_orchestrator` child starts.
- [x] Gate `subagent_orchestrator` child lifetimes through the shared admission layer.
- [x] Preserve existing orchestrator local limits.
- [x] Bound waiters and make close/cancel/release leak-free.
- [x] Add concurrency, fairness, cancellation, overflow, and orchestrator regression tests.
- [x] Complete the pre-commit admission review and focused validation.
- [x] Commit the shared-admission slice.

## Child Execution And Effects

- [x] Create workflow children through `AgentSubagentToolPort`.
- [x] Reject direct ACP and preserve DeepChat-loop ACP compatibility.
- [x] Enforce the launch target-agent allowlist before admission.
- [x] Make child creation crash-safe and idempotent by correlation slot.
- [x] Persist child identity before handoff.
- [x] Map child runtime state and usage into durable invocation state.
- [x] Add workflow-scoped frozen-head Tape lineage.
- [x] Require a durable Tape-link receipt before replayable success.
- [x] Propagate workflow invocation context to the common tool boundary.
- [x] Add an explicit invocation-context registry at the common tool boundary.
- [x] Persist monotonic effect state before every bound child tool execution.
- [x] Fail tool execution closed when effect intent persistence fails.
- [x] Treat unknown or untrusted tool metadata conservatively.
- [x] Add crash-window, late-event, Tape-evidence, and lineage tests.
- [x] Complete the pre-commit child/effect review, focused validation, and commit.

Effect-boundary validation evidence (2026-07-31):

- 236 workflow and tool tests passed under Electron's Node ABI.
- `pnpm run typecheck:node`

Child-executor validation evidence (2026-07-31):

- 57 workflow, session-lifecycle, and session-projection tests passed under Electron's Node ABI.
- 159 session integration and existing subagent-orchestrator regression tests passed.
- `pnpm run lint`
- `pnpm run typecheck`

## Structured Output

- [x] Add bounded JSON Schema validation.
- [x] Add invocation-scoped structured-output tool injection for DeepChat-loop children.
- [x] Add same-child correction feedback and bounded attempts.
- [x] Remove the temporary output tool on every invocation terminal path.
- [x] Validate and bound plain JSON before persistence and guest settlement.
- [x] Cover normal providers and DeepChat-loop ACP compatibility.
- [x] Add valid, invalid, oversized, exhausted, cancelled, and direct-ACP tests.
- [x] Complete the pre-commit structured-output review, focused validation, and commit.

Structured-output validation evidence (2026-07-31):

- 531 workflow, tool, and DeepChat harness tests passed with native SQLite required.
- `pnpm run format:check`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm exec electron-vite build`

## Workflow Service

- [x] Add explicit launch approval bound to source hash and effective scope.
- [x] Add one-process-per-run lifecycle.
- [x] Add admission, execution, settlement, timeout, cancellation, and budget orchestration.
- [x] Add resume, retry, and retry-from-here behavior.
- [x] Add typed launch/status/cancel/resume/retry routes.
- [x] Add explicit workflow agent-tool actions.
- [x] Add typed workflow events and renderer projections.
- [x] Keep activation independent from reasoning effort and explicit-only in V1.
- [x] Add service, protocol-failure, recovery, and budget tests.
- [x] Add route and agent-tool tests.
- [x] Complete the pre-commit service-core review, focused validation, and commit.

Service-core validation evidence (2026-07-31):

- launch approvals bind the source and input hashes to a main-resolved workspace, allowlist,
  limits, and budget; pending approval count and bytes are bounded;
- one-process-per-run admission covers active, queued, overflow, cancellation, and shutdown paths;
- queued resume intent survives restart; replay, duplicate active paths, utility crashes, token and
  execution-time budgets, effect-aware retry, retry-from-here, and projection failure isolation
  are covered by focused tests;
- child usage is validated, correction-turn usage is accumulated, and terminal invocation usage is
  durable.
- 435 workflow, shared-admission, orchestrator, session-lifecycle, and DeepChat harness tests passed.
- `pnpm run format:check`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm exec electron-vite build`

Control-surface validation evidence (2026-07-31):

- launch approval and every invocation dispatch revalidate the immutable workspace and effective
  target-agent capability scope, including MCP and Skill selections;
- typed routes and events expose bounded projections rather than stored script, input, prompt, or
  full result payloads;
- the Agent tool keeps launch as a non-rememberable two-step permission action and preserves
  completed mutation results if the calling turn is cancelled afterward;
- 309 workflow, Agent-tool, and composition-boundary tests passed;
- `pnpm run format:check`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm exec electron-vite build`

## Parent Result And UI

- [x] Persist one idempotent Workflow Result.
- [x] Deliver with `triggerTurn: false`.
- [x] Queue safely while a parent turn is active.
- [x] Add explicit parent synthesis action.
- [ ] Add the workflow side-panel section and progress tree.
- [ ] Add child-session navigation and interaction projection.
- [ ] Add cancel, resume, retry, retry-from-here, and effect-warning controls.
- [ ] Add loading, empty, interrupted, incompatible, and partial-result states.
- [ ] Add vue-i18n copy and renderer tests.
- [x] Complete the pre-commit parent-result review, focused validation, and commit.
- [ ] Complete the pre-commit UI review, focused validation, and commit.

Parent-result validation evidence (2026-07-31):

- a stable delivery/message identity closes the transcript-write/result-state crash window;
- result notices are bounded, searchable first-class facts but do not enter parent model history,
  compaction, or memory ingestion;
- explicit synthesis preserves the pending-input `pending`/`claimed` state, caps full-result input
  at 256 KiB, and carries a system-level untrusted-data guard;
- 490 workflow, persistence, transcript, context-builder, memory-ingestion, route, and DeepChat
  harness tests passed in the final focused run;
- `pnpm run format:check`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm exec electron-vite build`

## Saved Workflows

- [ ] Add safe user-readable named workflow storage.
- [ ] Keep immutable run snapshots separate from editable source files.
- [ ] Add bounded args and path/symlink validation.
- [ ] Add named invocation UX.
- [ ] Defer auto mode until explicit workflows pass recovery validation.
- [ ] Complete the pre-commit saved-workflow review, focused validation, and commit.

## Final Validation

- [ ] Run all focused workflow and affected regression suites.
- [ ] Run `pnpm run format`.
- [ ] Run `pnpm run i18n`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run build`.
- [ ] Verify packaged QuickJS loading on the current platform.
- [ ] Perform the final cross-module review and fix findings.
- [ ] Record actual validation evidence in this document.
- [ ] Commit all validated work locally.
- [ ] Do not push.
