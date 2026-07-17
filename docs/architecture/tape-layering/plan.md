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
ViewManifest hashing, lineage validation, stored-manifest validation, and replay hashing remain
pure. Database row parsing and trace-evidence reads remain in the application layer.

The primary ports are:

- `TapeEntryStore`: append, anchor/event append helpers, and read/query operations. It has no
  destructive method. `TapeBootstrapStore` and `TapeTransactionRunner` are separate application
  composition capabilities.
- `TapeSearchProjectionStore`: rebuildable search projection behavior.
- `TapeToolFactWriter`: the single `appendToolFact` capability used by the Agent loop.
- `TapeMessageFactWriter`: message, replacement, and retraction fact operations used by transcript.
- `TapeReconciliationPort`: bootstrap and transcript reconciliation used by the loop runner, Turn
  coordinator, and ACP compatibility projection.
- `TapeViewManifestReader` and `TapeViewManifestWriter`: the manifest capabilities used by the
  loop runner without exposing the full facade.
- `TapeAnchorReader`: only the latest reconstruction-anchor read required by settings.
- `TapeAnchorWriter`: narrow anchor append capability for settings and Memory.
- `TapeRawEntryReader`: only `getBySession`, retained for effective-view rebuilding in Memory.
- `TapeInspectionReader`: effective source spans and Memory ViewManifest inspection DTOs; no raw
  entry rows cross this boundary.
- `TapeLifecycleAdmin`: Session-owned delete and reset operations across entries and projections.
- Explicit transcript and trace evidence read ports used by reconciliation and replay.

One application object may implement multiple interfaces. Composition injects the narrow interface
at each call site.

## Application Services

The current `SessionTape` behavior is divided without changing method semantics:

1. **TapeFactService** owns message, tool, generic anchor, handoff, and fork-message fact appends.
2. **TapeReconcilerService** owns bootstrap, legacy transcript backfill, and legacy summary-anchor
   repair.
3. **TapeRecallService** owns info, search, context windows, anchor listing, and authorized source
   resolution needed by recall.
4. **TapeLineageService** owns link validation, frozen child heads, authorization, and lineage
   receipts.
5. **TapeViewReplayService** owns ViewManifest append and source assembly, manifest listing, replay
   exports, Memory inspection projection, and explicit trace-evidence reads.
6. **TapeForkService** owns only fork creation, delta merge, discard, and external lifecycle
   receipts.

`SessionTape` becomes a compatibility facade that constructs these services and forwards the
existing methods. `SessionTapePort` in Session contracts remains unchanged.

## SQLite Infrastructure

The large entry table module is separated into Tape-owned row and append types, reusable effective
query SQL, a normal SQLite entry store, and a lifecycle adapter. Table names, indexes, SQL
predicates, provenance uniqueness, and payload serialization remain byte-compatible.

Physical entry deletion is removed from the normal entry-store interface. `TapeLifecycleAdmin`
coordinates entry deletion, search projection deletion, and reset bootstrap. A reset executes
entry and mutation-projection deletion, search and FTS deletion, and new bootstrap creation in one
transaction. Startup legacy import may continue to execute whole-database cleanup SQL because it
rebuilds persisted state before normal runtime composition.

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

Runtime composition passes reconciliation, ViewManifest read/write, and tool-fact capabilities to
the loop runner; only reconciliation to the Turn coordinator and ACP adapter; raw-row and anchor
capabilities to the Memory coordinator; and `TapeInspectionReader` to Memory routes. No
application consumer gets the concrete entry table. Transcript and settings have no concrete
facade default: normal composition injects their capabilities from the shared `SessionTape`, and
legacy import reuses that composition-owned `TapeMessageFactWriter` instead of constructing a
second facade.

`ensureSessionTapeReady` remains at the current Session port boundary. Search and context requests
with linked-source scopes keep their existing conditional reconciliation behavior.

## Transaction Boundaries

- Transcript deletion and retry truncation append retractions inside the same SQLite transaction
  that deletes projection rows.
