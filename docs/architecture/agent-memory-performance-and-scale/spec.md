# Agent Memory Performance and Scale — Specification

> Status: **implemented**
>
> Classification: **architecture**
>
> Local performance gate: **passed**
>
> Post-commit native CI gate: **passed** in PR
> [#1952](https://github.com/ThinkInAIXYZ/deepchat/pull/1952), including Native SQLite storage,
> retrieval evaluation, and the complete performance matrix

This document defines the maintained requirements and acceptance criteria for predictable Agent Memory work
at large per-agent and multi-agent scales.

## Purpose

Agent Memory stores authoritative semantic state in SQLite, derives its extraction input from the
conversation Tape, and uses per-agent DuckDB sidecars for vector search. The implementation already
protects semantic operations with authoritative revalidation, revision compare-and-swap, read epochs,
destructive operation generations, vector-store leases, provider deadlines, and fail-closed privacy
gates. Those correctness mechanisms are baseline invariants, not optional performance costs.

The remaining scale risks were algorithmic amplification and unbounded resource growth in the Electron
main process: non-indexed keyword scans, repeated stale-vector scans, full-session effective Tape views,
per-candidate provider calls, per-row embedding persistence, unbounded maintenance work, and missing
store, list, content, and audit caps.

The target operating envelope is predictable work with 10,000–50,000 memories per agent, 100,000 Tape
entries per session, and 100 configured agents. The goal is not constant latency on every machine; it is
bounded local work, provider work, materialization, and native resource use.

## Goals

- Keep pre-first-token SQLite work index-backed and bounded by candidate limits.
- Make extraction cost proportional to the unconsumed Tape range instead of complete history.
- Bound an eight-candidate extraction to five steady-state provider calls and six under contention.
- Persist embedding batches with batch-level DuckDB and SQLite statements rather than per-row loops.
- Give working memory and maintenance explicit debounce, row, call, token, and concurrency budgets.
- Bound startup warmup, open DuckDB stores, management pages, submitted content, and operational audit
  growth.
- Maintain a deterministic scale suite that enforces complexity, cross-size recall growth, and stable relative
  work reductions without using shared-runner absolute latency as a hard gate.

## Non-Goals

- Changing retrieval scoring, reciprocal-rank fusion, default weights, top-K, or similarity thresholds.
- Introducing an external search or vector service, or adding a runtime dependency.
- Combining per-agent DuckDB files or changing the sidecar file format.
- Weakening authoritative final revalidation, semantic revision checks, destructive cancellation,
  vector leases, provider deadlines, or fail-closed privacy behavior.
- Splitting lifecycle state from embedding state.
- Replacing the Memory Settings information architecture; pagination only bounds browsing while
  `memory.search` remains the full-corpus search path.
- Implementing memory export. A future export path needs independent pagination that includes historical,
  superseded, conflicted, persona, and archived rows; it must not reuse the management-page contract.
- Optimizing real provider network latency. This architecture limits request count, concurrency, queueing,
  and local work.

## Architectural Invariants

1. SQLite `agent_memory` remains authoritative. FTS, Tape projection, and DuckDB vectors are rebuildable
   derived state.
2. Tape remains the evidence source of truth. Projection failure may reduce performance but cannot corrupt
   or replace Tape.
3. Every provider continuation rechecks its operation fence after admission and completion. Destructive
   clear, agent deletion, configuration replacement, and disposal prevent older work from committing.
4. Semantic writes use revision-aware conditional transitions. A stale decision cannot overwrite newer
   content or silently fall through to `ADD`.
5. Recall performs one final agent-scoped authoritative materialization before returning rows.
6. Vector operations run under manager-owned generation leases. Derived-data generation and resource lease
   epoch remain separate concepts.
7. Provider deadlines include rate-limit admission, and every model or embedding request uses the shared
   provider gateway.
8. Performance optimizations fail open only where correctness permits it: FTS may fall back to bounded LIKE,
   projection may fall back to the authoritative Tape view without advancing a cursor, and vector failure
   may fall back to lexical recall.
9. Privacy and stale-write checks remain fail closed.
10. No scale optimization may change the DuckDB format or consume a global SQLite schema migration version
    for rebuildable derived state.

## Requirements

### Conditional Keyword Recall and FTS v4

- FTS metadata uses schema version 4 and records a separate policy version. A predicate, scope encoding, or
  tokenizer change invalidates and rebuilds the derived index.
- FTS contains only recallable rows: `superseded_by IS NULL`, not archived or conflicted, and not persona or
  working memory.
- Authoritative DML and the FTS dirty generation share one outer transaction. Explicit mirror maintenance
  runs inside a nested savepoint; mirror failure rolls back only the savepoint, commits the authoritative
  mutation, and leaves the derived generation dirty.
- Filtered rebuild indexes only recallable rows. It never indexes the complete table and relies on query-time
  filtering afterward.
- Keyword selection is deterministic: code/path terms precede CJK terms, which precede ASCII terms; within a
  class, longer Unicode-code-point terms precede shorter terms, with first occurrence as the final tie-break.
  At most eight terms are retained, then restored to original query order.
- Corpus term-statistics SQL and unbounded keyword-stat caches are absent. BM25 supplies frequency weighting.
- When trigram FTS is available and every selected term is at least three Unicode code points, recall executes
  only a bounded BM25 branch and a bounded importance/created-at supplement using the same MATCH expression.
- When FTS is unavailable, unicode61 is active, or all useful terms are short, recall executes at most one
  agent-scoped bounded LIKE query.
- A recall uses exactly one keyword strategy: `fts-only` or `like-fallback`; it never combines FTS and LIKE.
- MATCH includes a deterministic agent-scope token and content. Scope has zero BM25 weight. Scope policy v2
  uses a fixed 24-bit token to reduce trigram posting intersections, while final `agent_id` revalidation
  prevents cross-agent results even if tokens collide.
- Runtime structural failure marks the mirror dirty and enables a cooled lazy rebuild. Transient busy/locked
  errors affect only the current request. unicode61 stays LIKE-only and does not maintain an unused mirror.
- Incremental import excludes derived FTS metadata and invalidates the target metadata after importing
  authoritative rows. Reopen performs a filtered rebuild.
- `clearByAgent` removes only that agent's mirror rows and cannot disable FTS for other agents.
- Both lexical and importance branches cap their candidate windows before materialization. A common term
  cannot materialize every match for an agent.

### Vector Readiness Certificate

- Ordinary recall never calls `hasStaleEmbeddings`.
- A ready certificate binds agent, provider/model, dimension, configuration generation, and logical
  derived-data generation. Closing and reopening an LRU resource changes only the lease epoch and does not
  invalidate the certificate.
- Startup warm, destructive rebuild, reset, and embedding identity change perform complete verification.
- Verification runs under a per-agent vector-mutation barrier. It pages through current embedded SQLite IDs,
  compares them bidirectionally with DuckDB IDs, removes sidecar extras, and triggers destructive reindex if
  SQLite IDs are missing vectors.
- A certificate is installed only when read epoch, embedding identity, and logical store generation remain
  stable across the complete scan.
- Embedding drain, reconciliation, sidecar mutation, SQLite-ready transition, and certificate verification
  share the mutation barrier. Verification cannot delete a vector written by an in-flight drain before its
  SQLite transition completes.
- A normal embedding drain does not create a missing certificate. A valid certificate remains valid after a
  successful revision-aware dual write.
- Authoritative vector materialization additionally requires an embedded row with the current model
  fingerprint and dimension. Pending rows remain lexically recallable.

### Tape Ingestion Projection

- `deepchat_memory_ingestion_projection` and its metadata are rebuildable derived tables with projection
  version 1 and idempotent creation.
- Each effective message stores session ID, message ID, order sequence, current lineage entry ID, role,
  content, final status, and effective tool-use state.
- The reducer is injected into the lowest-level Tape table. Every append, including anchors, events, tool
  facts, and unrelated rows, advances or invalidates session metadata.
- Tape append and projection update share one SQLite transaction. Reducer failure rolls back its savepoint,
  invalidates the session metadata, and still permits the authoritative Tape append. If invalidation also
  fails, the Tape append rolls back.
- Metadata compares against the previous maximum entry ID for the same session, never a global
  `entry_id - 1` assumption.
- Message revisions use the shared effective-view rank and entry-ID tie-break. Only sent/error messages are
  projected.
- A final tool fact before the sent/error message is a valid runtime order. Only explicit `success` and
  `error` tool statuses are terminal; missing, pending, loading, or unknown statuses cannot set final tool
  use. The final message reconstructs equivalent `had_tool_use`. Retraction and mutations whose equivalence
  cannot be proven mark the projection stale.
- Session delete, clear, fork, truncate, and rewind clean or invalidate projection state transactionally.
- Stale metadata triggers one full authoritative Tape read and one `buildEffectiveTapeView` rebuild, followed
  by transactional projection replacement. The already-built view is reused for the current extraction.
- Rebuild failure uses the authoritative full view for that extraction but sets every cursor commit boundary
  to null.
- A read or rebuild failure places the session in a 30-second passive retry cooldown. During cooldown,
  extraction skips before another full Tape read or provider call. The failure cache holds at most 256
  sessions, clears on success and session lifecycle reset, and never schedules an independent timer.
- Normal extraction reads the requested `(session_id, order_seq)` range in one SQLite statement and does not
  call `getBySession()`.
- Range ordering matches SQLite BINARY semantics: `orderSeq ASC, messageId ASC`. Equal-order fragments form
  one cursor commit group, and no chunk commits that sequence before its final fragment succeeds.
- Reading the last 20 messages of a 100,000-entry Tape materializes only the bounded range.

### Candidate and Decision Batching

- Parsed candidates are normalized and stably deduplicated by `(kind, normalized content)` before recall or
  provider work. First occurrence wins.
- Candidate content is limited to 2,000 Unicode code points. Oversized automatic candidates are rejected with
  a content-free aggregate audit reason and are never silently truncated.
- Decision retrieval performs one bounded keyword query per candidate, one batch query embedding for all
  unresolved candidates, all vector queries inside one lease, and one authoritative `listByIds` for the
  union. Each candidate retains at most three neighbors.
- A decision partition contains at most four candidates, three 400-code-point neighbor excerpts per
  candidate, and 12,000 estimated input tokens. At most two partitions are admitted.
- Budget reduction drops the lowest-priority neighbor excerpt first and never truncates the candidate.
  Candidates that still cannot fit use the initial safe `ADD` fallback without adding a third decision call.
- Batch results align by candidate index. The first duplicate index wins. A missing or invalid initial item
  falls back only that candidate to `ADD`; a batch provider failure falls back only that batch.
- Model-generated merged content above 2,000 Unicode code points is invalid.
- Candidate application is serial and preserves original order.
- Every provider admission and response checks the operation fence. A stale fence stops remaining partitions
  and prevents later external disclosure or writes.
- Final application re-resolves provenance, permanent-forget audit state, owner revision, liveness, pinned
  neighbors, and status inside the transaction boundary.
- The query-vector snapshot binds provider/model, dimension, and configuration generation. Retry never uses a
  vector produced by a different embedding identity.
- Only the first four revision conflicts retry. Retry refreshes provenance, lexical/vector neighbors, and
  authoritative rows while reusing only an identity-compatible candidate embedding, and performs at most one
  additional decision provider call.
- During retry, only an explicit valid `ADD` may create a row. Missing, invalid, stale, or failed retry results
  return `concurrent-update`.
- Provider calls are bounded to five in steady state and six under contention.

### Bulk Embedding Persistence

- A drain processes at most 50 pending rows per batch and continues through the same per-agent supervisor
  until the backlog is empty.
- Pending snapshots include ID and expected revision.
- Each batch performs one provider embedding call and one authoritative `listByIds` revalidation.
- One vector-mutation scope and lease contain one DuckDB transaction with one bulk delete and one
  parameterized multi-values insert.
- SQLite performs at most one revision-aware success update and one revision-aware error update per batch.
  Ready transitions require agent, ID, expected revision, pending state, and liveness.
- CAS misses cannot mark an old vector ready; their sidecar orphans are deleted in the same mutation scope or
  left to bounded reconciliation.
- A provider-wide failure leaves retryable rows pending and does not emit per-row pending-to-pending writes.
  Only malformed individual vectors enter the error batch.
- Concurrent callers share one supervisor promise covering merged follow-up cycles. The implementation does
  not create an unbounded promise chain or fire-and-forget a hidden final cycle.

### Working Memory and Bounded Maintenance

- A domain mutation marks working memory dirty and starts a 100 ms trailing debounce. Twenty synchronous
  mutations for one agent trigger at most one asynchronous refresh.
- A read or injection encountering dirty working memory cancels the timer and synchronously flushes before
  persona/working assembly, while preserving the initial epoch gate and final no-await gate.
- Archive work uses a set-based `UPDATE ... RETURNING` and processes at most 256 rows per pass.
- Eligibility uses current-time age algebra over `COALESCE(last_accessed, created_at)` and importance; it does
  not depend on `pow()`, stale materialized decay, or a lifetime `access_count === 0` veto.
- Reflection and persona use one aggregate plus indexed top-N repository query rather than full-agent
  materialization and JavaScript sorting.
- A maintenance budget permits eight calls and 24,000 estimated input tokens per pass. Step quotas are
  challenge 4, merge 2, reflection 1, and persona 1; quotas are not borrowed.
- Reserving a call consumes it even if gateway admission or the provider fails.
- Heavy steps run challenge, merge, reflection, then persona. Heavy work uses a process-wide fair semaphore
  of two agents and per-agent whole-pass singleflight. Cheap maintenance does not occupy the semaphore.
- Challenge selection uses bounded indexed fairness ordering by
  `COALESCE(last_consolidated_at, 0), created_at, id`. Every selected challenger is stamped after an attempt,
  including normalization, size, budget, gateway, and provider failures.
- Conflict integrity repair selects only actual anomalies, scans at most 256 rows, and uses a constant number
  of set-based statements. Sibling-group size does not increase statement count.
- Maintenance prompt construction performs incremental token preflight before concatenating strings.
- No-change passes do not perform whole-agent decay refresh, consolidation stamps, or other unbounded writes.

### Startup, Native Stores, and Resource Bounds

- Startup obtains enabled, managed, memory-enabled agents first, then performs candidate-scoped indexed latest
  activity lookup and collects at most eight agents.
- Embedding connection warmup is keyed by `provider:model`, with a process-lifetime success set, in-flight
  singleflight map, and five-minute failure cooldown.
- Per-agent vector stores have a soft cap of eight and an idle TTL of 15 minutes. An unref'ed 60-second sweep
  enforces both the cap and TTL.
- Eviction selects a candidate outside locks and rechecks lease count, open-in-flight state, and identity
  inside the agent lock. It never closes normal admission merely to test evictability.
- Busy stores may temporarily exceed the soft cap; lease release triggers immediate convergence.
- Expected lease competition waits or retries and does not clear the logical certificate or mark embeddings
  as failed.
- With 100 agents sharing one embedding model, startup performs at most one provider warmup and opens at most
  eight sidecars.

### Pagination, Content, and Audit Bounds

- `memory.page` is an additive typed route with default and maximum limit 100.
- Management visibility matches the legacy list: superseded, conflicted, persona, and working rows are
  excluded; archived rows remain visible.
- Ordering is `created_at DESC, id DESC`. The repository reads `limit + 1` and emits a cursor only when another
  page exists.
- The opaque cursor is canonical base64url JSON `{v:1,createdAt,id}`. Invalid encoding, version, shape, unsafe
  timestamp, or empty ID produces route validation failure rather than page-one fallback.
- After cursor validation, a non-DeepChat Agent receives an empty page and never reaches the memory
  presenter.
- `memory.list` remains wire-compatible for one compatibility window, is deprecated, and has an architecture
  guard against new production callers.
- Renderer pagination supports replace, append, load-more, ID deduplication, and request-generation rejection
  of stale responses. Agent changes reset pages. Update bursts are coalesced, and refresh atomically reloads
  the previously loaded page depth.
- Dirty editors preserve their local draft even when the refreshed window omits the row. Clean editors close
  only after the complete refreshed loaded window omits the row.
- Non-empty active-memory search continues to use server-side `memory.search` and hides the unrelated
  management-page Load more action. Archived search remains local to loaded management pages, so Load more
  stays available when archived rows are included.
- User add, manual edit, and memory-tool content is limited to 12,000 Unicode code points. Automatic extraction
  and model-generated merged memory are limited to 2,000. Validation exists at route/tool and domain layers.
- Existing oversized rows are not migrated or truncated and remain readable and recallable.
- Operational audit cleanup applies only to `memory/maintenance_llm`, `memory/reflect`, `memory/repair`,
  `memory/conflict_repair`, and `memory/extract`.
- Per agent, cleanup retains the newest 10,000 allowlisted events and deletes at most 500 older events per
  cheap pass.
- `memory/add`, `memory/manual_edit`, `memory/archive`, `memory/forget`, `memory/restore`,
  `memory/challenge_resolved`, every `persona/*` event, and unknown, malformed, or legacy causal rows are
  retained permanently.
- Cleanup classification never uses a blanket `memory_ref_id IS NULL` rule and cannot change
  `hasForgetEvent` results.

### Performance Evidence and CI Gate

- `test:main:memory-perf` uses an independent Vitest configuration and does not run in ordinary `test:main`.
- The deterministic matrix covers memory sizes 1,000, 10,000, and 50,000; Tape sizes 10,000 and 100,000; 100
  agents sharing one model; a 101-row embedding drain proving 50/50/1 batching; and eight candidates with
  three neighbors each.
- Production-path observers record SQLite statements, repository calls, materialized rows, provider calls,
  DuckDB statements, open stores, active leases, and queue/cache high-water marks. Production defaults to no
  observer and has no global observer state.
- CI hard-asserts statement, materialization, provider, store, lease, queue, and cache bounds.
- The recall scale gate uses 11 paired samples with alternating execution order. It requires the FTS median
  growth factor from 10,000 to 50,000 rows to be no more than 65% of the legacy LIKE growth factor and asserts
  that every indexed sample remains on the `fts-only` strategy.
- The 50,000-row FTS/LIKE point ratio is reported but is not a shared-runner gate. The 100,000-entry Tape tail
  median remains required to be no more than 20% of the full-view baseline.
- Absolute targets of 50 ms p95 for 50,000-row recall and 25 ms p95 for a 100,000-entry Tape tail are reported,
  not enforced on shared runners.
- The native CI job rebuilds the Node ABI binding, sets `DEEPCHAT_REQUIRE_NATIVE_SQLITE=1`, and treats a missing
  native binding or skipped performance suite as failure.

## Compatibility and Failure Semantics

- No third-party dependency or DuckDB format change is introduced.
- FTS and projection can be dropped and rebuilt. Their failure falls back to bounded LIKE or the authoritative
  Tape path without corrupting authoritative state.
- Bulk vector persistence does not change the sidecar schema.
- `memory.page` is additive, and `memory.list` remains temporarily wire-compatible.
- Operational audit deletion is intentionally irreversible but applies only to the exact allowlist and is
  protected by retention and forget-event parity tests.
- Existing recall scoring and quality semantics remain unchanged.
- Local package commands use `mise exec -- pnpm`; CI continues to use its configured pnpm toolchain directly.
- No GitHub issue is created or linked.
- Open design questions: none.

## As-Built Performance Evidence

The reference run used Apple M4 Pro/arm64, macOS 26.5.2, Node 24.14.1, and
`DEEPCHAT_REQUIRE_NATIVE_SQLITE=1`. Recall wall-clock values and point ratios are reference data. Complexity
bounds, the recall cross-size growth advantage, and the Tape relative ratio are the portable gates.

| Scenario | Size | New median/p95 | Legacy median/p95 | New/legacy |
| --- | ---: | ---: | ---: | ---: |
| Safe-trigram FTS / bounded LIKE | 1k | 0.699 / 0.731 ms | 0.165 / 0.181 ms | 422.8% |
| Safe-trigram FTS / bounded LIKE | 10k | 1.075 / 1.123 ms | 1.313 / 1.489 ms | 81.9% |
| Safe-trigram FTS / bounded LIKE | 50k | 3.546 / 3.645 ms | 8.428 / 8.567 ms | **42.1%** |
| Tape current-range / full effective view | 10k | 0.058 / 0.060 ms | 12.888 / 14.853 ms | 0.45% |
| Tape current-range / full effective view | 100k | 0.052 / 0.068 ms | 192.222 / 195.931 ms | **0.03%** |

An Ubuntu 22.04 shared runner observed a 95.0% recall point ratio at 50,000 rows while the FTS and LIKE
10,000-to-50,000-row growth factors were 2.67 and 5.45 respectively. The architecture therefore gates the
portable scaling advantage rather than an architecture-sensitive point ratio.

The 1,000-row FTS fixed cost and the 50,000-row FTS/LIKE point ratio are intentionally not shared-runner gates.
The portable recall gate compares the 10,000-to-50,000-row growth factors, while the Tape gate compares the
100,000-entry range and full-view medians. The reference p95 values are below both report-only targets.

Production-path complexity evidence also confirms:

- Safe-trigram recall uses one SQLite query and materializes at most 40 results.
- A current Tape range uses one query and materializes 20 rows.
- A 101-row embedding backlog drains in 50/50/1 provider and persistence batches.
- Eight candidates with three neighbors use triage, extraction, and two decision calls when vector embedding
  is not required.
- One hundred shared-model agents prewarm at most eight stores and one provider connection.
- Common-term recall remains agent-scoped across 100 agents.
- Maintenance uses the intended indexes at 50,000 rows, and a 1,000-sibling conflict transition uses one
  set-based statement.

Targeted main/native tests, the complete main and renderer suites, Memory renderer tests, the reference
performance suite, and type checking pass. PR #1952 also passed the required post-change Native SQLite,
retrieval quality, recall-growth, Tape-scale, and complete performance CI gates without weakening or skipping
their assertions.

## Acceptance

The architecture is accepted when all requirements above remain represented in production code and
regression tests, the growth, relative Tape, and complexity performance gates pass, authoritative data remains
safe under derived-state failure, and the post-commit native CI gate completes successfully.
