# Chat send jitter

## Issue

When the user sends a message while the chat is pinned to the bottom, the message list can visibly jump for one frame immediately after submit.

## Impact

The MarkStream rendering work feels smoother during generation, but the first outgoing-turn UI update can still feel unstable because the list scroll position is corrected twice.

## Suspected root cause

`ChatPage` inserts both an optimistic user message and an empty pending assistant placeholder before the backend starts streaming. `useMessageWindow` estimates an empty pending assistant row as a normal assistant message (`ASSISTANT_BASE`, 136px), while the real DOM for that row is only the assistant header plus spinner. `MessageListRow` then reports the smaller measured height on the next animation frame, and `ChatPage.onMessageMeasure` scrolls to the bottom again, causing a visible submit-time adjustment.

## Fix plan

- Teach `useMessageWindow` to estimate empty pending assistant placeholders close to their actual spinner row height.
- Keep the change narrowly scoped to synthetic pending assistant rows so real assistant messages keep their existing estimates.
- Add a regression test covering the placeholder estimate and measurement delta.

## Task checklist

- [x] Link GitHub bug issue
- [x] Update placeholder height estimate
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
