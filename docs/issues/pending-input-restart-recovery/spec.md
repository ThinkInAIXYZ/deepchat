# Pending Inputs Lack a Deterministic Restart Disposition

## GitHub

- Issue: https://github.com/ThinkInAIXYZ/deepchat/issues/2111
- Classification: complex reliability bug
- Priority: P1, with P0-level user perception when an accepted input appears lost
- Status: implemented on `codex/issue-2111-pending-input-recovery`

## Decision

A cold restart must not automatically execute any input accepted by the previous process.

- Queue remains an unsent draft in the normal Queue lane. The user explicitly resumes the Queue.
- An unread Steer becomes an internal terminal `error` transcript message without recovery-specific
  UI. The existing message toolbar remains available if the user wants to retry it.
- A Steer that had already been claimed remains sent; its interrupted assistant response becomes the
  failure surface and can be retried normally.
- Full Session restoration only projects the reconciled state. It does not wake the pending-input
  pump.

This replaces the earlier age-based recovery proposal. There is no 24-hour policy, recovery card,
sidebar warning, recovery timestamp, or database migration.

## Issue

Queue and Steer inputs are persisted in `deepchat_pending_inputs`, but a process restart rebuilds
only part of their durable state. The startup path repairs rows left in `claimed` and recovers
pending messages, then returns the runtime graph without giving every remaining input a stable
user-visible disposition.

The current behavior is inconsistent:

- a pending Queue can remain stored without an explicit way to start it while the Session is idle;
- a pending Steer can remain visible as `Unread` even though the process that accepted it no longer
  exists;
- `PendingInputAdmissionCoordinator.list()` may schedule a pending Steer merely because the
  renderer listed it;
- a later lifecycle wake can execute an old Queue even if opening the restored Session did not.

The defect is therefore not only a missing wakeup. The restart boundary fails to distinguish an
unsent Queue draft from a sent Steer attempt.

## Confirmed Code Path

```text
createDeepChatRuntimeServices()
  -> bind PendingInputWakeup to PendingInputPump
  -> recoverInputsAfterRestart()
  -> install process-local Queue holds
  -> atomically fail unread Steer messages and consume their pending rows
  -> recoverPendingMessages()
  -> return runtime services

later, when the renderer restores a Session
  -> sessions.restore
  -> SessionQuery.getSession()
  -> DeepChat session handle snapshot()
  -> SessionStateResolver.get()
  -> rebuild runtime state
  -> renderer lists pending inputs
  -> list() may schedule pending Steer as a side effect
```

`PendingInputPump.drain()` requires a hydrated runtime scope, so scheduling during startup is not a
reliable repair. Scheduling after full hydration would make historical inputs execute without a
fresh user decision. The selected fix removes that requirement instead of moving the automatic
wake to another lifecycle edge.

## User-visible Semantics

| State at process exit | Cold-start reconciliation | Restored Session | User action |
| --- | --- | --- | --- |
| Queue `pending` | Keep the durable row and hold it from automatic drain | Normal Queue item | Resume Queue |
| Queue `claimed`, no user message | Release to `pending` and hold it | Normal Queue item | Resume Queue |
| Queue `claimed`, user message exists | Consume the row; recover the interrupted transcript turn | Interrupted message/response | Retry message |
| Steer `pending` / `Unread` | Mark linked user messages `error`; consume the Steer row | Normal user message without a receipt | Existing message Retry action |
| Steer `claimed` / `Read` | Settle the user message; consume the row; recover assistant as interrupted | Failed assistant response | Retry response |
| Attachment-blocked input | Preserve the existing Queue/attachment recovery behavior | Queue item with attachment actions | Resolve attachment |

The distinction is semantic:

- Queue means “save this for later”; no transcript fact exists until it is claimed.
- Steer means “I already sent this into the active conversation”; its transcript fact must remain,
  but the interrupted delivery attempt must not stay `Unread` forever.

## Root Cause

1. Startup repair treats pending Queue and pending Steer as work that may still be executed, even
   though they represent different user commitments.
2. A durable `pending` row is level-triggered evidence, while pump scheduling is an in-memory edge.
   Losing or later recreating that edge produces inconsistent behavior.
3. `PendingInputAdmissionCoordinator.list()` compensates only for Steer and turns a read into an
   execution trigger.
4. The Queue UI has mutation actions but no explicit idle-state action that resumes a restored
   Queue.
5. Merely leaving a historical Queue as `pending` is insufficient: a later enqueue or completion
   wake can still drain it. The runtime must temporarily hold startup Queue rows until the user
   resumes them.

