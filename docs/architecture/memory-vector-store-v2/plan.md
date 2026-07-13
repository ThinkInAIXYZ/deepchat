# Plan: Store Format v2 and v1 → v2 Migration

## Scope

The format change centers on
`src/main/presenter/memoryPresenter/infra/memoryVectorStore.ts` behind the
`IMemoryVectorStore` interface, but it is not confined to it: the store path scheme changes in
`src/main/presenter/index.ts` (`memoryVectorDbPath` → v2/staging/marker paths), the factory
port (`ports.ts`) gains `markVectorStoreQuarantined(agentId)` for the linked issue's quarantine
flow. The dependency is required in production composition; only test adapters may provide an
explicit no-op. A `LegacyV1Reader` component is added for migration. `VectorStoreManager` /
`EmbeddingPipeline` / `RetrievalService` hardening belongs to the linked issue.

## Format v2 creation and open

- `initialize()`: create the plain `memory_vector` table only — drop the
  `CREATE INDEX ... USING HNSW` statement and the experimental-persistence `SET`; write
  `format_version = 2` into `embedding_meta`. It only ever runs against `stagingPath` inside
  `publishFreshV2()` — never against the final path.
- `open()`: read `embedding_meta`; a `format_version = 2` row with matching
  provider/model/dim opens directly (no VSS load). Identity mismatch handling is unchanged
  from v1 (store marked unusable, reindex path takes over).
- `query()` / `queryByMemoryId()` / `upsert()` / `deleteByMemoryIds()` / `listMemoryIds()`:
  SQL unchanged; verify by test that they run without `LOAD vss`.

## v1 → v2 migration (one-time, on open)

Paths: `v2Path = <agentId>.v2.duckdb`, `v1Path = <agentId>.duckdb`,
`stagingPath = <agentId>.v2.duckdb.migrating`. Format is decided purely from filesystem
presence — no file is opened to find out what it is.

**Commit point: the atomic rename of `stagingPath` to `v2Path` — for every creation path.**
Nothing is ever written to the final path directly; `v2Path` existing therefore always means a
committed, authoritative store — its authority never depends on whether cleanup afterward
succeeded (a delete is an operation that can fail; a same-directory rename to a non-existent
target is atomic on both Windows and POSIX).

All paths that produce a v2 store — fresh create, quarantine recovery, v1-with-WAL rebuild, and
preserve migration — publish through a single `publishFreshV2()` primitive; none may call
`initialize()` against the final path (a crash mid-initialize would otherwise leave a
half-built file at `v2Path`, violating the invariant):

1. delete any stale `stagingPath` and `${stagingPath}.wal`;
2. build the complete v2 store at `stagingPath` (schema, `format_version`, embedding identity;
   plus copied rows for the preserve path);
3. verify: schema present, `format_version = 2`, embedding identity matches, and for preserve —
   source/target row counts match;
4. `CHECKPOINT`, close, and assert `${stagingPath}.wal` is absent;
5. atomic rename `stagingPath` → `v2Path`;
6. open and validate the final store. Rename remains the commit point: if this final open fails,
   keep the committed current file, persist quarantine, and leave recovery to the next process.

Decision tree at `MemoryVectorStore.create()`:

0. **Quarantine marker present (`<v2Path>.quarantine`)** → recover in two phases before any
   handle is acquired. First destroy **all** of the agent's store files (v2 main + wal, staging
   main + wal, legacy v1 main + wal) while keeping the marker, then delete the marker as the
   final destruction step. Only after marker deletion succeeds may normal fresh publication
   start. A marker deletion failure therefore publishes nothing and keeps admission closed;
   it cannot repeatedly destroy a newly re-embedded healthy store. Rebuild of embeddings
   follows via coverage verification. The marker is written by
   the quarantine paths of the linked issue (settled fatal error, a vector query that never
   settled within grace) and by a failed preserve migration (below); the process that wrote it
   never deletes or reopens store files itself — it also closes vector admission for the agent,
   which guarantees the marker is only ever processed by a *later* process holding no handles.
   Sweeping v1 here is what makes an unsafe native preserve failure one-shot. On presenter
   startup, scan the whole `AgentMemory` directory for markers and apply the same files-first,
   marker-last destruction even when the owning agent has already been deleted.
1. **`stagingPath` (or `${stagingPath}.wal`) present** → always torn (staging is never a
   commit point): delete both unconditionally and continue. If recovery deletion fails, persist
   or retain the marker, terminate vector admission for this process, and do not retry on later
   leases.
2. **`v2Path` exists** → committed and authoritative — open it (safe even with a residual
   `.wal`); verify the in-band `format_version = 2` and embedding identity (mismatch →
   unusable → rebuild path). If v1 files are still present they are leftovers from a failed
   post-commit deletion: sweep them best-effort (failure only logs; re-swept next launch) —
   never discard the committed v2. Structural metadata mismatch is unusable and routes to a
   rebuild. Native open/read failure is terminal for this process: do not touch a fatal
   instance; for other open failures attempt a safe close, persist a marker, and defer recovery.
   If `v2Path` is absent but `${v2Path}.wal` exists, remove the orphan WAL before continuing;
   inability to remove it is terminal recovery, not a lease-level retry.
