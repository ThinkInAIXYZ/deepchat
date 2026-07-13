# Tasks: Store Format v2 and Migration

- [x] Format v2 in `memoryVectorStore.ts`: store lives at `<agentId>.v2.duckdb`; drop HNSW
      index creation and `hnsw_enable_experimental_persistence`; keep `format_version = 2` in
      `embedding_meta` as a post-open self-check; remove `LOAD vss` from v2
      create/open/query paths.
- [ ] `publishFreshV2()` — the single publish primitive for every creation path (fresh create,
      quarantine recovery, rebuild, preserve): clean stale staging main + wal → build complete
      v2 at `stagingPath` → verify (schema, `format_version = 2`, embedding identity, and for
      preserve source/target row counts) → `CHECKPOINT`, close, assert `${stagingPath}.wal`
      absent → atomic rename → open final. `initialize()` never runs against `v2Path`.
- [x] Path scheme in `presenter/index.ts` (`memoryVectorDbPath`): v2 / staging / marker /
      legacy-v1 paths; factory port gains `markVectorStoreQuarantined(agentId)` (issue scope
      uses it; path ownership stays in the factory).
- [x] Open decision tree step 0 (marker-last recovery): marker present → destroy all agent
      store files (v2 main+wal, staging main+wal, legacy v1 main+wal) **keeping the marker** →
      `publishFreshV2()` → delete marker last; rebuild via coverage verification.
- [x] Staging cleanup rule: `stagingPath` or `${stagingPath}.wal` present → delete both
      unconditionally (never a commit point) before continuing the decision tree.
- [x] Committed-v2 authority: `v2Path` present → open it; leftover v1 files are swept
      best-effort (failure logs and retries next launch) — never discard a committed v2.
- [ ] Migration (rebuild): v1 store with residual `.wal` → destroy v1 files without opening
      them, `publishFreshV2()`. (Preserve failures do NOT rebuild in-process — they take the
      marker path below and recover at the next launch.)
- [ ] `LegacyV1Reader`: VSS loaded on a neutral in-memory DuckDB connection + read-only
      `ATTACH` of the v1 file; keyset-paged reads of `memory_id, embedding` ordered by
      `memory_id` (bounded JS heap on the read side).
- [ ] Migration (preserve): v1 store without WAL → `LegacyV1Reader` pages rows into
      `publishFreshV2()` (staging build → verify incl. row counts → checkpoint → rename
      commit), then best-effort delete of v1 files; whole step under
      `V1_PRESERVE_TIMEOUT_MS = 60_000`.
- [ ] Preserve failure handling (native error or deadline expiry): write quarantine marker,
      close vector admission for the agent, FTS-only for the process, nothing closed or deleted
      in-process.
- [ ] Preserve abandon fence: per-attempt epoch marked abandoned at deadline expiry; fence
      re-checked after every native await and before every filesystem side effect; abandoned
      attempts may not query/close/checkpoint/rename/delete; late settlements are logged only
      and never resume admission; the original promise stays observed (no unhandled rejection).
- [x] `resetVectorStore` / `destroyFile` target v2 paths and sweep staging and legacy v1 files
      (main + wal each).
- [ ] Unit tests:
  - `publishFreshV2()` builds at staging and renames; `v2Path` never observable in a
    half-built state; `format_version = 2` recorded; a v1 file renamed to `v2Path` fails the
    post-open self-check and routes to rebuild.
  - `query()` returns exact top-k ordering without `LOAD vss`.
  - Marker-last recovery: crash (simulated by aborting) between file sweep and publish leaves
    the marker → next `create()` recovers again; marker deleted only after a healthy v2 exists.
  - v1 without WAL → vectors preserved via staging + atomic rename, v1 files gone, no
    re-embedding requested.
  - v1 with WAL → files destroyed before any open of the suspect data, fresh v2 store, reindex
    triggered via coverage verification.
  - Preserve failure (fake timers for the deadline case): marker written, admission closed, no
    close/delete in the failing process; a same-process warm retry does not process the marker;
    next `create()` in a fresh context sweeps v1 + staging + marker and rebuilds — a preserve
    that keeps failing can never loop across launches.
  - Abandon fence: deadline expires, then the wedged read settles late → no copy, no rename,
    no v1 delete, admission stays closed, late settlement logged; no unhandled rejection.
  - Crash before commit (v1 + staging present) → staging deleted, migration redone from v1.
  - Crash after commit (v2 + v1 both present) → v2 opened as authoritative, v1 swept; a v1
    sweep failure does not discard or re-migrate the committed v2.
  - v2 with residual WAL → opens normally, files untouched.
- [ ] Integration test (real DuckDB + bundled VSS, not mocked SQL): build a genuine WAL-free v1
      HNSW store, run the preserve migration end-to-end, assert keyset paging, row counts,
      `format_version` self-check, and exact query results on the migrated store.
- [ ] Crash-recovery tests: use a child process to simulate unclean shutdown (v2 residual WAL;
      staging main+wal left behind; exit immediately before and after the rename) and assert
      the decision tree recovers on next open. Child processes here are test tooling only — the
      production rejection of child-process migration is unaffected.
- [ ] Windows CI coverage: rename semantics onto the same volume, residual-handle behavior, and
      v1 deletion failure (`EBUSY`) leaving a committed v2 authoritative.
- [ ] Follow-up (separate change, after migration window): remove bundled VSS extension and its
      materialization / network-install machinery; drop `installRuntime:duckdb:vss` from the
      build; v1 handling reduces to destroy + reindex.