## Governing Invariants

1. Cold startup, Session hydration, message listing, and pending-input listing never execute a
   historical input.
2. `deepchat_pending_inputs` remains the durable source of Queue content and ordering.
3. A startup Queue hold is process-local safety state derived from existing active Queue IDs. It is
   not a second durable queue and does not require a schema field.
4. Restarting again safely rebuilds the hold from the same durable rows.
5. A restart-failed Steer remains a transcript fact, is excluded from model context while its
   message status is `error`, renders without a receipt, and is removed only by the existing
   retry/truncation contract.
6. `PendingInputPump` remains the only owner of Queue selection, lease acquisition, durable claim,
   and turn start.
7. Interaction, attachment, active-run, claimed-input, and instance-fence gates remain
   authoritative.
8. Duplicate Resume or Retry actions may request duplicate work but must create at most one claim
   and one turn.
9. Diagnostics contain no message text, attachment paths, serialized payloads, or other user
   content.
10. Materializing a claimed Queue user message and linking that message to its pending-input row
    commit or roll back together.
11. Failing unread Steer messages, recording their Tape replacements, and consuming the Steer row
    commit or roll back together.
12. Manual-resume intent belongs to the resumed Queue item, not to a transient pump wake reason; it
    survives attachment block and resolution until that item is consumed or explicitly removed.

## Fix Design

### 1. Reconcile restart state before any Session is restored

Replace the claimed-only startup repair with one deterministic reconciliation pass over active
pending inputs.

For Queue:

- keep `pending` rows unchanged;
- release `claimed` rows without a materialized user message back to `pending`;
- treat a linked but missing or foreign user message as a dangling rollback association, clear the
  link while releasing the row, and keep the Queue draft;
- preserve the existing terminal recovery for `claimed` rows that already materialized a user
  message;
- record the IDs of retained/released Queue rows in a process-local `restartHeldQueueInputIds` set.

For Steer:

- for each `pending` Steer, ensure its linked user message exists, change every linked message from
  `pending` to `error`, append the corresponding Tape replacements, and mark the Steer row
  `consumed` in one SQLite transaction;
- for `claimed` Steer, retain the existing behavior: settle linked user messages, consume the row,
  and let pending assistant recovery create the interrupted error response;
- preserve the existing attachment-blocked conversion and resolution path.

The pass is idempotent. Consumed Steer rows are not active on the next restart, and retained Queue
rows simply receive a new process-local hold.

No Session runtime is created during this scan. Startup logs report aggregate counts only.

### 2. Hold startup Queue rows until an explicit Queue resume

The process-local hold closes a subtle hole in the simple “leave it in Queue” approach. Without the
hold, any later `enqueue` or `completed` wake could claim the historical head row automatically.

The hold has narrow behavior:

- Queue listing, editing, moving, deleting, and capacity counting continue to use the durable rows;
- pump Queue selection stops when the FIFO head is held;
- pending Steer selection remains unaffected during normal live operation;
- an explicit new composer Send may start independently and does not silently release historical
  Queue rows;
- deleting or promoting a held Queue row removes its ID from the hold;
- once no held IDs remain, the overlay disappears naturally;
- another process restart derives a new hold from whatever Queue rows remain.

Queue transcript materialization also closes its crash window: creating the claimed Queue's user
message and linking that message ID back to the claimed row use one transaction. Startup can then
distinguish an unstarted draft from a turn whose transcript fact already exists without guessing
from timing.

Keep the set inside the existing pending-input runtime owner. Do not add a new service, database
column, timer, or global event bus.

### 3. Add an explicit Resume Queue action

Add a typed Session route named `sessions.resumePendingQueue`. It performs these steps under the
existing Session operation gate:

1. require a fully restored Session in `idle` or recoverable `error` state;
2. reject active interactions, attachment blockers, claimed inputs, or an owned drain lease;
3. release the Session's startup Queue hold;
4. request the existing pump to drain with a new explicit `manual` reason.

The list response exposes whether that Session actually has a restart-held Queue row. The renderer
uses this authoritative value instead of inferring recovery state from the presence of an ordinary
pending Queue item, and Resume returns `false` without starting a drain when no hold was released.

The action resumes the existing Steer-before-Queue and Queue FIFO rules. One click means “continue
this Queue”; after the first item completes, later Queue items may continue normally. Reorder or
delete remains available before resuming.

Repeated clicks are harmless because the instance drain lease and durable claim remain the
exact-once fences. If the turn cannot start after the hold is released, the durable row remains
pending and can be selected by the next valid lifecycle wake. A later process restart holds it
again.

