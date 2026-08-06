# 013 — Add a mount-once entrance to newly sent messages (opportunity)

- **Status**: DONE
- **Commit**: aefcb11cd
- **Severity**: MEDIUM (opportunity)
- **Category**: Missed opportunities
- **Estimated scope**: 1 file (MessageList.vue), ~20 lines + scoped CSS

## Problem

The message list is the app's core view, but rows insert with zero motion: your sent message and
the first assistant frame pop into the stream with no spatial cue. This is a *missed opportunity*
finding — the playbook's delight budget applies to occasional moments, and a sub-200ms opacity
entrance on the user's own sent row (NOT the streaming tokens) is within the crisp-productivity
budget.

Hard constraint: the list is **virtualized** (`MessageList.vue` renders a windowed
`allRenderedMessages` slice between measured spacers). A `<TransitionGroup>` would break the
spacer math — this plan must NOT use one.

Current code (`src/renderer/src/components/chat/MessageList.vue:10-28`):

```html
<MessageListRow
  v-for="item in allRenderedMessages"
  :key="item.renderKey ?? item.id"
  ...
/>
```

## Target

Animate ONLY rows that appear after the list finished its initial mount — never historical rows
(backfill/pagination/scroll-back) and never the streaming assistant frame (token frames already
have their own presence):

1. Scoped CSS in MessageList.vue:

```css
.message-row-entrance {
  animation: message-row-in 140ms var(--dc-ease-out-soft);
}

@keyframes message-row-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .message-row-entrance {
    animation: none;
  }
}
```

2. In `<script setup>`, keep a `const enteredRows = new Set<string>()`. On `props.messages`
   change, for the **last** message in the list only: if it is a newly appended message (id not
   in `enteredRows`), it is the user's own message (`role === 'user'`), and it is not the
   currently streaming id — add the class for that row and put its id in `enteredRows`.

3. Bind the class on the row wrapper:

```html
<MessageListRow
  v-for="item in allRenderedMessages"
  :key="item.renderKey ?? item.id"
  :class="{ 'message-row-entrance': shouldAnimateEntrance(item) }"
  ...
/>
```

`shouldAnimateEntrance(item)` returns true only while the row is in `enteredRows`; remove the
entry on `animationend` (or simply keep the set bounded — the class is inert after the animation
completes since `animation` does not replay unless the element remounts; for the virtualized
case, guard by NOT adding rows seen during initial mount: seed `enteredRows` with all ids present
at mount time).

The `MessageListRow` root must accept a `class` attribute (Vue passes attrs through unless
`inheritAttrs: false` — check the component first; if it sets `inheritAttrs: false`, apply the
class on the row wrapper `<div>` around `MessageListRow` instead, keeping the same data flow).

## Repo conventions to follow

- 140ms entrance + `--dc-ease-out-soft`: same values as
  `src/renderer/src/components/sidepanel/ChatSidePanel.vue:406` (`180ms var(--dc-ease-out-express)`
  is the token style for keyframes).
- Reduced-motion pattern: `src/renderer/src/components/message/MessageInfo.vue:50` has a local
  `@media (prefers-reduced-motion: reduce)` block.

## Steps

1. Add the scoped CSS block to `MessageList.vue`.
2. Add the `enteredRows` set; seed it with every row id present on the first render
   (`onMounted` after the initial `allRenderedMessages` is computed).
3. Add a watcher on `props.messages`: if the last item's id is new, `role === 'user'`, and
   `item.id !== streamingMessageId`, add the id to `enteredRows`.
4. Bind `:class` per the target above (directly on `MessageListRow` if it inherits attrs,
   otherwise on a wrapper div).
5. Remove ids from `enteredRows` on `animationend` (optional but keeps the set from growing with
   a long session).

## Boundaries

- Do NOT use `<TransitionGroup>` — the list is virtualized.
- Do NOT animate streaming assistant content or token frames.
- Do NOT animate rows that appear during initial mount, page backfill, or scroll-back.
- Do NOT change scroll measurement (`@measure`, spacers) logic.

## Verification

- **Mechanical**: `pnpm exec vitest run test/renderer/components/chat/MessageListRow.test.ts test/renderer/components/ChatPage.test.ts`
  must pass — ChatPage tests cover virtualization, scroll compensation, and history restore.
- **Feel check**: send a message:
  - Your row fades in over 140ms with a 4px rise; the first assistant frame appears normally.
  - Open a long session and scroll: no entrance replays on any historical row.
  - Toggle `prefers-reduced-motion: reduce`: rows insert instantly, no animation.
- **Done when**: only freshly sent user rows animate, exactly once, and no virtualization test
  regresses.
