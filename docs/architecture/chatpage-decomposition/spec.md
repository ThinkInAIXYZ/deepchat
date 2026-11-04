# ChatPage Composition and Race Ownership

`src/renderer/src/features/chat-page/ChatPage.vue` composes the chat page. Its private composables
stay in `features/chat-page/composables/`; `ChatTabView` consumes the feature through its page entry.
They depend on page state and are not general renderer utilities.

## Feature Owners

| Owner | Contract |
| --- | --- |
| `useSessionRestore` | Session preparation, restore generation, stale-write rejection, and deactivation |
| `useDisplayMessages` | Record-to-display conversion, stable/streaming groups, render-key cache, and pending-assistant placeholder state |
| `useMessageVirtualization` | Bounded windows, measurement batches, logical anchors, and geometry observation |
| `useListGestures` | Wheel, touch, pointer, and keyboard intents for the scroll controller |
| `useChatSearch` | Loaded-message search, navigation intent, and highlight scheduling |
| `useComposerSubmit` | Send, queue, steer, commands, compaction, and attachment-generation gates |
| `useVoiceInput` | Availability, model configuration subscriptions, recognition/transcription, and cleanup |
| `useToolInteraction` | Top-level/Subagent interactions, response single-flight, and current-page refresh |
| `useMessageActions` | Retry, edit, delete confirmation, fork, and continue |
| `usePendingInputActions` | Queue edits/reorder/delete/steer while preserving attachments and Skills |
| `useChatPageEventBridge` | Window-event subscriptions with explicit start/stop ownership |

The assistant placeholder stays with display conversion because its render-key handoff and streaming
visibility depend on the same mutable cache. A second owner must not mirror that state.

Each asynchronous owner carries its own generation/token and disposal boundary. It cannot write
page state after Session replacement, deactivation, or a newer operation. The
[chat-session application feature](../renderer-application-boundaries/spec.md) separately owns
cross-store navigation, creation, and submission coordination; page composables consume that owner.

## Scroll and Display Boundaries

The [scroll contract](../chat-scroll-ownership/spec.md) owns geometry and viewport writes:

- `useChatScrollController` owns mode, intent admission, and frame commit/verification.
- `chatScrollState` is the pure ownership reducer.
- `chatScrollOperationArbiter` owns one active physical scroll operation.
- `chatScrollRequestQueue` owns the coalescing priority slot.
- `useMessageWindow` owns logical layout, bounded ranges, and measurement snapshots.
- `recentMessageMeasurementCache` retains bounded recent-Session measurements across page remounts.

Page composition cannot bypass these owners with direct viewport writes or independent timers.
Further extraction must reduce a concrete ownership dependency; an arbitrary page line count is
not an acceptance condition.

`features/chat-page/model/displayMessage.ts` owns the pure `DisplayMessage` family, assistant-block
renderability, and compaction policy. Lists, blocks, stores, and tests may consume that contract.
It depends only on shared types and cannot import ChatPage, feature composables, or stores.

The built-in plan checklist capability is retired. The event bridge manages window events, and
the interaction dock handles questions and permissions. Historical data follows
[plan retirement](../agent-plan-retirement/spec.md).
