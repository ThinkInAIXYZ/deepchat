# Agent Memory Performance and Scale — Tasks

> The requirements are defined in [spec.md](./spec.md), and the implemented design is described in
> [plan.md](./plan.md). Phases are ordered by architectural dependency and contain no external document gate.

## Phase: Characterization and Performance Baseline

- [x] Lock the keyword strategy, retry fallback and cap, Tape table-level projection, certificate/resource
  generations, bounded maintenance writes, export boundary, and exact audit allowlist.
- [x] Verify lazy provenance re-key collision recovery by rereading the v2 owner and comparing kind plus
  normalized content.
- [x] Cover equivalent and non-equivalent concurrent provenance owners.
- [x] Characterize recall IDs/order/source, effective Tape ranges, decision outcomes, embedding status,
  working blobs, archive behavior, maintenance, and startup warmup.
- [x] Add an independent `*.perf.ts` Vitest configuration and `test:main:memory-perf` command.
- [x] Add deterministic 1k/10k/50k memory, 10k/100k Tape, and 100-agent fixtures.
- [x] Add optional, no-op-by-default production observers for SQLite, repository, materialized rows, provider,
  DuckDB, store, lease, queue, and cache metrics.
- [x] Record the safe-trigram/LIKE, full Tape view, 101-row drain, and eight-candidate baselines.
- [x] Keep benchmark fixtures independent of real providers and user data.
- [x] Replace test-side counter reporting with counters emitted at production execution points.

Gate: the baseline reproduces per-agent scans, full Tape materialization, call amplification, and resource
growth deterministically.

## Phase: Recall Hot Path and Vector Readiness

- [x] Upgrade FTS metadata to v4 with a policy version, deterministic agent scope, explicit savepoint-isolated
  mirror maintenance, and filtered rebuild.
- [x] Ensure FTS failure never rolls back authoritative memory DML and degrades to exactly one LIKE fallback.
- [x] Remove corpus keyword statistics and unbounded keyword caches.
- [x] Implement the deterministic code/path, CJK, and ASCII selector with an eight-term cap.
- [x] Implement bounded BM25 and same-MATCH importance branches.
- [x] Use LIKE only for unavailable FTS, unicode61, or an all-short useful query.
- [x] Bind vector readiness to embedding identity, configuration generation, and logical store generation.
- [x] Remove ordinary recall calls to `hasStaleEmbeddings`.
- [x] Keep one authoritative `listByIds` materialization for recall results.
- [x] Serialize coverage verification, vector mutation, reconciliation, and SQLite-ready transitions through a
  per-agent mutation barrier.
- [x] Sign readiness only after stable-epoch bidirectional SQLite/DuckDB coverage verification.
- [x] Make incremental import invalidate derived FTS metadata and keep agent-scoped clear isolated.
- [x] Bound common-term candidate materialization before sorting.
- [x] Cover trigram, unicode61, short CJK/code, build/runtime failure, liveness transitions, configuration
  generation, scope isolation, and retrieval evaluation parity.
- [x] Run the 1k/10k/50k recall matrix and record the large-scale point ratio.

Gate: safe-trigram recall performs no LIKE, corpus statistics, or stale-vector existence scan.

## Phase: Tape Ingestion Projection

- [x] Add projection and metadata tables, projection version 1, range index, and idempotent schema creation.
- [x] Implement message revision, retraction, tool, and deletion semantics with shared effective-view ranking.
- [x] Run Tape append and projection update in one transaction; invalidate metadata before accepting a degraded
  authoritative append.
- [x] Treat a final tool fact before its sent/error message as a valid runtime order.
- [x] Clean or invalidate projection state for delete, clear, fork, truncate, and rewind.
- [x] Add metadata validation, transactional full rebuild, and authoritative fallback.
- [x] Add one-statement current-range reads keyed by session and order sequence.
- [x] Prevent any fallback extraction from advancing the persistent cursor.
- [x] Commit an equal-order sequence only after its final fragment succeeds.
- [x] Verify parity for replacement, retraction, pending state, tool deduplication, lineage, edit/retry, restart,
  and stale metadata.
