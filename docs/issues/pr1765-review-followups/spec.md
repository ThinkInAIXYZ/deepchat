# PR 1765 Review Followups

## Problem

External review comments on PR #1765 identified several cleanup opportunities after the presenter
IPC migration and background utility-host guard work.

## Requirements

- Fix low-risk correctness or cleanup issues that are directly supported by the current code.
- Avoid broad IPC migrations for startup, window-lifecycle, or floating-widget channels unless the
  behavior can be changed safely in this PR.
- Record which review suggestions are intentionally deferred or rejected.

## Non-Goals

- Complete a second large presenter IPC migration.
- Remove startup unlock IPC before the splash database-unlock flow has a route-runtime design.
- Delete legacy presenter type exports before the remaining type consumers are split.
