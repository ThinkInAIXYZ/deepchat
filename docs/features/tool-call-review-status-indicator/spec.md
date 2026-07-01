# Tool Call Review Status Indicator

Status: proposed
Date: 2026-07-01

## User Need

When `auto_approve` is reviewing a tool call with the assistant model, the tool pill should show a
distinct yellow status dot. Users should be able to tell that DeepChat is waiting on model review,
not running the tool, waiting for their manual approval, or already finished.

## Current Behavior

Tool pills are rendered by `src/renderer/src/components/message/MessageBlockToolCall.vue`. The status
indicator is derived from `block.status`:

- neutral/gray for pending or unknown states
- running for `loading`
- success/green for `success`
- error/red for `error`

The upcoming `auto_approve` review path runs before the tool is allowed to execute, but the tool pill
has no separate visual marker for that review window.

## UX Target

Before:

```txt
Tool pill states

○ read /path      pending/neutral
○ read /path      running/executing
● read /path      success
● read /path      error
```

After:

```txt
Tool pill states

○ read /path      pending/neutral
● read /path      reviewing with assistant model (yellow)
○ read /path      running/executing
● read /path      success
● read /path      error
```

The yellow dot is a transient review state. It must not remain after the review resolves.

## Acceptance Criteria

- Tool calls under `auto_approve` show a yellow indicator while model review is pending.
- The yellow indicator appears before awaiting the reviewer result, so slow reviewer calls are visible.
- Approved actions leave review state and continue into the normal executing/success path.
- Reviewer `ask_user` results leave review state and show the existing permission interaction UI.
- Reviewer `block` results leave review state and show the existing error path.
- Non-`auto_approve` tool calls keep the current gray/running/green/red behavior.
- The implementation does not add a new persistent database field.
- The implementation does not add a new IPC event; existing stream snapshots carry the transient UI
  marker.
- The indicator uses the existing tool pill size and does not shift the label or summary text.

## Constraints

- Reuse `AssistantMessageBlock.extra` for transient renderer metadata.
- Do not split model review into a separate visible message or action card.
- Do not overload `block.status = 'loading'`; reviewing is not tool execution.
- Keep the yellow state scoped to the exact tool call being reviewed.

## Non-goals

- Showing reviewer rationale in the chat UI.
- Persisting review latency or audit data in message content.
- Adding a global review progress banner.
- Changing the manual permission dialog.

## Open Questions

None.
