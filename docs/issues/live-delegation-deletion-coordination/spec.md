# Live Delegation Deletion Coordination And Dispatch Visibility

Status: implemented and validated.

GitHub issue: not requested or created; this is a local SDD record.

## Issue

The live-delegation execution path is durable and interaction-complete, but three lifecycle edges
remain after the interaction hardening work:

1. Session tree deletion closes child runtimes and removes Session rows without first asking the
   live-delegation owner to interrupt related active turns. Runtime status side effects usually
   settle those turns, but deletion can race repository cascades and produce failed settlement
   attempts or delayed admission release.
2. The write-ahead `startedAt` transition is persisted before handoff delivery, while its renderer
   projection is emitted only after `sendConversationMessage()` resolves. A slow handoff therefore
   leaves the UI at `queued` even though the durable authority is already `running`.
3. Parent cards expose the waiting status and an `Open child` action, but the action has the same
   visual weight as ordinary child navigation. Permission and question waits are actionable states
   and should be more discoverable without copying child interaction blocks into the parent.

## Impact

- Deleting a parent or child Session can leave live-delegation cleanup dependent on incidental
  runtime events and can generate avoidable repository errors during cascade deletion.
- A slow or blocked handoff temporarily presents stale state and hides that dispatch has begun.
- Users may overlook a waiting child and leave otherwise healthy proactive work blocked.

## Root Cause

- `SessionDeletion` has narrow cleanup ports for runtime, state, permissions, and Skills, but no
  orchestration cleanup port.
- `sendChildHandoff()` treated the post-delivery notification as both durable-start projection and
  in-memory delivery acceptance even though those are separate facts.
- Parent UI used status-specific badges but a status-neutral navigation action.

## Fix Plan

1. Add a narrow Session deletion orchestration port. Before descending into or deleting a Session
   tree, ask `LiveDelegationService` to interrupt every active delegation whose parent or bound
   child matches the Session. Drain acquisition and handoff work through the existing interruption
   path before runtime cleanup and row deletion continue.
2. Keep deletion best-effort: orchestration cleanup failure is recorded with the other cleanup
   stages and must not prevent the Session row from being removed.
3. Publish the write-ahead running transition immediately and remove the redundant post-delivery
   projection. Keep `active.started` false until delivery resolves so terminal and Tape semantics
   continue to mean accepted execution.
4. Promote the existing `Open child` button to the primary action while the delegation is waiting
   for permission or input. Do not add parent-side interaction persistence or response routing.
5. Add focused tests for deletion ordering, parent/child interruption, handoff failure, immediate
   running projection, and waiting-action presentation.

## Compatibility And Non-goals

- Do not block Session deletion when orchestration cleanup fails; deletion remains best-effort and
  reports partial cleanup through logs.
- Do not duplicate child action blocks into the parent transcript or add another interaction fact
  source. Approval and question response remain in the read-only child dock.
- Do not change the hidden `subagent_orchestrator` compatibility route or expose both tools to the
  model catalog.
- Do not hard-disable explicit delegation, add shared-workspace writer isolation, rename the
  orchestration surface, or split the service in this issue.
- Do not claim exactly-once delivery or side-effect execution.

## Acceptance Criteria

1. Parent or bound-child deletion interrupts and drains every related active live delegation before
   backend cleanup or Session row deletion starts.
2. A cleanup failure does not prevent recursive Session deletion and is reported as a partial
   orchestration-stage failure.
3. The durable `running` transition is projected while handoff delivery is still pending and is not
   published a second time when delivery resolves.
4. Handoff rejection settles the write-ahead turn as failed and releases its active lifecycle.
5. Parent cards and the Agent activity panel visually prioritize opening a child only while user
   interaction is required.
6. Child interaction remains the sole response surface; ordinary child composition and mutation
   remain disabled.

## Task Checklist

- [x] Validate the review findings against current production paths and tests.
- [x] Add explicit Session deletion coordination.
- [x] Project write-ahead dispatch immediately.
- [x] Improve waiting-action discoverability without duplicating state.
- [x] Add focused lifecycle and renderer regressions.
- [x] Run project validation and complete the pre-commit review.

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `ELECTRON_RUN_AS_NODE=1 pnpm exec electron node_modules/vitest/vitest.mjs run --config
  vitest.config.ts test/main/orchestration test/main/session/deletion.test.ts --reporter=dot`
  (6 files, 43 tests passed)
- `pnpm exec vitest run --config vitest.config.renderer.ts
  test/renderer/components/LiveDelegationPanel.test.ts
  test/renderer/components/message/LiveDelegationToolCallCard.test.ts
  test/renderer/components/ChatPage.test.ts --reporter=dot` (3 files, 102 tests passed)
- `pnpm run test:main -- --reporter=dot` (502 files and 5,885 tests passed; 27 native SQLite
  files were skipped by the repository's Node test environment)
- `pnpm run test:renderer -- --reporter=dot` (249 files and 2,004 tests passed)

## Pre-commit Review

Findings are ordered by severity:

1. **P2 — fixed:** Session deletion relied on runtime status side effects to settle active
   delegations. The deletion boundary now explicitly interrupts and drains parent- or child-bound
   work before destructive cleanup, while preserving best-effort deletion if cleanup fails.
2. **P2 — fixed:** The durable write-ahead `running` state could remain visually `queued` during a
   slow handoff. The authoritative transition is now published immediately, with delivery
   acceptance still tracked separately for terminal and Tape semantics.
3. **P2 — fixed:** Waiting children were visible but their navigation action was easy to miss. The
   existing action is now prioritized only for permission and question waits, without adding a
   second approval state or widening parent permissions.
4. **P2 — no change required in this issue:** Parent-side approval projection, the hidden legacy
   batch tool, prompt-level delegation policy, shared-workspace isolation, and terminology/service
   decomposition remain documented compatibility or architecture follow-ups. Changing them here
   would expand the state model or alter public behavior without addressing the lifecycle bug.

No P0 or P1 findings remain in this change set.
