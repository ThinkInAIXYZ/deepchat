# Memory State Model Normalization — Implementation Plan

> Requirements and acceptance criteria are defined in [spec.md](./spec.md). The completed execution
> record is in [tasks.md](./tasks.md).

## 1. Strategy

Use an additive expand-and-project migration:

1. Define canonical runtime enums, tolerant legacy normalization, public projection, and complete
   transition validation in the memory domain.
2. Add canonical columns and backfill historical rows transactionally.
3. Install downgrade compatibility triggers before recording the migrated schema version.
4. Move repository mutations and reads to canonical state while synchronizing the legacy shadow.
5. Replace unguarded adapter mutation with revision-aware intent APIs.
6. Bind ordered query paths to exact canonical indexes and shared SQL builders.
7. Add exceptional targeted recovery without adding healthy-startup scans.
8. Enforce the boundary with architecture analysis and layered tests.

The legacy column remains available throughout the compatibility window. No down migration removes
canonical data.

## 2. Ownership

### 2.1 Domain Owner

`memoryPresenter/domain/stateModel.ts` owns:

- runtime lifecycle and embedding enum validation;
- tolerant legacy normalization;
- canonical-to-legacy projection;
- recall and embedding eligibility predicates;
- canonical insert validation;
- intent-level transition validation over complete snapshots.

`memoryPresenter/domain/types.ts` owns service-facing canonical row types. Service rows do not expose
the legacy status shadow.

### 2.2 SQLite State SQL Owner

`sqlitePresenter/tables/agentMemoryStateSql.ts` owns SQL generation for:

- enum literals;
- internal-kind and complete-reference predicates;
- legacy lifecycle and embedding derivation;
- canonical projection and mismatch predicates;
- compatibility bridge expressions and DDL.

Migration, catalog repair, trigger installation, and importer behavior consume the same runtime enum
and mapping ownership rather than maintaining independent literal sets.

### 2.3 Adapter Boundary

`AgentMemoryTable` owns persistence and exposes only guarded production capabilities. Test-only
historical and corrupted states are constructed by explicitly named fake or raw-seed helpers rather
than public production mutators.

## 3. Schema Migration

### 3.1 Transaction Lifecycle

Add an internal optional table hook:

```ts
interface BaseTable {
  finalizeMigration?(version: number): void
}
```

For each schema version, the SQLite presenter performs one transaction:

1. execute all migration SQL blocks;
2. call every table finalizer;
3. record the schema version.

`AgentMemoryTable.finalizeMigration(42)` installs the compatibility bridge, promotes compatible FTS
metadata when safe, records normalization statistics, and removes migration-local markers before the
transaction commits.

### 3.2 Full and Partial Backfill

Before adding columns, create transaction-local markers for the axes actually missing from the
source schema.

- If both axes are missing, run one combined canonical backfill.
- If one axis is missing, derive only that axis.
- Preserve any existing valid canonical axis.
- Re-project the shadow after both axes are available.
- Record the count of rows repaired through tolerant normalization.

This avoids relying on ignored duplicate-column errors and prevents default values from overwriting a
partially migrated database.

### 3.3 Tolerant Mapping

Migration SQL and the pure TypeScript helper follow the same precedence:

1. Preserve valid archived or conflicted lifecycle values.
2. Internal persona and working rows use `not_applicable`.
3. Known active embedding statuses map directly.
4. Non-internal archived, conflicted, or malformed rows with complete references use `ready`.
5. Remaining eligible rows use `pending`.
6. Project a legal shadow from the canonical result.

Matrix tests compare SQL and TypeScript outcomes across status, kind, reference completeness, and
partial-schema combinations.

### 3.4 Schema Assertion and Catalog Repair

Current-schema assertion validates:

- both canonical columns exist;
- both columns are `NOT NULL`;
- both `CHECK` clauses contain the complete enum set;
- compatibility trigger names and normalized definitions match the canonical DDL.

Weak canonical constraints fail hard. Catalog repair adds only missing columns, backfills only those
columns, reconciles the shadow, replaces bridge artifacts, and checks consistency inside its existing
repair transaction.

## 4. Compatibility Bridge Recovery

### 4.1 Trigger Behavior

The insert bridge activates only when canonical state and projected shadow disagree after a legacy
insert. It derives missing canonical state while preserving archived or conflicted internal
lifecycle.

The update bridge activates only when:

