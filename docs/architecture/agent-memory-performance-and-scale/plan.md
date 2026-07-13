# Agent Memory Performance and Scale — Implementation Plan

> This document describes the implemented architecture. Requirements and acceptance criteria are defined in
> [spec.md](./spec.md), and implementation evidence is tracked in [tasks.md](./tasks.md).

## Delivery Sequence

The work was delivered in dependency order so that every optimization retained the existing correctness
gates:

1. Close architectural decisions, establish characterization tests, and add production-path counters.
2. Bound keyword recall and separate logical vector readiness from resource lifetime.
3. Add a rebuildable Tape ingestion projection.
4. Batch candidate decisions and embedding persistence.
5. Bound working-memory refresh and maintenance work.
6. Bound startup resources, management pages, content, and audit growth.
7. Run the full scale matrix and record as-built evidence.

Authoritative revalidation, semantic revision checks, read epochs, destructive operation generations,
provider deadlines, and vector leases remain active in every phase.

## Recall Hot Path

### FTS Policy and Derived-State Isolation

A single FTS policy module owns the JavaScript row evaluator, SQL recallability predicate, policy version,
and deterministic agent-scope encoder. Explicit mirror maintenance, filtered backfill, status transitions,
and differential tests consume that policy rather than duplicating exclusions.

Authoritative memory DML follows this transaction shape:

1. Apply the authoritative table mutation.
2. Advance the FTS mutation generation and mark the mirror dirty.
3. Enter a nested savepoint and apply the minimal mirror mutation.
4. On mirror success, update the clean generation.
5. On mirror failure, roll back only the savepoint and commit the authoritative mutation with dirty metadata.

Updates that do not affect content or recallability avoid FTS work. Bulk agent deletion removes that agent's
mirror rows while authoritative rows still exist, then deletes the authoritative rows. Structural failures
schedule a cooled lazy rebuild; transient busy/locked failures degrade only the current request.

FTS v4 includes content and a deterministic scope token. MATCH constrains both columns, while BM25 assigns
zero weight to scope. unicode61 is a permanent LIKE-only capability state because maintaining an unused
mirror would create write amplification without a reader.

### Deterministic Keyword Selection

Every keyword candidate receives this priority tuple:

```ts
type RecallTermPriority = [kindRank: number, negativeLength: number, position: number]
```

`code/path=0`, `cjk=1`, and `ascii=2`. Length is measured in Unicode code points. The selector takes at most
eight terms by priority and restores original occurrence order before building the query. If any useful term
has at least three code points, shorter code tokens are dropped; an all-short query remains eligible for one
LIKE fallback.

### Bounded Search Strategy

`MemoryRepositoryPort.search` returns internal rows plus the selected strategy:

```ts
interface MemoryKeywordSearchResult {
  rows: AgentMemoryRow[]
  strategy: 'fts-only' | 'like-fallback'
}
```

The FTS statement has two bounded branches:

- A MATCH/BM25 branch orders and limits its lexical candidate window first.
- An importance branch reads a fixed window from the recall-importance partial index and probes the same
  MATCH expression.

The branches union and deduplicate at most twice the caller limit. The fallback is one bounded agent-scoped
LIKE statement. Both paths feed the existing scoring and fusion logic, then one `listByIds` call replaces
snapshots with current authoritative rows.

### Vector Readiness and Mutation Barrier

Logical readiness and native resource lifetime are independent:

```ts
interface VectorReadyCertificate {
  agentId: string
  providerId: string
  modelId: string
  dimension: number
  configGeneration: number
  storeGeneration: number
}
```

The vector manager provides `withVectorMutation(agentId, operation)`. Coverage verification, bulk upsert,
sidecar deletion, reconciliation, destructive reindex, and SQLite-ready transitions use this barrier.
Ordinary vector queries use a generation lease but do not occupy the mutation barrier.

The verifier acquires the barrier before reading SQLite embedded IDs, compares paged SQLite and DuckDB ID
sets in both directions, removes sidecar extras, and rebuilds when an authoritative embedded row lacks a
vector. It signs the certificate only if the read epoch, embedding identity, and store generation are stable
before and after the scan.

