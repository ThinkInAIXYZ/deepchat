# IM-style Steer Messages Spec

## Status

Implemented on `codex/steer-message-lifecycle`. The behavior spans the pending-input lifecycle,
transcript persistence, DeepChat and ACP runtime boundaries, typed IPC events, and the chat
renderer.

There are no unresolved product questions in this spec.

## Design Correction

Queue and Steer must not become visually identical before admission.

- A queued input is still an editable, reorderable draft. It stays in the composer-side queue lane
  until the runtime admits it.
- A steered input is a sent conversation fact. It enters the transcript immediately and is no
  longer edited or reordered as a draft.

Making queued drafts look like sent chat messages would create a false delivery contract and force
transcript ordering to follow mutable queue operations. The stable shared model is therefore:

```text
Queue = mutable draft, normal admission time, no receipt
Steer = immutable sent message, interrupt admission time, Unread -> Read receipt
```

The live receipt has only two named states: `Unread` and `Read`. It disappears after `Read`;
disappearance is presentation, not a third live state. User-facing Chinese copy is `未读` / `已读`.
Cold restart before claim terminalizes the message internally as `error` and suppresses the receipt;
it does not add a third delivery label or a recovery-specific action.

## Problem

The current Steer path has two disconnected representations:

1. The composer shows an in-flight Steer spinner.
2. The pending-input rail shows a locked Steer row.
3. The actual user input is not shown as a normal message until the next turn begins.
4. DeepChat cancels the active run immediately.
5. The next output can continue through lifecycle paths that do not make the user/model turn
   boundary obvious.

This makes Steer feel like a background command rather than a message. It also leaves the user
without a reliable answer to three basic questions:

- Was my message sent?
- Has the runtime admitted it?
- Which assistant response is answering it?

## Target Experience

Steer behaves like inserting a message into an IM conversation while the other side is preparing or
typing:

1. The current turn keeps its place and continues until a safe runtime boundary.
2. The accepted Steer appears immediately after the current turn's durable transcript facts as a
   standard user message.
3. The Steer shows `Unread`.
4. At the safe boundary, the current assistant message becomes terminal.
5. The runtime claims the Steer and the receipt changes to `Read`.
6. A new assistant message, with a new message ID, starts below the Steer.
7. `Read` remains visible for 1.5 seconds, fades over 150 ms, and then disappears.

If Steer arrives before the provider stream starts, the current user fact is persisted first, the
pre-stream operation ends with `pending_input`, and no empty assistant row remains. The old assistant
row is never reused for the new response. The persisted source user fact replaces the existing
optimistic source bubble in the same renderer update, so the source message is not duplicated.

## Goals

- Make every accepted Steer visible in the normal message list.
- Persist the visible message before reporting acceptance.
- Keep the message `Unread` until the runtime claims it for the next loop.
- Show a short-lived `Read` receipt after claim.
- End the current assistant turn at a backend-safe boundary.
- Start the response to the Steer in a new assistant message.
- Preserve Queue as an editable pending lane.
- Preserve one visible user bubble per user submission, including rapid consecutive Steers.
- Keep message order, receipts, and pending state correct across reload, session switching, process
  restart, and dropped renderer events.
- Use existing stores, message components, pending-input infrastructure, and typed IPC patterns.

## Non-goals

- Turning Queue items into transcript messages before they are admitted.
- Replacing the pending-input queue editor with a second message composer.
- Claiming that `Read` means the language model semantically understood the text.
- Adding delivery receipts to normal sends or queued messages.
- Adding an unsend/recall feature for accepted Steers.
- Editing, reordering, or retrying a Steer while its linked pending batch is active.
- Threaded replies, per-message reply arrows, or a new conversation grouping UI.
- A new state-machine library, a new Pinia store, or a new persistence table.
- Changing provider protocol semantics beyond the minimum required turn boundary.

## Terminology

- **Steer message**: one user-visible transcript message created by one accepted Steer submission.
- **Steer batch**: the existing pending Steer record and its merged runtime payload. A batch may
  contain one or more visible Steer messages accepted before claim.
- **Unread**: the Steer is durably accepted but its batch is still `pending`.
- **Read boundary**: the atomic transition in which the runtime changes the batch to `claimed`,
  stamps all linked Steer messages with `readAt`, and reserves the new assistant message.
- **Settled**: the claimed loop has completed, aborted, or failed and the pending record is
  `consumed`.
