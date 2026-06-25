# Agent Plan / `update_plan` Task — Tasks (v4)

> Implemented. Decisions D1–D4 are hard-resolved in `spec.md` (D4: agent-mode history
> shows an inline `type:'plan'` block — settled). Ordered so the cheap terminal-state wins ship
> before the persistence refactor. Each task is one reviewable commit/PR.

## Increment 0 — De-risk (must precede Increment 2)

- [x] **T1 — ACP reachability audit (R5/AC14).** Trace both ACP subsystems end-to-end: does a
      `type:'plan'` block today reach the persisted message stream and render via `MessageBlockPlan`?
      Cover subsystem A (`acpProvider.handleSessionUpdate`, which drops `mapped.blocks`) vs subsystem
      B (`AcpEventMapper`, instantiated at `acpClientPresenter/index.ts:18` but whose
      `mapSessionUpdate` has **no found call site**). Record findings in
      `acp-plan-reachability.md`. Output decides AD2 wiring (T8). **No deletion of `MessageBlockPlan`.**

## Increment 1 — Stop the "stuck spinner" (no persistence, immediate value)

- [x] **T2 — Prompt closure discipline (R7/AC22).** Extend `buildProgressPrompt`: reconcile every
      step before finishing, never end a turn with a dangling `in_progress`. Mirrors Codex's
      plan-closure rule. (+ prompt snapshot test.)
- [x] **T3 — Per-turn baseline + live freeze/rebaseline transitions (R2/AC4 live, AC5; C1).** In the
      store add `beginTurn(sessionId)` (reset baseline → 0) and `freezeActive(sessionId)` (stops the
      **live** spinner). Wire `beginTurn` into `onSubmit`/`onSteer`/`onMessageRetry`/
      `onMessageEditSave`/`onMessageContinue`; wire `freezeActive` into `onStop`. **No blanket
      delete.** Scope: this only fixes the live in-session spinner; the persistable terminal marker
      (reload) is T6. (+ renderer test: stop mid-plan → live float no longer spins; retry → clean
      overlay.)
- [x] **T4 — Auto-collapse + sticky dismiss + default-expanded (R2/AC6,AC7; AC19).** View-state
      `{ collapsed, dismissedRevision }`; default `collapsed=false` first appearance; auto-collapse
      when all complete; `dismiss` sets `dismissedRevision`. (+ store test.)

## Increment 2 — Persisted plan block + terminal state + rehydration (depends on T1; D1/D2/D4)

- [x] **T5 — Upsert THE `type:'plan'` block per turn (R1/AD1).** In `dispatch.applyProgressUpdate`,
      upsert the single `type:'plan'` block of the turn — locate the lone `type:'plan'` block in
      `state.blocks`, mutate in place, else insert it **immediately after the first (hidden)
      `update_plan` tool-call block**; carry
      `plan_entries/plan_explanation/plan_revision/plan_updated_at`; keep the tool-call block
      `internalTool=true`. **Rewrite `dispatch.test.ts:299`** to assert the upsert (idempotent across
      revisions, never duplicated) + event. (+ test.)
