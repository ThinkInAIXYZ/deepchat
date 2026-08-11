# Released Queue Inputs Lack an Explicit Retry

## GitHub

- Issue: https://github.com/ThinkInAIXYZ/deepchat/issues/2112
- Classification: complex reliability bug
- Priority: P1
- Status: implemented on `fix/issue-2112-pending-input-retry`

## Issue And Impact

`PendingInputPump` deliberately leaves a Queue row at the FIFO head when a claimed turn is
released before its user fact is committed. The durable row currently returns to the ordinary
`pending` state, so the renderer cannot distinguish it from an unsent draft and exposes no Retry
action. The row can therefore block every later Queue input with no explanation or direct recovery
path.

Editing the row happens to schedule another drain, but that mutation is not the explicit retry
contract owned by the pump.

## Root Cause

PR https://github.com/ThinkInAIXYZ/deepchat/pull/2023 centralized Queue claim, release, and
single-flight draining in `PendingInputPump`. Commit `b2729141` added the contract and regression
that a released Queue head waits for explicit retry, but release persisted the same `pending` state
used by ordinary drafts and the renderer contract was not extended.

PR https://github.com/ThinkInAIXYZ/deepchat/pull/2129 did not introduce the defect. It added the
separate restart-held Queue and Resume Queue semantics that this fix must preserve.

## Fix Design

- Add durable `retry_required` to `PendingSessionInputState`. Schema version 67 adds
  `retry_required_at`; the row is stored as the legacy-safe `blocked` state plus that marker and is
  projected as `retry_required` by the current store. Migration rewrites prerelease raw
  `retry_required` values to this representation. A downgraded binary therefore fences the row and
  can release it through its existing blocked-input Retry path instead of dispatching past an
  unknown state.
- Failed DeepChat Queue settlements transition `claimed -> retry_required`. Intentional temporary
  release for Queue-to-Steer mutation and cold-start repair continue to transition to `pending`.
- Keep `retry_required` in Queue ordering while excluding it from claimable work. Claimed Queue
  rows retain their occupied order slot during move, delete, and Queue-to-Steer resequencing, so a
  later release cannot create duplicate order values or let another row overtake it.
- Add an idempotent per-item DeepChat retry operation under the existing Session operation gate.
  The first request transitions `retry_required -> pending` and asks the existing pump to drain;
  stale repeated requests are no-ops. The addressed row need not be the current head: an explicit
  Send can be claimed behind an older restart-held draft or as a question follow-up, then fail
  before committing its user fact. Retry authorizes that exact row while the pump continues to
  enforce FIFO execution of any earlier rows.
- Preserve restart behavior: an existing `retry_required` row remains retry-required and is not
  added to the restart hold. Ordinary pending rows and recovered claimed rows remain restart-held.
  Resume Queue is available only when the actual FIFO head is restart-held.
- Keep ACP release behavior unchanged. ACP continues to release failed Queue claims to `pending`.
- Label retry-required rows in the existing Queue lane, expose Retry, and suppress invalid Steer and
  reorder actions. Attachment-blocked actions remain unchanged.
- Editing a retry-required row is an explicit content mutation that authorizes a new attempt and
  transitions the row back to `pending`, preserving existing behavior without relying on it as the
  only recovery path.

## Compatibility And Safety Invariants

1. Ordinary live Queue drafts remain `pending` and retain their existing actions.
2. A later Queue row is never claimed while a retry-required row is ahead of it.
3. Claimed Queue rows keep a unique occupied order slot across every waiting-row resequence.
4. Duplicate Retry requests create at most one state transition, claim, and turn.
5. Retry schedules only the addressed Session and never claims directly from the route.
6. A manually resumed Queue item retains its consume-before-provider marker if a pre-user-fact
   failure makes it retry-required.
7. A mixed restart queue with a retry-required head and restart-held tail cannot release the tail
   through Resume Queue.
8. Attachment-blocked Retry and Send without image content keep their existing state machine.
9. Downgrade sees retry-required rows as blocked work; an old Retry changes the persisted state to
   `pending`, which the current projection honors even if the additive marker remains.
10. No message text, attachment path, or payload is added to diagnostics.

## Tasks

- [x] Add and enforce the durable retry-required state and distinct release transitions.
- [x] Add the gated, typed, idempotent retry route through the existing pump.
- [x] Project retry-required state and action in the renderer with localized copy.
- [x] Add focused persistence, pump, restart, route, and renderer regressions.
- [x] Run format, i18n, lint, typecheck, and relevant main/renderer tests.
- [x] Review the staged change for side effects, compatibility, boundaries, performance, security,
  naming, coverage, and maintenance cost before committing.

## Validation

```bash
pnpm exec vitest run --config vitest.config.ts \
  test/main/session/data/tables/deepchatPendingInputsTable.test.ts \
  test/main/session/data/pendingInputs.test.ts \
  test/main/agent/deepchat/runtime/pendingInputPump.test.ts \
  test/main/agent/deepchat/runtime/pendingInputAdmissionCoordinator.test.ts \
  test/main/session/turn.test.ts \
  test/main/routes/dispatcher.test.ts
pnpm exec vitest run --config vitest.config.renderer.ts \
  test/renderer/components/PendingInputLane.test.ts \
  test/renderer/features/chat-page/composables/usePendingInputActions.test.ts \
  test/renderer/stores/pendingInputStore.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```