LRU close/reopen changes only the lease epoch. Configuration identity change stops new leases, drains old
leases, clears the logical certificate, and rebuilds. A query with no certificate remains FTS-only and may
schedule asynchronous verification.

## Tape Ingestion Projection

### Derived Schema

The projection uses idempotent derived tables rather than a global migration:

```sql
CREATE TABLE deepchat_memory_ingestion_projection (
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  order_seq INTEGER NOT NULL,
  entry_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  had_tool_use INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, message_id)
);

CREATE INDEX idx_memory_ingestion_projection_range
  ON deepchat_memory_ingestion_projection(session_id, order_seq, message_id);

CREATE TABLE deepchat_memory_ingestion_projection_meta (
  session_id TEXT PRIMARY KEY,
  projection_version INTEGER NOT NULL,
  max_entry_id INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Projection version starts at 1. Tape retains complete revisions and remains authoritative.

### Reducer Semantics

`DeepChatTapeEntriesTable.append` invokes the reducer at the lowest persistence layer so every caller shares
the same behavior.

- Message revisions use the existing rank and entry-ID tie-break.
- Only effective sent/error messages produce projection rows.
- Final tool-call facts may arrive before their message. They advance metadata; the final message derives
  `had_tool_use` from shared effective semantics.
- Only explicit `success` and `error` tool statuses rank as terminal. Missing, loading, pending, and unknown
  statuses cannot become final tool-use evidence.
- Tool results and pending tool interactions advance metadata without setting final tool use.
- Retraction and mutations whose equivalence cannot be proven invalidate session metadata.
- Session delete, clear, fork, truncate, and rewind remove or invalidate the corresponding projection state.

Tape append and reducer execution share one transaction. Before advancing metadata, the reducer compares the
current session metadata with that session's previous maximum entry ID. Reducer failure invalidates the
session metadata while preserving the authoritative append; invalidation failure rolls back the append.

### One-Statement Current Range

`readCurrentMemoryIngestionRange` uses one CTE to read the Tape maximum, projection metadata, and requested
range. Its tagged result is one of:

```ts
type MemoryIngestionRangeResult =
  | { source: 'projection'; current: true; rows: ProjectionRow[] }
  | { source: 'rebuilt'; current: true; rows: ProjectionRow[] }
  | { source: 'fallback'; current: false; rows: EffectiveTapeRow[] }