- Summary compare-and-set appends its reconstruction anchor inside the same transaction that
  updates summary state.
- Clear-time pending-input deletion, transcript deletion, and Tape reset run in one outer
  shared-connection transaction. The Tape generation transaction nests as a savepoint, so a reset
  or bootstrap failure restores every clear-time data family.
- Reset deletes entries, mutation projection, search projection, FTS metadata, and FTS rows and
  appends the new bootstrap within one shared-connection transaction. A propagated transition
  failure restores the old incarnation. The pre-existing fail-open mutation-projection append
  policy may instead commit the new Tape with that derivative marked stale after old projection
  rows have been removed.
- Fork discard performs the same atomic cleanup attempt. Cleanup failure rolls that attempt back
  but still appends a fail-closed discard receipt, preserving the non-blocking contract.
- Final Session deletion keeps its staged lifecycle ordering and does not create a replacement
  incarnation. Its Tape entry and search-projection cleanup still runs as one generation
  transaction before the Session row is removed.
- FTS is a rebuildable derivative. If session-row deletion from the virtual table fails, the
  adapter drops the FTS table and clears freshness metadata inside the same lifecycle transaction;
  the next search recreates and repopulates it. Failure to drop the damaged derivative remains a
  hard transaction failure rather than committing a mixed generation.
- Port implementations use the same connection provider and remain synchronous, so extracting a
  service does not cross a transaction boundary.

Contract tests will force failures between paired operations and verify rollback or unchanged
behavior where the current implementation is atomic.

## Compatibility Strategy

- Keep all shared DTOs and `SessionTapePort` signatures unchanged.
- Preserve old internal exported symbol names through explicit, frozen compatibility re-exports
  marked as deprecated.
- Keep methods that existed on the historically exported concrete SQLite classes, while excluding
  them from application-facing protocols. Remove non-historical raw-row forwarding helpers from
  the facade.
- Use `TapeViewManifestAssemblySources` for the complete application source set and
  `TapeViewManifestLookupMaps` for pure domain lookups. Preserve each historical
  `TapeViewManifestSourceMaps` shape only at its original legacy import path.
- Advance the rebuildable search projection to version 3 so same-head version 2 rows from a
  possible interrupted legacy reset are never trusted. The first current-Tape search performs a
  one-time rebuild; linked read-only search uses the existing effective-Tape fallback until a
  current rebuild exists.
- Preserve schema SQL, existing rows, canonical policy identifiers, hashes, source identities,
  provenance keys, error messages where tested, and bounded query limits.
- Preserve projection failure fallback and best-effort fork projection cleanup.
- Keep trace evidence distinct from transcript projection in replay dependencies.

## Follow-up Hardening

1. Replace the deleted monolithic Tape test in the Memory native scope with every split suite that
   contains `itIfSqlite` or `describeIfSqlite`, and make the scope validator discover this required
   coverage independently.
2. Route final Session Tape deletion through `deleteTapeGeneration` and recover a failed FTS row
   delete by invalidating and dropping the derivative within the generation transaction.
3. Prune pre-version-3 and metadata-orphaned projection rows during schema initialization without
   rebuilding every current projection eagerly.
4. Freeze legacy shim export surfaces; remove non-historical facade raw-row helpers, and retain
   historical concrete-store methods because the exported classes are compatibility contracts.
5. Rename the canonical domain ViewManifest lookup-map type and make Memory route boundary scans
   reject static, dynamic, CommonJS, type-import, and re-export bypasses.
6. Reuse the composition-owned Tape fact writer in legacy import, document the same-connection
   anchor requirement, cache SQLite FTS capability per connection, and replace exception-by-missing
   mock behavior with explicit failure fixtures.
7. Put the complete `clearMessages` mutation set inside one shared-connection transaction and
   document that a failed best-effort fork cleanup leaves permanent, non-retried residue that is
   nevertheless fail-closed for merge and identifier reuse.

## Test Strategy

1. Record the current seven-file baseline: 120 passed and 26 native-SQLite-gated skipped tests.
2. Mechanically split the monolithic test suite by application-service boundary without changing
   assertions or skip gates.
