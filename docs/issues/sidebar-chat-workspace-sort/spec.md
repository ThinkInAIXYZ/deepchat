# Sidebar Chat Workspace Sort Spec

## User Need

The expanded sidebar must keep Chat and Workspace as separate sections. The Workspace sort toggle
must not move workspace sessions into Chat or make the Workspace section disappear.

## Goal

- Chat sessions remain under Chat and can be collapsed.
- Workspace sessions remain under Workspace.
- The Workspace toggle only changes Workspace grouping between project/date modes.

## Acceptance Criteria

- Clicking Chat collapses and expands Chat sessions.
- The Chat section icon matches the chat icon used by the new-thread project selector.
- In date mode, date groups for workspace sessions render under Workspace, not Chat.
- Workspace stays visible in the same sidebar position after toggling grouping.
- Pinned sessions stay independent.

## Constraints

- Keep the fix local to the renderer sidebar.
- Do not add dependencies or new persistent settings.
- Do not touch unrelated Skills work already dirty in the worktree.

## Non-Goals

- Redesign the sidebar.
- Change session storage, pagination, or pin behavior.

## UI Shape

Before:

```text
Pinned
Chat
  Recent / Earlier workspace groups
Workspace
```

After:

```text
Pinned
Chat          [collapsible]
  chat sessions only
Workspace     [project/date toggle]
  workspace groups only
```