- [x] **T6 — Persistable terminal marker on every turn-exit (R2/AC4 reload; AD6).** Add
      `state.planTerminalReason?: 'aborted'|'max_steps'|'error'` to `StreamState` (`types.ts`); set
      it `= 'max_steps'` right before the `break` at `process.ts:404`. Add an **idempotent** helper
      `stampPlanTerminalIfOpen(state, io, reason)` that stamps `plan_terminal_reason` onto the latest
      `type:'plan'` block (only when a step is still `in_progress`) and emits one final
      `chat.plan.updated`. Call it from **all three exits**: `finalizeError` (`dispatch.ts:1489` —
      covers cancel `process.ts:95`, tool error `:440`, context-window `:504`, no-response `:512`,
      non-abort exception `:538`, interrupted recovery `messageStore.ts:615`), the `finalize`
      (`:1475`) after `MAX_TOOL_CALLS`, **and the abort-exception catch branch (`process.ts:527-535`)
      before its early `return`** (reason `aborted`). **Persistence boundary:** DB writes live only
      in the finalize family (`updateAssistantContent` :1449 / `finalizeAssistantMessage` :1475 /
      `setMessageError` :1504), so call the helper **before** those writes in `finalize`/
      `finalizeError`, and in the abort-exception branch **persist after stamping**
      (`messageStore.updateAssistantContent` + `flushBlocksToRenderer`) since it has no finalize.
      (`buildTerminalErrorBlocks` flips block status only — never rely on it for entry status.)
      **Extend the event contract** `chat.events.ts:47-57`
      with optional `terminalReason: z.enum(['aborted','max_steps','error'])` (+ update the
      `defineEventContract` test; `AgentPlanViewSnapshot` derives it). Render `in_progress`
      **without** `animate-spin` when terminal — directly in `MessageBlockPlan.vue` +
      `AgentProgressFloat.vue` for now (consolidated into the composable by T13). (+ main tests:
      cancel / **abort-exception (plan written → provider throws `AbortError` → `aborted`,
      asserted persisted to messageStore, not just emitted)** / tool-error / exception / max-steps;
      + renderer test: reload after an error/abort ending → no spin.)
- [x] **T7 — Rehydrate live float from persisted block on load/switch (R1/AC1–AC3; C1).** On
      `loadMessages` / sessionId switch, take the latest `type:'plan'` block and
      `agentPlanStore.applySnapshot`; rely on `beginTurn` (T3) so a subsequent live turn rebaselines
      cleanly. Per-conversation isolation. (+ renderer rehydration + switch-isolation tests, incl.
      the C1 guard.)
- [x] **T8 — Converge ACP onto the same block (R5/AC15; AD2).** Per T1's outcome, fix the ACP
      producer/transport so its `type:'plan'` block renders via `MessageBlockPlan`; remove the
      divergent/dead branch (producer side only — renderer stays). (+ test for the live ACP path.)

## Increment 3 — Backend hygiene

- [x] **T9 — Bound `states` + purge renderer (R3/AC8).** Wire `planTool.clearState(sessionId)` into
      `destroySession` and `agentPlanStore.purge` on conversation delete. Backend revision may stay
      process-local (safe under C1). (+ main test.)
- [x] **T10 — Remove dead surface (R3/AC9).** Drop `rawData.toolResult.snapshot` (only `onProgress`
      consumed); remove `getState`/`clearState` if T9 leaves them unused. Document `onProgress` as
      sole transport.
- [x] **T11 — Subagent orphan-key + missing-`toolCallId` (R3/AC10,AC11).** Stop subagent
      `update_plan` from polluting the parent `states` Map; treat a missing `toolCallId` as an error
      or logged drop, not silent success. (+ main tests.)

## Increment 4 — Contracts & DRY

- [x] **T12 — Status enum single source (R4/AC12; AD5).** `agentPlanStepStatusSchema` /
      `agentPlanItemSchema` once in shared; import in tool schema + event contract; remove
      re-declarations and the unreachable `failed`/`skipped` i18n (AC21).
- [x] **T13 — Shared status presentation composable (R4/AC13; AD4).** Extract
      `useAgentPlanStatus.ts` (+ `normalizePlanEntry` + `resolveStepPresentation` incl. the terminal
      non-spin rule from T6); both renderers consume it; unify completed styling.

## Increment 5 — UX / i18n / a11y polish (independent, low-risk)

- [x] **T14 — Parameterized completed counter (R6/AC16).** One pluralizable
      `chat.workspace.plan.completedCount` across locales; float + inline badge consistent.
      (+ per-locale render test.)
- [x] **T15 — Contrast + a11y (R6/AC17,AC18).** Completed-step text at `text-foreground` (mute icon
      only); `aria-live="polite"`/`role="status"`; single disclosure control with `aria-expanded` +
      `aria-controls`; drop the redundant chevron tab stop.
- [x] **T16 — Prune persisted view-state (R6/AC20).** GC the renamed `agent-plan-view-state` key on
      conversation deletion (same flow as T9); one-time prune the legacy `agent-plan-collapsed` key.

