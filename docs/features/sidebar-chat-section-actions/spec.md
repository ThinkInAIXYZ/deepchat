# Sidebar Section New Chat Actions - Spec

## Problem

The sidebar Chat section header still shows a leading message icon and has no local new-chat action. Project folder headers also require the same local new-chat affordance, but only when the sidebar is grouped by project folders.

## Goal

Make Chat and Project folder headers use the same compact row interaction: hover covers the whole row, `+` appears inside the row action area, and new chats start with the matching workspace selected.

## UI Shape

Chat:

```text
Chat                                      [+]
  Chat session
  Chat session
```

Project folder mode:

```text
folder design                         [+] [...]
  Project session
```

Time grouping:

```text
Today
  Project session
```

## Acceptance Criteria

1. The Chat section title no longer renders a leading icon.
2. Clicking the Chat title still collapses and expands Chat sessions.
3. Hovering the Chat row covers the title and `+` action area as one row.
4. Clicking the Chat `+` selects the Chat workspace and starts a new chat through the existing route/new-conversation path.
5. Clicking the Chat `+` does not toggle the Chat section collapse state.
6. Project folder rows show a `+` action before the existing `...` action when grouped by project.
7. Clicking a Project folder `+` selects that project workspace and starts a new chat.
8. Time-grouped rows do not show folder `+` actions.
9. No new user-facing strings are introduced.

## Non-Goals

- Do not redesign Workspace grouping.
- Do not change how sessions are persisted or created from `NewThreadPage`.
- Do not change Remote features.
