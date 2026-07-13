# Memory State Model Normalization — Specification

> This document defines the requirements and acceptance criteria for normalizing the persisted
> agent-memory state model. See [plan.md](./plan.md) for the implementation design and
> [tasks.md](./tasks.md) for the execution record.
>
> - Status: **implemented**
> - Classification: architecture migration
> - Schema version: 42
> - GitHub issue: none

## 1. Problem Statement

The legacy `agent_memory.status` column represented two independent concerns in one enum:

- business lifecycle: active, archived, or conflicted;
- embedding processing: pending, ready, failed, or keyword-only.

That representation forced recall, maintenance, embedding, conflict, management, health, migration,
and import code to maintain overlapping negative filters. It also allowed state combinations whose
meaning could not be expressed or validated precisely at the type boundary.

The storage model needed two canonical axes while preserving existing database compatibility,
public status values, downgrade behavior, and archived embedding references.

## 2. Goals

1. Represent business lifecycle and embedding processing with separate canonical columns.
2. Make canonical state the only source of truth for service and core behavior.
3. Replace generic status mutation with guarded intent-level transitions.
4. Keep the legacy status column synchronized for public projection and downgrade compatibility.
5. Migrate historical, partially migrated, malformed, and imported data without corrupting valid
   canonical state.
6. Preserve bounded query plans for recall, maintenance, embedding queues, conflicts, and management
   pagination.
7. Keep startup read-only for a healthy schema and bound exceptional repair work to mismatched rows.
8. Enforce the state boundary through types, architecture checks, Native SQLite tests, and real
   adapter integration tests.

## 3. Canonical State Model

### 3.1 Lifecycle State

`lifecycle_state` accepts only:

- `active`: eligible for normal domain flows, subject to kind, supersession, conflict, and policy
  guards;
- `archived`: excluded from recall while retaining existing embedding state and references;
- `conflicted`: an unresolved challenger excluded from ordinary recall.

Supersession remains represented by `superseded_by`. It is not a lifecycle value. A challenged
target remains lifecycle-active, while conflict-participant guards prevent unsafe mutation.

### 3.2 Embedding State

`embedding_state` accepts only:

- `pending`: waiting for the current embedding identity;
- `ready`: embedding metadata and sidecar identity are complete;
- `error`: the latest embedding attempt failed and may be retried;
- `fts_only`: keyword recall is intentionally used without vector processing;
- `not_applicable`: internal persona or working memory does not enter the vector pipeline.

### 3.3 Orthogonal State

The following fields remain independent and keep their established meaning:

- `persona_state` for persona draft, active, and history state;
- `conflict_state` and `conflict_with` for target/challenger participation;
- `decision_revision` for optimistic concurrency;
- `superseded_by` for provenance-head replacement;
- `is_anchor`, category, importance, access, decay, and consolidation metadata.

## 4. Legacy Projection

The legacy status remains a synchronized shadow and public compatibility vocabulary:

| Canonical state | Legacy `status` |
| --- | --- |
| lifecycle archived | `archived` |
| lifecycle conflicted | `conflicted` |
| active + pending | `pending_embedding` |
| active + ready | `embedded` |
| active + error | `error` |
| active + fts_only | `fts_only` |
| active + not_applicable | `fts_only` |

Lifecycle takes precedence over embedding state. Every supported write path updates canonical state
and its legacy projection in the same SQL statement or transaction.

## 5. Migration and Import Semantics

### 5.1 Additive Schema

Fresh databases and the schema migration add:

```sql
lifecycle_state TEXT NOT NULL DEFAULT 'active'
  CHECK (lifecycle_state IN ('active', 'archived', 'conflicted')),
embedding_state TEXT NOT NULL DEFAULT 'pending'
  CHECK (embedding_state IN ('pending', 'ready', 'error', 'fts_only', 'not_applicable'))
```

The legacy column is retained. No down migration deletes data or removes compatibility artifacts.

### 5.2 Tolerant Legacy Normalization

Known legacy values map directly to canonical state. Unknown or malformed legacy values do not block
the entire database upgrade:

