# Tape Layering Refactor Specification

## Background

Before this refactor, DeepChat's Tape implementation had strong runtime semantics but weak module
boundaries. The main `SessionTape` implementation combined fact writing, migration and
reconciliation, search and context recall, ViewManifest and replay assembly, subagent lineage,
and fork management in one large module. The SQLite entry table also exposed destructive
lifecycle operations beside normal append and read operations.

Several consumers bypassed `SessionTape` and depended directly on the SQLite table. Transcript
writes, Memory ingestion, Memory management routes, Session settings, and startup migration each
used a different subset of Tape behavior, but the table-shaped dependency gave them more
authority than they needed. Tape types also flowed in the wrong direction because the Tape layer
imported Agent loop port types.

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
- A reset that creates a new Tape incarnation deletes entries, mutation projection state, and
  search projection state and appends the new bootstrap anchor in one SQLite transaction.
- A discarded fork is fail-closed for merge and identifier reuse even when best-effort physical
  cleanup fails. Failed cleanup leaves permanent inert residue; no automatic retry is scheduled.

## Capability Boundaries

| Consumer | Allowed capability |
| --- | --- |
| DeepChat loop runner | `TapeReconciliationPort`, `TapeViewManifestReader`, `TapeViewManifestWriter`, and `TapeToolFactWriter` |
| Turn coordinator and ACP compatibility adapter | `TapeReconciliationPort` |
| Session transcript | `TapeMessageFactWriter` |
| Memory runtime | `TapeRawEntryReader` and `TapeAnchorWriter` |
| Session settings and compaction | `TapeAnchorReader`, `TapeAnchorWriter`, and `TapeLifecycleAdmin` |
| Memory management routes | `TapeInspectionReader` |
| Session IPC | Existing `SessionTapePort` facade |

A single implementation may satisfy several ports, but each consumer receives only the
structural type it needs. `TapeRawEntryReader` exposes only `getBySession`. The inspection port
returns purpose-built effective-message and Memory ViewManifest DTOs; it never returns a physical
Tape row. `TapeAnchorReader` exposes only the latest reconstruction anchor required by settings.
Transcript and settings require these capabilities to be injected; only normal or migration
composition may provide them, and only normal Session composition constructs the concrete facade.
Legacy import reuses the composition-owned `TapeMessageFactWriter`. `TapeViewManifestWriter`
intentionally exposes a `void` append contract because its consumer does not observe the stored
row; the concrete facade's richer return value remains an internal compatibility detail.

`TapeViewManifestAssemblySources` names the complete source set assembled by the application
service. `TapeViewManifestLookupMaps` names the smaller domain lookup map used by pure
ViewManifest builders. The two historical `TapeViewManifestSourceMaps` exports remain available
only from their respective legacy compatibility modules, where each is an explicit deprecated
alias of the original shape.

## Direct Storage Access Inventory

The implementation must account for every current physical-table access:

- `session/data/tape.ts`: compatibility re-export of the new facade; production imports use
  `@/tape/*` directly.
- `session/data/transcript.ts`: legitimate message fact producer; migrated to
  `TapeMessageFactWriter` while preserving same-connection transactions.
- `session/data/settings.ts`: bootstrap, reconstruction-anchor reads, summary/reset anchors, and
  destructive cleanup; migrated to anchor and lifecycle capabilities.
- `agent/deepchat/runtime/deepChatRuntimeCoordinator.ts`: composition root that distributes
  reconciliation, fact, manifest, raw-read, and anchor capabilities to narrower consumers.
- `memory/routes.ts` and app composition: use `TapeInspectionReader`; effective source spans and
  Memory ViewManifest records cross the boundary only as domain DTOs.
- `memory/data/tables/deepchatMemoryIngestionProjection.ts`: one-statement freshness comparison
  between Tape head and projection head; retained as an explicit read-only infrastructure
  exception to preserve atomicity and query count.
- `app/startupMigrations/legacyChatImportService.ts`: destructive whole-database rebuild; retained
  as an explicit startup-migration exception while reusing the composition-owned message fact
  writer.
- Schema catalog and database security table-name lists: metadata, not runtime Tape access.

## Generation and Failure Semantics