- [x] Run the 100k Tape tail matrix and satisfy the full-view relative ratio.

Gate: normal extraction does not call Tape `getBySession()` and materializes only the requested range.

## Phase: Candidate Decisions and Embedding Batches

- [x] Stably deduplicate candidates by normalized `(kind, content)` and enforce the 2,000-code-point limit
  before recall or provider work.
- [x] Add batched decision retrieval with one query-embedding batch, one vector lease, and one authoritative
  row materialization.
- [x] Add a deterministic four-candidate, three-neighbor, 12,000-token partitioner.
- [x] Add the indexed batch prompt/result parser, initial candidate-local `ADD` fallback, and budget fallback
  audit.
- [x] Apply candidates serially in original order with revision-aware semantic transitions.
- [x] Fence every provider admission and response and stop later partitions after destructive invalidation.
- [x] Revalidate provenance, permanent-forget state, liveness, revision, pinned rows, and embedding identity at
  final apply.
- [x] Retry only the first four conflicts, reuse only identity-compatible embeddings, and never use implicit
  retry `ADD`.
- [x] Enforce provider limits of five in steady state and six under contention.
- [x] Perform DuckDB bulk delete and bulk insert in one transaction.
- [x] Perform at most one revision-aware SQLite success update and one error update per embedding batch.
- [x] Replace promise chaining with one per-agent drain supervisor that processes 50-row chunks to exhaustion.
- [x] Preserve pending rows on provider-wide failure and avoid empty pending-to-pending writes.
- [x] Cover partial parsing, missing/duplicate indexes, token overflow, concurrent forget/clear/configuration
  change, sidecar orphan cleanup, and 101-row drain behavior.

Gate: eight candidates and a 50-row embedding batch remain inside fixed provider and statement limits.

## Phase: Working Memory and Maintenance Bounds

- [x] Add 100 ms trailing working-memory debounce and per-agent refresh singleflight.
- [x] Synchronously flush dirty working memory on read while preserving read-epoch finalization.
- [x] Add a 256-row `archiveEligibleBatch` using indexed current-time age algebra and
  `UPDATE ... RETURNING`.
- [x] Remove the lifetime zero-access archive veto and align lifecycle preview, health, UI copy, and tests.
- [x] Replace full-corpus reflection/persona reads with aggregate plus indexed top-N input.
- [x] Add a shared maintenance budget with 4/2/1/1 call quotas and 24,000 estimated input tokens.
- [x] Run heavy steps in challenge, merge, reflection, persona order without quota borrowing.
- [x] Add persistent challenger fairness and stamp every attempted challenger outcome.
- [x] Limit heavy maintenance to two agents with process-wide fairness and whole-pass per-agent singleflight.
- [x] Keep gateway admission failures inside the consumed budget.
- [x] Replace conflict sibling loops and broad integrity repair with bounded set-based transitions.
- [x] Verify maintenance query plans use their intended indexes without temporary ORDER BY storage.
- [x] Cover mutation coalescing, read flush, archive limits, recent access, cognitive top-N, provider budget,
  conflict fairness, and three-agent concurrency.

Gate: a no-change pass performs no unbounded row writes or provider calls.

## Phase: Resource, Pagination, Content, and Audit Bounds

- [x] Filter managed, enabled, memory-enabled agent candidates before indexed latest-activity ranking.
- [x] Limit startup prewarm to eight recent agents.
- [x] Key embedding connection warmup by `provider:model` with successful, in-flight, and five-minute failure
  caches.
- [x] Add lease-safe store LRU with a soft cap of eight, a 15-minute idle TTL, and immediate convergence after
  lease release.
- [x] Keep expected LRU competition from clearing logical readiness or creating embedding errors.
- [x] Verify 100 shared-model agents use at most one warm embedding call and eight open sidecars.
- [x] Add `memory.page`, a canonical versioned opaque cursor, and default/maximum page size 100.
- [x] Add indexed keyset pagination, loaded-depth renderer refresh, stale-response rejection, and server search.
- [x] Keep dirty page-two editors intact across refresh.
- [x] Deprecate the legacy list and prevent new production callers through an architecture guard.
- [x] Enforce 12,000-code-point manual and 2,000-code-point automatic content limits across shared, domain,
  tool, and model-generated boundaries.
