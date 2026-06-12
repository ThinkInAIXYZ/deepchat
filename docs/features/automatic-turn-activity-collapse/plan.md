# Plan

## Approach

Implement a render-only activity grouping layer inside assistant message rendering:

1. Expose assistant `updatedAt` on `DisplayMessage`.
2. Add a small pure helper that turns assistant blocks into render items.
3. Add a compact `MessageBlockActivityGroup.vue` component that renders the title and, when expanded,
   delegates to the existing reasoning/tool-call block components.
4. Update `MessageItemAssistant.vue` to render grouped items only when the turn is settled.
5. Add localized title strings and duration formatter output.
6. Cover the helper and component behavior with renderer tests.

No main-process, preload, IPC, route, database, or shared event contract changes are planned for the
first increment.

Persistence decision:

- Do not persist derived activity groups.
- Do not persist per-group expanded/collapsed state.
- Keep the default state collapsed each time a completed assistant message group is mounted.
- Use renderer computation first; add only an in-memory cache if profiling shows a real bottleneck.

## Affected Files

Expected renderer files:

- `src/renderer/src/components/chat/messageListItems.ts`
- `src/renderer/src/pages/ChatPage.vue`
- `src/renderer/src/components/message/MessageItemAssistant.vue`
- `src/renderer/src/components/message/MessageBlockActivityGroup.vue`
- `src/renderer/src/components/message/messageActivityGroups.ts`
- `src/renderer/src/i18n/*/chat.json`

Expected tests:

- `test/renderer/components/message/MessageItemAssistant.test.ts`
- `test/renderer/components/message/MessageBlockActivityGroup.test.ts`
- `test/renderer/components/message/messageActivityGroups.test.ts`

## Display Model

Add `updatedAt` to the renderer-only `DisplayMessageBase`.

```typescript
type DisplayMessageBase = {
  id: string
  timestamp: number
  updatedAt: number
  // existing fields...
}
```

Populate it in:

- `toDisplayMessage(record)`: `updatedAt: record.updatedAt`
- `toStreamingMessage(...)`: `updatedAt: Date.now()` for type completeness, though streaming messages
  must not be auto-grouped.

## Render Item Model

Keep the persisted `DisplayAssistantMessageBlock[]` unchanged. Add only a local UI render model.

```typescript
type AssistantRenderItem =
  | {
      kind: 'block'
      key: string
      block: DisplayAssistantMessageBlock
    }
  | {
      kind: 'activity-group'
      key: string
      blocks: DisplayAssistantMessageBlock[]
      startedAt: number
      endedAt: number
      durationMs: number
      reasoningCount: number
      toolCallCount: number
    }
```

This is not written to message content and is not sent over IPC.

## Performance Model

The grouping helper is an O(n) pass over the assistant block array, where n is the number of blocks in
one assistant message. This is expected to be cheaper than markdown rendering, tool-call detail
rendering, syntax highlighting, and media previews.

Renderer computation is preferred over persistence because the renderer already needs the block array
to decide which existing component to render. Persisting grouping state would not remove the need to
parse/render the message content, but would add:

- storage reads/writes for every manual toggle if UI state is persisted,
- schema or settings-key lifecycle concerns,
- stale synthetic ids after retry/regeneration/import,
- cleanup work when messages are deleted,
- extra compatibility surface for exports and variants.

Implementation should keep the helper pure and easy to memoize. If needed, cache render items in
memory by:

```text
messageId + content reference/hash + updatedAt + status + shouldGroupActivity
```

Do not add disk persistence as a performance optimization without measured renderer cost.

## Grouping Helper

Create a pure helper near message components:

```typescript
buildAssistantRenderItems({
  blocks,
  messageId,
  messageUpdatedAt,
  shouldGroup,
  isInternalToolCall
}): AssistantRenderItem[]
```

Rules:

- `shouldGroup === false`: every visible block returns as `kind: 'block'`.
- A block is activity when it matches the spec's collapsible activity definition.
- A block is groupable only when its status is not `loading` or `pending`.
- Consecutive groupable activity blocks are buffered.
- Any non-groupable visible block flushes the buffer before itself.
- Internal hidden tool calls are skipped exactly as they are today.

Keying:

- Use stable block ids/tool call ids when present.
- Fall back to `messageId:index`.
- Group key can be `activity:${messageId}:${firstIndex}:${lastIndex}`.

## Turn Settled Gate

In `MessageItemAssistant.vue`, compute:

```typescript
const shouldGroupActivity = computed(() => {
  if (resolvedIsInGeneratingThread.value) return false
  if (currentMessage.value.status === 'pending') return false
  return true
})
```

If implementation finds paused user-interaction turns have `status: pending` even after stream end,
do not broaden the first increment. Keep pending turns ungrouped unless a reliable existing signal
already distinguishes inactive pending from active streaming.

This keeps the behavior strict and avoids hiding activity while the turn is still live.

## Activity Group Component

`MessageBlockActivityGroup.vue` props:

```typescript
defineProps<{
  blocks: DisplayAssistantMessageBlock[]
  messageId: string
  threadId: string
  usage: DisplayMessageUsage
  startedAt: number
  endedAt: number
  reasoningCount: number
  toolCallCount: number
}>()
```

State:

