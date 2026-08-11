# Sidebar Workspace Registration

## Status

Implemented on `codex/issue-2115-workspace-sidebar-spec` as of 2026-08-11. Native Windows and POSIX
manual validation remains pending. Linked GitHub issue:
[#2115](https://github.com/ThinkInAIXYZ/deepchat/issues/2115).

This specification refines the issue where its proposed UI conflicts with the current Chat/Workspace
sidebar split, paginated Session projection, or persisted directory lifecycle.

## Problem

The main sidebar exposes workspace-backed Sessions, but it does not expose every managed workspace.
`WindowSideBar.vue` starts from Session groups and removes groups whose filtered Session list is
empty. `projectStore.environments` only influences the order of groups that already exist.

The Project domain already persists a selected directory independently of Session history. A newly
selected directory can therefore be active, ordered, and available to new conversations while the
sidebar still omits it. Adding only a folder-picker button would leave the following broken flow:

1. the user selects a directory;
2. Project persists and publishes the active environment;
3. the directory has no non-draft Session;
4. the Session-derived sidebar renders no row, so the action appears to have failed.

The issue's numeric Session-count mockup is not adopted. `EnvironmentSummary.sessionCount` is a
global durable count, while the sidebar can show a selected agent, only loaded pages, search
matches, and a separate pinned section. Rendering the global number beside that filtered list would
make the visible hierarchy internally inconsistent.

## Goal

Let users register a workspace from the place where workspaces are navigated, show active managed
workspaces before their first Session exists, and start a correctly scoped draft from an empty
workspace without changing existing directory lifecycle or Session-discovery behavior.

## Ownership And Terminology

- **Managed workspace**: an active `EnvironmentSummary` owned by `src/main/project/` and projected
  through `projectStore.environments`.
- **Chat workspace**: `defaultChatWorkspacePath`, represented by the dedicated Chat section and
  never duplicated under Workspace.
- **Session group**: the currently loaded and filtered Sessions grouped by `projectDir`.
- **True empty workspace**: an active managed workspace with `sessionCount === 0` and no visible
  Session. A group that is empty only because of agent filtering, pinning, search, or pagination is
  not a true empty workspace.
- **Historical group**: a Session-derived group whose path is archived, removed, or otherwise not
  in the active managed projection. It exists only to keep existing Sessions discoverable.

Project remains the source of workspace identity, active order, status, existence, and durable
count. Session remains the source of visible Session membership. The sidebar owns only the merged
view model. Workspace filesystem access remains owned by the Workspace domain.

## User Experience

### Layout

Before:

```text
Workspace                                      [Group]
  project-a                                      [+] [...]
    Session A
  project-b                                      [+] [...]
    Session B
```

After:

```text
Workspace                               [Add] [Group]
  new-project                         Empty      [+] [...]
  project-a                                      [+] [...]
    Session A
  project-b                                      [+] [...]
    Session B

  [...]
    Move to Top
    Move Up
    Move Down
    Move to Bottom
    ----------------
    Archive
```

`Add` is a compact `folder-plus` icon button with an accessible **Add workspace** name and tooltip.
It appears in the expanded sidebar in both date and project grouping modes. The existing grouping
toggle remains the final header action.

An empty row uses the same folder identity and persisted position as a populated row. It shows a
muted **Empty** label instead of a misleading Session count. Its new-conversation action remains
visible rather than hover-only so the next step is apparent.

### Add Workspace Flow

1. The user activates **Add workspace**.
2. The existing typed Project directory picker opens. The action is disabled until it settles so
   one sidebar cannot open competing pickers.
3. Cancellation changes no selection, search query, grouping mode, or persisted state.
4. Successful selection registers or reactivates the path through `project.selectDirectory`, moves
   a newly active path to the top of the persisted active order without scanning every managed path,
   and waits for the versioned Project snapshot.
5. The sidebar clears its Session search, switches deterministically to project grouping, scrolls
   the resulting row into view, and returns focus to that row.
6. The action does **not** create a draft and does **not** replace the current New Thread project
   selection. Registration and starting work remain two explicit user actions.

If the selected path is already active, no duplicate row is created and its explicit persisted
order is not disturbed. The existing row is revealed and focused. If it is archived or removed,
the existing Project route reactivates it at the top and clears the lifecycle tombstone. If it is
the built-in Chat workspace, the Chat section is revealed instead of creating a duplicate Workspace
row.

Picker or snapshot failures leave the current list intact and produce the existing destructive
renderer notification. A successful registration remains durable even if the later reveal/focus
step fails.

### Archive Workspace Flow

1. Every active managed workspace exposes its ellipsis menu, even when movement is unavailable
   because it is the only row or reorder is temporarily disabled.
2. Move actions retain their existing gates. A separator places **Archive** after the move actions.
3. Archive opens the same confirmation contract used by directory Settings. The description states
   that Sessions, messages, and the real folder are retained.
4. Confirmation calls the existing `projectStore.archiveEnvironment(path)` action and waits for the
   exact mutation version to be committed by the Project snapshot. It never edits Session rows or
   filesystem content in the renderer.
5. A successful zero-Session archive disappears from Workspace. A workspace with Session history
   remains as the existing historical group, outside active reorder and new-conversation actions.
6. Failure keeps the confirmation open, keeps the active row intact, and reports a localized error.
   Cancel and repeated confirmation are disabled while the archive request is pending.

The built-in Chat section and historical groups never expose this Archive action. Restore and
Remove remain in Settings, where archived lifecycle state is managed.

### Empty Workspace Flow

- Activating the primary row of a true empty, existing workspace starts a new conversation with
  that path as the explicit `projectDir`.
- The visible plus action performs the same operation.
- The sidebar must call the existing unified `startNewConversation({ projectDir })` path. It must
  not create a Session directly. The one-shot project intent is required so an active Session can
  close without an agent or global default overwriting the clicked workspace.
- DeepChat continues to persist a Session on first submission. ACP may ensure its existing draft
  Session, but draft rows remain excluded from the sidebar and environment usage count.
- When the first non-draft Session and Project snapshot arrive in either order, the row keeps the
  same path identity, gains the Session, drops the Empty label, and adopts normal collapse behavior.

A true empty row has no collapse state. Populated rows retain click-to-collapse and their existing
new-conversation action. A workspace whose durable count is non-zero but whose currently loaded
children are empty remains a populated row; it never changes a header click into an implicit new
conversation.

### Lifecycle And Visibility Matrix

| State | Sidebar behavior |
| --- | --- |
| Project grouping, no search | Merge every eligible active managed workspace with loaded Session groups. |
| Date grouping | Keep date groups unchanged. A successful Add switches to project grouping to reveal the result. |
| Session search active | Show only groups containing matching loaded Sessions; do not synthesize empty rows. Add success clears search before reveal. |
| Agent filter, pinned-only children, or unloaded pages | Keep active workspace rows; attach only currently visible Sessions. Durable count determines true emptiness. |
| Active and existing | Show, reorder, allow new conversations, and expose Archive. |
| Active but missing | Show with an unavailable indicator; keep ordering and Archive, but disable new conversations. |
| Archived with Session history | Keep the existing historical group discoverable; do not synthesize an empty row or allow a new conversation. |
| Archived without Session history | Hide from the sidebar; manage it in Settings. |
| Removed | Never synthesize a row. Residual ACP Session discovery follows the existing Session projection but gains no add, reorder, or new-conversation affordance. |
| Built-in Chat path | Render only in Chat, never as a Workspace duplicate. |

## Business Rules

1. A path is the stable group identity. Display names can collide and must never be used for merge,
   collapse, reorder, or draft intent.
2. Active Project order is authoritative. `ProjectService.selectDirectory()` prepends a path when
   selection makes it newly active. The renderer consumes the committed order and must not
   independently front-insert a path or derive order from Session activity.
3. Empty rows exist only in project grouping without an active Session search. Search remains a
   Session search rather than silently expanding into workspace-name search.
4. An explicit Project order survives duplicate selection. Selecting the same active path is
   idempotent for membership; fallback recency may change only where no explicit order exists.
5. Missing, archived, and removed paths cannot create new conversations from the sidebar.
6. The built-in Chat path is fixed outside workspace reorder even when it is present in the active
   Project snapshot.
7. A first Session replaces the empty presentation in place. There must never be one synthetic row
   and one Session-derived row for the same path.
8. Renderer-local optimistic state may reveal mode or focus changes, but only a committed versioned
   Project snapshot may add, reactivate, or remove a workspace row.
9. Archive availability is independent of reorder availability. Reorder may be disabled for a
   single row, search, loading, or animation while the active row remains archivable.
10. Sidebar archive is the existing reversible Project lifecycle mutation. It must confirm first
    and must not delete Sessions, messages, or filesystem content.
11. Project snapshot readiness is Project-store state. The same snapshot carries the built-in Chat
    workspace identity, so the sidebar cannot synthesize a duplicate while startup bootstrap and
    Project refresh race.
12. Workspace identity removes trailing separators only for comparison and preserves POSIX and
    Windows drive roots. It does not case-fold or rewrite separator style.
13. Archiving or removing the manually selected New Thread workspace invalidates that selection;
    the next draft must not reuse a non-active path.
14. Group-mode persistence is serialized. On failure, the visible mode rolls back to the latest
    successfully persisted mode, and every caller observes the failure of the write it awaited.
15. Directory registration writes recent-project and active-order state in one database
    transaction. Reactivation/new registration moves to the top with one preference-table write;
    selecting an already-active path preserves its order.

## Acceptance Criteria

- The expanded Workspace header has a keyboard-accessible Add workspace action with localized
  label and tooltip.
- Choosing a directory registers or reactivates exactly one managed environment through the
  existing typed Project route.
- Canceling the picker is a no-op; concurrent activation cannot open a second picker.
- A newly registered zero-Session workspace appears immediately after the committed Project
  snapshot at the top of the Workspace list, including when Add started in date grouping or during
  search.
- Selecting an archived or removed workspace reactivates it at the top of the persisted active
  order.
- The built-in Chat path never appears twice.
- Duplicate active selection reveals one existing row and preserves explicit order.
- Every active managed workspace has a keyboard-accessible Archive menu action, including a single
  workspace and an active missing workspace.
- Archive requires confirmation, uses the existing typed Project action, preserves Session and
  filesystem data, and dismisses the dialog only after the exact archive snapshot version commits.
  Failures keep the dialog and row visible.
- Archived zero-Session rows disappear; archived rows with Session history retain only historical
  navigation behavior.
- A true empty, existing workspace opens a new draft with the exact path carried through the
  one-shot workspace intent.
- Starting from an active Session cannot let agent or global defaults overwrite that path.
- First non-draft Session creation converts the same row to a normal populated group without a
  duplicate or collapse-state reset.
- Search, agent filtering, pinning, pagination, project reorder, archived history, removed
  tombstones, missing paths, and default Chat behavior follow the matrix above.
- Picker, snapshot, and grouping-persistence failures are observable and do not fabricate a row.
- A failed pair of concurrent group-mode writes restores the last persisted mode, and a coalesced
  caller receives the same write failure instead of a false success.
- `/` and Windows drive roots remain valid workspace groups; trailing separators do not create a
  duplicate group for ordinary paths.
- Archiving or removing the current manual New Thread workspace clears that draft selection.
- Focus, disabled state, unavailable state, and Empty text are accessible without relying on hover
  or color alone.

## Constraints

- Keep native directory selection behind the existing typed Project route and context-isolated
  bridge.
- Add no database table or schema migration; current environment preferences already persist a
  selected zero-Session path.
- Preserve the versioned Project snapshot/event owner and its stale-read fencing.
- Keep directory-picker registration free of synchronous existence checks over unrelated paths.
- Use vue-i18n and existing `DcButton`, tooltip, notification, dropdown, and draggable primitives.
- Preserve the existing Sidebar pagination, scroll restoration, shortcut badges, pin animation,
  and drag gates.

## Non-Goals

- Displaying global Session counts in the filtered/paginated sidebar.
- Creating a filesystem directory without the native picker.
- Automatically creating a conversation immediately after directory selection.
- Adding lifecycle management to the Workspace header, or adding Restore, Remove, rename,
  default-workspace, or bulk-archive actions to workspace rows.
- Searching workspace names, nested workspace hierarchy, or bulk workspace operations.
- Changing the dedicated Chat section or the Settings directory-management surface.
