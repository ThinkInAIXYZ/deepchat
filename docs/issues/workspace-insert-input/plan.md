# Implementation Plan

## Approach

1. Split workspace node actions so left-click file selection and context-menu insertion use separate events.
2. Let `WorkspacePanel` emit a session-scoped insertion request upward when the context-menu action is selected.
3. Forward the insertion request through `ChatSidePanel` as a window-level renderer event scoped by `sessionId`.
4. Add a `ChatInputBox` exposed method that inserts a workspace reference using the existing formatter.
5. Make `ChatPage` listen for the session-scoped insertion event and call the exposed input method only for the active session.

## Affected Interfaces

- `WorkspaceFileNode.vue`: adds an `insert-path` emit while preserving `append-path` for preview selection.
- `WorkspacePanel.vue`: adds an `insert-file-reference` emit.
- `ChatSidePanel.vue`: dispatches a renderer custom event for the current session.
- `ChatInputBox.vue`: exposes `insertWorkspaceReference`.
- `ChatPage.vue`: listens for and handles workspace insertion requests.

## Data Flow

```text
WorkspaceFileNode context menu
  -> insert-path(filePath)
  -> WorkspacePanel insert-file-reference(filePath)
  -> ChatSidePanel window CustomEvent(sessionId, filePath)
  -> ChatPage active-session listener
  -> ChatInputBox.insertWorkspaceReference(filePath)
```

## Compatibility

- Existing drag-and-drop uses the same formatter and remains unchanged.
- Existing left-click preview selection continues using `append-path`.
- Event payload includes `sessionId` to avoid cross-session insertion.

## Test Strategy

- Unit test that `ChatInputBox` exposes workspace-reference insertion.
- Unit test that `WorkspaceFileNode` emits a distinct insertion event for the context menu.
- Unit test that `WorkspacePanel` forwards insertion requests.
- Run formatter, i18n generation, and lint per repository guidance.
