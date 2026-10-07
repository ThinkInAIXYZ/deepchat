# Sidebar Session Batches

## Contract

Issue: https://github.com/ThinkInAIXYZ/deepchat/issues/2406

Chat and each workspace initially display five recent unpinned regular sessions. Each
Show more activation adds five. The control disappears after exhaustion. Collapsing one
group resets only its display limit; cached sessions survive. Sidebar collapse and navigation
preserve limits. Agent, grouping-mode, and default Chat workspace changes invalidate query scope.
Pinned rows and date groups retain their existing behavior.

Search displays all loaded matches without changing normal display limits. An active session
outside the visible prefix is appended once, without expanding the intervening history.
Explicit group collapse wins over background session updates. Numeric shortcuts use rendered rows.

```text
Before                        After
Chat                          Chat
  Session 01                    Session 01
  ...                           ...
  Session 40                    Session 05
Workspace A                     Show more
  Session A1                  Workspace A
  ...                           Session A1
                                ...
                                Session A5
                                Show more
```

## Ownership and Data Flow

The existing sidebar grouping composable owns display limits, scoped cursors, loading and retry
state. Session store remains the shared entity owner and merges query results through its existing
revision and deletion guards. The lightweight session route gains optional project-directory union
and pinned-state filters. SQL filters precede pagination; Chat includes unassigned sessions and
the default Chat workspace. The client parses query inputs through the route contract before IPC,
so reactive cursors and path arrays become serializable values. No schema migration or dependency
is required.

Each group has its own cursor. Unfinished global pagination does not imply that a particular group
has more sessions; fully loaded global history allows cache-only expansion. A cached
row older than a group's fetched cursor is not proof that intervening history has loaded. Scoped
queries fill only the requested prefix, stopping on collapse, search, disposal, or scope changes.
Failed loads preserve existing rows and expose an inline retry. Scroll position stays stable during
append. Viewport auto-fill must not drain global history because intentionally hidden rows shorten
the list. Existing global pagination remains available for date groups and history discovery.

## Acceptance

- Twelve sessions produce 5, 10, then 12 rows; collapse restores 5 without changing other groups.
- Old workspaces load independently of unrelated globally newer sessions.
- Chat merges assigned/default and unassigned history with accurate exhaustion.
- Drafts, pinned sessions and subagents do not consume normal group page slots.
- Failures, repeated activation, collapse during loading, and Agent changes preserve scope.
- Search, active-session visibility, shortcut numbering and workspace registration remain correct.

## Non-goals

Configurable batch sizes, nested scrolling, persistent expansion counts, full-history search,
virtualization, database migrations, and a general-purpose pagination framework.
