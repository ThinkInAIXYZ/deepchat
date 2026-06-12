# Plan

## Implementation

- Add a project-group-specific session comparator in the renderer session store.
- Apply it only inside `groupByProject` when assigning `group.sessions`.
- Keep the existing `sortSessions` path for pinned sessions, initial session list storage, and time
  grouping.

## Test Strategy

- Add a renderer store regression test that creates multiple sessions in one project with titles and
  update times in opposite order.
- Run the focused `sessionStore` test, then repository format, i18n, lint, and typecheck.

## Risks

- Project group order itself will still follow the existing upstream session order; this change only
  sorts sessions inside each group as requested.
