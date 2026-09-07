# Memory Vector Store Format v2: Plain Table + Exact Scan

## Context

Store format v1 persisted an HNSW index inside each per-agent DuckDB sidecar
(`app_db/AgentMemory/<agentId>.duckdb`) behind `hnsw_enable_experimental_persistence = true`.
Persisting a custom index whose WAL replay is unimplemented upstream (duckdb-vss) created a
whole corruption class: any unclean shutdown could leave a WAL whose replay poisons the HNSW
index (`Duplicate keys not allowed in high-level wrappers` → DuckDB INTERNAL Error → instance
invalidated). The associated message-sending hang was fixed before v2 became the current format;
the issue document has been removed and its regression coverage remains in Memory tests.

## Decision

**Remove the persistent ANN index entirely; query by exact brute-force scan.**

At DeepChat's memory scale the index buys nothing:

- Exact top-k over a plain `FLOAT[dim]` column is `O(rowCount × dimensions)`: at today's scale
  (344 × 1024-dim ≈ 0.7M FLOPs) it is sub-millisecond in DuckDB's vectorized engine, and it
  stays well inside the recall soft deadline for thousands of rows at common dimensions. The
  cost grows linearly with both factors — the escape hatch below is governed by measurement,
  not by a fixed row count.
- Results are exact, not approximate — recall quality strictly improves.
- Zero index build at open, zero index maintenance on upsert/delete, no experimental
  persistence flag, no VSS extension on the hot path.
- The existing query SQL (`ORDER BY array_cosine_distance(...) LIMIT k`) uses core DuckDB
  functions and is unchanged; without an index it executes as an exact scan.

## Store format v2 contract

- **File name is the format discriminator, decided before any native call:** the v2 store lives
  at `<agentId>.v2.duckdb`; the legacy v1 store is `<agentId>.duckdb`. Format detection must
  never require opening a file — opening a v1 file is itself the dangerous act (WAL replay +
  HNSW catalog). A static format-version suffix carries no runtime state; this is distinct from
  (and does not reopen) the rejected generation-suffix scheme for same-process recovery, which
  required unbounded runtime generation management.
- `memory_vector(memory_id VARCHAR PRIMARY KEY, embedding FLOAT[dim])` — plain table, no
  custom index.
- `embedding_meta(provider, model, dim, format_version)` — `format_version = 2` is kept
  in-band as a self-check after open (defends against a v1 file renamed to the v2 path);
  mismatch marks the store unusable and routes to rebuild.
- No `hnsw_enable_experimental_persistence`; no `LOAD vss` for create/open/query of v2 stores.
- Embedding identity rules (provider/model/dim fingerprint, per-agent isolation, cache key)
  are unchanged from v1.
- Crash consistency: a residual `.wal` next to a v2 store is safe — plain-table WAL replay is
  core, battle-tested DuckDB. An unclean shutdown no longer costs a rebuild or re-embed.
- Sidecar files per agent: `<agentId>.v2.duckdb`, `<agentId>.v2.duckdb.wal` (transient),
  `<agentId>.v2.duckdb.quarantine` — a marker written when a runtime failure or a failed
  preserve migration quarantines the store; its presence makes the next process destroy all of
  the agent's store files (v2, staging, legacy v1), remove the marker as the final destruction
  step, and only then publish a fresh store (see plan.md decision tree, step 0); a v1-era process
  never writes this marker — and
  `<agentId>.v2.duckdb.migrating` — migration staging, never a valid store; deleted on sight.
- Commit point: **every** creation path (fresh create, quarantine recovery, rebuild, preserve
  migration) builds at `.migrating` and atomically renames to the final path after verification
  (`publishFreshV2()`, see plan.md); nothing is ever initialized directly at the final path.
  `<agentId>.v2.duckdb` existing always means a committed, authoritative store; its authority
  never depends on post-commit cleanup succeeding.
- Recovery is terminal within the process that encounters an unsafe native or filesystem state.
  It persists the marker, closes vector admission, and falls back to FTS without retrying file
  operations. A later process performs recovery before acquiring any store handle.
- A current WAL without a current main file is an orphan, never a recoverable store. It must be
  removed before fresh publication and checked again immediately before the atomic rename.
- Explicit reset and agent retirement return a cleanup disposition. `pending-restart` means the
  logical operation may complete after a durable quarantine marker is present, while locked
  vector files are intentionally left for the next process.

## VSS extension lifecycle

- This release: the bundled VSS extension is kept **only** for reading v1 stores during
  migration (a v1 catalog contains an HNSW index entry and cannot be opened without the
  extension). Migration never downloads or installs VSS from the network. Missing or
  unmaterializable bundled VSS before a legacy handle is opened selects the safe empty-rebuild
  path; a native `LOAD`, `ATTACH`, or metadata-read failure after native access begins requires
  terminal quarantine.
- Follow-up release: once the migration window has passed, remove the bundled extension and its
  materialization / network-install machinery from `memoryVectorStore.ts` and the runtime
  installer.

## Scale escape hatch (recorded, not built)

If exact-scan cost (`rowCount × dimensions`) ever pushes the measured p95 recall latency toward
the recall soft deadline, build an in-memory ANN index at warm time from the plain table —
**never persist it**. The trigger is those two measurements, not a fixed row threshold (50k
rows at 1024 dims and 12k rows at 4096 dims cost the same). Building one today would pay an
index build on every open for approximate results with no measurable latency win.

## Rejected alternatives

- **Keep persistent HNSW behind more guards** — the upstream WAL-replay bug stays reachable;
  every unclean shutdown risks another full re-embed.
- **In-memory HNSW snapshot now** — pays an index build on every open and approximate recall
  for zero benefit at current scale.
- **Move vectors into SQLite BLOBs and score in JS** — burns main-process CPU and JS heap per
  query; DuckDB keeps the scan in native vectorized code, and the DuckDB runtime ships anyway
  for the knowledge presenter.
