# Ask User Empty Prompt And Compaction Order

## Problem

After a DeepChat `deepchat_question` answer is selected or deferred to a follow-up message, the next
model request can include a blank user message. AI SDK rejects that prompt with
`Invalid prompt: messages must not be empty`.

The resume context can also collapse to only the leading system prompt when the protected resume
turn is larger than the remaining positive token budget. In that case Anthropic-compatible
providers such as MiniMax promote the only message to the top-level `system` option and pass an
empty `messages` array to AI SDK.

Context compaction can also run while resuming an assistant message after an ask-user interaction.
The persisted compaction indicator is currently appended after the whole assistant message, so the UI
shows "context compacted" at the bottom instead of where the compaction happened in the turn.

## Acceptance Criteria

- Blank text-only user inputs are not included in model prompts.
- User inputs that contain files/media still produce a valid model prompt even when the text is blank.
- Ask-user option answers continue to resume the assistant message normally.
- The protected ask-user resume turn is kept even when it exceeds the remaining history budget, so
  the provider still receives the resolved tool call and tool result instead of a system-only prompt.
- Resume-time compaction indicators are persisted before the assistant message being resumed, so the
  message list renders the indicator at the interaction point instead of at the bottom.
- Existing automatic compaction before a new user turn keeps its current ordering.

## Non-Goals

- Redesigning the ask-user UI.
- Changing compaction summary content or token budgeting.
- Changing manual compaction behavior outside the persisted indicator placement.
