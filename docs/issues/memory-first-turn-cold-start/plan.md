# Memory First-Turn Cold Start Latency Plan

## Strategy

Three independent workstreams. P0-A guarantees first-token latency on its own; P0-B removes the
worst amplifier; P1 raises the chance the first turn also gets semantic recall. Ship P0-A and P0-B
together; P1 can follow.

## P0-A — Hot-path FTS zero-wait (primary, `memoryPresenter`)

Move the DuckDB cold open and the query embedding off the pre-first-token path. Only take the
awaited vector path when the agent's store is already warm; otherwise answer this turn from FTS
and warm in the background.

- **Add a `getDimensions` dep** to `MemoryPresenterDeps` (`types.ts:251-274`, today only
  `getEmbeddings`) and wire it to `llmproviderPresenter.getDimensions` (`presenter/index.ts:575`,
  alongside the existing `getEmbeddings` wiring; `llmProviderPresenter` already exposes it at
  `index.ts:823-827`). This is what lets warm resolve the embedding dimension **without** a query
  embedding — otherwise an implementer will reach for `getEmbeddings([query])` to learn the dim and
  drag the cold-start cost back onto the hot path.
- Track readiness explicitly with the **full cache-key identity**. Add
  `vectorStoreReady: Map<agentId, string>` whose value is exactly
  `vectorStoreCacheKey(agentId, embedding, dim)` = `agentId::providerId::modelId::dim`
  (`index.ts:2377-2383`) — never key on `agentId` alone, or a model/dim switch would read as warm.
  Set it **only** after `openVectorStoreLocked` resolves to a store whose `isUsable()` is true
  (`index.ts:2424-2444`); the existing `vectorStoreIdentities` is set when the open *starts*, so it
  cannot gate readiness, and the unusable-store branch (`index.ts:1703-1711`) must leave ready unset.
- Clear `vectorStoreReady` everywhere the store cache is evicted, so a stale/closed store is never
  treated as warm: in `closeVectorStore` (`index.ts:2408-2409`, the single eviction chokepoint for
  reset paths 611/2222/2244 and the identity-change reopen at 2435), in `dispose`'s
  `.clear()` block (`index.ts:2343-2344`), and in the `openVectorStoreLocked` open-failure catch
  (`index.ts:2437-2438`).
- In `retrieve` (`index.ts:1640-1717`), before the vector block, do a **synchronous** warm check
  (`isVectorStoreWarm(agentId, embedding)` comparing against the full identity):
  - **Warm:** keep today's path — `getEmbeddings([query])` → `getVectorStore` (now a cache hit) →
    `store.query` → `fuse`.
  - **Cold:** skip the query embedding **and** the store open this turn; `void warmVectorStore(...)`
    in the background; fall through with empty `vecMatches` so `fuse` returns FTS-only.
- `warmVectorStore(agentId, embedding)`: resolve `dim` only from a stored `embedding_dim` on a row
  whose `embedding_model === embeddingFingerprint(providerId, modelId)` (`index.ts:114`, the same
  current-identity match `hasStaleEmbeddings` uses, `index.ts:2367-2375`); otherwise fall back to
  the new `getDimensions` dep — **never** a query embedding, and **never** a stale-fingerprint row
  (that would open the old store under the old dim and mark stale vectors warm). Then
  `void getVectorStore(agentId, embedding, dim)`. Coalesce concurrent callers (reuse the in-flight
  open promise; do not stack opens), but keep it **re-runnable across turns** (not one-shot) so it
  self-heals after a reindex.
- **Preserve the reindex triggers the cold path would otherwise skip.** Because cold turns skip the
  query embedding (and thus `hasStaleEmbeddings` at `index.ts:1653`) and the in-line unusable-store
  branch (`index.ts:1703-1711`), `warmVectorStore` must reproduce them after the open resolves:
  - store **not** `isUsable()` → `void reindexEmbeddings(agentId, true)` (mirrors `index.ts:1708`);
    do **not** set `vectorStoreReady`.
  - store usable but `hasStaleEmbeddings(agentId, dim, currentFingerprint)` → `void
    reindexEmbeddings(agentId)` (mirrors `index.ts:1659`); do **not** set `vectorStoreReady`.
  - store usable and not stale → set `vectorStoreReady`.
  Since `isVectorStoreWarm` stays false until ready is set, each cold turn re-schedules warm, so once
  the background reindex finishes the next warm finds a usable, non-stale store and marks it warm —
  the agent self-heals instead of being stuck FTS-only.
- Keep the existing background `backfillEmbeddings`/`reindexEmbeddings` triggers on the warm path
  intact — they already run via `void` behind the per-agent lock; warm simply front-runs the
  `getVectorStore` that `retrieve` used to await.