- [x] Retain existing oversized rows without migration or truncation.
- [x] Add exact operational-audit retention: newest 10,000 retained and at most 500 deleted per cheap pass.
- [x] Prove user-semantic, persona, unknown, malformed, and legacy causal rows are never pruned.
- [x] Prove cleanup leaves `hasForgetEvent` unchanged.
- [x] Cover cursor tampering/ties/end, repository direct-call bounds, renderer load-more/search/refresh, Unicode
  boundaries, and retention idempotence.

Gate: long-lived native resources, management responses, submitted content, and operational audit growth have
explicit limits.

## Phase: Scale Evidence and Documentation

- [x] Run the complete performance matrix and record median, p95, and production complexity counters.
- [x] Add alternating 11-sample paired measurement, assert `fts-only`, and enforce the portable
  10k-to-50k growth-factor gate.
- [ ] Verify the portable recall growth gate in post-change native CI.
- [x] Verify 100k Tape current-range median is no more than 20% of the full-view baseline.
- [x] Record whether the report-only recall and Tape p95 targets pass in the reference environment.
- [x] Record the implemented architecture, compatibility guarantees, failure modes, and benchmark evidence in
  this self-contained document set.
- [x] Verify no unresolved clarification marker remains.

Gate: the implementation and its scale evidence agree with [spec.md](./spec.md).

## Validation Status

- [x] `mise exec -- pnpm run typecheck`
- [ ] `mise exec -- pnpm run test:main -- --run` — memory-focused tests pass; the complete suite still has four
  unrelated pre-existing failures in Cron Jobs, a debug mock session, and agent-session rebudget integration.
- [ ] `mise exec -- pnpm run test:renderer -- --run` — MemoryListView 25/25 and MemorySettings 11/11 pass; the
  complete suite still has four unrelated Skills/Pinia mock initialization failures.
- [ ] `mise exec -- pnpm run test:main:memory-perf` — non-native collection passes with seven tests and four
  expected native skips; the local binding is intentionally not rebuilt, so native execution is delegated to
  CI.
- [x] `mise exec -- pnpm run format`
- [x] `mise exec -- pnpm run i18n`
- [x] `mise exec -- pnpm run lint`
- [x] `mise exec -- pnpm run format:check`
- [ ] GitHub Actions `memory-native-validation` post-commit gate.

## Hardening Review Completion

- [x] Serialize vector verification and mutation, prevent LRU admission errors, and make incremental import
  rebuild FTS safely.
- [x] Consolidate FTS policy and scope, bound common-term queries, and add indexed archive ranges.
- [x] Preserve projection currency for valid tool-before-message order and select only conflict anomalies.
- [x] Add a bounded passive projection-rebuild cooldown without weakening fallback cursor safety.
- [x] Treat only explicit success/error tool facts as terminal effective Tape evidence.
- [x] Guard management paging for non-DeepChat Agents and align Load more with active versus archived search.
- [x] Address review maintainability findings for shared limits, query-plan assertions, and mirrored tests.
- [x] Make startup activity work proportional to eligible agent count rather than memory-row count.
- [x] Restore server search, coalesce update events, refresh loaded pages atomically, and correct lifecycle UI
  semantics.
- [x] Use Unicode code points for content and excerpts, share one drain supervisor promise, version the exact
  audit-retention index, and remove duplicate/dead abstractions.
- [x] Run targeted main/native/static tests, Memory renderer tests, the scale suite, type checking, linting,
  formatting, and translation checks without weakening assertions.

## Definition of Done

- Every recall, Tape, provider, embedding, maintenance, store, page, content, and audit path has an explicit
  complexity or capacity bound.
- FTS, projection, and DuckDB failure preserve authoritative SQLite and Tape state.
- Correctness, privacy, revision, lease, cancellation, and deadline invariants remain intact.
- Automated and benchmark evidence covers every requirement.
- No unresolved clarification, external document dependency, or GitHub issue side effect remains.