- `isExpanded = false` by default.
- Local state only; no config setting and no message metadata write.
- Toggling emits `toggle-collapse` so `MessageItemAssistant` can reuse the existing
  `variantChanged` notification path.

Rendering:

- Title row mirrors `ThinkContent` text size/color/chevron.
- The title row is a real button with reset button styles.
- Expanded children render in a flat `flex flex-col gap-1.5` container with no added left padding.
- Reasoning blocks use `MessageBlockThink`.
- Tool-call blocks use `MessageBlockToolCall`.
- Artifact thinking can reuse the same visual pattern as reasoning if the codebase already renders
  it through `MessageBlockThink`; otherwise keep it as an explicit non-goal for the first
  implementation pass.

## Title Text

Recommended Chinese title:

```text
已经工作了 {duration} · {reasoningCount} 段思考 · {toolCallCount} 次工具调用
```

Recommended English title:

```text
Worked for {duration} · {reasoningCount} thought(s) · {toolCallCount} tool call(s)
```

Omit count segments when the count is `0`:

- reasoning only: `已经工作了 12秒 · 1 段思考`
- tool calls only: `已经工作了 12秒 · 2 次工具调用`

## Duration Formatting

Add a local formatter in the grouping helper or a small companion file. Keep the formatter pure and
pass localized unit labels from `MessageBlockActivityGroup.vue`:

```typescript
type ActivityDurationLabels = {
  day: string
  hour: string
  minute: string
  second: string
}

formatActivityDuration(durationMs: number, labels: ActivityDurationLabels): string
```

Implementation detail:

- Clamp non-finite values to `0`.
- `totalSeconds = Math.max(0, Math.floor(durationMs / 1000))`.
- Compute days/hours/minutes/seconds.
- Concatenate non-zero units and include seconds when all larger units are zero.
- Use localized unit labels from `chat.activityCollapse.duration.*`.
- Unit labels may include spacing when the locale needs spaces between duration segments.

Avoid `Intl.DurationFormat` for now because support varies and would add fallback complexity.

## Styling

Use the current reasoning header as the visual reference:

- `text-xs`
- `leading-4`
- muted foreground color consistent with `ThinkContent`
- `lucide:chevron-right` when collapsed
- `lucide:chevron-down` when expanded
- no border/card wrapper
- no additional content indentation
- `self-start` width title, not full-width panel

ASCII layout target:

```text
Assistant row
  icon | message column
       | info line
       | > Worked for 1m 12s · 1 thought · 2 tool calls
       | visible answer text
```

Expanded target:

```text
Assistant row
  icon | message column
       | v Worked for 1m 12s · 1 thought · 2 tool calls
       | Thinking for 18s
       | [tool] shell_command
       | [tool] read_file
       | visible answer text
```

## Compatibility

- Existing persisted messages render unchanged except for the new collapsed presentation.
- Export, context building, compaction, and model input are unaffected because stored blocks are not
  changed.
- Copy behavior remains based on `currentContent`.
- Existing reasoning global setting `think_collapse` remains scoped to individual reasoning content
  when a group is expanded. The group's default collapsed state is independent.
- Manual activity-group expansion is intentionally not remembered across reloads in the first
  increment.
- Search and trace behavior are unaffected.

## Risks

1. **Duration overcounts separate groups in the same message.**
   - Mitigation: first increment uses the only reliable end timestamp available in the current display
     model, the final assistant message `updatedAt`. Do not add backend block update timestamps unless
     the UX proves this is misleading.
2. **Pending paused turns may remain long.**
   - Mitigation: keep first increment strict. If needed later, add a reliable settled-state signal
     rather than guessing from block shapes.
3. **Rendering logic duplication.**
   - Mitigation: group component renders only the narrow set of groupable block types.
4. **Layout shift after reload.**
   - Mitigation: collapse only after stream completion reload; this is expected and solves transcript
     length. Keep scrolling behavior covered by existing message-list auto-scroll tests if affected.
5. **Repeated renderer grouping work.**
   - Mitigation: keep grouping pure and O(n). Add in-memory memoization only if profiling shows the
     helper is material compared with existing block rendering.

## Test Strategy

Unit tests:

- Group consecutive reasoning/tool-call blocks after a settled turn.
- Split groups around `content` blocks.
- Skip grouping when `shouldGroup` is false.
- Skip `loading` and `pending` activity blocks.
- Preserve internal hidden tool-call behavior.
- Format duration for seconds, minutes, hours, and days.
- Verify grouping helper remains deterministic so in-memory memoization is safe if added later.

Component tests:

- `MessageItemAssistant` renders `MessageBlockActivityGroup` for final messages.
- `MessageItemAssistant` renders raw `MessageBlockThink` / `MessageBlockToolCall` while pending.
- `MessageBlockActivityGroup` starts collapsed.
- Clicking title expands and shows child reasoning/tool-call stubs.
- Clicking again collapses.
- Remounting a group returns it to the default collapsed state.
- Title includes duration and counts.

Manual QA:

- Long agent turn with multiple tool calls.
- Turn with only final text and no activity.
- Turn with reasoning only.
- Turn with tool calls only.
- Error final message.
- Dark mode.
- Narrow chat width.

Quality gates after implementation:

```text
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm test -- MessageItemAssistant
pnpm test -- MessageBlockActivityGroup
```
