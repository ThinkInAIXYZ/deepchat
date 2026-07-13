# Memory State Model Normalization — Tasks

> Tasks are ordered by dependency and record the implementation represented by the current change.
> Acceptance criteria are defined in [spec.md](./spec.md); implementation details are in
> [plan.md](./plan.md).

## Phase A — Domain Model and Characterization

- [x] Define lifecycle, embedding, and legacy status runtime values and types.
- [x] Implement tolerant legacy normalization and canonical-to-legacy projection.
- [x] Implement canonical recall and embedding eligibility predicates.
- [x] Define strict canonical insert invariants.
- [x] Implement complete snapshot validation for each transition intent.
- [x] Cover the legacy status, memory kind, and embedding-reference matrix.
- [x] Preserve public route, tool, export, health, and renderer status behavior.

## Phase B — Schema Migration and Compatibility

- [x] Add canonical columns with `NOT NULL` and complete `CHECK` constraints to fresh schema.
- [x] Add the version 42 migration with full and partial-schema markers.
- [x] Use one combined update when both canonical axes are absent.
- [x] Normalize malformed legacy state tolerantly and record repaired-row statistics.
- [x] Add the per-version table migration finalizer before schema-version recording.
- [x] Install both compatibility triggers inside the migration transaction.
- [x] Share trigger DDL across fresh schema, migration, catalog repair, and schema assertion.
- [x] Validate canonical column constraints and normalized trigger definitions at startup.
- [x] Keep healthy schema assertion read-only.
- [x] Add safety backup and mismatch-only recovery for stale or missing bridge artifacts.
- [x] Preserve canonical lifecycle for the historical internal-row mismatch shape.
- [x] Roll back bridge recovery when replacement or consistency validation fails.
- [x] Promote compatible clean FTS metadata without rebuilding.
- [x] Rebuild FTS for partial-canonical or dirty metadata state.

## Phase C — Import and Diagnostics

- [x] Extend internal import summaries with repaired and skipped row counts.
- [x] Make complete canonical source state authoritative over stale shadow state.
- [x] Preserve a valid existing axis in partial-canonical imports.
- [x] Apply tolerant normalization to legacy-only rows.
- [x] Skip only memory rows with invalid existing canonical state or unknown kind.
- [x] Keep structural and transaction failures atomic across the complete import.
- [x] Log repaired and skipped counts without changing the public synchronization response.
- [x] Retain read-only canonical-shadow mismatch health diagnostics.

## Phase D — Transition and Mutation Boundary

- [x] Remove generic status and unguarded production mutators from service-facing capabilities.
- [x] Add guarded archive, restore, supersession revival, conflict, content, metadata, and internal
  content intents.
- [x] Keep TypeScript precheck, pure validator, and guarded SQL as three transition defenses.
- [x] Synchronize canonical state, shadow status, conflict fields, references, and revision atomically.
- [x] Suppress audit, events, FTS maintenance, and generation changes for zero-row transitions.
- [x] Make challenger content resolution a discriminated union.
- [x] Preserve category when challenger resolution omits it.
- [x] Prevent stale second supersession during manual provenance reversal.
- [x] Add revision-aware user metadata mutation and access-time re-anchoring.
- [x] Retry working-memory compare-and-swap once and reschedule after a second failure.
- [x] Restrict ready state to embedding completion.

## Phase E — Canonical Reads and Query Plans

- [x] Move recall, FTS, vector liveness, queue, maintenance, archive, conflict, working, persona,
  management, and health reads to canonical state.
- [x] Exclude unresolved challenged targets from decision retrieval without removing them from normal
  user recall.
- [x] Return an explicit conflict no-op for a challenged provenance head.
- [x] Add stable `(created_at, id)` ordering to agent and global pending queues.
- [x] Add the canonical management-page index and shared keyset SQL builder.
- [x] Restore exact canonical indexes for recall and maintenance workloads.
- [x] Remove unused status-based partial indexes from canonical steady state.
- [x] Require exact index selection and no temporary order B-tree in query-plan tests.
- [x] Verify fifty-thousand-row management pagination remains bounded.

## Phase F — Architecture and Test Infrastructure

- [x] Reject legacy status types in services and core through resolved-symbol analysis.
- [x] Cover named aliases, namespaces, inline import types, re-exports, property access, bracket access,
  and destructuring.
- [x] Deduplicate architecture violations by file and rule.
- [x] Remove retired mutators from production capability checks.
- [x] Move test-only historical and corruption setup to explicitly named helpers.
- [x] Preserve the shared fake row-map prototype across transaction rollback.
- [x] Add a memory test TypeScript Program gate driven by `memory-test-scope.json`.
- [x] Add a test-only presenter adapter without changing the production constructor contract.

## Phase G — Integration and Migration Evidence

- [x] Cover archive, restore, embedding, conflict, supersession, internal, and content transitions in
  service tests.
- [x] Add real SQLite coverage for provenance reversal, revision, FTS, audit, and rollback.
- [x] Verify fake and SQLite adapters return the same outcomes for the transition matrix.
- [x] Cover conflict outcomes, content parameter order, and category preservation.
- [x] Cover fresh and historical migration, full and partial canonical schemas, and repeated startup.
- [x] Cover malformed legacy values, malformed canonical rows, and per-row import continuation.
- [x] Cover compatibility insert/update, targeted recovery, safety backup, and recovery rollback.
- [x] Cover clean metadata promotion and partial or dirty FTS rebuild.
- [x] Cover exact indexes, stable ordering, and bounded scale workloads.

## Phase H — Documentation and Validation

- [x] Document the canonical state model, migration, bridge, recovery, transitions, indexes, and
  compatibility window.
- [x] Synchronize the maintained agent-memory architecture reference with the implemented behavior.
- [x] Run `mise exec -- pnpm run format`.
- [x] Run `mise exec -- pnpm run i18n`.
- [x] Run `mise exec -- pnpm run lint`.
- [x] Run `mise exec -- pnpm run typecheck`.
- [x] Run `mise exec -- pnpm run test:memory`.
- [x] Run the Native SQLite memory configuration directly.
- [x] Run memory evaluation and memory performance suites.
- [x] Run renderer tests.
- [x] Run focused synchronization-presenter regression tests after updating import fixtures.
- [ ] Complete the full main-process gate after unrelated Cron and Agent Session fixtures are
  corrected outside this change.

## Definition of Done

- Canonical lifecycle and embedding state are the internal source of truth.
- Every supported write keeps the legacy projection consistent in the same mutation boundary.
- Migration, import, catalog repair, and compatibility recovery are transactional and covered by
  Native tests.
- Healthy startup performs no unbounded shadow repair.
- Ordered production queries use their exact canonical indexes and stable tie-breakers.
- Public status behavior and downgrade compatibility remain intact.
- No unresolved clarification marker or implicit compatibility-cleanup task remains.
