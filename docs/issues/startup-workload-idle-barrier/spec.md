# Startup Workload Idle Barrier

## Issue

`StartupWorkloadCoordinator.whenIdle()` is named and used as an idle barrier, but its current
implementation schedules an ordinary `background/io` task. Because the coordinator has two IO
lanes, that task can start while another IO task and the CPU task are still running.

The only production caller uses the callback to start the full provider warmup. The retained startup
orchestration decision says this warmup must begin only after coordinator work already registered at
the barrier has finished. This is therefore a state-machine defect, not an intentional definition of
idle as "an IO lane is available."

## Impact

- Provider warmup can overlap the startup CPU task and another IO task.
- Startup work can contend for the main process at the exact point the idle policy was meant to avoid.
- Tests cannot use `whenIdle()` as a reliable completion boundary.

## Root Cause

- `whenIdle()` is represented as a normal scheduled task instead of a dependency barrier.
- Scheduler priority and resource capacity decide when the callback starts; task completion does not.
- A running task cancelled by `cancelTarget()` settles its public promise before its underlying
  execution returns and releases its resource lane. A correct barrier must not mistake that early
  public settlement for execution completion.

## Contract

An **idle generation** is the snapshot of all coordinator task records that are pending or still
executing when `whenIdle(target, callback)` is called.

- The callback starts exactly once, after every task in that captured generation has physically
  finished and released its scheduler lane.
- Normal completion, rejection, and cancellation all finish a captured task only when no underlying
  execution remains. A cancelled pending task finishes immediately because it never acquired a lane.
- Tasks submitted after `whenIdle()` captures its generation belong to a later generation and do not
  extend the current wait. Each non-empty waiter registers an independent token containing its
  captured generation, task-sequence cutoff, and waiter order. For each resource, the scheduler uses
  the oldest active token that still has captured pending work on that resource and admits only
  pending tasks at or before that token's cutoff. Eligible tasks retain their normal phase and
  sequence ordering. A token with no captured pending work on a resource does not block that resource.
- The generation is coordinator-wide, matching the existing global `isIdle()` check and the retained
  "coordinator idle" startup policy. `target` owns the waiting lifecycle: cancelling or replacing
  that target run before the callback begins rejects the waiter with `AbortError`. Once the callback
  begins, its own owner controls cancellation and its result or error is propagated unchanged. The
  production callback schedules its warmup as a target/run-owned task, so that work remains
  cancellable through the existing task contract.
- Each `whenIdle()` call owns its callback. Concurrent waiters may capture the same generation, and
  each callback runs exactly once; the old scheduled-task dedupe behavior is intentionally removed.
- A waiter is not workload: it consumes no CPU/IO lane, has no visible task, and emits no unchanged
  `startup.workload.changed` snapshot.
- The local scheduling consequence is intentional: a background task captured before a barrier may
  run before an interactive task submitted after that barrier on the same resource. The token is
  removed when its wait succeeds or aborts, so this is not a global phase reorder.

## Fix Plan

- Track the physical completion of each scheduled task separately from its public promise settlement.
- Capture current active task completion promises in `whenIdle()` and wait without consuming a lane.
- Register an independent cutoff token for each active non-empty wait and remove it in `finally`.
- At dispatch, apply only the oldest relevant token cutoff per resource before using existing
  phase/sequence ordering.
- Tie the wait to the target run cancellation signal and remove its abort listener on every outcome.
- Keep ordinary phase ordering, resource limits, task dedupe, public snapshots, and CRD-001
  settlement semantics unchanged.

## Acceptance Criteria

- A captured deferred CPU task and two concurrently running IO tasks all finish before the callback.
- A captured task rejection still delays the callback until execution cleanup, without making the
  barrier fail.
- A task scheduled after the barrier starts does not delay that barrier.
- A later interactive task on the same resource cannot starve a captured background task; the later
  task still does not become part of the captured generation.
- Interleaved waiters retain independent cutoffs: a later waiter may include work excluded by an
  earlier waiter without allowing that work to overtake the earlier generation.
- A token with captured pending CPU work does not delay later IO work, or vice versa.
- Target cancellation rejects the barrier once, never calls the callback, and late task settlement
  restores the lane without retained active, pending, run, or dedupe records.
- A physically running task remains visible to a barrier owned by another target after its public
  promise is cancelled.
- Concurrent waiters each invoke their own callback once; an immediate-idle callback runs directly.
- Callback rejection is propagated by identity, and target cancellation after callback start does not
  replace the callback outcome.
- Existing priority, concurrency, cancellation settlement, and atomic snapshot tests continue to pass.

## Non-Goals

- No scheduler phase, priority, or concurrency redesign.
- No automatic inclusion of descendant or continuously arriving tasks in an open generation.
- No changes to provider warmup behavior, startup event schemas, or renderer state.
- No timeout for task bodies that ignore cancellation; their lane remains occupied by design.

## Tasks

- [x] Add focused failing generation, rejection, cutoff, cancellation, and late-settlement tests.
- [x] Implement physical task completion tracking and the lane-free barrier.
- [x] Run focused and repository validation.
- [x] Record the final validation evidence.
- [x] Protect captured pending tasks from later same-resource phase starvation.
- [x] Cover cross-target late execution, concurrent waiters, immediate idle, and callback ownership.
- [x] Re-run focused and repository validation after independent review findings.
- [x] Replace per-task waiter-reference union with independent ordered cutoff tokens.
- [x] Cover interleaved waiter cutoffs and token cleanup on success and cancellation.
- [x] Re-run focused and repository validation after the second independent review.

## Validation

- The independent-review follow-up tests failed before the scheduling protection was added: a later
  interactive CPU task started before the captured background CPU task, and waiter references were
  not tracked or released.
- The second-review interleaving test failed against the per-task reference model: waiter B made its
  later interactive task appear protected to waiter A, so it started before A's captured background
  task. The independent token set was also absent before the token implementation.
- `pnpm vitest run test/main/presenter/startupWorkloadCoordinator.test.ts`: 13 passed.
- `pnpm run typecheck`: passed.
- `pnpm run format`: passed.
- `pnpm run i18n`: passed.
- `pnpm run lint`: passed, including architecture and agent-cleanup guards.
- `pnpm run test:main -- --reporter=dot`: 3,261 passed and 135 skipped. The two failures are
  unchanged baseline failures in `createMockChatSession.test.ts` and
  `agentSessionPresenter/integration.test.ts`; no startup coordinator test failed.
