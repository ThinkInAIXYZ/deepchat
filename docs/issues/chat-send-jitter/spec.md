# Chat send jitter

## Issue

When the user sends a message while the chat is pinned to the bottom, the message list can visibly jump for one frame immediately after submit or flash when the first assistant chunk starts rendering.

## Impact

The MarkStream rendering work feels smoother during generation, but the first outgoing-turn UI updates can still feel unstable because the list scroll position is corrected twice and the pending assistant row can be replaced by a different keyed DOM node at stream start.

## Suspected root cause

`ChatPage` inserts both an optimistic user message and an empty pending assistant placeholder before the backend starts streaming. `useMessageWindow` estimates an empty pending assistant row as a normal assistant message (`ASSISTANT_BASE`, 136px), while the real DOM for that row is only the assistant header plus spinner. `MessageListRow` then reports the smaller measured height on the next animation frame, and `ChatPage.onMessageMeasure` scrolls to the bottom again, causing a visible submit-time adjustment.

At stream start, `chat.stream.updated` can set `isStreaming` before the real assistant record is available. The old placeholder was hidden immediately on `isStreaming`, leaving a one-frame gap. When the real assistant message then appears, `MessageList` keyed it by the real message id instead of the pending placeholder id, unmounting the spinner row and mounting a new assistant row.

## Fix plan

- Teach `useMessageWindow` to estimate empty pending assistant placeholders close to their actual spinner row height.
- Keep the change narrowly scoped to synthetic pending assistant rows so real assistant messages keep their existing estimates.
- Keep the pending assistant placeholder visible until the first real streaming assistant content exists.
- Carry the pending placeholder render key onto the first real assistant row so Vue patches the existing row instead of replacing it.
- Add regression tests covering the placeholder estimate, measurement delta, and stream-start row transition.

## Task checklist

- [x] Link GitHub bug issue
- [x] Update placeholder height estimate
- [x] Keep placeholder stable through stream-start
- [x] Add regression coverage
- [x] Run focused tests and required checks
- [x] Commit and push the PR branch

## Validation

- `pnpm exec vitest --config vitest.config.renderer.ts test/renderer/composables/useMessageWindow.test.ts test/renderer/components/MessageListRow.test.ts test/renderer/components/ChatPage.test.ts`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck:web`

## Linked GitHub issue

https://github.com/ThinkInAIXYZ/deepchat/issues/1897
