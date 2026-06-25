# Agent Plan / `update_plan` Task — Refactor Spec

> Status: **proposal, decisions resolved (v4)** — incorporates four review rounds. No code change yet.
> Derived from a full review of the `update_plan` task feature (backend tool → agent runtime →
> renderer float + inline block). v4 hard-resolves D4, covers the terminal marker across **every**
> turn-exit (incl. the abort-exception early return), threads `max_steps` via `StreamState`, defines
> the plan-block upsert identity, and tightens the ACP-reachability and one-builder wording.

## Problem

The "计划 / Progress Checklist" task surface (the floating `AgentProgressFloat` shown during a
multi-step agent turn) is functionally a port of Codex's `update_plan` tool, but it shipped with two
disconnected plan representations and a cluster of lifecycle bugs that make a finished or aborted
plan look stuck.

1. **Two disconnected plan representations.**
   - **Live path (DeepChat agent mode):** `update_plan` tool → `onProgress(agent_plan)` →
     `chat.plan.updated` event → `agentPlan` Pinia store → `AgentProgressFloat.vue`. The store is
     **in-memory only and not rehydrated on reload**. The agent-runtime path **deliberately does not
     persist a plan block** — `test/main/.../dispatch.test.ts:299` asserts "publishes plan update
     events without inserting plan blocks into messages", and the `update_plan` tool-call block is
     hidden inline via `isInternalToolCall` (`MessageItemAssistant.vue:71`).
   - **Persisted/ACP path:** `AcpContentMapper.handlePlanUpdate` builds a `type:'plan'` block with
     `extra.plan_entries` (`acpContentMapper.ts:245`); `MessageBlockPlan.vue` renders `type:'plan'`
     blocks (`MessageItemAssistant.vue:69`).
   - **Correction vs. the original review:** the original review called the inline/ACP path
     "entirely dead". That is **not established**. The main `acpProvider.handleSessionUpdate`
     forwards only `mapped.events` (drops `mapped.blocks`), but a second mapper —
     `acpClientPresenter/mapper/AcpEventMapper.ts:21-27` — maps `mapped.blocks`→`content.block` and
     `mapped.planEntries`→`plan.updated`. `AcpEventMapper` **is instantiated**
     (`acpClientPresenter/index.ts:18`), but **no call site for its `mapSessionUpdate` was found** in
     repo grep. There are two parallel ACP subsystems and end-to-end reachability is genuinely
     ambiguous. **A reachability audit is required before any deletion** (see R5).

2. **Lifecycle / stale-state bugs (live path).** The float can show a finished or aborted plan
   indefinitely:
   - Disappears entirely after app reload / reopening a conversation (store is in-memory only).
   - Re-shows a stale plan on conversation switch (the `sessionId` watcher never touches the plan
     store; `ChatPage.vue:782`).
   - `onStop` / `onMessageRetry` / `onMessageEditSave` / `onMessageContinue` never reset the store
     (`ChatPage.vue:1736,1746,1797`), so an aborted or regenerated turn leaves the last
     `in_progress` step **spinning forever** (`MessageBlockPlan.vue:139` / `AgentProgressFloat.vue`
     `animate-spin`).
   - An all-completed plan never auto-collapses; `dismiss` is not sticky.

3. **Backend state hygiene.** `AgentPlanTool` keeps a process-lifetime `states` Map used only as a
   `revision++` counter (`agentPlanTool.ts:55,94`). `getState`/`clearState` have **zero production
   callers**; the Map is never cleared on `destroySession`, and a subagent's `update_plan` pollutes
   it with orphan keys that no UI reads. The renderer's monotonic revision gate
   (`agentPlan.ts:12`) silently depends on this Map never being cleared.

4. **No single source of truth.** Status→presentation mapping is hand-copied across
   `AgentProgressFloat.vue` and `MessageBlockPlan.vue` and has **already drifted** (completed step is
   emerald in one, muted in the other). The status enum is hand-written in three places (TS union,
   tool zod schema, event-contract zod schema).

5. **UX / i18n / a11y gaps.** The inline badge concatenates a standalone status word into a counter
   (`2/5 完了しました` in ja), completed-step text fails WCAG AA contrast, there is no `aria-live`
   region, the float defaults to collapsed on first appearance, and there are two redundant collapse
   controls. `status.failed` / `status.skipped` i18n keys are unreachable (enum has only three
   values).

## Current trigger conditions (verified — not changing)

The task fires **only** when all of these hold; firing itself is **model-decided** (no code
threshold):

- Chat mode is DeepChat-native `agent` (`agentToolManager.getAllToolDefinitions`: `isAgentMode`
  gate, line 373). Plain chat and **ACP agent mode do not expose `update_plan`**.
- The tool is in the tool list, which injects the `## Progress Checklist Tool` system-prompt block
  (`toolPresenter.buildProgressPrompt`, lines 641-657).