```

A stale projection reads Tape once, invokes the single `buildEffectiveTapeView` implementation, and replaces
projection and metadata transactionally. The already-materialized view supplies the current extraction range.
If replacement fails, extraction consumes the authoritative view but all cursor commit boundaries are null.

Read and replacement failures enter a bounded per-session cooldown for 30 seconds. During that interval,
subsequent extraction attempts stop before another full Tape materialization or provider call. The passive
retry state holds at most 256 sessions, requires no timers, clears after a successful current read or replace,
and is removed when the session is initialized, cleared, or destroyed.

Chunk construction records the final fragment for each `orderSeq`. No chunk may commit a sequence until that
fragment succeeds. Projection and full-view ordering use SQLite-compatible UTF-8/BINARY comparison.

## Candidate and Decision Batching

### Normalization and Retrieval

Candidate parsing is followed immediately by Unicode-safe content validation and stable deduplication using
`(kind, normalizeForProvenanceV2(content))`. No recall or provider work occurs for discarded candidates.

`retrieveForDecisions` performs:

1. One bounded lexical query per candidate.
2. One batch query embedding for unresolved candidates.
3. All vector queries under one store lease.
4. One authoritative `listByIds` for every candidate and vector ID.
5. A maximum of three live neighbors per candidate.

Pinned decision-head state stores IDs only. Pinned rows join the same authoritative materialization and must
pass the live predicate before entering a prompt.

The query-vector snapshot is identity-bound:

```ts
interface MemoryDecisionQueryVectorSnapshot {
  vector: number[]
  providerId: string
  modelId: string
  dimension: number
  configGeneration: number
}
```

### Partitioning and Parsing

The pure partitioner caps each batch at four candidates, three neighbor excerpts per candidate, and 12,000
estimated input tokens. At most two batches are sent. It drops the lowest-priority neighbor excerpt before
using the initial `ADD` fallback for an otherwise unplaceable candidate.

The response is a JSON array keyed by original candidate index:

```ts
interface BatchMemoryDecisionResult {
  candidateIndex: number
  decision: 'ADD' | 'UPDATE' | 'SUPERSEDE' | 'NOOP' | 'CHALLENGE'
  targetIndex: number | null
  mergedContent: string | null
}
```

A shared JSON-fence parser extracts the array. The first duplicate index wins. Initial missing, invalid, or
provider-failed items use candidate-local `ADD` fallback. Retry uses a stricter policy: only an explicit valid
`ADD` may create a row; every other missing, invalid, stale, or failed result becomes `concurrent-update`.

### Fencing and Revision Retry

Each provider partition checks its operation fence before admission and after completion. Final application
re-resolves provenance, permanent-forget state, current owner revision, liveness, and status at the
transaction boundary. Candidate application stays serial in original order.

Only the first four revision conflicts are retried. Retry refreshes provenance and neighbors, reuses the
candidate embedding only if its identity snapshot remains current, and sends one additional decision batch.
The upper bounds remain five provider calls in steady state and six under contention.

## Bulk Embedding Persistence

One supervisor promise per agent owns `{ dirty, running }` state and continues in 50-row chunks until the
backlog is empty. Concurrent triggers share the same promise, including merged follow-up cycles.

Each chunk follows this fixed transaction flow:

1. Snapshot IDs, expected revisions, content, and embedding identity.
2. Request one provider embedding batch.
3. Perform one authoritative `listByIds` revalidation.
4. Enter `withVectorMutation` and one vector lease.
5. Execute one DuckDB bulk delete and one parameterized bulk insert in one transaction.
6. Execute one revision-aware SQLite success update and, if needed, one error update.
7. Remove vectors for SQLite CAS misses before releasing the mutation scope.

Provider-wide failure leaves retryable rows pending. Malformed individual vectors enter the error batch.
Configuration, clear, forget, and content-edit races cannot mark old vectors ready.

## Working Memory and Maintenance

### Working Dirty Coalescing

The working-memory service owns dirty-agent state, trailing timers, and per-agent refresh singleflight.
Mutation finalization calls `markDirty(agentId)`; the 100 ms timer refreshes once and skips an unchanged blob.
A read encountering dirty state cancels the timer and synchronously flushes before final injection assembly.
Dispose cancels timers; working memory remains rebuildable.

### Archive and Cognitive Queries

`archiveEligibleBatch` converts the decay threshold into an age inequality over
`COALESCE(last_accessed, created_at)`, uses its expression index, and updates at most 256 IDs through a CTE and
`UPDATE ... RETURNING`. The health count uses the same algebra.

Reflection and persona call `getCognitiveMaintenanceInput`, which returns eligible count, importance after
watermark, maximum creation time, and bounded top rows. SQL performs aggregate, ordering, and limiting.

### Provider Budget, Fairness, and Concurrency

`MaintenanceBudget` owns total calls, input tokens, and non-transferable step quotas:

| Step | Call quota |
| --- | ---: |
| Challenge | 4 |
| Merge | 2 |
| Reflection | 1 |
| Persona | 1 |

The total token budget is 24,000 estimated input tokens. Reservation occurs before gateway admission and is
not refunded on failure.

Heavy steps run in the listed order under a process-wide fair semaphore of two. An agent's complete heavy
pass is singleflight. Cheap maintenance runs outside the semaphore.

Conflict challenger selection uses its persisted fairness index. Every selected challenger is stamped after
an attempt. Integrity repair selects bounded anomaly classes and uses set-based transitions, while semantic
sibling-group resolution uses a constant number of statements regardless of sibling count.

## Resources and Data Capacity

### Startup Warmup and Store LRU

Startup first asks the agent repository for managed, enabled, memory-enabled candidates. Memory storage then
uses the recent-activity expression index to rank only those candidates and returns at most eight.

Embedding connection warmup uses a process-lifetime success set, in-flight map, and five-minute failure map
keyed by `provider:model`.

The vector manager maintains a soft cap of eight open stores, a 15-minute idle TTL, and an unref'ed 60-second
sweep. Candidate selection occurs outside locks; the agent lock rechecks lease count, open-in-flight state,
and identity. All-busy pressure may exceed the cap temporarily, and lease release immediately retries
convergence.

### Management Pagination

The additive route is:

```ts
interface MemoryPageInput {
  agentId: string
  cursor?: string
  limit?: number
}