`resetSessionTape` performs entry deletion, mutation-projection deletion, search-projection and FTS
deletion, and new bootstrap creation inside one transaction on the shared Session SQLite
connection. Any propagated lifecycle, cleanup, or bootstrap failure restores the complete prior
incarnation. The existing fail-open mutation-projection append policy remains: if applying the new
bootstrap to that derived projection fails, its metadata is invalidated after old rows have been
removed, so the new Tape can commit without trusting partial projection state. Search-projection
session cleanup is also internally transactional so it cannot leave base, metadata, and FTS rows
at different generations.

Fork discard makes one atomic cleanup attempt. If cleanup succeeds, cleanup and the discard
receipt commit together. If cleanup fails, the cleanup attempt rolls back, the parent still
appends the discard receipt, and the failure remains non-blocking. Merge checks an existing merge
receipt first for idempotency and then rejects a discard receipt before reading the fork. Creating
a fork with an explicitly discarded identifier also fails closed.

Context projection reads use `getByEntryIdsIfCurrent`, which verifies projection version and the
projection metadata head against the current Tape head supplied by the synchronous caller in the
same SQL statement that reads the requested rows. A non-current projection is ignored and summary
or reference context is rebuilt from the current effective Tape. Projection version 3 invalidates
version 2 data that may have survived an interrupted pre-atomic reset with the same entry-id head;
current search rebuilds that derivative on demand, while read-only linked search retains its
effective-Tape fallback.

Corrupt or unavailable FTS storage must not block deletion of authoritative Tape or transcript
state. A failed FTS row deletion invalidates FTS metadata and drops the rebuildable virtual table
before the lifecycle transaction continues; if that recovery operation itself cannot complete,
the enclosing Tape generation transaction fails atomically. Startup removes base and FTS
projection rows owned only by pre-version-3 metadata so inert legacy text does not remain on disk
or force linked read-only searches onto permanent fallback paths.

`clearMessages` places pending-input deletion, transcript deletion, and Tape reset inside one
outer transaction on that same connection. The Tape generation transaction becomes a nested
savepoint, so any reset, projection cleanup, or bootstrap failure restores all three data families
instead of leaving transcript and Tape at different generations.

The Memory native-test manifest must include every split Tape suite that contains an active native
SQLite gate. Scope validation discovers these gated suites independently from the manifest so
removing or renaming one cannot silently eliminate the only real-SQLite lifecycle and FTS CI
coverage.

## Acceptance Criteria

1. `src/main/tape/domain/` does not import Agent, Session, Memory, App, SQLite, Electron, or logging
   runtime modules.
2. Agent execution consumers compile against reconciliation, manifest, and fact ports rather than
   concrete `SessionTape` or the deleted broad `TapeRecorder` interface.
3. Runtime, transcript, settings, routes, and normal application composition do not receive a
   `DeepChatTapeEntriesTable` instance.
4. `TapeEntryStore` exposes no reset or delete method.
5. Existing `SessionTapePort`, persisted schema, table names, entry payloads, View policy IDs, and
   renderer contracts remain unchanged.
6. Transcript mutation plus Tape correction, summary mutation plus anchor append, and clear-time
   pending/transcript deletion plus Tape reset share their required transaction context.
7. `ensureSessionTapeReady` remains idempotent and runs at the same Session port boundaries.
8. Projection search fallback remains unchanged. Fork cleanup failure remains non-blocking while
   its discard receipt prevents later merge or identifier reuse.
9. Baseline Tape tests remain green; the pre-refactor baseline is 120 passed and 26
   environment-gated skipped tests across seven files.
10. Tape scale coverage confirms bounded tail materialization and no added full-history query on
    the Memory projection fast path.
11. Architecture tests reject forbidden imports, production use of legacy compatibility paths,
    concrete facade imports from capability-scoped consumers, Memory route capability expansion,
    the actual SQLite driver, and new physical-table bypasses. Negative fixtures prove that each
    guard recognizes the prohibited dependency.
12. No remote Git operations are performed as part of this work.
13. Native Memory CI discovers and executes every SQLite-gated Tape suite after test splitting.
14. Corrupt FTS cleanup cannot leave transcript, Tape entries, and base search projection in
    different generations; pre-version-3 projection data is removed during schema initialization.
15. Legacy Tape modules expose frozen deprecated export lists, while canonical modules use
    unambiguous ViewManifest source-map names.
16. Historical concrete SQLite-class methods remain available through the frozen legacy class
    exports, but non-historical raw-row helpers are absent from the `SessionTape` facade and every
    application-facing port.

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
