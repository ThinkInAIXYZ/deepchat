# Automatic Turn Activity Collapse

## User Need

DeepChat agent turns can include multiple reasoning sections and tool calls before the final answer.
When every intermediate block remains expanded, one assistant turn becomes too long to scan and the
final conclusion is pushed far down the transcript.

Users need completed thinking/tool activity to collapse automatically after the turn settles, while
keeping the final text answer visible and preserving the current message layout.

## Goal

After an assistant turn is complete, automatically group completed reasoning and visible tool-call
blocks into a compact collapsible title row. The title should reuse the visual language of the
current reasoning-content header, show how long the grouped work took, and expand/collapse on click.

The grouping is a renderer-only presentation transform over the existing assistant message blocks.
It must not create a new persisted message type, database table, or backend transport contract unless
implementation proves the renderer cannot compute the required state reliably.

## Current Structure Summary

- Chat messages are loaded in `ChatPage.vue` from `ChatMessageRecord` into `DisplayMessage`.
- Assistant content is stored as a JSON array of `AssistantMessageBlock`.
- `MessageItemAssistant.vue` renders assistant blocks in order:
  - `content` through `MessageBlockContent`
  - `reasoning_content` through `MessageBlockThink`
  - `tool_call` through `MessageBlockToolCall`
  - other block types through their existing block components
- Streaming updates apply blocks inline while the assistant message is pending, then stream end reloads
  the persisted message.
- Reasoning UI uses `ThinkContent.vue`, whose title row is compact text plus a chevron/ellipsis.

## UX Requirements

1. During streaming, keep the current layout and do not auto-collapse new blocks.
2. After the turn settles, collapse completed reasoning/tool-call activity by default.
3. Keep regular assistant text content visible by default.
4. Clicking the activity title toggles the grouped activity open/closed.
5. The activity title must not introduce a new indentation level for the expanded blocks.
6. The expanded content must reuse existing reasoning/tool-call block rendering.
7. Pending user actions, errors, media, plans, and normal text content must remain visible unless they
   already have their own existing collapsed behavior.
8. Internal tool calls that are already hidden, such as internal `update_plan`, must stay hidden.
9. Copy behavior must continue to use the original assistant content array, so existing
   `copyWithCotEnabled` behavior remains unchanged.
10. The feature should not add a user setting in the first increment.

## Collapsible Activity Definition

The first increment treats these completed block types as collapsible activity:

- `reasoning_content` with non-empty `content`
- `artifact-thinking` with non-empty `content`
- visible `tool_call` blocks, excluding current internal tool calls

The first increment does not auto-collapse:

- `content`
- `plan`
- `action`
- `error`
- `search`
- `image`
- `audio`
- `video`
- any block with `status` still `loading` or `pending`

## Grouping Rules

1. Build render groups only when the assistant turn is settled.
2. Preserve the original block order.
3. Consecutive collapsible activity blocks become one activity group.
4. A visible non-activity block flushes the current activity group before rendering that block.
5. If the final blocks are collapsible activity and the turn is settled, render them as the final
   activity group.
6. If a group contains only one collapsible block, still collapse it automatically after turn end.

## Settled Turn Definition

A turn is considered settled when the renderer is no longer receiving stream updates for that
assistant message and the persisted message has been reloaded after stream completion or failure.

Implementation should prefer existing signals:

- `chat.stream.completed` / `chat.stream.failed` already trigger `loadMessages`.
- Persisted `ChatMessageRecord.updatedAt` is available after reload.
- `MessageItemAssistant` already receives message status and generating-thread state.

The feature must not collapse blocks while the current assistant message is actively streaming.

## Persistence Decision

The first increment must not persist either the derived activity groups or each group's expanded /
collapsed UI state.

Keep these concepts separate:

- Stored assistant blocks: existing source of truth, unchanged.
- Derived activity groups: renderer-only, rebuilt from the block array.
- Expanded/collapsed state: local component state, default collapsed after the group is mounted.

Reasons:

1. Grouping is a cheap linear pass over blocks that are already parsed for rendering.
2. Persisting derived groups would duplicate source data and introduce invalidation rules when a
   message is edited, retried, regenerated, imported, or rendered as a variant.
3. Persisting per-group UI state would require stable synthetic group ids and storage cleanup for
   deleted messages, without improving the main goal of reducing long completed turns.
4. A stored state could make old long turns unexpectedly expanded on later visits, weakening the
   default compact transcript behavior.