- The model chooses to call it mid-turn inside the agent `while(true)` loop (`process.ts:327`).
  There is **no turn-end event** that finalizes or clears the plan — the root cause behind the
  stale-float bugs.

## Resolved decisions

- **D1 — One persisted representation: the `type:'plan'` block.** `MessageBlockPlan.vue` (rendering
  `type:'plan'` blocks) is the **single visible, persisted plan renderer**. The live
  `AgentProgressFloat` is a **transient overlay during active generation**, rehydrated from the same
  persisted plan snapshot. The hidden `update_plan` tool-call block stays **transport/provenance
  only**. The agent-runtime path therefore **projects each plan update into a persisted
  `type:'plan'` block** (this intentionally changes the `dispatch.test.ts:299` contract — that test
  is rewritten, not worked around).
- **D2 — ACP plans render through the same `type:'plan'` block.** Both the agent-runtime
  `update_plan` path and the ACP path converge on `type:'plan'` blocks rendered by
  `MessageBlockPlan.vue`, which is **kept and hardened, never deleted**. Exact ACP wiring depends on
  the reachability audit (R5/T1).
- **D3 — Increment ordering.** The cheap terminal-state fixes (R2) and prompt closure (R7) ship
  **first and independently of persistence**. Persistence/rehydration (R1) is the second increment.
  Safe because, once R1 lands, "reload shows last state" is satisfied by the **persisted block**, not
  the live store — so resetting the live store on stop/switch (R2) no longer conflicts with R1.
- **D4 — Accepted (hard decision): agent-mode history shows an inline `type:'plan'` block.**
  DeepChat agent-mode turns now render an inline plan checklist block in message history (previously
  only the ephemeral float showed). The float is the live overlay during generation and rehydrates
  from the same persisted snapshot; the inline block is the persisted history record. The rejected
  alternative was float-only history rehydrated from hidden tool-call params, which keeps two
  divergent renderers. **This is settled — not deferred to implementation.**

## User stories

- **U1** When a turn finishes or is stopped, the checklist reflects a terminal state — no step is
  left spinning as if work were still running, **including after reload**.
- **U2** When I reopen a conversation or reload the app, I still see the plan the agent produced for
  that conversation, in its last state.
- **U3** When switching conversations, each conversation shows its own plan (or none), never a stale
  plan bled in from another conversation or a previous turn.
- **U4** When I dismiss the float, it stays dismissed for the current turn.
- **U5** As a screen-reader / keyboard user, plan progress changes are announced, the disclosure
  control is unambiguous, and completed steps are legible (AA contrast).
- **U6** As a translator, every shipped plan string is reachable and reads naturally in my locale.

## Requirements & acceptance criteria

### R1 — One plan model, persisted + rehydrated (U2, U3; D1)
- Each plan update is persisted as a `type:'plan'` block on the assistant message (single block per
  turn — see plan.md AD1 for the upsert identity). The live float rehydrates from the persisted plan
  on session load / reopen.
- AC1: After reload, reopening a conversation that ran a plan shows its last plan state (inline block
  always; float overlay optional).
- AC2: Switching A→B→A shows A's own last plan (or none), never B's or a stale turn's.
- AC3: The live store baseline is **per-turn** (Constraint C1) — rehydration and new turns never
  silently drop a fresh plan.

### R2 — Terminal-state correctness (U1, U4)
- AC4: On **any** turn exit that leaves a step `in_progress` — user `onStop`, a provider **abort
  raised as an exception (the early-return catch branch)**, tool terminal error, context-window
  error, no-model-response, a non-abort uncaught exception, interrupted-session recovery, or
  `MAX_TOOL_CALLS` exhaustion — the agent runtime stamps the persisted `type:'plan'` block with a
  terminal marker (`terminalReason: 'aborted' | 'max_steps' | 'error'`, additive — see C3 / plan.md
  AD6) and emits a final `chat.plan.updated`. Both the live float and the reloaded inline block then
  render the once-`in_progress` step **without a spinner** (a static interrupted indicator). Normal
  completion is covered by R7 (the model marks steps complete). **No step spins after its turn ended
  — on every error/abort path, including the abort-exception early return and after reload.**
- AC5: A new turn (`onMessageRetry` / `onMessageEditSave` / `onMessageContinue`, matching
  `onSubmit`/`onSteer`) **rebaselines** the live overlay (resets the per-turn baseline) rather than
  blanket-deleting persisted data.
- AC6: An all-completed plan auto-collapses (does not auto-delete) instead of lingering expanded.
- AC7: `dismiss` is sticky for the current turn (a trailing higher-revision update does not re-pop).

### R3 — Backend state hygiene
- AC8: `AgentPlanTool.states` is bounded — cleared on `destroySession`. Because the live baseline is
  per-turn (C1), backend revision may stay process-local and even reset on restart without risk.