- legacy status changed;
- neither canonical axis changed in the same statement;
- projected canonical state does not match the new status.

Archive and conflict updates preserve embedding state and references. Restore and pending updates
enter `active/pending`. Trigger execution never changes `decision_revision`.

### 4.2 Artifact Verification

Fresh schema, migration finalization, catalog repair, and startup assertion use one trigger installer
and two separately comparable DDL definitions.

- Correct definitions require no write and no row scan.
- Missing or stale definitions with zero mismatches are replaced transactionally.
- Missing or stale definitions with mismatches enter targeted recovery.

### 4.3 Targeted Recovery

Before modifying mismatched data:

1. checkpoint the database;
2. create a `*.memory-state-repair.bak` copy;
3. identify only rows whose shadow differs from canonical projection;
4. preserve canonical lifecycle for the known historical internal-row mismatch shape;
5. reconstruct other mismatches from legacy status;
6. install the canonical bridge definitions;
7. assert that mismatch count is zero;
8. record repaired counts, preserved internal counts, and backup path.

Any failure rolls back database mutations. The safety backup remains available for diagnostics.

## 5. Incremental Import

Extend the internal import result:

```ts
interface ImportSummary {
  tableCounts: Record<string, number>
  repairedRowCounts: Record<string, number>
  skippedRowCounts: Record<string, number>
}
```

Use a dedicated memory-row copy plan:

- complete valid canonical state is authoritative;
- partial valid canonical state is retained while the missing axis is derived;
- legacy-only rows use tolerant normalization;
- invalid legacy shadow on a legacy-only row is repaired and counted;
- invalid existing canonical state or unknown kind skips only the affected row;
- invalid structure, DDL, or transaction behavior aborts the import.

The synchronization presenter logs non-empty repaired and skipped counts. Its existing public success
DTO remains unchanged.

## 6. Transition APIs

### 6.1 Lifecycle Targets

All single-row transitions use:

```ts
interface MemoryTransitionTarget {
  agentId: string
  id: string
  expectedRevision: number
}
```

Lifecycle intents include:

- archive active memory;
- restore archived memory;
- revive superseded memory;
- activate or archive a resolved challenger;
- archive a conflict target;
- invalidate user content and embedding state;
- update internal content;
- update user metadata.

Each implementation performs a TypeScript snapshot precheck, pure intent validation, and guarded SQL
mutation. The SQL predicate remains authoritative under concurrency.

### 6.2 Conflict Resolution

Represent challenger resolution as a discriminated union between:

- state-only activation;
- activation with a complete content update.

Omitted category preserves the current value. Link cleanup and lifecycle transition occur in the
same row mutation so one logical operation increments revision once.

Decision retrieval excludes unresolved challenged targets, while ordinary user recall continues to
include them. If the current provenance head is challenged, write coordination returns an explicit
conflict no-op instead of retrying into a misleading concurrent-update outcome.

### 6.3 Content, Metadata, and Supersession

- User content, provenance, category, embedding invalidation, reference cleanup, shadow projection,
  and revision increment happen in one statement.
- Internal content uses a separate API and preserves `active/not_applicable`.
- User metadata uses `updateUserMetadataIfRevision`; zero rows produce no audit or event.
- Observation-driven category backfill supplies the current timestamp to re-anchor access time.
- When atomic revival reports that the edited row is the retired head, the caller does not apply a
  second supersession with a stale revision.
- Working-memory refresh reloads and retries one failed compare-and-swap, then marks the source dirty,
  schedules another refresh, and records a warning if the second attempt fails.

### 6.4 Embedding and FTS Side Effects

Embedding ready, error, keyword-only, and requeue operations modify only the embedding axis and do
not increment decision revision.

Every recall mutation declares whether it affected authoritative rows:

```ts
private runRecallMutation<T>(input: {
  mutate: () => T
  didMutate: (result: T) => boolean
  maintainFts: (result: T) => void
}): T
```

If `didMutate` is false, the adapter does not run the mirror callback or advance the FTS generation.
Batch operations use actual returned identifiers rather than requested identifiers.

## 7. Canonical Queries and Indexes

### 7.1 Query Migration

Move query ownership in this order:

1. repository query predicates;
2. service consumers;
3. core recall and embedding predicates;
4. DTO, health, tool, and export projection.

Canonical query rules:

- recall requires lifecycle active, no supersession, and a non-internal kind;
- embedding queues require lifecycle active, embedding pending, no supersession, and a non-internal
  kind;
- maintenance and archive require lifecycle active plus conflict, anchor, supersession, age, and
  decay guards;
- challenger lists require lifecycle conflicted;
- working and persona paths require internal kind and `not_applicable`;
- management and health aggregate canonical state and project legacy status only at the output
  boundary.

### 7.2 Ordered Indexes

Install and bind these indexes:

| Index | Ordered key |
| --- | --- |
| `idx_agent_memory_recall_importance_v5` | `(agent_id, importance DESC, created_at DESC, id ASC)` |
| `idx_agent_memory_archive_eligible_v3` | `(agent_id, COALESCE(last_accessed, created_at), created_at, id)` |
| `idx_agent_memory_cognitive_top_v3` | `(agent_id, importance DESC, created_at DESC, id DESC)` |
| `idx_agent_memory_conflict_fairness_v3` | `(agent_id, COALESCE(last_consolidated_at, 0), created_at, id)` |
| `idx_agent_memory_recent_activity_v3` | `(agent_id, COALESCE(last_accessed, created_at) DESC)` |
| `idx_agent_memory_embedding_pending_agent_v2` | `(agent_id, created_at, id)` |
| `idx_agent_memory_embedding_pending_global_v2` | `(created_at, id, agent_id)` |
| `idx_agent_memory_management_page_v3` | `(agent_id, created_at DESC, id DESC)` |

Keep the conflict-target, conflict-anomaly, base agent, provenance, and other exact canonical indexes
used by production queries. Remove status-based partial indexes that are not used in canonical steady
state.

Adapter-internal builders own pending-queue and management-page SQL. Query-plan tests call the same
builders and require the exact index name, stable tie-breaker, and absence of
`TEMP B-TREE FOR ORDER BY`.

## 8. Architecture Enforcement

The memory architecture guard rejects service or core access to legacy state through:

- named imports and aliases;
- namespace-qualified types;
- inline import types;
- type re-exports;
- direct property access;
- bracket access;
- object and binding-pattern destructuring;
- structured aliases of legacy row state.

Violations are deduplicated by file and rule. Fixtures cover each supported bypass shape.

Production capability checks exclude removed generic mutators. Shared fakes expose explicitly named
seed or corruption helpers only for tests.

## 9. Test Strategy

### 9.1 Pure and Service Tests

- Legacy status, kind, and reference-completeness normalization matrix.
- Canonical projection and recall/embedding predicates.
- Every intent validator predecessor and successor invariant.
- Valid, wrong-agent, wrong-revision, wrong-lifecycle, internal, superseded, and conflict-participant
  transitions.
- Zero-row audit, event, FTS result, and generation stability.
- Working-memory retry and provenance reversal behavior.

### 9.2 Real SQLite and Native Tests

- Fresh and historical schema migration to version 42.
- Full, lifecycle-only, embedding-only, and complete canonical sources.
- Unknown legacy status and malformed canonical rows.
- Finalizer failure, trigger collision, repair failure, and transaction rollback.
- Internal bridge insert/update and historical mismatch recovery.
- Backup creation and targeted repaired-row counts.
- Clean FTS metadata promotion and partial or dirty rebuild.
- Conflict outcomes, content parameter order, category preservation, revision deltas, FTS, and
  fake/SQLite parity.

### 9.3 Query and Scale Tests

- Exact index and no-temporary-sort assertions for recall, archive, cognitive, conflict, recent,
  pending queues, and management pagination.
- Stable ordering for identical timestamps.
- Fifty-thousand-row management pagination and bounded page materialization.
- Startup path verification that healthy schema assertion does not scan all memory rows.

### 9.4 Test Type Gate

Build a TypeScript Program from `memory-test-scope.json` before running memory Vitest suites. Include
all scoped tests and the shared fake so removed methods, invalid transition inputs, and stale test
contracts fail before runtime.

## 10. Rollout and Cleanup

- Keep additive columns and the shadow during application rollback.
- Allow an older application to rebuild its historical indexes; canonical startup removes them again.
- Keep the compatibility bridge for the release containing the migration and one subsequent stable
  release.
- Require a separate migration and architecture decision before deleting the bridge or shadow.
- Do not proceed with compatibility cleanup while diagnostics report canonical-shadow mismatches.