- **Safe boundary**: the earliest backend-supported point where the previous assistant turn can end
  without appending the Steer response to that assistant message.

## Queue and Steer Contract

| Property | Queue | Steer |
| --- | --- | --- |
| Before admission | Queue lane | Message list |
| User meaning | Saved draft | Sent message |
| Editable | Yes | No |
| Reorderable | Yes | No |
| Delete before admission | Yes | No recall in this scope |
| Receipt | None | `Unread` -> `Read` -> disappears |
| Runtime priority | Normal FIFO | Before Queue at the next safe boundary |
| Transcript fact created | When claimed for a normal turn | At durable acceptance |
| Response message | New assistant row | New assistant row |

Promoting a Queue item to Steer is a one-way admission transition:

1. Prepare attachments.
2. If preparation needs user action, keep the item in Queue.
3. Otherwise, remove it from the queue lane, create its user message, link it to the Steer batch,
   and show `Unread`.

## Steer Lifecycle

### State mapping

| Durable state | User message status | Receipt metadata | Visible state | Allowed actions |
| --- | --- | --- | --- | --- |
| Acceptance failed | No message | None | Draft remains in composer | Retry submit |
| `pending` | `pending` | `readAt: null` | `Unread` | Copy |
| `claimed` | `pending` | `readAt: <timestamp>` | `Read`, then disappears | Copy |
| `consumed` | `sent` | Original `readAt` retained | No receipt after timeout | Normal message actions |
| Cold restart before claim | `error` | `readAt: null` retained | No receipt | Normal message actions |

`ChatMessageRecord.status = 'pending'` prevents an accepted-but-unsettled Steer from entering later
context as historical input. `isContextHistoryRecord` already excludes pending user messages.

### Receipt semantics

`Unread` means:

- the input and its visible user message are durable;
- the runtime has not yet claimed the linked Steer batch.

`Read` means:

- the pending-input pump crossed the claim boundary;
- the input is bound to the next loop;
- the new assistant message identity has been reserved.

It does not mean that a provider produced a token or that a model can prove semantic
comprehension.

The claim transition is irreversible for UI semantics. A failure after claim produces a terminal
assistant error or interruption below the Steer; it does not move the message back to `Unread` or
silently delete it.

A cold restart before claim is different from a live failure after claim. The accepting runtime no
longer exists, so startup consumes the active Steer row and recovers its linked user messages to
`error`. The renderer uses that status to hide the stale live receipt and otherwise keeps the normal
user-message rendering. The standard toolbar Retry action starts a normal turn because there is no
active turn left to steer.

### Rapid consecutive Steers

The existing payload merge is retained, but the UI no longer merges user messages:

```text
Assistant A is running
  -> user sends S1
  -> user sends S2
  -> one pending Steer batch contains the merged S1 + S2 runtime payload
  -> transcript contains two separate user messages
  -> claim marks S1 and S2 Read together
  -> Assistant B starts below S2
```

This preserves one bubble per submission while avoiding two artificial assistant turns for a burst
that reached the same admission window.

The batch closes atomically at claim. A Steer accepted after that point creates the next pending
batch and is ordered below the newly reserved assistant message.

## Runtime Boundary Contract

### DeepChat

Accepting a Steer must not call the generic user-stop cancellation path.

- During a provider-only response, the current provider response may finish. The completed
  assistant message is the safe boundary.
- During a tool loop, the existing `shouldYieldForPendingInput` check yields after the current tool
  batch and before another provider round.
- Before provider streaming starts, persist or reuse the current user fact before the Steer, abort
  preparation with cause `pending_input`, and remove any empty assistant reservation.
- A pending permission or question remains a blocker. The Steer stays `Unread` until that interaction
  is resolved.
- The old assistant message settles with `stopReason: 'pending_input'` and no cancellation error
  block.
- The pending-input pump then claims the Steer batch and starts a new assistant message.

### ACP

ACP does not expose the same in-loop yield hook. It keeps the same visible contract with a
backend-specific boundary:

1. Persist and display the Steer as `Unread`.
2. If projection has not started, persist the claimed Queue input's user fact before the Steer.
3. Cancel the active ACP prompt with cause `pending_input`.
4. Wait for the old ACP operation and projection to settle.
5. Claim the Steer batch.
6. Start a new ACP prompt and a new assistant message.

