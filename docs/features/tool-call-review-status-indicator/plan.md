# Tool Call Review Status Indicator Plan

## Renderer Working Brief

Target

- User-visible behavior: tool pills show a yellow dot while `auto_approve` model review is pending.
- Current rendering component: `MessageBlockToolCall.vue`.
- Logical owner: tool call block renderer plus agent runtime dispatch code that knows when review is
  pending.
- Route/layout/shell owner: no route or shell ownership change.
- Trigger path: provider emits tool call -> agent runtime dispatch enters auto-approve review -> stream
  snapshot updates tool block extra -> renderer maps review marker to yellow status.
- Existing similar implementation: `statusVariant` maps block state to status icon/ring; subagent
  progress already mutates `block.extra` for transient renderer metadata.

Context Map

- Vue owner chain: `ChatPage` -> `MessageList` -> `MessageItemAssistant` ->
  `MessageBlockToolCall`.
- DOM/render chain: one inline tool pill, status indicator first, tool name/summary after it.
- State source: `AssistantMessageBlock` snapshots from `chat.stream.updated`.
- Derived state: `MessageBlockToolCall.statusVariant`.
- Events: existing stream snapshot flushes are enough; no new event channel.
- Side effects: runtime marks the tool block as reviewing before awaiting the reviewer, then clears it
  when the reviewer returns.
- Styling/layout constraints: indicator remains `0.75rem`; no label width changes.
- Performance-sensitive areas: no per-frame animation or timers.
- Accessibility concerns: do not rely only on visible color if a non-visible label can be added cheaply.
- Electron boundary: no preload or IPC contract change.
- Existing project patterns: `block.extra` for renderer-only metadata, `state.dirty` +
  `scheduleRendererFlush` for stream updates.

Diagnosis

- Root cause: `block.status` conflates pending-before-execution with execution lifecycle and has no
  auto-review substate.
- Correct ownership layer: runtime owns the review marker; renderer owns color mapping.
- Affected consumers: only tool call pills in assistant messages.
- Constraints: reviewer state must clear on approve, ask-user, block, error, and abort.
- Existing pattern to reuse: mutate matching tool block by `tool_call.id`, set `state.dirty`, flush
  snapshot.

Decision

- Selected approach: add a transient `block.extra.autoApproveReviewStatus = 'reviewing'` marker while
  the reviewer promise is pending, and teach `MessageBlockToolCall` to map that marker to a yellow
  status variant.
- Files to edit:
  - `src/main/presenter/agentRuntimePresenter/dispatch.ts`
  - `src/renderer/src/components/chat/messageListItems.ts`
  - `src/renderer/src/components/message/MessageBlockToolCall.vue`
  - focused main runtime tests for review marker flush/clear
  - focused renderer tests for yellow review indicator
- State impact: transient block metadata only; no store shape or DB schema change.
- DOM/layout impact: same pill, same indicator slot, yellow visual state only.
- Render/update impact: one extra stream snapshot before reviewer await and one clear after reviewer
  result.
- IPC/main-process impact: none.
- Verification plan: focused dispatch tests and `MessageBlockToolCall` tests.

## Implementation Notes

Use the smallest marker possible:

```ts
extra: {
  autoApproveReviewStatus: 'reviewing'
}
```

Add tiny helpers near existing tool block mutation helpers:

- `markToolCallReviewing(blocks, toolCallId)`
- `clearToolCallReviewing(blocks, toolCallId)`

Runtime sequence:

```txt
tool_call block exists
mark reviewing
flush renderer snapshot
await auto approve reviewer
clear reviewing
continue with auto_allow / ask_user / block handling
flush existing outcome snapshot
```

Renderer sequence:

```txt
if extra.autoApproveReviewStatus === 'reviewing' -> statusVariant = 'reviewing'
else fall back to existing error/success/loading/neutral mapping
```

Keep `block.status` unchanged while reviewing. That preserves execution semantics and prevents a
reviewing tool from looking like it is already running.

## Test Strategy

- Main runtime: review path marks the target tool call as reviewing before reviewer promise resolves.
- Main runtime: review marker clears on auto-allow.
- Main runtime: review marker clears on ask-user fallback.
- Main runtime: review marker clears on block/error.
- Renderer: a block with `extra.autoApproveReviewStatus = 'reviewing'` renders the yellow indicator.
- Renderer: reviewing marker takes precedence over `pending` but not over terminal `error` if both are
  somehow present after malformed input.

## Compatibility

The marker lives inside assistant block JSON. Older clients ignore unknown `extra` fields. Persisted
messages should normally not retain this marker because it is cleared before terminal persistence, but
even if a crash leaves it behind, the renderer can treat terminal `success/error` as higher priority.