- AC9: Dead surface removed or wired: drop `rawData.toolResult.snapshot` (only `onProgress` is
  consumed); remove `getState`/`clearState` unless wired by AC8.
- AC10: A subagent `update_plan` no longer pollutes the parent's plan state with an orphan key.
- AC11: A missing `toolCallId` no longer returns silent success with no UI effect (error or logged
  drop).

### R4 — Single source of truth for shape & presentation
- AC12: `AgentPlanStepStatus` and the plan-item shape are defined once (zod as source, `z.infer`);
  tool schema and event contract import it.
- AC13: Status→icon/color/badge mapping, the frozen/terminal rendering, and the aria-label live in
  one shared composable used by both renderers; completed-step styling is identical across surfaces.

### R5 — Audit + converge the inline/ACP pipeline (D1, D2)
- AC14: Before any change, a reachability audit documents whether/how the `type:'plan'` block is
  produced and rendered today across **both** ACP subsystems (`acpProvider` and
  `acpClientPresenter`/`AcpEventMapper`). No `MessageBlockPlan` deletion.
- AC15: After convergence, agent-runtime and ACP may keep **separate entry points**, but both call
  **one shared plan-block construction/normalization helper** producing **one `type:'plan'` block
  shape**, rendered by the **single `MessageBlockPlan`** renderer; no second, divergent builder or
  renderer remains.

### R6 — UX / i18n / a11y
- AC16: The completed counter uses one parameterized/pluralizable i18n message
  (`{completed}/{total}` localized), not a concatenated status word; float and inline block present
  the count consistently.
- AC17: Completed-step text meets WCAG AA (≥4.5:1) — mute the icon and/or strike-through, keep text
  at `text-foreground`.
- AC18: The steps container exposes `aria-live="polite"` (`role="status"`); the disclosure control
  is a single unambiguous control (`aria-expanded` + `aria-controls`), no duplicate tab stop.
- AC19: The float defaults to expanded on first appearance.
- AC20: `collapsedBySession` (and any persisted view-state) is pruned on conversation deletion.
- AC21: Unreachable i18n keys (`status.failed`, `status.skipped`) are removed unless the enum is
  extended to produce them.

### R7 — Prompt closure discipline (cheap, high ROI; borrowed from Codex)
- AC22: `buildProgressPrompt` instructs the model to reconcile every step before finishing and never
  end a turn with a dangling `in_progress` step. This is the minimal mitigation for the "stuck
  spinner" symptom under normal completion, independent of R1/R2.

## Non-goals

- No new heavyweight planning concept (no `PLANS.md` / ExecPlans, no Plan Mode).
- No change to **when** the task triggers (model-decided, agent-mode-only stays).
- No step-status enum extension (`blocked`/`cancelled`) in this goal — abnormal termination uses the
  additive block-level `terminalReason` instead (AD6). Model-emitted closure stays the three values.
- No cross-session "global task board"; plan stays scoped to its conversation.
- No new dedicated DB table for plans — persistence rides the existing message/block store.

## Constraints

- **C1 — Revision baseline is per-turn (resolves the silent-drop hazard).** The renderer store drops
  snapshots with `revision <= current` (`agentPlan.ts:12`); backend revision comes from a
  process-local Map (`agentPlanTool.ts:94`) that resets on restart. To remove the coupling: **reset
  the live store baseline to 0 at the start of every turn** (submit/steer/retry/continue). Revision
  then only orders updates **within a single turn** (dispatch is sequential, so monotonic by
  construction). Backend clearing and restart-reset become harmless. No "reset both ends from one
  signal" handshake is needed.
- **C2 — Agent-mode gating unchanged.** `update_plan` stays `agent`-mode only.
- **C3 — Stored-data contract.** `type:'plan'` blocks and any `block.extra` plan fields
  (`plan_entries`, `plan_terminal_reason`, …) are additive; conversations persisted before this
  change have no plan block and rehydrate to "no plan".
- **C4 — Minimal complexity.** Reuse the existing message-block + typed-event machinery; no new store
  or channel. Per project preference (no compatibility shims unless explicitly required), the
  storage-key migration is a clean rename + one-time prune, not a legacy-value translation layer.

## Success criteria

- No state can leave the float **or the reloaded inline block** showing a spinning `in_progress`
  after its turn ended (tests for stop/retry/complete transitions, live and post-reload).
- Plan survives reload and conversation switch with correct per-conversation isolation (AC1–AC3),
  and a fresh `revision = 1` plan after restart is never dropped (C1 guard test).
- Status enum and status→presentation logic each exist exactly once (grep shows a single source).
- One persisted plan-block producer feeds one renderer; the ACP reachability audit is recorded.
- `pnpm run format && pnpm run i18n && pnpm run lint && pnpm run typecheck` clean; new renderer/main
  tests cover the lifecycle transitions, the per-turn baseline, the terminal marker, and rehydration.