- persona and working rows normalize to `active/not_applicable`;
- non-internal rows with complete embedding references normalize to `active/ready`;
- other non-internal rows normalize to `active/pending`;
- valid archived or conflicted lifecycle information is retained;
- the shadow status is re-projected from the resulting canonical state.

When both canonical axes are absent, migration performs one combined backfill. A partial schema uses
transaction-local markers to backfill only the missing axis and never overwrites an existing valid
axis.

### 5.3 Incremental Import

Import follows these precedence rules:

1. If both canonical axes exist and are valid, they are authoritative and stale shadow data is
   ignored.
2. If one canonical axis exists and is valid, it is preserved and only the missing axis is derived.
3. If neither axis exists, tolerant legacy normalization derives both axes.
4. An invalid existing canonical axis or unknown memory kind skips only that memory row.
5. Structural, DDL, transaction, or finalizer failure rolls back the complete import.

Import results report inserted, repaired, and skipped row counts per table. The synchronization
presenter records those diagnostics without changing its public success response.

## 6. Transition Contract

Production mutations use intent-level APIs. Each single-row transition receives agent identity, row
identity, and expected revision, validates the complete predecessor/successor snapshot, and retains a
guarded SQL `WHERE` clause as the final concurrency boundary.

Required behavior includes:

- archive accepts only active, non-internal, non-superseded, non-conflict-participant rows;
- restore accepts only archived, non-superseded, non-conflict-participant rows, enters
  `active/pending`, and clears embedding references;
- embedding completion and failure affect only active, eligible, non-superseded rows;
- late embedding completion for archived or conflicted rows affects zero rows;
- conflict resolution updates links, lifecycle, embedding state, shadow, and revision atomically;
- user content updates invalidate embedding state and increment revision exactly once;
- internal content updates preserve `active/not_applicable`;
- metadata updates use revision-aware compare-and-swap;
- a zero-row mutation emits no audit event, mutation event, FTS mirror update, or FTS generation
  change;
- manual provenance reversal does not apply a stale second supersession after an atomic revival has
  already retired the edited row;
- working-memory compare-and-swap retries once after reloading and reschedules refresh after a second
  failure.

Canonical inserts are restricted to these initial states:

- ordinary user memory: `active/pending`;
- conflict challenger: `conflicted/pending` with `conflict_with`;
- persona or working memory: `active/not_applicable`.

The `ready` state can be produced only by the embedding completion path.

## 7. Query and Index Contract

Recall, FTS liveness, vector liveness, embedding queues, maintenance, archive, conflict, working,
persona, management, and health queries use canonical state. Service and core code must not make
business decisions from the legacy status shadow.

Ordered production paths use exact canonical indexes:

- `idx_agent_memory_recall_importance_v5`;
- `idx_agent_memory_archive_eligible_v3`;
- `idx_agent_memory_cognitive_top_v3`;
- `idx_agent_memory_conflict_fairness_v3`;
- `idx_agent_memory_recent_activity_v3`;
- `idx_agent_memory_embedding_pending_agent_v2`;
- `idx_agent_memory_embedding_pending_global_v2`;
- `idx_agent_memory_conflict_target_v2`;
- `idx_agent_memory_management_page_v3`.

Agent and global pending queues use `ORDER BY created_at ASC, id ASC`. Management pagination uses a
stable descending `(created_at, id)` keyset. Production queries and query-plan tests share the same
adapter-owned SQL builders and must not create a temporary B-tree for ordering.

Unused status-based partial indexes are removed from the canonical steady state. Base agent and
provenance indexes, conflict-anomaly indexes, and exact canonical indexes remain.

## 8. Compatibility Bridge and Recovery

Two temporary database triggers support one downgrade compatibility window:

- `agent_memory_legacy_status_bridge_ai` handles legacy inserts that do not provide canonical axes;
- `agent_memory_legacy_status_bridge_au` handles status-only updates when neither canonical axis was
  changed by the same statement.

