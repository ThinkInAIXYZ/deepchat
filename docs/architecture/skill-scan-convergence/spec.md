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
- Persisted cache is best-effort: malformed tool/skill entries are ignored while valid names
  still suppress duplicate discoveries. Successful startup scanning replaces the cache.
- The Worker entry runs scanning and comparison and posts the existing response envelope.
- scanWorker owns loading the bundled entry. Node structured clone preserves Date values;
  no ISO conversion or public type change is required.
- SkillSyncService retains cache persistence, events and Worker-failure fallback.

## Compatibility and security

Preserve registered tools, input ordering, project-root handling, pattern matching, 10 MiB
file limit, description extraction and per-file error isolation. The separate security fix
resolves the final metadata file inside its skill folder before reading it: an ordinary
directory must not make an escaping SKILL.md symlink trusted. Contained file targets and
symlinked configured roots remain supported; directory entries and flat-file symlinks remain
excluded. No persistence migration is needed.

Scanning support does not imply import support: snapshot import still rejects symlinked
source roots and manifests. Such skills can appear in discovery but cannot be imported until
the source uses ordinary directories and files. This pre-existing import policy is unchanged.

## Acceptance

Worker and fallback return equal non-empty results and discoveries for identical fixtures,
including Date metadata. Actual built Worker loading must succeed, not merely a mocked call.
Missing paths, rejected files, cancellation and Worker failure must not break the existing
fallback contract. File safety and project-level behavior remain covered. Removing a fix
must make its regression check fail. Rollback is a code revert with no data changes.

## Non-goals

No Provider/Session changes, scanner timeouts, continuous synchronization, parser improvements,
UI changes, import/export redesign, or global Worker-runner rewrite. No unresolved design choices.
