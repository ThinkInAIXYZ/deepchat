# Workspace Insert Into Input Fix

## User Need

When a user opens the workspace file list and right-clicks a file or directory, the context-menu action labeled `Insert into input` must insert a workspace reference into the current chat input.

## Goal

Restore the workspace file-list context-menu insertion flow so it targets the active chat input instead of behaving like file preview selection.

## Acceptance Criteria

- Right-clicking a workspace file and choosing `Insert into input` inserts the same `@relative/path` reference format used by workspace drag-and-drop.
- Right-clicking a workspace directory and choosing `Insert into input` also inserts a workspace reference when it is inside the active workspace.
- Normal left-click behavior remains unchanged: directories toggle and files select/open in the workspace preview area.
- The insertion request is scoped to the current chat session so another session does not receive the text.
- Invalid or empty paths fail without throwing user-visible errors.

## Constraints

- Keep changes renderer-local and aligned with existing Vue 3 Composition API patterns.
- Reuse existing workspace reference formatting logic from `chatInputWorkspaceReference`.
- Do not introduce new user-facing strings.

## Non-goals

- Changing drag-and-drop insertion behavior.
- Changing the workspace preview/file selection behavior.
- Adding input insertion for the new-thread page workspace selector.

## Open Questions

None.