New code performs explicit dual writes and does not rely on those triggers for domain transitions.
The triggers do not increment `decision_revision`.

Healthy startup compares normalized trigger definitions and remains read-only. If a trigger is
missing or stale:

- with no shadow mismatch, it is replaced atomically;
- with mismatches, the database is checkpointed and copied to a
  `*.memory-state-repair.bak` safety backup;
- recovery updates only mismatched rows;
- the known historical internal-row mismatch shape preserves canonical lifecycle;
- other mismatches use the legacy status as the recovery source;
- the replacement transaction must end with zero mismatches or roll back.

Mismatch counting remains a read-only health diagnostic. Global shadow repair is not part of normal
presenter startup.

The bridge and shadow may be removed only after the release containing this migration has shipped and
one additional stable release has completed. Removal requires a separate architecture decision and
migration.

## 9. Public Compatibility

- Public memory DTOs, health `byStatus`, tool output, renderer filters, and export JSON continue to
  use the legacy six-value vocabulary.
- A single pure projection owns conversion from canonical state to public status.
- Canonical axes are not exposed through the public DTO.
- Archived rows retain embedding references until restore.
- An older application can read new writes through the shadow status and can perform supported
  status-only writes through the compatibility bridge.

## 10. Scope

### In Scope

- Canonical lifecycle and embedding columns.
- Additive migration, catalog repair, incremental import, and downgrade recovery.
- Intent-level mutation APIs and canonical insert invariants.
- Canonical reads, exact indexes, stable queues, and management pagination.
- Legacy projection, temporary compatibility triggers, and health diagnostics.
- Architecture enforcement, Native migration coverage, real-adapter transition tests, and memory test
  type checking.

### Out of Scope

- Removing the legacy status column or compatibility bridge in this change.
- Adding superseded, persona, or challenged-target values to lifecycle state.
- Changing recall scoring, archive thresholds, conflict policy, persona policy, vector-store format,
  or provider behavior.
- Exposing canonical state in renderer or public API contracts.
- Adding user-facing configuration for the state model.
- Fixing unrelated main-process test fixtures.

## 11. Acceptance Criteria

- **AC-1 — Canonical schema:** Fresh and migrated databases contain both canonical columns with
  `NOT NULL` and complete `CHECK` constraints.
- **AC-2 — Safe migration:** Full and partial historical schemas normalize transactionally without
  overwriting a valid existing canonical axis; malformed legacy status is repaired tolerantly.
- **AC-3 — Import diagnostics:** Canonical precedence, partial derivation, per-row skip behavior, and
  repaired/skipped counts are enforced without changing the public synchronization response.
- **AC-4 — Explicit transitions:** Production services use guarded intent APIs, complete transition
  validation, revision checks, and zero-row side-effect suppression.
- **AC-5 — Canonical reads:** Service and core behavior uses canonical state; architecture checks
  reject legacy-type and row-status access through direct, aliased, namespace, import-type,
  re-export, bracket, and destructuring paths.
- **AC-6 — Query performance:** Ordered recall, maintenance, conflict, queue, and management queries
  use their exact indexes with stable tie-breakers and no temporary order B-tree.
- **AC-7 — Bounded recovery:** Healthy startup performs no table-wide repair; exceptional bridge
  recovery creates a safety backup, updates only mismatches, and rolls back on any failed invariant.
- **AC-8 — FTS integrity:** Only successful authoritative mutations update the FTS mirror or
  generation; clean compatible metadata is promoted without rebuilding, while partial or dirty state
  is rebuilt.
- **AC-9 — Public compatibility:** Existing public status values, renderer behavior, export format,
  archive references, and downgrade reads remain compatible.
- **AC-10 — Validation evidence:** Pure, service, real SQLite, Native migration/import, query-plan,
  scale, architecture, and renderer tests cover the state contract.

## 12. Constraints and Open Questions

- The migration is additive and does not delete user data.
- Canonical and shadow state must remain synchronized in one mutation boundary.
- Database triggers are limited to downgrade compatibility and cannot own new-code domain behavior.
- No unresolved design questions remain.
