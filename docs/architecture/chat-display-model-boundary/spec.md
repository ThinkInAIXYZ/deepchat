# Chat Display Model Boundary

## Ownership

`src/renderer/src/features/chat-page/model/displayMessage.ts` owns `DisplayMessage`, its block and
usage contracts, `MessageListItem`, assistant-block renderability, and compaction classification.
The chat-page feature owns record conversion and display ordering; components, stores, and chat
composables consume this model directly.

The model is a pure feature contract. It may depend on shared types and pure values, but not on Vue,
Pinia, IPC, components, composables, or its consumers. Chat components may read this feature model
without importing the feature's page or runtime state.

## Invariants

- `components/chat/messageListItems.ts` remains absent, including compatibility re-exports.
- There is one definition of each display type and renderability policy.
- Message filtering, compaction classification, and block visibility use the same model contract
  across the list, message blocks, store, and search projection.
- This boundary does not change `MessageList` or `MessageListRow` props/events, persisted records,
  IPC payloads, streaming semantics, virtualization, or Markdown rendering.

## Regression Protection

Model and message-list consumers must resolve imports through the feature model. Renderer type
checking and the relevant display, list/window, and message-block tests protect its consumers and
observable behavior. Private file-location aliases are not a second supported API.
