# Live Delegation Interaction And Projection Hardening

Status: implemented and validated.

GitHub issue: not requested or created; this is a local SDD record.

## Issue

The durable live-delegation lifecycle was complete, but four cross-boundary gaps remained:

1. A child waiting for tool permission or a question response cannot be resumed from the UI. The
   parent card shows the waiting status and opens the child Session, but Subagent Sessions hide the
   composer region that owns `ChatToolInteractionOverlay`, and the response composable rejects all
   read-only Sessions.
2. Initial handoff delivery records `startedAt` only after `sendConversationMessage()` resolves. A
   host crash after the child accepts the message but before that write can make restart recovery
   classify an idle child as never dispatched and discard a recoverable result.
3. Repeated block projections of an unchanged permission/question wait rewrite the same durable
   status, increment its revision, and emit redundant renderer events.
4. A successful renderer list refresh only upserts authoritative live-delegation summaries. Items
   omitted from the bounded latest list remain in memory indefinitely for that renderer lifetime.

## Impact

- A normal child write, shell command, or clarification can deadlock until the user interrupts it.
- A narrow crash window can turn accepted child work into an interrupted result after restart.
- Tool-heavy child streams can generate avoidable database writes and IPC updates while waiting.
- Repeated bounded list refreshes do not bound the authoritative renderer projection itself.

## Root Cause

- Read-only Session policy was applied to the whole composer region and response callback instead
  of distinguishing conversation mutation from responding to an already pending host interaction.
- `startedAt` was treated as an acknowledgement written after delivery rather than a write-ahead
  dispatch intent used to correlate any subsequently persisted child answer.
- Waiting-state projection lacked a same-state guard before calling the revisioned repository
  transition.
- The renderer did not treat a successful bounded list response as an authoritative membership
  snapshot. It also needs to preserve newer events that race with an older list request and keep
  untrusted transcript seeds non-authoritative until host confirmation.

## Implemented Fix

1. Keep Subagent Sessions read-only for composition, message edits, retry, deletion, and pending
   input. Mount an interaction-only dock when their own transcript has a pending permission or
   question, and allow that dock to call the existing typed response route for the child Session.
2. Persist the running/dispatch marker immediately before invoking child handoff delivery. Keep the
   in-memory `started` flag false until delivery resolves so Tape linking and runtime settlement
   continue to represent an accepted child turn.
3. Persist and publish waiting transitions only when the durable turn status actually changes.
4. After a successful list refresh, remove pre-request authoritative entries absent from the
   response only when no newer event replaced them. Preserve non-authoritative transcript seeds.
5. Add focused main and renderer regressions for child interaction response, write-ahead handoff,
   waiting idempotence, authoritative pruning, and stale-list/event races.

## Compatibility And Non-goals

- Keep `subagent_orchestrator` as hidden call-routing compatibility. Removing or redirecting its
  separate batch state machine is an architecture migration, not a safe bug fix; the model catalog
  continues to expose only `deepchat_subagents` for live delegation.
- Do not duplicate child action blocks into the parent transcript or add another persisted waiting
  interaction source. Parent cards retain waiting status and child navigation.
- Do not auto-approve child tools or broaden any permission policy.
- Do not hard-disable explicit-policy tools: explicit user, Skill, and project-instruction
  delegation remains supported by the current architecture.
- Do not add parallel-writer isolation or exactly-once side-effect claims.
- Pending parent-to-child messages are already bounded to 16 per delegation and 8 KiB each; no
  event-retention change is needed for the reported unbounded-message concern.
- Service decomposition and terminology consolidation remain maintenance follow-ups, not behavior
  changes in this issue.

## Acceptance Criteria

1. Opening a waiting Subagent Session exposes its permission/question control while every ordinary
   conversation mutation remains unavailable.
2. Responding uses the child Session, message, and tool-call identities and refreshes only the
   still-active child view.
3. Restart can correlate an answer accepted in the handoff crash window, while a handoff that never
   resolves still does not count as an in-memory started child for Tape settlement.
4. Repeated identical waiting projections do not change the durable revision or publish another
   live-delegation event.
5. Successful bounded refreshes prune stale authoritative summaries without deleting transcript
   seeds or a newer event that arrived during the request.
6. Existing regular-Session interaction UX, read-only Subagent restrictions, Workflow child
   navigation, result paging, recovery, and hidden batch compatibility remain intact.

## Task Checklist

- [x] Validate each reported finding against production code and retained architecture.
- [x] Add the interaction-only Subagent response surface.
- [x] Move initial handoff correlation to a write-ahead boundary.
- [x] Make repeated waiting projections idempotent.
- [x] Bound authoritative renderer projections after refresh.
- [x] Add focused regressions and run project validation.
- [x] Complete the pre-commit review and record findings by severity.

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test:renderer -- --reporter=dot`: 249 files and 2,004 tests passed.
- `pnpm run test:main -- --reporter=dot`: 502 files and 5,885 tests passed; 27 files and
  403 tests requiring unavailable native capabilities were skipped by the existing harness.
- `ELECTRON_RUN_AS_NODE=1 pnpm exec electron node_modules/vitest/vitest.mjs run --config
  vitest.config.ts test/main/orchestration --reporter=dot`: 5 files and 38 native orchestration
  tests passed.
- The focused ChatPage, interaction composable, renderer projection, dispatcher, and related
  delegation-card suites passed.

## Pre-commit Review

1. **Critical — fixed:** waiting child permissions and questions had no actionable UI. The child
   view now exposes only the pending interaction surface and keeps all conversation mutation
   disabled.
2. **Medium — fixed:** handoff correlation had a crash window between accepted delivery and the
   durable start marker. The marker is now a write-ahead dispatch intent; in-memory acceptance and
   Tape settlement still wait for delivery to resolve.
3. **Medium — fixed:** successful bounded refreshes could retain stale authoritative summaries.
   Pruning is fenced by entry identity so an in-flight event cannot be deleted, while transcript
   seeds remain non-authoritative.
4. **Low — fixed:** repeated identical waiting blocks caused revision and IPC churn. Same-state
   projections are now no-ops.
5. **No change required:** the old batch tool remains hidden call-routing compatibility, effect
   escalation is already idempotent, runtime status transitions are already guarded, and pending
   parent-to-child messages already have count and byte limits.