Once the manually resumed head has persisted its user and assistant facts and is about to enter the
provider Run, its Queue claim is consumed like an explicit Send. A returned provider error therefore
stays in the transcript and cannot put the same item back into Queue. Failures before that boundary
still release the claim so no accepted draft is lost.

If attachment preparation blocks the resumed head, the process-local manual marker remains attached
to that item ID. Retrying or degrading the attachment can wake the pump with the ordinary `enqueue`
reason without losing manual-resume semantics. The marker is cleared only after consumption or an
explicit delete/Steer conversion.

### 4. Terminalize pending Steer as a retryable failure

A Steer accepted by the previous process must not be demoted to Queue: it already has a visible user
message and Tape fact. It also must not remain `Unread`, because the accepting runtime is gone.

Cold-start reconciliation therefore applies this terminal transition:

```text
pending Steer row + pending user message
  -> Steer row consumed
  -> user message status error
  -> receipt hidden
```

The existing `inputReceipt.mode = 'steer'` metadata and `message.status = 'error'` are sufficient to
exclude the interrupted attempt from later model context and suppress its live receipt. No new
persisted failure marker is required.

Retry uses the existing message retry semantics:

- remove the failed user message and later invalidated transcript suffix;
- resend its original content as a normal turn because there is no active turn to steer after
  restart;
- keep restart-held Queue drafts intact;
- allow this narrowly identified restart-failed Steer retry to coexist with held Queue rows;
- keep the ordinary retry prohibition for genuinely executable pending inputs.

For a Steer already claimed before the crash, the user message was successfully read. It remains
`sent`; the interrupted assistant message carries the failure and the existing assistant Retry
action restarts the turn.

### 5. Make pending-input listing a pure read

Remove the scheduling side effect from `PendingInputAdmissionCoordinator.list()`.

After the change:

- Session restoration reads messages and Queue rows;
- lightweight Session summaries remain non-hydrating;
- full Session hydration does not schedule pending work;
- only live admission, run settlement, attachment resolution, and explicit Resume/Retry actions can
  request a pump drain.

### 6. Expose Queue resume without recovery-specific Steer chrome

Do not add a recovery panel, modal, sidebar warning, or separate recovery list.

The Queue lane gains one action while the Session is idle and contains a restart-held Queue:

- `Resume queue` in the lane header;
- disabled while the Session is generating or an interaction/attachment blocker owns the Session;
- existing edit, reorder, Steer, and delete controls remain unchanged.

The restart-failed Steer remains where the user originally sent it, but renders as an ordinary
historical user message: no `Unread`, no `Failed`, and no inline recovery button. The standard
message toolbar below it remains unchanged and continues to provide the normal Retry command.

The Queue action copy uses vue-i18n and the existing `DcButton` primitive.

## UI Change

BEFORE

```text
Restored Session
+--------------------------------------------------+
| You  10:21  Unread                               |
| Please change the output format                  |
|                                                  |
| Queue (2)                                        |
|  1. Add a short example          [Edit] [Delete] |
|  2. Translate it to Chinese      [Edit] [Delete] |
|                                                  |
| [composer]                                       |
+--------------------------------------------------+

The Unread Steer may execute from a read side effect.
The Queue has no clear idle-state resume action.
```

AFTER

```text
Restored Session
+--------------------------------------------------+
| You  10:21                                       |
| Please change the output format                  |
|                                                  |
| Queue (2)                         [Resume queue]  |
|  1. Add a short example          [Edit] [Delete] |
|  2. Translate it to Chinese      [Edit] [Delete] |
|                                                  |
| [composer]                                       |
+--------------------------------------------------+

Nothing executes merely because the Session was opened.
```

Resume availability correction:

```text
BEFORE — ordinary live Queue
+--------------------------------------------------+
| Queue (1)                         [Resume queue]  |
|  1. Follow up after this turn                    |
+--------------------------------------------------+

AFTER — ordinary live Queue
+--------------------------------------------------+
| Queue (1)                                        |
|  1. Follow up after this turn                    |
+--------------------------------------------------+

The action is projected only for a real restart-held Queue.
```

## Data and Contract Changes

