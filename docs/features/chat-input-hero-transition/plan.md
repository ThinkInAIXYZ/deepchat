# Chat Input Hero Transition Plan

## Approach

- Add a small renderer utility that captures the source `ChatInputBox` DOM node from `NewThreadPage.vue`, clones it into a fixed overlay, and stores a pending flight in module state.
- Consume that pending flight from `ChatPage.vue` after mount by animating the overlay clone to the destination `ChatInputBox` bounds with the Web Animations API.
- Fade the destination composer in during the last part of the flight to avoid duplicate visible inputs.

## Affected Files

- `src/renderer/src/lib/chatInputHero.ts`
- `src/renderer/src/pages/NewThreadPage.vue`
- `src/renderer/src/pages/ChatPage.vue`

## Data Flow

- `NewThreadPage.vue` resolves the local `ChatInputBox` element and calls `prepareChatInputHeroFlight()` before triggering session navigation.
- The helper stores an in-memory pending flight plus an overlay clone attached to `document.body`.
- `ChatPage.vue` resolves its composer element on mount and calls `playChatInputHeroFlight()`.
- The helper animates overlay position, scale, and border radius, then removes the overlay and restores the destination element.

## Compatibility And Risk

- Reduced-motion users bypass the animation.
- Failed navigation or failed session creation explicitly cancel the pending overlay.
- Because the state is module-local and one-shot, unrelated route changes remain unaffected.

## Validation

- Run `pnpm run format`
- Run `pnpm run i18n`
- Run `pnpm run lint`
