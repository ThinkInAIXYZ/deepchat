# Memory Vector Store Corruption Silently Hangs Message Sending

## Issue

### Summary

With agent memory enabled, every `processMessage` call hangs silently before the provider request
is issued: the user message renders in the UI, no assistant message is created, no error is thrown,
no log line is emitted, and the session stays in `generating` forever. Disabling memory immediately
restores normal sending. The hang survives app restarts.

Root trigger: the per-agent DuckDB vector store (`AgentMemory/<agentId>.duckdb`) is persistently
corrupted. Every startup prewarm hits a DuckDB **INTERNAL Error** from the VSS/HNSW index, which
invalidates the whole DuckDB instance. The memory subsystem neither detects this fatal state nor
bounds the recall vector query with a timeout, so the first recall awaits an operation on the
invalidated instance that never settles.

### Environment

- Observed on: DeepChat 1.0.9 packaged build, Windows (win32 x64), provider `new-api`,
  agent `deepchat` with 344 memories.
- Corrupted store: `%APPDATA%\DeepChat\app_db\AgentMemory\deepchat.duckdb` (main file last
  checkpointed 2026-06-29) plus a residual `deepchat.duckdb.wal` (stuck since 2026-07-06,
  i.e. an unclean shutdown that was never checkpointed afterwards).

### Log evidence (2026-07-13, two consecutive app runs)

Startup prewarm fails identically on every launch, ~10ms after the store opens:

```text
[info]  [MemoryVectorStore] loaded bundled VSS extension: ...\runtime\duckdb\extensions\vss.duckdb_extension
[warn]  [Memory] orphan vector reconcile failed for deepchat: Error: INTERNAL Error:
        Failed to add to the HNSW index: Duplicate keys not allowed in high-level wrappers
```

Message outcomes correlate strictly with the memory toggle, zero exceptions across two runs:

| Time     | Message                          | Memory | `[ProcessStream] start` | Outcome |
| -------- | -------------------------------- | ------ | ----------------------- | ------- |
| 14:14:03 | "网络中断了，请继续完成。"       | on     | never                   | hang    |
| 14:14:47 | "你好。"                         | on     | never                   | hang    |
| 14:16:20 | "你好。" (after restart)         | on     | never                   | hang    |
| 14:19:02 | "你好"                           | off    | +147ms                  | ok      |
| 14:20:00 | "你好啊"                         | off    | +126ms                  | ok      |
| 14:20:35 | "你好啊"                         | on     | never                   | hang    |
| 14:21:39 | "你好啊"                         | on     | never                   | hang    |

Additional confirmation that in-flight memory promises never settle: on quit, presenter teardown
logged `destroy.memoryPresenter.dispose done durationMs=5007.6` — the dispose path waited on the
stuck operations until its 5s cap expired, while every other presenter disposed in milliseconds.

## Location / Root Cause

### Causal chain

1. **Unclean shutdown left a WAL** next to the vector store. duckdb-vss HNSW persistence is
   experimental (we set `hnsw_enable_experimental_persistence = true` in
   `src/main/presenter/memoryPresenter/infra/memoryVectorStore.ts`), and WAL replay / DELETE
   maintenance on HNSW-indexed tables is a known upstream landmine.
2. **Prewarm mutates the HNSW-indexed table.** The warm/verify flow deletes orphan rows from the
   vector table (`verifyVectorCoverage` → `store.deleteByMemoryIds(extras)` in
   `src/main/presenter/memoryPresenter/infra/embeddingPipeline.ts`; the 1.0.9 build logs this as
   "orphan vector reconcile"). With the replayed-WAL index state, usearch throws
   `Duplicate keys not allowed in high-level wrappers`, surfaced by DuckDB as an **INTERNAL
   Error** — an assertion failure that **invalidates the entire DuckDB instance**. Every
   subsequent operation on that instance is in a fatal state.
3. **The corruption is self-perpetuating.** DuckDB only truncates the WAL on a successful
   checkpoint; since every touch of the HNSW index aborts, a checkpoint never succeeds, the WAL
   survives, and the next launch replays it and fails again. Restarting can never heal it.