The old ACP assistant message must not show the generic
`common.error.userCanceledGeneration` error for a Steer handoff.

### Common invariant

After an assistant row exists, both backends preserve:

```text
oldAssistant.id != newAssistant.id
oldAssistant.orderSeq < every steerUser.orderSeq < newAssistant.orderSeq
```

Before an assistant row exists, both backends preserve:

```text
sourceUser.orderSeq < every steerUser.orderSeq < newAssistant.orderSeq
```

No stream update from the new run may target `oldAssistant.id`.

## UI and Interaction Specification

### BEFORE: command-style Steer

```text
+--------------------------------------------------------------+
| Assistant                                                    |
| Streaming current response...                                |
|                                                              |
| [Steer 1 · locked ···]                         pending rail   |
| [composer draft                                      ]       |
| [Steer spinner] [Queue]                                      |
+--------------------------------------------------------------+
```

Before the first assistant row existed, the Steer action was disabled:

```text
+--------------------------------------------------------------+
|                                      You  14:23               |
|                                  +-------------------------+ |
|                                  | Start the analysis.     | |
|                                  +-------------------------+ |
|                                                              |
| Assistant is preparing...                                    |
| [composer: Change the approach...                    ]       |
| [Steer disabled] [Queue]                                     |
+--------------------------------------------------------------+
```

### AFTER: pre-stream Steer

```text
+--------------------------------------------------------------+
|                                      You  14:23               |
|                                  +-------------------------+ |
|                                  | Start the analysis.     | |
|                                  +-------------------------+ |
|                                      You  14:23 · Unread      |
|                                  +-------------------------+ |
|                                  | Change the approach...  | |
|                                  +-------------------------+ |
|                                                              |
| Assistant is preparing...                                    |
+--------------------------------------------------------------+
```

At claim, `Unread` becomes `Read`, the preparation placeholder is replaced by a new assistant
message below the Steer, and `Read` then disappears on the normal receipt timer.

### Accepted Steer

```text
+--------------------------------------------------------------+
| Assistant                                                    |
| Streaming current response...                                |
|                                                              |
|                                    You  14:23 · Unread        |
|                                  +-------------------------+ |
|                                  | Change the approach...  | |
|                                  +-------------------------+ |
|                                                              |
| [composer                                             ]      |
+--------------------------------------------------------------+
```

There is no Steer row in the pending rail and no text-only Steer spinner.

### Read boundary and new response

```text
+--------------------------------------------------------------+
| Assistant                                                    |
| Previous response ends here.                                 |
|                                                              |
|                                      You  14:23 · Read        |
|                                  +-------------------------+ |
|                                  | Change the approach...  | |
|                                  +-------------------------+ |
|                                                              |
| Assistant                                                    |
| New response starts in a new message...                      |
+--------------------------------------------------------------+
```

### After receipt timeout

```text
+--------------------------------------------------------------+
| Assistant                                                    |
| Previous response ends here.                                 |
|                                                              |
|                                             You  14:23        |
|                                  +-------------------------+ |
|                                  | Change the approach...  | |
|                                  +-------------------------+ |
|                                                              |
| Assistant                                                    |
| New response continues...                                    |
+--------------------------------------------------------------+
```

### Multiple messages in one admission window

```text
+--------------------------------------------------------------+
| Assistant A                                                  |
| Previous response ends here.                                 |
|                                                              |
|                                      You  14:23 · Read        |
|                                  +-------------------------+ |
|                                  | Use the smaller API.    | |
|                                  +-------------------------+ |
|                                      You  14:23 · Read        |
|                                  +-------------------------+ |
|                                  | Keep the old schema.    | |
|                                  +-------------------------+ |
|                                                              |
| Assistant B                                                  |
| Responds once to both messages...                            |
+--------------------------------------------------------------+
```

### Queue remains separate

```text
+--------------------------------------------------------------+
| Assistant is running...                                      |
|                                                              |
| [Queued 1/5]                                                 |
| [drag] Follow up after completion      [edit] [steer] [x]    |
| [composer                                             ]      |
+--------------------------------------------------------------+
```

When that Queue item drains normally:

```text
Assistant A
You: Follow up after completion
Assistant B
```

It receives no `Unread` / `Read` receipt.

### Message placement

- Use the existing `MessageItemUser` bubble, avatar, attachment rendering, mentions, active Skills,
  collapse behavior, and typography.
- Order by authoritative `orderSeq`; do not splice an independent pending row into the rendered
  list.