- Preserve all `canReadAgentMemory`/teardown guards already in `retrieve`.

Net effect: a cold first turn does FTS-only memory injection (fast, no network embed, no DuckDB
open); turn 2+ (or any turn after warm resolves) restores full hybrid recall.

## P0-B — Ship VSS on all platforms + smoke (build/runtime)

- Make `scripts/installVss.js` **platform/arch-aware**: remove the macOS early `return` and accept
  explicit `--platform`/`--arch` flags that select the **target** triple (e.g. `osx_arm64` vs
  `osx_amd64`), version-locked to the current `@duckdb/node-api` package version. Do **not** rely on the host
  machine's architecture — a CI x64 box cross-building `build:mac:arm64` would otherwise bundle the
  wrong extension. (DuckDB `INSTALL` resolves the host platform by default; the script must fetch/
  copy the requested target's binary, mirroring how `installRuntime:*:<arch>` already takes `-a`.)
- Wire the arch-specific install into each build target so `runtime/duckdb/extensions/` is populated
  with the **matching** binary before `electron-builder` packages `./runtime/`
  (`electron-builder.yml:41-43`): `build:mac:arm64` → `--platform darwin --arch arm64`,
  `build:mac:x64` → `--arch x64`, and the corresponding win/linux targets. Do not blanket-insert the
  default `installRuntime:duckdb:vss` (host-arch) into all builds.
- Load bundled VSS by explicit path in `memoryVectorStore.loadVss()`. In packaged builds, a missing
  or invalid bundled extension fails closed so the caller falls back to FTS; network `INSTALL vss`
  remains a dev/test-only fallback with explicit logging.
- On macOS, write the packaged `vss.duckdb_extension` as a base64(gzip) data asset during
  `afterPack` and delete the raw Mach-O before codesign/notarization. Runtime decodes and
  materializes the asset into `app.getPath('userData')` and loads that copy, preserving DuckDB's
  required footer without putting a recognizable executable or gzip archive inside the notarized
  `.app`. Materialization is async and process-coalesced by packaged asset path plus userData root so
  multiple agents share one read/hash/inflate pass per process.
- Extend `scripts/smoke-duckdb-vss.js` to assert the extension loads from either the bundled raw
  path (`LOAD '<path>'`) or a packaged base64 asset (`--extension-base64-path`, materialized to a temp file)
  without a network `INSTALL`, and run it in CI / build preflight.

## P1 — Background prewarm (best-effort, `memoryPresenter` + lifecycle hook)

- Add `warmActiveAgents()` that, for each enabled managed agent, `void warmVectorStore(...)` and
  optionally issues one tiny `getEmbeddings` to warm the provider connection / load a local
  embedding model.
- Trigger earlier than maintenance: a short dedicated startup pass (a few seconds after start) and/or
  on chat session/window open — decoupled from `MAINTENANCE_START_DELAY_MS = 60s` (`index.ts:109`).
  Reuse the staggering shape of `armActiveAgentsStaggered` (`index.ts:296-307`).
- Strictly best-effort: P0-A still guarantees the hot path when the user out-races the warm.

## Follow-up — VSS reliability and cold-store coverage

- Harden `scripts/installVss.js` without changing its public CLI: export import-safe helpers for
  parsing, target resolution, retrying downloads, and validating extension metadata; run the CLI only
  behind an `import.meta.url` main guard.
- Retry VSS downloads up to three times for network failures, HTTP 408/429, and 5xx. Do not retry
  permanent 4xx responses; include DuckDB extension version, target triple, and URL in the failure so
  a version/triple mismatch is diagnosable from CI logs.
- Validate the gunzipped extension footer before writing it into `runtime/duckdb/extensions/`: the
  last 64 KiB must contain `duckdb_signature`, the expected DuckDB extension version, and the expected
  target triple.
- Change the macOS build matrix so x64 uses an Intel runner (`macos-15-intel`) and arm64 uses
  `macos-15`. Keep the existing install + smoke step before `electron-builder`; do not remove the
  package-level build-script install hooks.
- Document the deliberate cold-store FTS-only behavior for secondary callers (`coordinateWrite`,
  `searchMemories`) and add focused tests proving they do not reintroduce cold DuckDB/embedding
  awaits. Keep `mergeNearDuplicates` behavior unchanged in this follow-up.
- Drain `embeddingWarmups` in both global dispose and deleted-agent cleanup, matching
  `vectorStoreWarmups`.

## Remaining low-risk follow-up — Release parity and runtime polish

- Bring `.github/workflows/release.yml` to parity with `build.yml`: run target-arch VSS install and
  `smoke:duckdb:vss` before each `electron-builder` call, and use an Intel runner for macOS x64.
- Fail packaged VSS load closed: a packaged app never performs network `INSTALL vss`; dev/test keeps
  the fallback. Build and release jobs also smoke the packaged `app.asar.unpacked/runtime` copy after
  `electron-builder` so CI proves the shipped asset exists and loads.
- In cold `retrieve`, keep returning FTS-only immediately but also start `warmEmbeddingConnection`
  alongside `warmVectorStore`; both remain fire-and-forget and coalesced.
- Add a 30s cooldown for failed warm dimension resolution when no current embedded row provides a
  dimension. The cooldown is keyed by `agentId::providerId::modelId`; it is cleared after a successful
  dimension resolution and after agent cleanup/dispose.
- Extend `MemoryRepositoryPort` with targeted current-dimension and stale-existence queries, backed
  by SQL `LIMIT 1` / `EXISTS` in `AgentMemoryTable`, and use them instead of scanning every embedded
  row during warm and drain ready checks.
- Let offline duplicate consolidation best-effort await `warmVectorStore` before scanning neighbors;
  failures still fall through to the existing FTS/no-op behavior.
- Rename the current-embedding guard to reflect that it also checks readability/teardown state, and
  document the 3-part warm key vs 4-part vector cache key prefix comparison.

## Compatibility

- No schema/IPC/event changes. Pure main-process timing + build-packaging change.
- Existing on-disk `.duckdb` sidecars and embedding identities are untouched; the warm path opens
  the same files via the same `openVectorStoreLocked`.
- Memory-disabled / no-embedding behavior is unchanged.

## Risks

- **Silent FTS-only forever** if a bundled extension fails to `LOAD` by path or macOS base64 asset
  materialization fails: mitigate by logging and covering both raw and base64 load paths in smoke
  checks.
- **Warm coalescing**: ensure `warmVectorStore` reuses the in-flight open and never opens a second
  DuckDBInstance for the same file (it routes through `getVectorStore` → per-agent lock, which
  already serializes — verify).
- **First-turn recall quality**: FTS-only on a cold turn is a deliberate, documented trade-off.
- **Build-time extension download dependency**: transient outages can fail releases. Retry transient
  failures, but fail permanent 4xx immediately to surface unsupported DuckDB versions or target
  triples.
- **Wrong-arch bundled extension**: cross-arch smoke only checks presence. Validate extension metadata
  offline and run macOS x64 smoke on an Intel runner so the most likely missed target is load-tested.
- **Release/package drift**: release jobs call `electron-builder` directly, so package-level build
  script hooks are not enough. Cover release workflow wiring with tests.
- **Dimension cooldown**: suppresses repeated `getDimensions` calls during outages; FTS recall remains
  available and the cooldown retries automatically.

## Test Strategy

- `test/main` — `retrieve` cold path: with a deliberately slow `createVectorStore`, the first
  `retrieve` resolves quickly, returns FTS-only, **does not call `getEmbeddings([query])`**, awaits
  no store open, and schedules exactly one background warm; mark store ready and assert the next
  `retrieve` uses the vector path.
- `test/main` — `warmVectorStore` opens the store once, sets readiness, and coalesces concurrent
  calls; no second instance for the same agent.
- `test/main` — embedding-model switch self-heal: against an unusable / identity-mismatched store,
  a cold `retrieve` does not block, schedules `reindexEmbeddings(force)`, and leaves the store
  un-warmed (`vectorStoreReady` unset); after the reindex completes, a later `retrieve` restores the
  vector path — i.e. no permanent FTS-only.
- `test/main` — memory-disabled / no-embedding: unchanged (no warm scheduled, FTS path as today).
- Build/smoke — `smoke:duckdb:vss` loads the bundled extension by path on Windows/Linux and loads
  the packaged base64 asset on macOS without network install.
- Scripts — unit-test `installVss` helper parsing, retry classification, no-retry 404 failures, and
  extension footer validation for valid, wrong-version, wrong-triple, and missing-signature cases.
- Memory — unit-test cold `searchMemories`, cold exact-provenance duplicate writes, cold semantic
  neighbor writes, and embedding warmup drain in dispose/deleted-agent cleanup.
- Workflows — assert both build and release workflows install and smoke VSS before packaging, and mac
  x64 release runs on `macos-15-intel`.
- Repository/runtime — unit-test targeted current-dimension and stale-existence queries, dimension
  failure cooldown/retry, cold embedding prewarm coalescing, and consolidation warm-before-merge.
- Quality gates — `pnpm run format && pnpm run i18n && pnpm run lint && pnpm run typecheck`.