## Increment 6 — Review follow-up fixes

- [x] **T17 — Accept same-revision terminal updates.** Keep terminal stamps on the existing plan
      revision, but let `agentPlanStore.applySnapshot` accept a same-revision snapshot that adds or
      changes `terminalReason`, so the live float does not keep spinning after `max_steps`/error.
- [x] **T18 — Make dismiss turn-sticky and store getters pure.** Replace revision-based dismiss
      gating with a turn-scoped `dismissed` flag reset by `beginTurn`; make `isVisible` and
      `isCollapsed` pure reads that do not create localStorage entries.
- [x] **T19 — Tighten rehydration.** Rename the store clear API to `clearSnapshot`, update
      `ChatPage`, and scan loaded messages from newest to oldest, stopping at the first persisted
      `type:'plan'` block.
- [x] **T20 — Backend cleanup.** Reduce `AgentPlanState` to the revision value that remains in use
      and share the canonical `update_plan` tool-name constant with the shared block helper.
- [x] **T21 — Add runtime regression tests.** Cover subagent/no-progress isolation, process-level
      `MAX_TOOL_CALLS` terminal stamping, abort-exception persistence, and terminal-stamp
      idempotency with cloned messageStore write assertions.
- [x] **T22 — Add renderer regression tests.** Cover same-revision terminal acceptance, backend
      terminal reason overriding optimistic freeze, sticky dismiss through later revisions, pure
      getters, and session switch rehydration isolation.

## Increment 7 — Second review follow-up fixes

- [x] **T23 — Make dismiss message-scoped.** Store the dismissed `messageId` instead of a
      session-level boolean; keep dismiss sticky for the current turn and allow the next auto-drained
      turn to show its live float without requiring renderer `beginTurn`.
- [x] **T24 — Treat changed `messageId` as a new live plan turn.** Let `agentPlanStore.applySnapshot`
      accept a lower/equal revision when `messageId` changes, while preserving same-message revision
      monotonicity and same-revision terminal-only updates.
- [x] **T25 — Reset backend plan state at new assistant turn creation.** Add
      `clearAgentPlanState(sessionId)` as a narrow ToolPresenter method and call it after
      `createAssistantMessage`, covering user sends and main auto-drained queue turns without
      clearing tool mappings.
- [x] **T26 — Add second-review regression tests.** Cover no-`beginTurn` next-message visibility,
      same-revision non-terminal drops, narrow clear-state wiring, auto-queue reset calls, and direct
      `snapshotFromAgentPlanBlock` hydration behavior.

## Increment 8 — Third review follow-up fixes

- [x] **T27 — Strengthen error stamp persistence guard.** Capture `setMessageError` blocks at call
      time and assert ordinary `finalizeError` writes already include `plan_terminal_reason: 'error'`.
- [x] **T28 — Strengthen renderer purge view-state guard.** Make `agentPlanStore` tests assert the
      real `useStorage` value shape so `purge(sessionId)` must delete persisted view-state.
- [x] **T29 — Keep new-message live plans expanded.** Reset collapsed state when `applySnapshot`
      accepts a changed `messageId`, covering main auto-drained queue turns that do not call
      `beginTurn`.
- [x] **T30 — Make auto-collapse transition-only.** Auto-collapse only when the same message moves
      from not-all-completed to all-completed, not during rehydration or repeated completed updates.

## Sequencing notes

- **T1 first** — resolves the only remaining ambiguity (ACP reachability) and unblocks T5/T8.
- Increment 1 (T2–T4) ships independently, no persistence, fixes the most visible **live** symptom;
  safe before T5 because freezing/rebaselining the live overlay does not touch persisted history.
- T5 carries a deliberate test-contract change; T6 (terminal marker) and T7 (rehydration) must land
  with it so reload never shows a spinning or vanished plan. T7 must include the C1 guard test.
- Increments 3–5 are cleanup; interleave once Increment 2's contracts are settled. T13 absorbs the
  inline terminal-render added directly in T6.