- Put the receipt in the existing `MessageInfo` line next to the timestamp.
- Do not add a badge, pill, colored semantic box, glow, pulse, or progress spinner.
- Use existing muted text tokens at the same `text-xs` density as the timestamp.
- Keep the `MessageInfo` line at its existing height so receipt appearance and disappearance do not
  change virtual-row height.
- Keep the user bubble width and alignment unchanged.

### Receipt timing

- `Unread` has no animation.
- `Read` is visible until `readAt + 1500 ms`.
- It fades with an opacity-only 150 ms transition.
- Under `prefers-reduced-motion: reduce`, omit the fade but keep the same visibility deadline.
- The timeout is renderer-only. No delayed database write clears the receipt.
- On session restore, calculate the remaining time from the persisted absolute `readAt`.
- If the deadline already passed, render no receipt.

### Composer behavior

- Text-only Steer keeps focus in the composer.
- The draft clears only after durable acceptance.
- Acceptance failure keeps text, attachments, inline mentions, and active Skills.
- Keep a session-scoped dispatch lock to prevent a double click from duplicating one submission.
- Do not expose that short text-only lock as a Steer spinner or `aria-busy`.
- Attachment preparation remains visible through the existing attachment preparation flow because
  it is real work before acceptance.
- While the session is generating, Steer remains available before the first assistant message. Main
  persists the current user fact before the Steer so authoritative `orderSeq` stays stable.
- If generation ends in the click/IPC race, main may admit the Steer immediately as the next turn;
  it still follows the same message and receipt contract.

### Pending lane

- Render only Queue items in `PendingInputLane`.
- Remove the Steer count, locked Steer rows, Steer delete control, and blocked Steer presentation.
- Keep Queue drag, edit, remove, promote-to-Steer, attachment resolution, count, and capacity
  behavior unchanged.
- Legacy blocked Steer records are reconciled back to Queue because attachment preparation has not
  reached the sent-message boundary.

### Message actions

- While the linked Steer batch is `pending` or `claimed`, show Copy only.
- Hide or disable Edit, Delete, Retry, and Fork for that message.
- Once the batch is `consumed`, the standard historical user-message toolbar returns.
- This feature does not add recall/unsend.

### Scroll ownership

- A successful local Steer submit requests one scroll-to-bottom through the existing chat scroll
  controller.
- The request is scoped to the same committed session and restore epoch.
- Subsequent streaming follows the existing auto-follow policy.
- Receipt changes never call `scrollToBottom`.
- Because the receipt stays inside the fixed-height `MessageInfo` line, it does not trigger virtual
  row remeasurement or scroll correction.

### Accessibility

- The receipt is text, not color-only state.
- The transition to `Read` uses a polite live-region announcement scoped to the receipt.
- Do not repeatedly announce `Unread` during streaming renders.
- The message bubble and copy action keep their existing keyboard behavior.
- The composer retains focus after acceptance.
- Existing disabled-state tooltips remain for actual blockers such as attachment preparation,
  permissions, or an unavailable session.

## Failure and Recovery Behavior

| Failure point | Required behavior |
| --- | --- |
| Attachment preparation needs action | No message is created; keep draft and show existing resolution UI |
| Persistence fails before acceptance | No partial pending row or message; keep draft and show error |
| Renderer misses acceptance event | Route result inserts the persisted message; later restore is authoritative |
| Renderer misses claim event | Session restore reconstructs `readAt` and the new assistant row |
| App restarts during pre-stream handoff before Steer claim | Keep the materialized source user fact, consume its claimed Queue record, and terminalize the Steer internally as `error` without a receipt |
| Previous DeepChat turn errors | Open the safe boundary and drain the durable Steer unless an interaction blocks it |
| Previous ACP turn cancellation fails | Keep Steer `Unread`; do not claim until the old operation is terminal |
| Runtime fails after claim | Keep user messages `Read`; settle a new assistant error row; do not delete or retry silently |
| App restarts before claim | Atomically fail linked user messages, append Tape replacements, consume the Steer row, hide the receipt, and leave the standard toolbar Retry action available |
| App restarts after claim | Restore the persisted `Read` receipt and settlement facts; never duplicate user rows |
| App restarts with Queue drafts | Keep rows in Queue and hold them from automatic drain until explicit `Resume queue`; once the manually resumed head enters the provider Run, consume it so a provider error cannot restore it to Queue |
| Session is switched | Keep lifecycle in main; active renderer derives the state when restored |
| Session is deleted | Delete transcript and pending-input facts through the existing session deletion transaction |