4. **No fatal-state handling in the memory layer.** The failure is caught and logged as a plain
   warning, but:
   - the invalidated store instance stays cached in `VectorStoreManager.vectorStores` and keeps
     being reused (`src/main/presenter/memoryPresenter/infra/vectorStoreManager.ts`);
   - nothing marks the store unusable (`MemoryVectorStore.isUsable()` only reflects open-time
     metadata checks) and nothing schedules a file reset;
   - in the 1.0.9 build the warm flow still marks the ready certificate, so recall proceeds down
     the vector path against the invalidated instance.
5. **The recall vector query has no deadline.** In
   `src/main/presenter/memoryPresenter/services/retrievalService.ts`, `retrieve()` guards the
   query *embedding* with an 800ms soft timeout, and every provider call has a hard deadline in
   `src/main/presenter/memoryPresenter/infra/providerGateway.ts` — but the store query itself
   (`await this.ports.vectorStore.query(...)`) is unbounded. On the invalidated instance the
   native call never settles, so the await pends forever with no error and no log.
6. **Memory injection sits on the send critical path with no bound.** On current `dev` the
   injection runs through `MemoryRuntimeCoordinator.contribute()`
   (`src/main/agent/deepchat/memory/memoryRuntimeCoordinator.ts`), which awaits
   `memoryPort.buildInjection(...)` unbounded before the assistant message is created and before
   `processStream` starts (the 1.0.9 build had the equivalent code inline in the runtime
   presenter). A pending recall therefore freezes the whole turn: session status stays
   `generating`, queued inputs are never drained, and nothing is written to the log.

### Defense-gap summary

| Await on the recall path                    | Bound today                        | Failure visibility |
| ------------------------------------------- | ---------------------------------- | ------------------ |
| Query embedding (provider HTTP)             | 800ms soft + gateway hard deadline | warn logged        |
| Batch/warm embeddings (provider HTTP)       | 30s gateway hard deadline          | warn/error logged  |
| Lease admission errors                      | fail-fast exception                | warn logged        |
| **Vector store query (DuckDB native)**      | **none**                           | **silent**         |
| **`buildInjection` as a whole (send path)** | **none**                           | **silent**         |

## Fix Plan

Five layers. Layer 4 is the root fix — it removes the corruption class itself by dropping
persistent HNSW in favor of an exact scan (faster and simpler at this scale) with a one-time
store migration. Layers 1–3 are defense in depth so that no memory failure mode — including
unknown future ones — can ever block message sending again: layer 1 detects fatal store errors,
quarantines in-process, and self-heals at the next launch; layers 2–3 bound every await on the
send path. Layer 5 makes any
future pre-stream stall diagnosable from `main.log` alone instead of requiring code archaeology.

### 1. Classify DuckDB fatal errors and quarantine + rebuild the store (self-heal)

New helper in `src/main/presenter/memoryPresenter/infra/memoryVectorStore.ts` (exported for the
manager and pipeline):

```ts
isDuckDbFatalError(error): boolean
// matches: "INTERNAL Error", "FATAL Error", "database has been invalidated",
//          "Failed to add to the HNSW index"
```

**Governing principle: the process that observed the failure never deletes or reopens the
store.** A settled fatal error only proves that *one* call finished; sibling leases may still
have native work wedged on the same invalidated instance, `closeSync` is a synchronous native
call that cannot be bounded by a timeout (a wedge there freezes the event loop), and open
handles make file deletion fail on Windows (`EBUSY`). In-process recovery is therefore
quarantine-only; file-level recovery always happens at the next process start, before any
handle exists.

- `MemoryVectorStore`: wrap `query` / `queryByMemoryId` / `upsert` / `deleteByMemoryIds` /
  `listMemoryIds`; on a fatal error set `usable = false` before rethrowing so every later
  `isUsable()` gate short-circuits. Three existing error paths would break the
  "never touch a fatal instance" rule and must be fixed explicitly:
  - the `upsert` catch currently issues `ROLLBACK` before rethrowing — another native call on a
    possibly-invalidated instance; classify first, and on fatal mark unusable + rethrow
    **without** the rollback;
  - the `create()` catch unconditionally runs `store.close()` (→ `closeSync`); fatal and
    timeout failures during open/migration must bypass this catch-close path;
  - `readEmbeddingMeta()` currently swallows every exception into `null`, which would disguise
    a DuckDB fatal error as an ordinary metadata mismatch — fatal errors must propagate to the
    classifier.
