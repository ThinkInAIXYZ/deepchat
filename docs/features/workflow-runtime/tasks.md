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
- [ ] Prove active-run and queued-run bounds.
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
  none touched workflow code or failed in the new v52-to-v53 migration test.

## Shared Admission

- [x] Add cancellation-aware owner-fair `AgentInvocationAdmission`.
- [x] Apply the process-wide default limit of four active children.
- [ ] Add a separate bounded workflow utility-process admission gate.
- [ ] Gate both workflow and `subagent_orchestrator` child starts.
- [x] Gate `subagent_orchestrator` child lifetimes through the shared admission layer.
- [x] Preserve existing orchestrator local limits.
- [x] Bound waiters and make close/cancel/release leak-free.
- [x] Add concurrency, fairness, cancellation, overflow, and orchestrator regression tests.
- [x] Complete the pre-commit admission review and focused validation.
- [x] Commit the shared-admission slice.

## Child Execution And Effects

- [ ] Create workflow children through `AgentSubagentToolPort`.
- [ ] Reject direct ACP and preserve DeepChat-loop ACP compatibility.
- [ ] Enforce the launch target-agent allowlist before admission.
- [ ] Make child creation crash-safe and idempotent by correlation slot.
- [ ] Persist child identity before handoff.
- [ ] Map child runtime state and usage into durable invocation state.
- [ ] Add workflow-scoped frozen-head Tape lineage.
- [ ] Require a durable Tape-link receipt before replayable success.
- [ ] Propagate workflow invocation context to the common tool boundary.
- [ ] Persist monotonic effect state before every child tool execution.
- [ ] Fail tool execution closed when effect intent persistence fails.
- [ ] Treat unknown or untrusted tool metadata conservatively.
- [ ] Add crash-window, late-event, Tape-evidence, and lineage tests.
- [ ] Complete the pre-commit child/effect review, focused validation, and commit.

## Structured Output

- [ ] Add bounded JSON Schema validation.
- [ ] Add run-scoped structured-output tool injection for DeepChat-loop children.
- [ ] Add same-child correction feedback and bounded attempts.
- [ ] Remove the temporary output tool on every invocation terminal path.
- [ ] Validate and bound plain JSON before persistence and guest settlement.
- [ ] Cover normal providers and DeepChat-loop ACP compatibility.
- [ ] Add valid, invalid, oversized, exhausted, cancelled, and direct-ACP tests.
- [ ] Complete the pre-commit structured-output review, focused validation, and commit.

## Workflow Service

- [ ] Add explicit launch approval bound to source hash and effective scope.
- [ ] Add one-process-per-run lifecycle.
- [ ] Add admission, execution, settlement, timeout, cancellation, and budget orchestration.
- [ ] Add resume, retry, and retry-from-here behavior.
- [ ] Add typed launch/status/cancel/resume/retry routes.
- [ ] Add explicit workflow agent-tool actions.
- [ ] Add typed workflow events and renderer projections.
- [ ] Keep activation independent from reasoning effort and explicit-only in V1.
- [ ] Add service, route, tool, protocol-failure, and budget tests.
- [ ] Complete the pre-commit service review, focused validation, and commit.

## Parent Result And UI

- [ ] Persist one idempotent Workflow Result.
- [ ] Deliver with `triggerTurn: false`.
- [ ] Queue safely while a parent turn is active.
- [ ] Add explicit parent synthesis action.
- [ ] Add the workflow side-panel section and progress tree.
- [ ] Add child-session navigation and interaction projection.
- [ ] Add cancel, resume, retry, retry-from-here, and effect-warning controls.
- [ ] Add loading, empty, interrupted, incompatible, and partial-result states.
- [ ] Add vue-i18n copy and renderer tests.
- [ ] Complete the pre-commit result/UI review, focused validation, and commit.

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