## Persistence and Ordering Invariants

1. Acceptance persists the pending Steer update and the user message in one SQLite transaction.
2. Every accepted submission creates exactly one user message.
3. One pending Steer batch may link multiple user message IDs.
4. Claim updates the pending state, all linked receipts, and the new assistant reservation in one
   SQLite transaction.
5. A new Steer batch cannot accept a message until the prior claim transaction has reserved its
   assistant row.
6. Pending Steer user messages remain excluded from provider history.
7. The claimed batch payload is supplied exactly once as the new loop input.
8. Settlement marks all linked user messages `sent` and appends the corresponding Tape replacement
   facts.
9. Reload in the same process may show an accepted `Unread` Steer because it is a real sent fact;
   cold-start recovery terminalizes an unclaimed Steer as `error` and shows no receipt instead.
10. Event delivery is a cache update, never the source of truth.
11. Pre-stream acceptance materializes and links the current claimed Queue user fact in the same
    transaction as the Steer, before assigning the Steer's `orderSeq`.
12. Normal claimed Queue materialization also creates the user fact and links its pending row in one
    transaction.
13. Restart terminalization changes every unread Steer message to `error`, appends its Tape
    replacement, and consumes the Steer row in one transaction.

## Acceptance Criteria

### Core behavior

- Sending a text-only Steer during an active assistant response adds a standard user message without
  a bottom loading row or Steer spinner.
- Sending Steer while the assistant is still preparing creates the current user fact first, then the
  `Unread` Steer, and leaves no blank or cancelled assistant row.
- The message initially shows `Unread`.
- The current assistant message remains the active stream until the backend-safe boundary.
- At claim, `Unread` becomes `Read`.
- The response begins in a distinct assistant message below the Steer.
- The old assistant message receives no later stream append.
- `Read` disappears according to the specified timing without moving the message row.

### Queue behavior

- Queue items remain editable and reorderable in the bottom lane.
- Queue promotion creates a visible `Unread` Steer only after successful preparation.
- Normal Queue drain creates no receipt.
- Queue drafts retained across cold restart do not drain from hydration or lifecycle wakes and expose
  `Resume queue` only when the backend reports an actual restart hold while the Session is idle.
- A manually resumed Queue head is consumed before its provider Run and does not return to Queue
  after a provider error, including after attachment Retry or Send without image content.

### Reliability

- Rapid Steers create separate bubbles, enter one batch before claim, and receive one reply below
  the last bubble.
- A Steer accepted after claim belongs below the newly reserved assistant message.
- Reload and restart never duplicate, hide, or reorder accepted Steer messages.
- Cold restart never executes an unclaimed Steer implicitly; it renders without a receipt and the
  standard toolbar Retry action starts one normal turn.
- Retrying a restart-failed Steer does not release retained Queue drafts.
- A post-claim failure never removes or reverts the user message.
- DeepChat and ACP satisfy the same visible ordering contract.

### UI quality

- Light and dark themes use existing semantic tokens.
- The receipt is keyboard/screen-reader understandable.
- Reduced-motion mode has no fade.
- Virtualized message row height remains stable.
- Existing user bubble, attachment, mention, Skill, copy, and collapse rendering remain unchanged.

## Constraints

- Use pnpm and the repository's existing Electron, Vue 3, Pinia, vue-i18n, and shadcn-vue patterns.
- Keep context isolation and typed preload/IPC boundaries.
- Add no runtime dependency.
- Add no persistence table.
- Keep DeepChat and ACP behavior behind their existing backend handles.
- Preserve unrelated pending-input, transcript, Tape, compaction, Memory, and history-search
  behavior.

## Resolved Decisions

- Queue remains a draft lane; only Steer enters the transcript before claim.
- Rapid Steers remain separate visually and share the existing merged runtime batch.
- `Read` occurs at durable claim, not first token.
- `Read` is irreversible; post-claim errors produce an assistant error row.
- `Read` remains visible for 1.5 seconds and fades for 150 ms.
- Accepted Steers cannot be recalled or edited while active.
- Steer is available throughout an active turn, including before the first assistant stream update.
- This feature is delivered directly through its implementation PR; no separate GitHub issue is
  required.
