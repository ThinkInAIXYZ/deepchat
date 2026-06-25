# Agent Plan / `update_plan` Task — Plan (v4)

> Active planning doc. Delete after implementation; fold durable facts into
> `docs/architecture/agent-system.md` or `tool-system.md`. v4 broadens the terminal marker to cover
> **every** turn-exit incl. the abort-exception early return (AD6), threads `max_steps` via
> `StreamState`, and clarifies that ACP and agent-runtime share one block-builder helper, not one
> entry point (AD2).

## Involved modules

| Layer | File | Role today |
| --- | --- | --- |
| Backend tool | `src/main/presenter/toolPresenter/agentTools/agentPlanTool.ts` | `update_plan` def, `states` Map, snapshot/revision |
| Tool wiring | `src/main/presenter/toolPresenter/agentTools/agentToolManager.ts` | agent-mode gating (`isAgentMode`, :373), tool-call routing |
| Prompt | `src/main/presenter/toolPresenter/index.ts` | `buildProgressPrompt` (:641-657) |
| Runtime | `src/main/presenter/agentRuntimePresenter/dispatch.ts` | `markInternalPlanToolCallBlock` (:371), `publishPlanUpdated` (:385), `agent_plan` branch (:916), `finalize` (:1475) / `finalizeError` (:1489) |
| Runtime loop / finalize | `src/main/presenter/agentRuntimePresenter/process.ts` | `while(true)` loop (:327), `MAX_TOOL_CALLS` break→`finalize` (:404), `finalizeError` calls (:95,440,504,512,538), **abort-exception early return (:527-535, bypasses finalize)** |
| Error finalize | `src/main/presenter/agentRuntimePresenter/messageStore.ts` | `buildTerminalErrorBlocks` (:39) flips block `status`→`error` only — does **not** touch `plan_entries[*].status`; interrupted recovery (:615) |
| Runtime lifecycle | `src/main/presenter/agentRuntimePresenter/index.ts` | `destroySession` (:528-554), cancel/abort |
| Runtime state | `src/main/presenter/agentRuntimePresenter/types.ts` | `StreamState` — add `planTerminalReason` |
| ACP (subsystem A) | `llmProviderPresenter/acp/acpContentMapper.ts`, `providers/acpProvider.ts`, `aiSdk/.../accumulator.ts` | builds `type:'plan'` block; `acpProvider` drops `mapped.blocks` |
| ACP (subsystem B) | `acpClientPresenter/mapper/AcpEventMapper.ts` (instantiated at `acpClientPresenter/index.ts:18`) | maps `mapped.blocks`→`content.block`, `mapped.planEntries`→`plan.updated`; **`mapSessionUpdate` has no found call site** |
| Shared types | `src/shared/types/agent-plan.ts`, `src/shared/contracts/events/chat.events.ts`, `src/shared/contracts/acp.ts` | `AgentPlanStepStatus`, snapshot/item, event payloads |
| Store | `src/renderer/src/stores/ui/agentPlan.ts` | in-memory `snapshots`, persisted `collapsedBySession`, revision gate (:12) |
| UI (live) | `src/renderer/src/components/chat/AgentProgressFloat.vue` | the float in the screenshot |
| UI (persisted) | `src/renderer/src/components/message/MessageBlockPlan.vue` | `type:'plan'` renderer (`MessageItemAssistant.vue:69`); spins on `in_progress` (:139) |
| Wiring | `src/renderer/src/pages/ChatPage.vue` | `onPlanUpdated` (:1860), dismiss (:999), stop/retry/continue (:1736/1746/1797) |
| i18n | `src/renderer/src/i18n/*/chat.json` (`chat.workspace.plan.*`) | labels incl. dead `failed`/`skipped` |

## Architecture decisions

### AD1 — Single persisted representation = the `type:'plan'` block (D1, D4)
The persisted, in-history plan is a `type:'plan'` block rendered by `MessageBlockPlan.vue`. The live
`AgentProgressFloat` is a transient overlay during active generation; on reload it rehydrates from
the latest persisted plan block of the conversation. The hidden `update_plan` tool-call block stays
transport/provenance only (`extra.internalTool=true`, not double-rendered).

