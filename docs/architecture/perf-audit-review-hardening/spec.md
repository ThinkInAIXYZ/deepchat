# Perf Audit Review Hardening Spec

## User Need

The `perf/audit-fixes` branch should keep its performance improvements without introducing startup,
MCP, renderer navigation, icon, backfill, shutdown, or contract regressions found during PR review.

## Goal

Fix the merge-blocking review issues and the highest-value follow-up issues that directly undermine
the performance audit goals.

## Acceptance Criteria

- Startup schema diagnosis does not run a duplicate foreground/background pass on healthy startup.
- MCP startup soft timeout only releases startup orchestration; foreground MCP APIs wait for a real
  connection and cancellation does not produce false connection-failure notifications.
- Session activation hydration cannot navigate back to stale sessions after later navigation.
- Generated icon collections include literal icons declared in shared code.
- Backfills avoid full-table materialization and do not rely on long-lived write-conflicting
  iterators.
- Plugin-owned MCP server shutdown has the same timeout behavior as normal MCP shutdown.
- Shared contracts and type barrels do not strip or ambiguously re-export newly added fields/types.
- Pending assistant placeholders are not cleared by loading older history.
- Workspace preview handles large streamed files without silent broken previews.

## Constraints

- Preserve the existing repair-before-startup behavior for repairable SQLite schema drift.
- Preserve the public MCP startup soft-timeout behavior for initial app startup responsiveness.
- Keep changes scoped to the audited regressions; lower-risk naming/log cleanup can remain follow-up.

## Non-Goals

- Revisit the previously deferred F2/F4/F7/F10/F14 audit items.
- Redesign StartupWorkloadCoordinator scheduling beyond fixing confirmed regressions.