| Boundary | Change |
| --- | --- |
| SQLite | No schema or migration change. |
| Pending-input store | Atomically link claimed Queue messages and terminalize unread Steer messages with their rows. |
| Pump | Track startup-held Queue IDs and manually resumed item IDs; skip held FIFO heads; consume a manually resumed head at the provider boundary. |
| Admission | Make `list()` pure and expose Queue resume validation. |
| Session route/client | Add `sessions.resumePendingQueue` and authoritative `resumeAvailable` projection. |
| Transcript recovery | Persist unread Steer `error` status and Tape replacements inside reconciliation. |
| Renderer | Add the Queue resume action and suppress recovery-specific Steer receipt chrome. |

No provider, model request, permission, attachment-preparation, Session summary, or sidebar contract
changes.

## Runtime Sequences

### Restored Queue

```text
cold startup
  -> find active Queue row
  -> keep/release it as pending
  -> add its ID to restartHeldQueueInputIds
user opens Session
  -> full state hydration
  -> list Queue as normal
  -> no pump wake
user clicks Resume queue
  -> validate Session gates
  -> release hold
  -> pump acquires instance lease
  -> durable row is claimed once
  -> turn persists user and assistant facts
  -> Queue row is consumed before the provider Run
  -> a later provider error remains only in the transcript
```

### Restored pending Steer

```text
cold startup
  -> find pending Steer and linked user message
  -> consume Steer row
  -> recover user message to error
user opens Session
  -> message renders as a normal historical user message with no receipt
  -> no pump wake
user clicks the existing toolbar Retry action
  -> existing retry preparation reads original content
  -> failed transcript suffix is replaced
  -> one normal turn starts
  -> held Queue remains held
```

### Duplicate user action

```text
Resume click --------+
Resume click --------+--> same instance drain lease --> one durable claim --> one turn
later wake -----------+
```

## Affected Ownership

| Owner | Responsibility in this fix |
| --- | --- |
| `SessionPendingInputs` / store | Deterministic startup reconciliation and Steer terminalization inputs. |
| `PendingInputPump` | Startup Queue hold, explicit resume, manual-run claim policy, gating, and exact-once drain ownership. |
| `PendingInputAdmissionCoordinator` | Pure pending list and typed manual Queue resume validation. |
| Transcript recovery | Convert pending Steer messages to durable error messages. |
| Renderer pending-input/message UI | Render Queue resume and hide recovery-specific Steer chrome. |

`SessionStateResolver` is deliberately not changed. Full hydration is not an execution signal in
this design.

## Constraints and Non-goals

- Do not scan and hydrate every Session at startup.
- Do not execute Queue or Steer because a Session was listed, opened, or fully hydrated.
- Do not add `recovery_required_at`, an age threshold, a recovery lifecycle state, or a schema
  migration.
- Do not add a recovery card, modal, sidebar indicator, or recovery-specific delete command.
- Do not delete or demote an accepted Steer transcript fact.
- Do not overload attachment `blocked` state for restart interruption.
- Do not change live Queue FIFO, Steer priority, capacity, provider execution, or permission
  semantics.
- Do not add a second durable queue, scheduler, event bus, or state-machine dependency.
- Do not sync or rewrite the GitHub issue; it is already linked and contains the source report.

## Task Checklist

- [x] Extend startup pending-input reconciliation to collect held Queue IDs and terminalize pending
      Steer rows.
- [x] Atomically fail unread Steer messages, append Tape replacements, and consume their rows.
- [x] Add the process-local startup Queue hold to `PendingInputPump` selection and cleanup paths.
- [x] Remove the scheduling side effect from `PendingInputAdmissionCoordinator.list()`.
- [x] Add the typed `sessions.resumePendingQueue` route/client and Session operation-gate handling.
- [x] Add the Queue lane `Resume queue` action and its disabled/busy states.
- [x] Hide the receipt for `error + steer receipt` and rely on the standard message Retry action.
- [x] Allow restart-failed Steer Retry while restart-held Queue drafts remain non-executable.
- [x] Update `docs/architecture/session-management.md`,
      `docs/features/im-style-steer-messages/spec.md`, and
      `docs/architecture/deepchat-agent-harness-boundaries/spec.md` with the implemented contract.
- [x] Add focused reconciliation, pump, admission, retry, store, and component tests.
- [x] Run format, i18n, lint, typecheck, and focused main/renderer suites.
- [x] Atomically create and link claimed Queue user messages.
- [x] Preserve manual-resume semantics across attachment block and resolution.
- [x] Project authoritative Queue resume availability and reject no-hold Resume calls.
- [x] Add crash-window and attachment-resolution regressions, then rerun validation.

## Validation Plan

### Restart reconciliation