The agent-runtime path **projects each `update_plan` snapshot into a persisted `type:'plan'`
block**. This intentionally changes the contract asserted by `dispatch.test.ts:299` ("does not
insert plan blocks"); that test is rewritten to assert the upsert behavior.

**Upsert identity & position.** There is **at most one `type:'plan'` block per assistant message**.
The producer locates it by scanning the current turn's block stream (`state.blocks`) for a
`type:'plan'` block: if present it mutates that block in place; otherwise it inserts one
**immediately after the first (hidden) `update_plan` tool-call block** of the turn, then mutates that
same block in place for every later revision. Later revisions never move or duplicate it. Identity is
"the lone `type:'plan'` block within the active message" — **not** a `toolCallId` (which differs per
`update_plan` call) and **not** `messageId` lookups across the store. Because each turn (including
retry/continue) builds a fresh `state.blocks` for a new assistant message, a new turn yields a new
plan block — there is no cross-turn / cross-message overwrite.

Why not "rehydrate the float from the hidden tool-call params" (rejected D4 alternative): it keeps
two renderers interpreting different sources and leaves `MessageBlockPlan` half-dead. One
`type:'plan'` block consumed by one renderer is the lower-divergence design and gives the ACP path a
home (AD2).

### AD2 — Converge ACP and agent-runtime on one block shape + one builder (D2), after an audit
`AcpContentMapper.handlePlanUpdate` already builds a `type:'plan'` block. The agent-runtime
`update_plan` path and the ACP plan-notification path are **necessarily two entry points** — that is
fine. The constraint is: both must call **one shared plan-block construction/normalization helper**
that produces **one `type:'plan'` block shape**, rendered by the **single `MessageBlockPlan`**
renderer. Different entry points, one builder, one shape, one renderer.

The audit (T1) establishes which ACP subsystem is live end-to-end:
- If subsystem B (`AcpEventMapper` → `content.block`) is the real path, ensure a `content.block`
  carrying a `type:'plan'` block reaches the persisted message stream and renders via
  `MessageBlockPlan`.
- If subsystem A (`acpProvider`) is the real path, it currently drops `mapped.blocks`; wire the
  `type:'plan'` block through (and add a `'plan'` accumulator case if the persisted stream is rebuilt
  there).
Either way the **renderer stays `MessageBlockPlan`** and both paths share the builder helper. No
deletion.

### AD3 — Store models server-state and view-state separately, baseline per-turn (C1)
- `snapshots[sessionId]` is pure server-state for the **current turn's** live overlay. Add
  `beginTurn(sessionId)` that resets the baseline (clears the live snapshot) — called from
  submit/steer/retry/continue. The revision gate then only orders within-turn updates.
- Replace the boolean collapse map with per-session view-state `{ collapsed, dismissedRevision }`
  (persisted). `dismiss` sets `dismissedRevision = current.revision` (sticky) instead of deleting.
- `freezeActive(sessionId)` (for `onStop`): set the live overlay's terminal indicator so the spinner
  stops immediately. This is the **live mirror** of the persisted terminal marker (AD6); the source
  of truth for reload is the stamped block, not this call.
- Float visibility = `snapshot exists && revision > dismissedRevision && entries.length > 0`.
  Default `collapsed=false` on first appearance (AC19); auto-collapse (not delete) when
  `completedCount === total` (AC6).
- `purge(sessionId)` removes the live snapshot + persisted view-state key (on conversation delete /
  `destroySession`).

### AD4 — One shared status presentation module (AC13)
`src/renderer/src/composables/useAgentPlanStatus.ts` exports `STATUS_ICON`, `STATUS_ICON_CLASS`,
`STATUS_BADGE_CLASS`, `entryAriaLabel(t, status, step)`, and a `resolveStepPresentation(status,
{ terminal })` helper that returns a **non-spinning** interrupted indicator for `in_progress` when
the plan is terminal (AD6). Both renderers import it; the completed-step decision is made once (mute
icon, keep text at `text-foreground` for AA — AC17). `MessageBlockPlan`'s ad-hoc `normalizeStatus`/
`done`→`completed` tolerance moves here as a shared `normalizePlanEntry`.

### AD5 — Status enum single source (AC12)
In a shared runtime-capable module: `export const agentPlanStepStatusSchema = z.enum(['pending',
'in_progress','completed'])`, `agentPlanItemSchema = z.object({ step, status })`,
`type AgentPlanStepStatus = z.infer<...>`. `agentPlanTool.ts` and `chat.events.ts` import these.
Remove `failed`/`skipped` i18n (AC21). The step-status enum stays three values (see AD6 for the
block-level terminal marker).

### AD6 — Persistable terminal marker for abnormal/error termination (AC4)
The step-status enum is unchanged (AD5). To represent a turn that ended while a step was still
`in_progress`, add a **block/snapshot-level** field `terminalReason?: 'aborted' | 'max_steps' |
'error'`, persisted into the `type:'plan'` block `extra` (e.g. `plan_terminal_reason`) — additive, no
enum change (C3).

**Crucial: cover every turn-exit, not just `finalizeError`/`finalize`.** Three exits can leave an
open `in_progress` step:
1. `finalizeError` (`dispatch.ts:1489`) — the error/cancel chokepoint reached from user cancel
   (`process.ts:95`), tool terminal error (`:440`), context-window error (`:504`), no-model-response
   (`:512`), a **non-abort** uncaught exception (`:538`), plus interrupted-session recovery
   (`messageStore.ts:615`). Its `buildTerminalErrorBlocks` (`messageStore.ts:39`) only flips block
   `status`→`error`; it does **not** touch `extra.plan_entries[*].status`.
2. The normal `finalize` (`dispatch.ts:1475`) after the `MAX_TOOL_CALLS` `break` (`process.ts:404`).
3. **The abort-exception early-return branch (`process.ts:527-535`)** — when `abortSignal.aborted ||
   isAbortError(err)`, the catch `return`s `{status:'aborted'}` **without calling `finalize` or
   `finalizeError`**. Easy to miss; would leave the plan spinning on reload.

Without handling all three, a persisted plan block keeps its `in_progress` entry and **reloads
spinning** — violating "no step spins after its turn ended".

Implementation: add `state.planTerminalReason?: 'aborted' | 'max_steps' | 'error'` to `StreamState`
(`types.ts`); set it `= 'max_steps'` immediately before the `break` at `process.ts:404`. Introduce
one **idempotent** helper `stampPlanTerminalIfOpen(state, io, reason)` that finds the latest
`type:'plan'` block and, if any entry is still `in_progress` (and not already stamped), sets
`extra.plan_terminal_reason` and emits one final `chat.plan.updated`. Call it from: `finalize`
(reason = `state.planTerminalReason`, i.e. `max_steps`), `finalizeError` (reason `aborted` for
USER_CANCELED, else `error`), **and the abort-exception catch branch before its `return`** (reason
`aborted`). Idempotency makes a redundant call (e.g. an outer cancel path also invoking
`finalizeUserCanceledErrorIfNeeded`, `process.ts:90`) harmless. The shared presentation (AD4) renders
an `in_progress` step as a **static, non-spinning interrupted indicator** whenever `terminalReason`
is set. Normal, well-closed completion needs no marker (R7). `freezeActive` mirrors this in the store
for instant live feedback before persistence round-trips.

**Persistence boundary (so reload, not just live, is fixed).** DB writes happen only in the finalize
family — `finalize` → `updateAssistantContent` (`dispatch.ts:1449`) / `finalizeAssistantMessage`
(`:1475`); `finalizeError` → `setMessageError` (`:1504`). Streaming itself only flushes to the
renderer (`flushBlocksToRenderer`, no DB write). Therefore: (a) at `finalize`/`finalizeError`, call
`stampPlanTerminalIfOpen` **before** the messageStore write so the stamp is persisted; (b) the
abort-exception early-return branch (`process.ts:527-535`) runs **no** finalize and **no** DB write —
after stamping it must itself persist (`messageStore.updateAssistantContent(io.messageId,
state.blocks)` + `flushBlocksToRenderer`) before returning. Without (b), "live not spinning" is fixed
but **"reload not spinning" is not**.

Sequencing note: in Increment 1 (pre-persistence) `freezeActive` only stops the **live** spinner —
acceptable because there is no persisted plan block yet to reload. The persistable stamp + reload
non-spin lands in Increment 2, after the `type:'plan'` block exists (T5).

## Event & data flow (target)

```
update_plan(call)
  → AgentPlanTool: validate, build snapshot (revision = within-turn monotonic)
  → onProgress(agent_plan)                              [single transport; drop toolResult.snapshot]
  → dispatch.applyProgressUpdate (agent_plan, allowProgressUpdates):
        • upsert THE type:'plan' block of this turn (the lone one in state.blocks)        [NEW]
            plan_entries / plan_explanation / plan_revision / plan_updated_at
            (inserted right after the first hidden update_plan tool-call block)
        • keep update_plan tool-call block extra.internalTool=true (provenance, hidden)
        • publishDeepchatEvent('chat.plan.updated', payload)                              (live)
  → ChatPage.onPlanUpdated → agentPlanStore.applySnapshot

turn start (submit/steer/retry/continue):
  → agentPlanStore.beginTurn(sessionId)                 [NEW: reset per-turn baseline → 0]

any turn-exit with an open in_progress step → stampPlanTerminalIfOpen(state, io, reason) [NEW, idempotent]
  • finalizeError (stop / tool-error / context-window / no-response / non-abort exception / interrupted) → error | aborted
  • finalize after MAX_TOOL_CALLS break (state.planTerminalReason='max_steps' set before break) → max_steps
  • abort-exception catch branch (process.ts:527-535) BEFORE its early return → aborted
      (no finalize on this path → must also persist: updateAssistantContent + flushBlocksToRenderer)
  → stamps latest type:'plan' block extra.plan_terminal_reason + one final chat.plan.updated
      (at finalize/finalizeError: stamp BEFORE the messageStore write so the stamp is persisted)
  → agentPlanStore.freezeActive(sessionId)              [live mirror; non-spinning indicator]

session load / reopen / switch:
  → from loaded messages, take the latest type:'plan' block → agentPlanStore.applySnapshot [NEW]
    (history always renders inline via MessageBlockPlan; float overlay optional)

destroySession(sessionId) / conversation delete:
  → planTool.clearState(sessionId)  AND  agentPlanStore.purge(sessionId)                 [NEW]
```

ACP path converges on the same `type:'plan'` block via the shared builder (AD2) after the audit.

## Compatibility & migration

- `type:'plan'` blocks and `block.extra` plan fields (`plan_entries`, `plan_terminal_reason`, …) are
  additive; pre-change conversations have no plan block → rehydrate to "no plan" (C3).
- `collapsedBySession` localStorage (`agent-plan-collapsed`) gains a richer value shape. Per C4 /
  project preference (no compat shims unless required), the decision is to **rename the key** to
  `agent-plan-view-state` and one-time-prune the legacy `agent-plan-collapsed` key on first read,
  rather than ship a legacy-boolean translation shim.
- **Backward-compatible typed-event extension** (not "no change"): `chat.plan.updated` gains an
  optional `terminalReason`. Update the event-contract zod payload in `chat.events.ts:47-57` (add
  `terminalReason: z.enum(['aborted','max_steps','error']).optional()`); `AgentPlanViewSnapshot =
  DeepchatEventPayload<'chat.plan.updated'>` (`agentPlan.ts:6`) then derives the new field
  automatically, and the contract's `defineEventContract` test must be updated. No route/IPC channel
  change. If `AgentPlanViewSnapshot` is later re-expressed as `AgentPlanSnapshot + messageId`, that
  is type-only.

## Test strategy

- **Main (Vitest):**
  - `dispatch.test.ts:299` rewritten: `applyProgressUpdate` upserts the single `type:'plan'` block
    of the turn (idempotent across revisions, never duplicated) and still publishes the event.
  - abnormal/error termination: `finalizeError` (cancel, tool error, context-window, no-response,
    non-abort exception), the `MAX_TOOL_CALLS` `finalize`, AND the **abort-exception early-return
    branch** (plan written, then provider throws `AbortError`) each stamp `plan_terminal_reason`
    (`aborted`/`max_steps`/`error`) on the latest plan block when a step is open and emit a final
    event; for the abort-exception branch assert the stamp is **persisted to messageStore** (a
    reload sees the non-spinning state), not just emitted. Assert no `in_progress` entry survives
    unstamped after any such ending, and the helper is idempotent.
  - `agentPlanTool`: clearState wiring; missing-`toolCallId` behavior; revision monotonic within turn.
  - subagent path leaves no orphan state.
  - ACP: per audit outcome, a `type:'plan'` block is produced/renderable through the live path via
    the shared builder.
- **Renderer (Vitest + VTU):**
  - store: per-turn `beginTurn` baseline (the **C1 guard**: clear → next `revision=1` must render),
    `dismiss` sticky, `freezeActive`, `purge`, auto-collapse.
  - presentation: `in_progress` with `terminalReason` set renders **without** `animate-spin` (live
    float and inline block); completed-step uses `text-foreground` (not 50%-alpha muted); steps
    container has `aria-live`.
  - `AgentProgressFloat`: stop/retry/complete transitions leave no spinning `in_progress`; badge
    i18n renders per-locale (`en`, `ja`) without concatenation artifacts.
  - rehydration: a loaded conversation with a persisted plan block shows the plan (and a frozen one
    does not spin); switching sessions isolates plans.

## Review follow-up fixes

The post-implementation review found one real live-path regression and several missing regression
tests. These are implemented as a follow-up to this same architecture goal.

- Live terminal updates keep the existing tool revision, but `agentPlanStore.applySnapshot` must
  accept a same-revision snapshot when it adds or changes `terminalReason`; otherwise the live float
  can keep spinning until reload even though the persisted inline block is correct.
- `dismiss` is sticky for the whole active turn, not just the current revision. `beginTurn` resets
  the dismissed flag.
- Store read paths (`isVisible`, `isCollapsed`) are pure and do not create persisted view-state keys.
- Rehydration scans loaded messages from newest to oldest and stops at the first persisted plan
  block.
- Follow-up tests cover the subagent/no-progress path, process-level `max_steps` and abort-exception
  wiring, same-revision terminal updates, sticky dismiss, pure getters, and session switch
  rehydration isolation.

## Second review follow-up fixes

The second review found a real queue-path regression in the first follow-up: `dismiss` became
session-scoped while `beginTurn` is only called by renderer user handlers. Main-process automatic
pending-queue drain starts a new assistant turn without calling `beginTurn`, so the previous turn's
dismissed state can hide the next turn's live float.

- `dismiss` is keyed to the current snapshot `messageId`, so it remains sticky for the active turn
  but cannot leak into a later auto-drained turn.
- `agentPlanStore.applySnapshot` treats a changed `messageId` as a new turn boundary and accepts the
  snapshot even when its revision is lower than the previous turn's last revision. Within the same
  `messageId`, revision monotonicity remains intact and only same-revision terminal reason changes
  are accepted.
- Main exposes a narrow `clearAgentPlanState(sessionId)` path and calls it after creating a new
  assistant message. This resets backend `update_plan` revision state for user-initiated turns and
  main auto-drained queue turns without clearing tool mappings.
- Tests cover the no-`beginTurn` auto-queue-visible store path, same-revision non-terminal drops,
  direct plan-state reset wiring, auto-queue reset calls, and direct persisted-plan rehydration
  helper behavior.

## Third review follow-up fixes

The third review found no functional blocker, but it identified two test guards that were still too
weak and two renderer view-state edge cases.

- `finalizeError` tests must capture the `setMessageError` write-time blocks with `structuredClone`
  and assert the persisted plan block already has `plan_terminal_reason: 'error'`.
- Renderer store tests must assert the actual `useStorage` value shape so `purge(sessionId)` cannot
  become a no-op while tests stay green.
- `agentPlanStore.applySnapshot` resets collapsed state when a changed `messageId` establishes a new
  live turn, so auto-drained queue turns appear expanded even when the previous turn was dismissed.
- Auto-collapse runs only when the same message transitions from not-all-completed to all-completed;
  rehydration or repeated completed snapshots must not override a user's manual expansion.

## Risks

- **AD1 contract change** (`dispatch.test.ts:299`) is deliberate but touches a persisted-block
  invariant; keep it isolated to one PR with the rewritten test + a rehydration test. The upsert
  identity ("lone `type:'plan'` block in `state.blocks`") must be covered so revisions never
  duplicate the block.
- **C1 guard** (fresh-`revision=1`-dropped) is the highest-risk regression; the store test must
  reproduce "beginTurn → revision 1 → renders".
- **AD6 main-side stamping** must hook **every** turn-exit: `finalizeError`, the `MAX_TOOL_CALLS`
  `finalize`, AND the **abort-exception early-return branch (`process.ts:527-535`) which bypasses
  both** — or a reloaded plan still spins. Three traps: (1) `buildTerminalErrorBlocks` not touching
  `plan_entries` status; (2) the abort branch returning before any finalize; (3) **DB writes living
  only in the finalize family** — so the abort branch must persist (`updateAssistantContent` + flush)
  after stamping, else "live" is fixed but "reload" is not. Cover each trigger (cancel,
  abort-exception, tool-error, exception, max-steps) in tests **including a reload/persistence
  assertion**; make the helper idempotent.
- **AD2 audit** may reveal subsystems A/B are both partially wired; resolve to one before touching
  the hot path. Audit is its own task (T1), output recorded in this folder.
- Scope: R6 items are independent low-risk cleanups — separate commits so R1/R2 stay reviewable.
