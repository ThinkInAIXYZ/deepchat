# External Skill scan convergence

## Context and decision

External Skill scanning currently duplicates ToolScanner inside an inline Worker string,
including filename validation, metadata extraction and discovery filtering. The execution
environment is different; the product rules are not. PR4 removes that second implementation.

Reuse the asynchronous ToolScanner in both environments. electron-vite's `?modulePath`
builds a standalone Worker entry; the existing inline runner loads it and retains cancellation
and failure handling. There is no existing timeout contract. Do not introduce a filesystem
adapter, a new parser, a dependency, or a public setting.

## Ownership and interfaces

- ToolScanner owns the registry and scanning rules, accepting a tool list at construction so
  the Worker uses the same configuration snapshot as its caller.
- A shared discovery function compares scan results with cached and imported names.
- The Worker entry runs scanning and comparison and posts the existing response envelope.
- scanWorker owns loading the bundled entry. Node structured clone preserves Date values;
  no ISO conversion or public type change is required.
- SkillSyncService retains cache persistence, events and Worker-failure fallback.

## Compatibility and security

Preserve registered tools, input ordering, project-root handling, pattern matching, 10 MiB
file limit, description extraction and per-file error isolation. Keep existing symlink
behavior during the refactor; any confirmed unsafe read needs a separate fix and regression
experiment rather than an implicit compatibility change. No persistence migration is needed.

## Acceptance

Worker and fallback return equal non-empty results and discoveries for identical fixtures,
including Date metadata. Actual built Worker loading must succeed, not merely a mocked call.
Missing paths, rejected files, cancellation and Worker failure must not break the existing
fallback contract. File safety and project-level behavior remain covered. Removing a fix
must make its regression check fail. Rollback is a code revert with no data changes.

## Non-goals

No Provider/Session changes, scanner timeouts, continuous synchronization, parser improvements,
UI changes, import/export redesign, or global Worker-runner rewrite. No unresolved design choices.
