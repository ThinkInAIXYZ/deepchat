# Assistant Loading Placeholder Delay Plan

## Renderer Working Brief

Target

- User-visible behavior: submitted turns show an assistant loading row immediately.
- Current rendering component: `src/renderer/src/pages/ChatPage.vue`.
- Logical owner: `ChatPage` owns submit orchestration and `displayMessages`.
- Route/layout/shell owner: existing chat page message list layout.
- Trigger path: `ChatInputBox submit` -> `ChatPage.onSubmit()` -> `chatClient.sendMessage()`.
- Existing similar implementation: `MessageItemAssistant.vue` already renders a spinner for empty
  pending assistant messages; `messageStore.addOptimisticUserMessage()` already supports local user
  echo.

Context Map

- Vue owner chain: `ChatPage` -> `MessageList` -> `MessageListRow` -> `MessageItemAssistant`.
- DOM/render chain: `displayMessages` feeds the virtualized/windowed message list.
- State source: persisted messages from `messageStore.messages`; stream snapshots from
  `messageStore.isStreaming`, `streamingBlocks`, and `currentStreamMessageId`.
- Derived state: `displayMessages` appends a virtual streaming row only when stream blocks exist.
- Events: `chat.stream.updated` folds stream blocks into a real assistant record; `chat.stream.completed`
  reloads persisted messages.
- Side effects: submit starts `agentPlanStore.beginTurn()`, calls `chatClient.sendMessage()`, clears
  composer, clears skill chips, and schedules scroll.
- Styling/layout constraints: reuse the existing assistant message row and spinner; no new overlay.
- Performance-sensitive areas: keep placeholder state local and avoid adding reactive work per message
  item.
- Accessibility concerns: no new visible text; existing row/spinner behavior remains.
- Electron boundary: no new preload/IPC/main-process contract.
- Existing project patterns: local refs in `ChatPage`, computed `displayMessages`, existing message
  store helper for optimistic user echo.

Diagnosis

- Root cause: loading UI depends on backend stream events, but the first stream event is after
  pre-stream work and possibly after provider first-token latency.
- Correct ownership layer: renderer submit orchestration, because the requirement is immediate visual
  feedback rather than a new persisted message lifecycle state.
- Affected consumers: chat page only; exports, search, remote clients, and persisted history should not
  see fake assistant records.
- Constraints: avoid duplicate assistant rows, clear on session switch/failure, do not create queued
  turn placeholders.
- Existing pattern to reuse: `toStreamingMessage([], placeholderId)` plus `MessageItemAssistant` empty
  pending spinner.

Decision

- Selected approach: add a local pending assistant placeholder in `ChatPage` for active non-queued
  submits, append it from `displayMessages` while no real stream/persisted assistant row is available,
  and clear it on stream start, message reload, failure, or session switch.
- Files to edit:
  - `src/renderer/src/pages/ChatPage.vue`
  - `src/renderer/src/stores/ui/message.ts` only if the existing optimistic user helper needs a tiny
    payload shape fix
  - `test/renderer/components/ChatPage.test.ts`
  - `test/renderer/stores/messageStore.test.ts` only if the store helper changes
- State impact: one local placeholder id/session ref in `ChatPage`; no persisted schema changes.
- DOM/layout impact: one normal assistant row using existing row structure and spinner.
- Render/update impact: placeholder disappears once `messageStore.isStreaming` or the real assistant
  record exists; current stream row reuse remains unchanged.
- IPC/main-process impact: none.
- Verification plan: focused ChatPage tests and existing message store streaming tests.

## Implementation Notes

The shortest stable implementation is renderer-only:

1. Capture the outgoing payload in `onSubmit()` before clearing the composer.
2. For non-generating sends, add the existing optimistic user echo if it is still valid for the
   payload, then set a local pending assistant placeholder id.
3. Clear the composer and schedule bottom scroll immediately after local optimistic state is set, not
   after `chatClient.sendMessage()` resolves.
4. Call `chatClient.sendMessage()` and clear the placeholder in the rejection path if no stream has
   started.
5. In `displayMessages`, append `toStreamingMessage([], placeholderId)` only when:
   - the placeholder belongs to `props.sessionId`
   - `messageStore.isStreaming` is false
   - there is no current inline streaming target
6. Clear local placeholder on session id change and after persisted message hydration catches up.

Avoid moving `createAssistantMessage()` before `buildTapeChatView()` in the first increment. That
touches context/tape ordering and is unnecessary for a purely visual loading placeholder.

## Test Strategy

- `ChatPage` renders an assistant spinner immediately after submit before any stream update.
- `ChatPage` clears the placeholder when `messageStore.isStreaming` becomes true.
- `ChatPage` does not create a placeholder when submit queues input during active generation.
- `ChatPage` removes the placeholder when `chatClient.sendMessage()` rejects before streaming.
- `ChatPage` clears placeholder state on `sessionId` change.

## Compatibility

This does not change persisted message format, route contracts, stream event contracts, or provider
execution behavior.