3. Add characterization coverage for reconciliation ordering, transaction atomicity, projection
   fallback, and lifecycle reset.
4. Add contract coverage for append-only correction, frozen-head authorization, fork delta merge,
   ViewManifest hashes, replay evidence, and projection rebuild equivalence.
5. Add source-boundary tests that reject domain reverse/runtime imports, production legacy Tape
   imports, concrete facade imports from capability-scoped consumers, Memory route capability
   expansion, the project SQLite driver, and non-allowlisted table access. Exercise each guard with
   table-driven negative fixtures.
6. Add native-scope discovery, corrupt-FTS recovery, stale-projection cleanup, bootstrap rollback,
   frozen-shim, and non-static Memory route import coverage.
7. Run the full main-process suite, Tape scale suite, type checks, formatting, i18n validation, and
   lint before handoff.

## Commit and Review Strategy

Each implementation slice remains green and receives a local conventional commit. Before every
commit, review the complete unstaged and staged diff for hidden side effects, compatibility,
boundary cases, performance, security, misleading names, missing tests, and long-term maintenance
cost. Fix all findings and repeat validation before committing.

The initial implementation commits were:

1. `docs(tape): specify layering refactor`
2. `test(tape): split behavior contracts`
3. `refactor(tape): establish domain ports`
4. `refactor(tape): split application services`
5. `refactor(tape): close storage bypasses`
6. `test(tape): enforce layer boundaries`
7. `test(tape): align writer mock naming`
8. `docs(tape): refresh architecture map`

The review remediation commits are:

1. `fix(tape): make generation resets atomic`
2. `refactor(tape): narrow consumer ports`
3. `refactor(tape): align service ownership`
4. `test(tape): harden layer boundaries`
5. `docs(tape): clarify layer contracts`

The cumulative review added these focused fixes before the documentation commit:

1. `test(tape): guard semantics compatibility path`
2. `test(tape): guard project sqlite driver`
3. `fix(tape): invalidate legacy projections`
4. `refactor(tape): require capability injection`
5. `refactor(tape): narrow anchor reader port`
6. `refactor(tape): narrow storage protocols`

The post-review hardening added these local commits:

1. `docs(tape): specify follow-up hardening`
2. `test(memory): restore native tape scope`
3. `test(tape): restore layered settings fixture`
4. `fix(tape): harden generation cleanup`
5. `refactor(tape): harden compatibility boundaries`
6. `test(tape): repair memory type contracts`

No commit is pushed. The final review compares the complete branch with `dev`.

## Final Validation Record

The final focused gates passed:

- Memory scope discovery classified 65 files with 3 explicit exemptions, and the independent
  Memory type gate passed all 65 scoped files.
- Memory behavior passed 749 tests across 46 files.
- Native SQLite and Tape coverage passed 242 tests across 13 files; the 2 skipped tests are
  Windows-only handle-locking cases on the current macOS host.
- Memory performance passed all 8 tests, including the 10k/100k Tape range-bound comparison.
- Full node and renderer type checks, formatting, i18n validation, and lint passed.
- The architecture baseline generator passed and refreshed the canonical snapshot against the
  final verified code commit.

The full main-process command completed with 390 passing files and 3 failing files: 4,471 tests
passed, 2 were skipped, and 9 failed. Each affected file was then run in an isolated detached
worktree at the exact `dev` baseline (`e84428b66`), reproducing the same 6 failures in
`mainDatabase.test.ts`, 1 failure in `schedulerService.test.ts`, and 2 failures in
`sessionDataMigrations.sqlite.test.ts`. These are pre-existing baseline failures, not branch
regressions; the project-wide main-process gate therefore remains red for reasons outside this Tape
refactor.

## Rollback

The work is organized into locally reviewable commits. Reverting must proceed in reverse order
because later composition and boundary changes depend on the earlier domain and port extraction.
The unchanged schema and compatibility re-exports allow a complete branch rollback without a data
migration.
