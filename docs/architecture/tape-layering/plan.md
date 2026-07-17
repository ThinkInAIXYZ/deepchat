# Tape Layering Refactor Implementation Plan

## Target Structure

The implementation will create a top-level Tape subsystem:

```text
src/main/tape/
  domain/                 pure entry, fact, view, manifest, lineage, and replay logic
  ports/                  storage and consumer capability interfaces
  application/            fact, reconciliation, recall, lineage, view/replay, and fork services
  infrastructure/sqlite/  SQLite entry store, query SQL, search projection, and lifecycle adapter
```

Existing `src/main/session/data/tape*.ts` and table modules will become compatibility re-exports
where an old import path is still part of the current internal contract. New production imports
will target `@/tape/*`.

## Domain and Port Design

Tape entry rows, append inputs, source identities, entry references, fact provenance, and tool fact
inputs move out of Agent and table modules into Tape-owned types. Effective-view selection,
ViewManifest hashing, lineage validation, and replay value conversion remain pure.

The primary ports are:

- `TapeEntryStore`: append, anchor/event append helpers, bootstrap, and read/query operations. It
  has no destructive method.
- `TapeSearchProjectionStore`: rebuildable search projection behavior.
- `TapeToolFactWriter`: the single `appendToolFact` capability used by the Agent loop.
- `TapeMessageFactWriter`: message, replacement, and retraction fact operations used by transcript.
- `TapeAnchorReader` and `TapeAnchorWriter`: narrow anchor capabilities for settings and Memory.
- `TapeRawEntryReader`: intentional raw-row access for effective-view rebuilding in Memory.
- `TapeInspectionReader`: effective source spans and Memory ViewManifest inspection queries.
- `TapeLifecycleAdmin`: Session-owned delete and reset operations across entries and projections.
- Explicit transcript and trace evidence read ports used by reconciliation and replay.

One application object may implement multiple interfaces. Composition injects the narrow interface
at each call site.

## Application Services

The current `SessionTape` behavior is divided without changing method semantics:

1. **TapeFactService** owns message, tool, event, anchor, handoff, and ViewManifest fact appends.
2. **TapeReconciler** owns bootstrap, legacy transcript backfill, and legacy summary-anchor repair.
3. **TapeRecallService** owns info, search, context windows, anchor listing, and authorized source
   resolution needed by recall.
4. **TapeLineageService** owns link validation, frozen child heads, authorization, and lineage
   receipts.
5. **TapeViewReplayService** owns ViewManifest source maps, manifest listing, replay exports, and
   explicit trace-evidence reads.
6. **TapeForkService** owns fork creation, isolated writes, delta merge, discard, and external fork
   receipts.

`SessionTape` becomes a compatibility facade that constructs or receives these services and
forwards the existing methods. `SessionTapePort` in Session contracts remains unchanged.

## SQLite Infrastructure

The large entry table module is separated into Tape-owned row and append types, reusable effective
query SQL, a normal SQLite entry store, and a lifecycle adapter. Table names, indexes, SQL
predicates, provenance uniqueness, and payload serialization remain byte-compatible.

Physical entry deletion is removed from the normal entry-store interface. `TapeLifecycleAdmin`
coordinates entry deletion, search projection deletion, and reset bootstrap. Startup legacy import
may continue to execute whole-database cleanup SQL because it rebuilds persisted state before
normal runtime composition.

The Memory ingestion projection retains its current single SQL statement that compares
`MAX(deepchat_tape_entries.entry_id)` with the projection metadata head. Moving this comparison to
two independent port calls would introduce a freshness race and an extra query, so it is an
allowlisted read-only infrastructure dependency.

## Composition and Data Flow

Session data composition will create the entry store and Tape services before constructing
transcript and settings:

```text
SQLite connection
  -> Tape stores and services
  -> Transcript with TapeMessageFactWriter
  -> Settings with anchor and lifecycle capabilities
  -> SessionTape facade and existing SessionTapePort adapter
```

Runtime composition passes `TapeToolFactWriter` to the loop, raw-row and anchor capabilities to
the Memory coordinator, and `TapeInspectionReader` to Memory routes. No application consumer gets
the concrete entry table.

`ensureSessionTapeReady` remains at the current Session port boundary. Search and context requests
with linked-source scopes keep their existing conditional reconciliation behavior.

## Transaction Boundaries

- Transcript deletion and retry truncation append retractions inside the same SQLite transaction
  that deletes projection rows.
- Summary compare-and-set appends its reconstruction anchor inside the same transaction that
  updates summary state.
- Reset and Session deletion coordinate entry and search-projection cleanup through lifecycle
  operations while preserving the current external ordering.
- Port implementations use the same connection provider and remain synchronous, so extracting a
  service does not cross a transaction boundary.

Contract tests will force failures between paired operations and verify rollback or unchanged
behavior where the current implementation is atomic.

## Compatibility Strategy

- Keep all shared DTOs and `SessionTapePort` signatures unchanged.
- Preserve old internal exported symbol names through compatibility re-exports.
- Preserve schema SQL, existing rows, canonical policy identifiers, hashes, source identities,
  provenance keys, error messages where tested, and bounded query limits.
- Preserve projection failure fallback and best-effort fork projection cleanup.
- Keep trace evidence distinct from transcript projection in replay dependencies.

## Test Strategy

1. Record the current seven-file baseline: 120 passed and 26 native-SQLite-gated skipped tests.
2. Mechanically split the monolithic test suite by application-service boundary without changing
   assertions or skip gates.
3. Add characterization coverage for reconciliation ordering, transaction atomicity, projection
   fallback, and lifecycle reset.
4. Add contract coverage for append-only correction, frozen-head authorization, fork delta merge,
   ViewManifest hashes, replay evidence, and projection rebuild equivalence.
5. Add a source-boundary test that rejects domain reverse imports and non-allowlisted table access.
6. Run the full main-process suite, Tape scale suite, type checks, formatting, i18n validation, and
   lint before handoff.

## Commit and Review Strategy

Each implementation slice remains green and receives a local conventional commit. Before every
commit, review the complete unstaged and staged diff for hidden side effects, compatibility,
boundary cases, performance, security, misleading names, missing tests, and long-term maintenance
cost. Fix all findings and repeat validation before committing.

The planned commits are:

1. `docs(tape): specify layering refactor`
2. `test(tape): split behavior contracts`
3. `refactor(tape): establish domain ports`
4. `refactor(tape): split application services`
5. `refactor(tape): close storage bypasses`
6. `test(tape): enforce layer boundaries`
7. `docs(tape): refresh architecture map`

No commit is pushed. The final review compares the complete branch with `dev`.

## Rollback

The work is organized into locally reviewable commits. Reverting must proceed in reverse order
because later composition and boundary changes depend on the earlier domain and port extraction.
The unchanged schema and compatibility re-exports allow a complete branch rollback without a data
migration.