- A pending Queue survives restart unchanged and is added to the process-local hold.
- A claimed Queue without a user message is released and held.
- A claimed Queue with only a dangling message ID is released, unlinked, and held.
- A claimed Queue with a user message follows existing interrupted-turn recovery.
- A pending Steer with one or multiple linked messages consumes its row and marks every linked user
  message `error`.
- Injecting a failure during multi-message Steer terminalization rolls back every message, Tape
  replacement, and the pending-row transition; the next reconciliation succeeds once.
- A claimed Steer keeps read user messages sent and recovers its assistant response to error.
- Repeating startup reconciliation changes no already-terminal Steer row and safely rebuilds Queue
  holds.
- Attachment-blocked inputs retain their existing resolution behavior.

### No implicit execution

- Harness construction, lightweight Session listing, full Session hydration, message listing, and
  pending-input listing start zero turns.
- An enqueue or completion wake cannot bypass a held Queue FIFO head.
- Sending a new composer message does not silently release the historical Queue hold.
- Removing every held Queue row clears the overlay without leaving the Session blocked.

### Explicit Queue resume

- Resume Queue starts the FIFO head exactly once.
- An ordinary live Queue does not expose Resume, and calling Resume without a restart hold returns
  `false` without draining.
- Once the manually resumed head reaches the provider boundary, it is consumed and cannot reappear
  after a returned provider error.
- Attachment Retry and Send without image content preserve that same consumption boundary for the
  manually resumed item even though resolution wakes the pump as `enqueue`.
- Later Queue items follow the existing completion/FIFO contract after explicit resume.
- Duplicate Resume calls, a held drain lease, stale instance, active interaction, attachment block,
  or concurrent lifecycle wake cannot create a duplicate claim or turn.
- A restart before claim safely holds the row again.

### Steer failure and retry

- A restored pending Steer renders no receipt or recovery-specific action and has no active pending
  row.
- Failed Steer content is excluded from later model context until retry.
- Retry replaces the failed message through the existing transcript retry contract and starts one
  normal turn.
- Restart-held Queue rows remain intact and held while the failed Steer is retried.
- A claimed Steer renders the existing interrupted assistant error and retries without duplicating
  the user message.

### Focused suites

- `test/main/session/data/pendingInputs.test.ts`
- `test/main/session/data/pendingInputStore.test.ts`
- `test/main/agent/deepchat/runtime/pendingInputPump.test.ts`
- `test/main/agent/deepchat/runtime/pendingInputAdmissionCoordinator.test.ts`
- `test/main/agent/deepchat/harness/deepChatAgentHarness.test.ts`
- `test/main/session/turn.test.ts`
- `test/renderer/stores/pendingInputStore.test.ts`
- `test/renderer/features/chat-page/composables/usePendingInputActions.test.ts`
- `test/renderer/components/PendingInputLane.test.ts`
- `test/renderer/components/message/MessageItemUser.test.ts`

## Validation Results

- `pnpm format`, `pnpm i18n`, `pnpm lint`, and `pnpm typecheck` pass.
- The focused main-process run passes 515/515 tests across ten affected and route-boundary files.
- The focused renderer run passes 34/34 tests; the full renderer run passes 2056/2056 tests.
- The full main-process run is not green in this Windows environment: 6544 tests pass, 394 are
  skipped, and 60 fail across 27 unchanged files. The failures are dominated by POSIX path
  expectations, Windows symbolic-link permissions, executable-bit checks, and packaging-script
  fixtures. None of the failing files is part of this change, and every affected main-process suite
  passes in the focused run.
- The installed Node.js version is 24.15.0 while the repository requests at least 24.18.0; pnpm emits
  an engine warning, but the completed checks above run successfully.

## Acceptance Criteria

1. No historical Queue or Steer starts because the app launched, a Session hydrated, or a read route
   ran.
2. Restored Queue drafts remain visible, editable, reorderable, deletable, and explicitly
   resumable from the existing Queue lane.
3. A restored Queue remains held across unrelated lifecycle wakes until the user resumes it.
4. Explicit Queue resume starts the FIFO drain exactly once; the resumed head is consumed at the
   provider boundary, cannot reappear after a provider error, and retains existing subsequent Queue
   behavior.
5. A pending Steer becomes an internal terminal transcript message, renders without a receipt, and
   no longer occupies active pending-input state.
6. The standard Retry action for that user message starts one normal turn while preserving
   restart-held Queue drafts.
7. A claimed Steer retains its sent user fact and exposes failure through the interrupted assistant
   response.
8. Pending-input listing is a pure read, and no Session hydration-specific wake is added.
9. No schema migration, age policy, recovery marker, recovery panel, or sidebar indicator is
   introduced.
