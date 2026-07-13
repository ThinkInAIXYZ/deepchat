# Steer / Queue Rework

## User Need

When a turn is generating, the user can either queue follow-up messages (which wait for the
current turn) or steer (interrupt the current turn immediately). The previous implementation did
neither intuitively: steer never aborted the active turn, the steer affordance was easy to miss,
and stopping a turn paused the queue behind a manual "resume" button.

## Problem

1. `AgentRuntimePresenter.steerActiveTurn` only enqueued a high-priority pending input and relied on
   `shouldYieldForPendingInput` at agent-loop tool boundaries. A plain text reply has no boundary, so
   steer effectively waited for the current turn to finish — it never interrupted.
2. The steer button was a faint ghost icon shown only while generating with draft text, so users did
   not discover it.
3. `cancelGeneration` paused the pending queue (`userPausedPendingQueues`) and an aborted
   queue-launched turn was rolled back to `pending`, producing the "回到 queue + 继续发送" loop.

## Acceptance Criteria

- Clicking steer aborts the active turn, **keeps the partial assistant output**, and immediately
  sends the steer message as the next turn (ahead of any queued items).
- A queued item exposes an **interrupt-and-send** action: clicking it promotes that item to steer
  and immediately interrupts the active turn (keeping partial output), running it as the next turn —
  the same semantics as toolbar steer, but sourced from an existing queue item.
- The steer control is a clearly visible button while generating with draft input; the primary
  button stays "queue".
- Stopping a turn aborts it (keeping partial output) and **automatically drains the next queued
  item** — no manual "resume" step.
- Stopping a turn that was itself launched from the queue does not re-run that item nor bounce it
  back to the waiting lane; it is consumed and the queue advances to the next item.
- Genuine (non-abort) errors still halt the queue at the error (no auto-retry loop).

## Non-goals

- Change rate-limit provider queues.
- Change queue capacity (still max 5) or steer merge behavior.
- Preserve the old pause/resume ("继续发送") workflow — it is removed.

## Supersedes

`docs/issues/stop-pauses-pending-queue` (archived). That spec deliberately paused the queue on stop;
this rework reverses that decision in favor of auto-continue.

## Review hardening (follow-up)

Post-implementation review surfaced six items, addressed as additional acceptance criteria:

- **Single-owner abort settlement.** The canceled terminal block, Stop/SessionEnd hooks, idle status,
  and queue drain are written exactly once per run, owned by the `processMessage` /
  `resumeAssistantMessage` abort branches. `cancelGeneration` only requests the abort and releases
  controllers/permissions — it no longer settles, so it can no longer double-fire hooks when the
  stream rethrows the abort.
- **Recoverable steer item.** Promoting a queued item to steer is recoverable: the backend permits
  deleting a *pending* steer item (it is no longer treated as immutable for deletion), the lane exposes
  a delete control, and a promotion that cannot start a turn is rolled back to the queue
  (`restoreSteerInputToQueue`) and surfaced as an error.
- **Actionable queue-row control.** The queue-row interrupt-and-send button is disabled with a reason
  tooltip when steering is not possible, and failures surface a toast instead of a silent console log.
- **Complete i18n.** `chat.pendingInput.toSteer` carries "Interrupt & send" semantics in every locale;
  new `remove` / `steerUnavailable` / `steerFailed` keys are translated across locales.
- **Trimmed API surface.** The unused renderer `convertPendingInputToSteer` / `convertToSteer`
  wrappers are removed; the backend route/method is retained and documented as the low-level,
  non-interrupting promote used by integration tests and external agents.
- **Clean tree.** `.deepchat/` runtime assets are gitignored.
- **Stale abort safety.** A stale run that later throws `AbortError` after a newer run has started
  dispatches its own terminal hooks and writes the canceled block, but must not set the session status
  to `idle` unless it is still the active run.
- **Started-drain response contract.** Backend steer actions return after a pending turn is claimed and
  launched, while the generation continues in the background. If a drain cannot start, the promoted
  steer item is restored to the queue or surfaced as a failed action.
- **Accessible queue controls.** Icon-only pending-input controls expose translated accessible names.