- `VectorStoreManager.withStoreLease`: catch task errors, and on a fatal error quarantine the
  agent's store — `clearReady(agentId)`, transition health to `quarantined`, call
  `markVectorStoreQuarantined(agentId)` (the factory writes `<dbPath>.quarantine`; the manager
  never touches paths), and drop the cached instance from the map **without calling `close`**
  (a deliberate leak until process exit). Recall runs FTS-only until restart; log an error
  saying so.
- Shutdown must exclude quarantined agents entirely — "skip the leaked instance" is not enough:
  `closeAllStores()` also derives agents from `vectorStoreLocks`, runs `drainAndClose()`, and
  awaits lease drain and mutation locks, any of which a wedged lease blocks forever. A
  `quarantined` agent participates in none of that (no drain wait, no agent/mutation lock wait,
  no `closeSync`), so dispose completes within a fixed bound.
- Next process start: presenter startup scans the whole `AgentMemory` directory, including
  markers whose agents were deleted. Marker recovery destroys all agent store files (v2,
  staging, legacy v1) while retaining the marker, deletes the marker as the final destruction
  step, and only then initializes a fresh store when an agent subsequently needs one; the warm
  flow's coverage verification then triggers
  `reindexEmbeddings(force)` to rebuild from the SQLite source of truth. This also covers a
  crash between marker write and restart. The same marker + admission-close path is used when
  the v1 preserve migration fails natively (see the architecture goal's plan) — closing
  admission guarantees the marker is only processed by a later process holding no handles.
- `EmbeddingPipeline.runWarmVectorStore` / `verifyVectorCoverage`: a fatal error follows the
  same quarantine path (not the generic warm-failure path); non-fatal errors keep today's
  behavior.
- Current-store native open/read failures, post-commit open failures, and required recovery
  cleanup failures are also typed terminal recovery failures. They persist or retain the marker
  and close admission rather than entering an unbounded create/lease retry loop. Fatal errors
  never call `closeSync`; non-fatal open failures require a successful close before cleanup.
- Explicit clear and agent deletion use a cleanup preflight. Once a marker is durable they may
  complete logical deletion and report `cleanupPendingRestart`; if marker persistence fails,
  agent deletion is blocked so vector files cannot become permanently ownerless.
- Rejected alternatives: drain-then-reset in-process (wedged leases never drain, and the final
  `closeSync` remains an unboundable sync native call); immediate evict + close/reset (races
  in-flight native work, poisons the per-agent lock chain if `close` wedges, `EBUSY` on
  Windows); generation-suffixed store filenames for same-process recovery without touching old
  handles (works, but permanent path-management complexity for an event that is rare once
  format v2 removes the corruption class — recorded as a future option; distinct from the
  *static* `.v2.duckdb` format-version filename adopted by the architecture goal, which carries
  no runtime generation state).

Rebuild cost is acceptable: memory rows live in SQLite and are untouched; re-embedding 344
memories runs in a handful of 50-item batches under existing 30s gateway deadlines, and recall
degrades to FTS-only in the meantime.

### 2. Bound the recall vector query with a soft timeout

**Ownership: the deadline state machine lives entirely inside `VectorStoreManager`** — the
current `VectorStoreRetrievalPort` has no pause/resume/quarantine surface and the manager does
not know db paths, so spreading the machinery across the retrieval layer would be an interface
gap, not a detail:

- `VectorStoreManager.query` / `queryBatch` enforce the soft deadline internally
  (`RECALL_VECTOR_QUERY_TIMEOUT_MS = 2_000` in
  `src/main/presenter/memoryPresenter/runtimeConstants.ts`) and throw a typed
  `VectorStoreQueryTimeoutError` on expiry; the manager keeps observing the lease promise in
  the background.
- `RetrievalService` only catches the typed error, records a `storeTimeout` degradation cause
  (extend `MemoryRetrievalDegradationCause`), and falls back to FTS-only for the turn — no
  admission control in the retrieval layer.
- Lease state gains an explicit health field — `'healthy' | 'suspect' | 'quarantined'` — rather
  than reusing `accepting`: the existing identity-transition `finally` blocks re-enable
  `accepting`, which could silently resurrect admission after a late settlement.
- Resuming from `suspect` to `healthy` requires all of: still `suspect` (not terminal
  `quarantined`), lease epoch and store generation unchanged, and the embedding identity
  unchanged since the timeout was observed.
- Quarantine needs the store path, which only the factory knows: extend the factory port with
  `markVectorStoreQuarantined(agentId)` (writes the marker; the manager calls it, never touches
  paths itself).

**Post-timeout policy.** Under the layer-1 governing principle the process never resets files
for timeouts either; settled vs. unsettled only determines how the failure is classified: a
settled error can be classified (fatal → quarantine, transient → resume), an unsettled timeout
must first be disambiguated from mere slowness by observing the promise itself.

**Soft + hard deadline observing the same native promise.** The timed-out promise itself is the
ground truth for "slow" vs. "wedged" — never issue a second probe query (statements on a store's
single DuckDB connection execute serially, so a probe behind a wedged call is doomed to time out
too, while piling up unsettled promises and undrainable leases):

- At the 2s soft timeout: the agent's health transitions to `suspect` (new vector leases are
  rejected so no further work stacks on the possibly-wedged connection) and the typed timeout
  error surfaces to retrieval → FTS-only for the turn + `storeTimeout` degradation + warn.