If profiling later shows grouping is expensive, prefer an in-memory renderer cache keyed by message
id, content identity, `updatedAt`, status, and the grouping gate. Do not add disk persistence for
performance unless measurements show the renderer pass is a bottleneck.

## Duration Display

The collapsed title shows the duration from the grouped work's first creation timestamp to the
containing assistant message's final update timestamp.

Start timestamp:

- Use the first folded block's `timestamp`.

End timestamp:

- Use the containing assistant message's `updatedAt` after it is exposed to the display message.
- Clamp to the start timestamp if malformed or earlier than start.

Formatting:

- Use whole seconds.
- Omit leading zero units.
- Always include seconds when duration is under one minute.
- Maximum display granularity is days, hours, minutes, seconds.
- Unit labels must come from i18n, not hardcoded locale checks.

Examples:

- `已经工作了 8秒`
- `已经工作了 3分钟12秒`
- `已经工作了 2小时4分钟9秒`
- `已经工作了 1天3小时10分钟2秒`

English equivalent:

- `Worked for 8s`
- `Worked for 3m 12s`
- `Worked for 2h 4m 9s`
- `Worked for 1d 3h 10m 2s`

## ASCII UI

Before:

```text
Assistant  GPT-5  10:20

Thinking for 18s                 v
Reasoning text...
More reasoning text...

[tool] shell_command  pnpm run lint
  params...
  response...

[tool] read_file  MessageItemAssistant.vue
  params...
  response...

Final answer starts here...
```

After, collapsed:

```text
Assistant  GPT-5  10:20

> 已经工作了 2分钟13秒 · 1 段思考 · 2 次工具调用

Final answer starts here...
```

After, expanded:

```text
Assistant  GPT-5  10:20

v 已经工作了 2分钟13秒 · 1 段思考 · 2 次工具调用
Thinking for 18s                 v
Reasoning text...
More reasoning text...

[tool] shell_command  pnpm run lint
  params...
  response...

[tool] read_file  MessageItemAssistant.vue
  params...
  response...

Final answer starts here...
```

No extra indentation:

```text
v 已经工作了 2分钟13秒 · 1 段思考 · 2 次工具调用
Thinking for 18s
[tool] shell_command
Final answer starts here
^ same left edge
```

Multiple activity phases in one turn:

```text
Assistant  GPT-5  10:20

> 已经工作了 42秒 · 1 段思考 · 1 次工具调用

I found the relevant file and will adjust the renderer grouping.

> 已经工作了 1分钟9秒 · 1 段思考 · 2 次工具调用

The implementation is complete.
```

## Accessibility

1. The title row is a `button`.
2. It exposes `aria-expanded`.
3. It has an accessible label that includes the duration and whether it expands or collapses the
   activity group.
4. Keyboard activation uses native button behavior.
5. The focus ring should match existing button/focus styling.

## Acceptance Criteria

1. Completed assistant messages with reasoning/tool-call blocks show collapsed activity groups by
   default.
2. Active streaming messages continue to show reasoning/tool-call progress as they do today.
3. Clicking a collapsed group expands it and shows the original reasoning/tool-call components in the
   original order.
4. Clicking an expanded group collapses it again.
5. The expanded content aligns with the group title and does not shift right compared with the
   collapsed title.
6. The final assistant text content remains visible without an extra click.
7. Duration text is computed from the first folded block timestamp to the assistant message
   `updatedAt`, formatted up to days/hours/minutes/seconds.
8. Existing hidden internal tool calls remain hidden.
9. Existing message copy behavior is unchanged.
10. Grouping and expanded/collapsed UI state are not persisted in the first increment.
11. Tests cover grouping, duration formatting, default collapsed state after turn completion, and no
    grouping during active streaming.

## Non-goals

- No backend compaction or summarization of reasoning/tool results.
- No deletion or mutation of stored assistant blocks.
- No persistent per-user collapse preference.
- No persisted per-message or per-group expansion state.
- No new database table or migration.
- No auto-collapse for pending permission/question cards.
- No visual redesign of tool-call details.

## Constraints

- Keep the change focused in renderer message rendering.
- Follow Vue 3 Composition API and existing Tailwind utility style.
- Use existing i18n files for user-facing text.
- Do not duplicate large message rendering logic unless extracted into a small local helper.
- Avoid adding broad fallback heuristics for malformed historical data; clamp invalid duration and
  render original blocks if grouping cannot be computed.

## Open Questions

Resolved: the first increment should be renderer-only and should not persist synthetic activity
blocks.

Resolved: grouping should happen only after a turn settles, not during streaming.

Resolved: the group title should not create an indentation wrapper around expanded content.