interface MemoryPageOutput {
  items: MemoryItemDto[]
  nextCursor: string | null
}
```

The shared contract owns canonical base64url encode/decode for `{v:1,createdAt,id}`. The repository applies
the management visibility predicate, uses `(created_at DESC, id DESC)` keyset ordering, and reads one extra
row to determine whether to emit a cursor. Direct repository calls cap their limit as well. After cursor
validation, the route returns an empty page for a non-DeepChat Agent without calling the presenter.

The renderer tracks loaded page count and request generation. Refresh replays the same page depth into a
temporary result and atomically replaces visible rows. Search retains the server route and its own request
generation. Active-only server search hides the unrelated page action, while local archived search keeps Load
more available to extend its loaded window. Update events are coalesced with a 100 ms trailing timer.

### Content and Audit Retention

Shared Unicode scalar helpers define code-point length and safe truncation. Route schemas, domain services,
memory tools, extraction parsing, merged content, excerpts, and chunking use those helpers.

Operational audit cleanup uses an exact partial index and allowlist. A cheap pass deletes at most 500 rows
beyond the newest 10,000 per agent. User-semantic, persona, unknown, malformed, and legacy causal rows never
enter the cleanup candidate set.

## Performance Validation

The independent `*.perf.ts` configuration runs single-worker, non-parallel scale fixtures with a 120-second
timeout. The production observer is optional and defaults to undefined; enabled tests receive real counters
from repository, projection, provider gateway, DuckDB store, and vector manager execution points.

The matrix separates scenarios rather than forming a Cartesian product:

- Memory recall at 1,000, 10,000, and 50,000 rows.
- Tape current-range and full-view baselines at 10,000 and 100,000 entries.
- One hundred agents sharing one embedding model.
- A 101-row drain proving 50/50/1 chunks.
- Eight decision candidates with three neighbors.
- Fifty-thousand-row maintenance query plans and a 1,000-sibling transition.

Median and nearest-rank p95 are reported. Recall uses 11 paired samples and alternates FTS/LIKE execution order
to reduce cache-order bias. Its hard gate asserts `fts-only`, preserves statement and materialization caps, and
requires the 10,000-to-50,000-row FTS median growth factor to be no more than 65% of the legacy LIKE growth
factor. The 50,000-row point ratio and absolute latency are report-only. The Tape relative ratio remains a hard
gate. The native CI job rebuilds the Node ABI dependency before running the suite.

## Compatibility and Rollback

- FTS and projection may be dropped and rebuilt; their failure paths preserve authoritative data.
- Projection metadata is independent of the global schema migration sequence.
- Bulk DuckDB writes preserve the existing table format.
- Batch decision behavior can be disabled without removing semantic revision checks.
- LRU closes only reopenable stores and does not delete sidecar files.
- `memory.page` is additive; the deprecated list remains temporarily compatible.
- Audit retention is limited to proven operational rows and is protected by exact allowlist tests.
- No runtime dependency, GitHub issue, or DuckDB format change is introduced.

## Validation Commands

```bash
mise exec -- pnpm run typecheck
mise exec -- pnpm run test:main -- --run
mise exec -- pnpm run test:renderer -- --run
mise exec -- pnpm run test:main:memory-perf
mise exec -- pnpm run format
mise exec -- pnpm run i18n
mise exec -- pnpm run lint
mise exec -- pnpm run format:check
```

Native SQLite, FTS, migration, and scale validation run in the `memory-native-validation` CI job. Local
development does not switch the shared dependency tree between Electron and Node ABIs.