- The manager keeps observing the original promise with a grace deadline
  (`RECALL_VECTOR_QUERY_GRACE_MS = 30_000`, unref'd timer):
  - settles successfully within grace → the store was merely slow (AV scan, cold disk):
    transition back to `healthy` (subject to the resume validation above); the late result is
    discarded. One-off slowness costs one degraded turn, nothing permanent.
  - settles with an error within grace → route through the layer-1 fatal-error classifier
    (fatal → `quarantined`; transient → resume, same validation).
  - still unsettled at the grace deadline → the wedge is real: transition to `quarantined`
    (terminal for the process), call `markVectorStoreQuarantined(agentId)` so the next launch
    rebuilds the store, recall stays FTS-only, log an error stating vector recall is disabled
    until restart (a late settlement after quarantine is logged but never resumes admission).
- Rejected alternatives: immediate evict/reset/reopen (races the in-flight native call and its
  file handles); lock-on-first-timeout (a single AV-induced slow query permanently degrades
  vector recall until restart); a second probe query next turn to confirm the wedge (measures
  the same wedge again through the serialized connection while accumulating unsettled leases).

### 3. Bound memory injection on the send path (last-resort guarantee)

In `MemoryRuntimeCoordinator.contribute()`
(`src/main/agent/deepchat/memory/memoryRuntimeCoordinator.ts`) — the single contributor shared
by the initial prompt, mid-stream refresh, resume, and context-pressure recovery paths, so all
of them are guarded at once:

- Add `MEMORY_INJECTION_TIMEOUT_MS = 3_000` and race `memoryPort.buildInjection(...)` against
  it. On timeout: log
  `[DeepChatAgent] memory injection timed out; sending without memory section` and return the
  base prompt.
- On timeout, the post-injection side effects must **not** run: no access accounting
  (`recordInjectionAccess`) and no tape anchor (`appendTapeAnchor`) for a result that was never
  injected. A late `buildInjection` result is discarded — never appended to a prompt that
  already shipped.
- Invariant after this change: **no state of the memory subsystem can delay a user turn by more
  than the injection deadline.**

### 4. Eradicate the trigger: store format v2 — plain vector table, exact scan, no persistent HNSW

**Decision: remove the ANN index instead of hardening it.** The entire corruption class exists
only because of `hnsw_enable_experimental_persistence` — persisting a custom index whose WAL
replay is unimplemented upstream. At today's scale (344 × 1024-dim) an exact brute-force top-k
over a plain `FLOAT[dim]` column is sub-millisecond — the cost grows as `O(rows × dims)`, and
the escape hatch is measurement-driven — exact rather than approximate, and needs no index
build or maintenance; the existing query SQL already executes as an exact scan once the index
is gone. A one-time v1 → v2 migration preserves existing vectors when the v1 store is
healthy and rebuilds from SQLite when it is suspect (residual WAL) or unreadable.

The store format contract, migration design, and task breakdown are a durable architecture
change and live in
[docs/architecture/memory-vector-store-v2](../../architecture/memory-vector-store-v2/spec.md)
(spec / plan / tasks). This issue depends on that goal and validates it end-to-end (see
Validation below — the affected machine's corrupted v1 store intentionally exercises the
rebuild migration path).

### 5. Pre-stream observability: make a stuck step visible in `main.log`

During this incident the window between `[DeepChatAgent] processMessage` and
`[ProcessStream] start` produced **zero** log lines across five hangs, because
`logSlowPreStreamStep` (`src/main/presenter/agentRuntimePresenter/index.ts`) only logs *after* a
step completes (and only when it exceeded 500ms) — a step that never settles is invisible. Fix:

- Introduce a step-wrapper helper in `agentRuntimePresenter/index.ts` used for every **awaited
  async** pre-stream step in `processMessage` (and the equivalent spots in
  `resumeAssistantMessage` / `retry`): `generation-settings`, `active-skills`,
  `tool-definitions`, `system-prompt`, `compaction-prepare`, `memory-injection`.
  - On completion it keeps the existing `logSlowPreStreamStep` behavior (single warn when
    > 500ms).
  - While pending, an unref'd watchdog timer fires at `PRE_STREAM_STUCK_WARN_MS = 5_000` and
    escalates once at `30_000`, logging
    `[DeepChatAgent] pre-stream step STUCK session=<id> step=<name> elapsedMs=<n>`.
  - Scope honesty: the watchdog is for async steps **without their own deadline**. With layer 3
    in place, `memory-injection` resolves at its 3s deadline before the 5s watchdog can fire —
    a memory stall surfaces as the timeout/degradation log, not as STUCK; STUCK catches the
    steps (and future regressions) that have no deadline of their own.
  - `context-build` (`buildTapeChatView`) is synchronous — a stall there blocks the event loop
    and no timer can fire mid-step. It gets completion-time slow logging only; the watchdog
    makes no real-time claim for synchronous steps.
  - The final segment (last step → provider start) is closed by the existing beforeStream
    boundary hook (`logPreStreamBoundary`), not by `processStream` returning — otherwise every
    normal long generation would be misreported as STUCK.
- Log one info line when memory injection degrades: timeout (layer 3) or recall degradation
  causes, so "memory was skipped or degraded this turn" is visible without enabling
  diagnostics. To make the causes available (and persisted into the tape via the
  `memory/view_assembled` anchor for post-hoc debugging), extend `MemoryInjectionManifest`
  (`src/main/presenter/memoryPresenter/core/injectionPort.ts`) with an optional
  `degradations?: MemoryRetrievalDegradationCause[]` field, propagated by `buildInjection()`
  from the retrieval result — the field does not exist today, so this is an explicit contract
  change, not a read of existing data.
- The memory diagnostics collector (`recordRecall`) only records settled retrievals; with the
  layer-2/3 deadlines every previously-silent stall now settles as a timeout and is therefore
  captured both in diagnostics and in the log.

With this layer, the failure investigated here would have produced, within 3 seconds, the
injection-timeout warn with its degradation cause and a normally-sent message — turning a
multi-hour code-reading session into a single grep. The STUCK watchdog covers whatever the next
unbounded await turns out to be.

## Tasks

- [x] Add `isDuckDbFatalError` classifier + fatal-state tracking (`usable = false`) to
      `memoryVectorStore.ts`; wrap all store operations; fix the three fatal-path holes
      (`upsert` catch must not `ROLLBACK` on fatal, `create()` catch must not `close()` on
      fatal/timeout, `readEmbeddingMeta()` must propagate fatal errors instead of returning
      `null`).
- [x] Quarantine on fatal error in `vectorStoreManager.ts` `withStoreLease`: clearReady, health
      → `quarantined`, `markVectorStoreQuarantined(agentId)` via the extended factory port,
      drop the cached instance without closing it.
- [x] Shutdown exclusion: `closeAllStores()` / dispose skip quarantined agents entirely — no
      `drainAndClose`, no lease-drain / agent-lock / mutation-lock waits, no `closeSync`;
      dispose completes within a fixed bound.
- [x] Marker check at `MemoryVectorStore.create()`: marker present → destroy all agent store
      files, delete marker last within destruction, then fresh store; startup also sweeps
      markers for deleted agents before any vector handle is opened.
- [x] Terminal recovery errors: current/post-commit open and required recovery cleanup failures
      persist marker + close admission once; no same-process file retry. Fatal errors never
      close, while non-fatal failures close safely before cleanup.
- [x] Quarantined clear/delete lifecycle: no drain/lock/native waits, marker durability
      preflight before repository deletion, and public `cleanupPendingRestart` result surfaced
      in Settings UI.
- [ ] Fatal-error handling in `embeddingPipeline.ts` warm/verify flows → same quarantine path
      (no in-process reset).
- [ ] Manager-owned query deadline: `VectorStoreManager.query`/`queryBatch` enforce
      `RECALL_VECTOR_QUERY_TIMEOUT_MS` internally and throw typed
      `VectorStoreQueryTimeoutError`; lease state gains
      `health: 'healthy' | 'suspect' | 'quarantined'` (not reusing `accepting`);
      `RetrievalService` catches the typed error → `storeTimeout` degradation (added to
      `@shared/types/agent-memory`) + FTS fallback.
- [ ] Post-timeout policy in the manager: grace observation
      (`RECALL_VECTOR_QUERY_GRACE_MS = 30_000`) of the same promise; resume requires
      still-suspect + unchanged lease epoch / store generation / embedding identity; grace
      expiry → `quarantined` + `markVectorStoreQuarantined` (never evict/reset in-process).
- [ ] Add `MEMORY_INJECTION_TIMEOUT_MS` deadline race around `buildInjection` in
      `MemoryRuntimeCoordinator.contribute()`; on timeout skip access accounting and tape
      anchor; discard late results.
- [ ] Extend `MemoryInjectionManifest` with optional `degradations` propagated by
      `buildInjection()`.
- [x] Implement store format v2 + one-time migration per
      [docs/architecture/memory-vector-store-v2/tasks.md](../../architecture/memory-vector-store-v2/tasks.md).
- [ ] Pre-stream step wrapper with stuck-step watchdog (`PRE_STREAM_STUCK_WARN_MS`) in
      `agentRuntimePresenter/index.ts`; async awaited steps only; final segment cleared by the
      existing beforeStream boundary hook; sync steps get completion-time slow logs only.
- [ ] Info log when memory injection is skipped/degraded (timeout or recall degradation causes).
- [ ] Unit tests (see Validation).
- [ ] `pnpm run format && pnpm run i18n && pnpm run lint && pnpm run typecheck && pnpm test`.

## Validation

### Unit tests (`test/main/`)

- Classifier: recognizes the observed message shapes (`INTERNAL Error ... HNSW ... Duplicate
  keys`, `database has been invalidated`), rejects ordinary errors.
- Quarantine: a lease task throwing a fatal error → certificate cleared, health `quarantined`,
  `markVectorStoreQuarantined` called, cached instance dropped without `close` being called;
  later `withStoreLease` calls reject.
- Shutdown with a wedged store: a query that never settles + manager shutdown → `closeAllStores`
  completes within a fixed bound, the quarantined agent's leases / agent locks / mutation locks
  are not awaited, and its `close` is never called (assert bounded time, not just "close not
  called").
- Fatal-path holes: `upsert` hitting a fatal error does not issue `ROLLBACK`; a fatal error
  during `create()` does not reach `store.close()`; `readEmbeddingMeta()` rethrows fatal errors
  instead of returning `null`.
- Marker recovery: `MemoryVectorStore.create` with a marker present → store files and marker
  destroyed before any open, marker removed before fresh publication, fresh store initialized,
  coverage verification requests reindex; marker-delete failure publishes nothing. Startup
  also cleans a marker and files for an already-deleted agent.
- Terminal recovery: fatal current open skips close; post-commit open and `EBUSY` while sweeping
  marker/staging/v1-WAL/orphan-current-WAL states each produce one terminal transition and no
  later lease retry.
- Cleanup lifecycle: quarantined clear/delete returns pending restart without awaiting native
  resources; marker failure preserves the agent; shutdown skips wedged quarantined promises and
  locks. Reindex stops before provider/vector work when reset returns pending restart; a committed
  clear still emits its change event and clears cooldown/diagnostics before marker failure is
  propagated; abandoning one shared warmup participant does not cancel or untrack other agents.
- Warm fatal error: `verifyVectorCoverage` throwing a fatal error → quarantine path invoked
  exactly once (no reindex loop in the same process).
- Format v2 + migration test cases are enumerated in
  [docs/architecture/memory-vector-store-v2/tasks.md](../../architecture/memory-vector-store-v2/tasks.md).
- Retrieval timeout: a vector store whose `query` never settles → `retrieve()` returns FTS-only
  results within the deadline, records `storeTimeout` degradation, clears ready.
- Timeout escalation (fake timers, observing one promise): soft timeout → health `suspect`,
  typed `VectorStoreQueryTimeoutError` surfaced, no second query issued; promise settles OK
  within grace → back to `healthy` only when lease epoch / store generation / embedding
  identity are unchanged (a changed epoch or identity blocks the resume); promise settles with
  a fatal error within grace → quarantine path invoked; grace expires unsettled → terminal
  `quarantined`, `markVectorStoreQuarantined` called, and a late settlement does not resume;
  an identity-transition `finally` restoring `accepting` does not resurrect a `suspect` or
  `quarantined` agent; instance never evicted/reset in-process.
- Injection deadline (`test/main/.../memoryRuntimeCoordinator.test.ts`): a
  `memoryPort.buildInjection` that never settles → `contribute()` returns the base prompt
  within the deadline; no access accounting, no tape anchor; a late result is discarded and
  never appended; `processMessage` proceeds to stream (assistant message gets created).
- Stuck-step watchdog: an async pre-stream step pending past `PRE_STREAM_STUCK_WARN_MS` (fake
  timers) → exactly one `pre-stream step STUCK ... step=<name>` warn at 5s and one escalation
  at 30s; no warn when the step settles in time; watchdog cleared on completion, on error, and
  by the beforeStream boundary hook for the final segment.

### Manual validation on the affected Windows machine (no file deletion — intentional)

The corrupted `deepchat.duckdb` + `.wal` are deliberately kept in place to prove self-healing:

1. Build and install the fixed version over the existing install; do **not** touch
   `%APPDATA%\DeepChat\app_db\AgentMemory\`.
2. Launch with memory enabled. Expected startup logs: v1 store with residual WAL detected →
   suspect files destroyed without being opened → fresh v2 store initialized → reindex begins;
   re-embedding proceeds in batches. No `LOAD vss` on the hot path, and no `INTERNAL Error` is
   reachable anymore. (If corruption ever manifests without a WAL, the fatal-error quarantine of
   layer 1 covers it instead.)
3. Send a message immediately (while reindex may still be running). Expected: `[ProcessStream]
   start` appears within normal latency; recall degrades to FTS-only at worst; the turn completes.
   If anything still stalls, the log must now name the step within 5s
   (`pre-stream step STUCK ... step=...`) — absence of both `[ProcessStream] start` and a STUCK
   warn is itself a test failure.
4. After reindex finishes, send a memory-relevant message and confirm vector recall works (memory
   section present, no fatal errors in log).
5. Quit the app. Expected: `destroy.memoryPresenter.dispose` completes in milliseconds, not at
   the 5s cap.
6. Relaunch. Expected: v2 store opens directly (no migration, no VSS load, no `INTERNAL Error`);
   vector recall available immediately after warm.
7. Performance sanity: memory diagnostics recall samples show the vector stage in single-digit
   milliseconds at the current store size (exact scan), no regression vs. the HNSW path.

## Linked Issue

None (not synced to GitHub).
