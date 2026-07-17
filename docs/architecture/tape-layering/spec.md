# Tape Layering Refactor Specification

## Background

DeepChat's Tape implementation has strong runtime semantics but weak module boundaries. The main
`SessionTape` implementation combines fact writing, migration and reconciliation, search and
context recall, ViewManifest and replay assembly, subagent lineage, and fork management in one
large module. The SQLite entry table also exposes destructive lifecycle operations beside normal
append and read operations.

Several consumers bypass `SessionTape` and depend directly on the SQLite table. Transcript writes,
Memory ingestion, Memory management routes, Session settings, and startup migration each use a
different subset of Tape behavior, but the current table-shaped dependency gives them more
authority than they need. Tape types also flow in the wrong direction because the Tape layer
imports Agent loop port types.

This refactor adopts Bub's useful dependency pattern—domain primitives, narrow store protocols,
application services, and independent view selection—without copying Bub's simpler schema or
reset semantics. DeepChat retains its stronger revision, retraction, ViewManifest, frozen-head,
and fork contracts.

## Goals

1. Establish a top-level `src/main/tape/` subsystem with explicit domain, port, application, and
   SQLite infrastructure boundaries.
2. Split `SessionTape` along its existing cohesive behavior groups while retaining a compatibility
   facade.
3. Replace raw table dependencies with the smallest capability required by each consumer.
4. Keep destructive reset and delete operations outside the append-only entry store contract.
5. Remove the Tape-to-Agent reverse dependency and delete unused `TapeRecorder` capabilities.
6. Preserve all persisted data, public IPC behavior, runtime ordering, transaction boundaries,
   failure fallbacks, and performance characteristics.
7. Add enforceable dependency and behavioral contracts so the layering does not regress.

## Data Families

The refactor keeps three distinct data families:

| Data family | Role | Authority |
| --- | --- | --- |
| Tape facts | Append-only execution facts, anchors, manifests, lineage, and fork receipts | Tape |
| Transcript projection | UI-oriented structured messages and a legacy backfill source | Session data |
| Trace evidence | Provider request and terminal execution evidence used by replay | Session trace storage |

Replay may combine Tape facts with trace evidence through explicit read ports. This is not a reason
to treat trace evidence as transcript data or to move it into the Tape entry schema.

## Required Invariants

- Entries in an active Tape are append-only. Known facts are never updated in place.
- Corrections and deletions of projected messages are represented by appended replacement or
  retraction facts.
- Anchors are reconstruction points and never imply deletion of earlier entries.
- Compaction changes the selected view, not the retained history.
- Fork merge appends only the fork delta and a merge receipt to the parent.
- Cross-Tape reads require an explicit direct-child lineage fact and remain bounded by the stored
  child head.
- Search projections are rebuildable derivatives. Projection failures retain the existing bounded
  effective-view fallback.
- Destructive Session cleanup is a lifecycle operation, not a normal Tape store operation.

## Capability Boundaries

| Consumer | Allowed capability |
| --- | --- |
| Agent loop | `TapeToolFactWriter` |
| Session transcript | `TapeMessageFactWriter` |
| Memory runtime | `TapeRawEntryReader` and `TapeAnchorWriter` |
| Session settings and compaction | `TapeAnchorReader`, `TapeAnchorWriter`, and `TapeLifecycleAdmin` |
| Memory management routes | `TapeInspectionReader` |
| Session IPC | Existing `SessionTapePort` facade |

A single implementation may satisfy several ports, but each consumer receives only the structural
type it needs.

## Direct Storage Access Inventory

The implementation must account for every current physical-table access:

- `session/data/tape.ts`: current core implementation; replaced by the new facade and services.
- `session/data/transcript.ts`: legitimate message fact producer; migrated to
  `TapeMessageFactWriter` while preserving same-connection transactions.
- `session/data/settings.ts`: bootstrap, reconstruction-anchor reads, summary/reset anchors, and
  destructive cleanup; migrated to anchor and lifecycle capabilities.
- `agent/deepchat/runtime/deepChatRuntimeCoordinator.ts`: Memory raw-row reads and anchor writes;
  migrated to explicit read and write ports.
- `memory/routes.ts` and app composition: raw table object escape; replaced with domain-level
  inspection queries.
- `memory/data/tables/deepchatMemoryIngestionProjection.ts`: one-statement freshness comparison
  between Tape head and projection head; retained as an explicit read-only infrastructure
  exception to preserve atomicity and query count.
- `app/startupMigrations/legacyChatImportService.ts`: destructive whole-database rebuild; retained
  as an explicit startup-migration exception.
- Schema catalog and database security table-name lists: metadata, not runtime Tape access.

## Acceptance Criteria

1. `src/main/tape/domain/` does not import Agent, Session, Memory, App, or SQLite infrastructure.
2. Agent loop compilation depends on `TapeToolFactWriter`, not the broad `TapeRecorder` interface.
3. Runtime, transcript, settings, routes, and normal application composition do not receive a
   `DeepChatTapeEntriesTable` instance.
4. `TapeEntryStore` exposes no reset or delete method.
5. Existing `SessionTapePort`, persisted schema, table names, entry payloads, View policy IDs, and
   renderer contracts remain unchanged.
6. Transcript mutation plus Tape correction, and summary mutation plus anchor append, retain their
   current transaction semantics.
7. `ensureSessionTapeReady` remains idempotent and runs at the same Session port boundaries.
8. Projection search fallback and non-blocking fork projection cleanup remain unchanged.
9. Baseline Tape tests remain green; the pre-refactor baseline is 120 passed and 26
   environment-gated skipped tests across seven files.
10. Tape scale coverage confirms bounded tail materialization and no added full-history query on
    the Memory projection fast path.
11. Architecture tests reject forbidden imports and new physical-table bypasses.
12. No remote Git operations are performed as part of this work.

## Constraints

- Use synchronous ports where the current SQLite operation is synchronous; do not introduce
  artificial asynchronous transaction boundaries.
- Preserve ordering, idempotency keys, hashes, error classes, and fallback logging semantics.
- Compatibility re-exports may remain at old module paths to control import churn.
- New SDD artifacts in this directory must use English prose.
- Every local commit requires a complete unstaged and staged diff review plus relevant validation.

## Non-Goals

- No database schema or data migration.
- No archive-on-reset behavior.
- No change to compaction, context selection, or ViewManifest policy.
- No redesign of transcript or trace storage.
- No renderer or IPC feature change.
- No GitHub issue, pull request, branch push, or other remote mutation.

## Open Questions

None. The implementation decisions required for this refactor are recorded in this specification
and the accompanying plan.