3. **Only `v1Path` exists** → migrate:
   - v1 with a residual `.wal` → do not open it at all (replaying a suspect HNSW WAL is the
     corruption trigger): `destroyFile` the v1 files, publish a fresh empty v2 via
     `publishFreshV2()`. The warm flow's coverage verification (`verifyVectorCoverage`) sees
     rows marked embedded in SQLite with no vector present and triggers
     `reindexEmbeddings(force)` — rebuild from the SQLite source of truth.
   - v1 without a WAL → prepare the bundled VSS extension without binding the shared
     materialization promise to any caller's abandon fence. Migration never runs network
     `INSTALL vss`. If the bundled extension is unavailable before legacy native access, safely
     delete v1 and publish an empty v2. Otherwise a dedicated `LegacyV1Reader` loads it on a
     neutral in-memory connection and read-only `ATTACH`es the v1 file (keeping VSS and legacy
     access entirely out of the v2 hot path). Before copying, read exactly one valid legacy
     `embedding_meta(provider, model, dim)` row. Only an exact identity match may be preserved;
     missing, duplicate, malformed, or mismatched metadata safely rebuilds empty without
     quarantine. Native `LOAD`, `ATTACH`, or metadata-read failures remain terminal. Then read
     `memory_id, embedding` in keyset-paged batches ordered by `memory_id` — paging bounds the
     JS heap on the read side, not just the write side. Rows flow into `publishFreshV2()`
     (staging build → verify incl. source/target row counts → checkpoint → rename commit),
     then the v1 files are deleted best-effort. Zero re-embedding cost; v1 stays intact until
     commit. The copy uses one transaction for all pages and INSERT-only population. The
     preserve step has a 60-second **no-progress** deadline, refreshed after each successful
     native await and page insertion, so a single native hang is bounded without penalizing a
     large migration that continues making progress.
   - **Any native failure after legacy native access begins — error or no-progress deadline
     expiry — follows the issue's governing principle**: write the quarantine marker, close
     vector admission for the agent for the remainder of the process, recall runs FTS-only,
     and nothing is closed or deleted
     in-process (a wedged open/read still holds v1 handles; `closeSync` after a fatal error is
     an unboundable sync native call). The leaked instance dies with the process; the next
     launch hits step 0, sweeps everything, and rebuilds from SQLite. Preserve is an
     optimization over the always-correct rebuild path — once native legacy access is unsafe,
     fall back permanently rather than classify-and-retry (a transient failure costs one
     re-embed; a misclassified "safe" recovery can freeze the app).
   - **Abandon fence — a deadline expiry must also stop the still-running flow.** Racing a
     deadline returns control to the caller but does not cancel the in-flight async migration;
     without a fence the original flow could resume at 70s and copy/checkpoint/rename/delete —
     a quarantined process committing a store, violating the governing principle (and racing a
     quickly-restarted next process doing marker recovery). Each migration attempt carries an
     epoch/fence: deadline expiry marks the attempt *abandoned*; the flow re-checks the fence
     after every native await and before every filesystem side effect; once abandoned it may
     not query, close, checkpoint, rename, or delete — a late settlement (success or failure)
     is logged only and never resumes admission. The original promise stays observed to the end
     so a late rejection cannot become an unhandled rejection.
4. **Neither exists** → publish a fresh empty v2 via `publishFreshV2()`. Immediately before
   rename, assert the current main is still absent and remove any newly appeared orphan current
   WAL; a failure becomes terminal recovery while preserving the original initialization cause.

Crash semantics are fully deterministic: a crash before the rename leaves v1 (if any) intact
plus staging garbage — main and/or `${stagingPath}.wal` — which step 1 cleans and step 3/4
redoes; a crash after the rename leaves an authoritative v2 plus v1 leftovers (step 2 sweeps).
No path ever discards a committed v2, and no path can leave a half-built file at `v2Path`.

All paths converge on a healthy v2 store; the only difference is whether embeddings were
preserved or recomputed. `resetVectorStore` / `destroyFile` target the v2 paths and also sweep
staging and legacy v1 files if present. Manager state has a single
`health: 'healthy' | 'quarantined'`; `accepting` is only a temporary admission gate. Reset and
retirement return `completed` or `pending-restart`. A quarantined agent is never drained,
closed, deleted, or awaited in-process; once its marker is durable, clear/delete may finish
their logical work and report `cleanupPendingRestart = true`. Agent deletion performs this
cleanup preflight before repository deletion, and a marker persistence failure aborts deletion.
Reindex treats `pending-restart` as terminal for the current process: requeued SQLite rows remain
pending for the next launch, while provider drain and vector-store warmup do not run. If clear has
already committed its SQLite deletion before marker persistence fails, it still publishes the
change event and clears consolidation cooldown and diagnostics before propagating the marker
error. Abandoning one agent removes only that agent's membership from a shared embedding warmup;
the shared promise and other agents remain tracked.

## Recovery alternatives rejected for suspect v1 stores and failed migrations

- In-process `CHECKPOINT` repair: replays the HNSW WAL natively in the main process and can
  wedge instead of erroring (unbounded native call).
- Out-of-process repair or migration (killable child): the strongest isolation for touching v1
  files, but the cross-platform packaging and orchestration of a native-module child process is
  unjustified for a rare one-shot path that has a safe fallback (rebuild).
- Classify-and-recover in-process for "clearly non-fatal" preserve failures: re-opens the
  per-error-type safety analysis the governing principle exists to close; every new error type
  would need a fresh proof that `closeSync` and file deletion are safe.

## Rollout

Ships together with the fail-open hardening in
[docs/issues/memory-vector-store-corruption-hang](../../issues/memory-vector-store-corruption-hang/spec.md);
that issue's validation section covers the end-to-end verification, including the intentionally
preserved corrupted v1 store on the affected Windows machine (exercises migration path 1).
