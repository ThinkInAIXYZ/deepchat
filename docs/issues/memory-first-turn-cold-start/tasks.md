# Memory First-Turn Cold Start Latency Tasks

## P0-A — Hot-path FTS zero-wait
- [x] Add a `getDimensions` port to `MemoryPresenterDeps` (`types.ts:251-274`) and wire it to `llmproviderPresenter.getDimensions` (`presenter/index.ts:575`).
- [x] Add `vectorStoreReady: Map<agentId, string>` keyed by the full `vectorStoreCacheKey` identity (`agentId::providerId::modelId::dim`); set it **only** when `openVectorStoreLocked` resolves to an `isUsable()` store; leave unset on the unusable branch (`index.ts:1703-1711`).
- [x] Clear `vectorStoreReady` wherever the cache is evicted: `closeVectorStore` (`2408-2409`), `dispose` (`2343-2344`), and the `openVectorStoreLocked` open-failure catch (`2437-2438`).
- [x] Add `isVectorStoreWarm(agentId, embedding)` (sync, full-identity compare) and `warmVectorStore(agentId, embedding)` (background, coalesced but re-runnable across turns; dim only from a stored `embedding_dim` row whose `embedding_model === embeddingFingerprint(providerId, modelId)` (`index.ts:114`), else `getDimensions` — **never** a query embedding or a stale-fingerprint row).
- [x] In `warmVectorStore`, reproduce the reindex triggers the cold path skips: store not `isUsable()` → `void reindexEmbeddings(agentId, true)` (`index.ts:1708`), no ready; usable but `hasStaleEmbeddings(...)` → `void reindexEmbeddings(agentId)` (`index.ts:1659`), no ready; usable + not stale → set ready.
- [x] Gate the vector block in `retrieve`: cold → FTS-only this turn + `void warmVectorStore`; warm → existing hybrid path. Preserve teardown guards and background backfill/reindex triggers.
- [x] Tests: cold `retrieve` resolves fast, returns FTS-only, **does not call `getEmbeddings([query])`**, awaits no store open, and schedules exactly one warm; warm `retrieve` uses the vector path; memory-disabled / no-embedding unchanged.
- [x] Test — embedding-model switch: with an unusable/identity-mismatched store, cold `retrieve` does not block, schedules `reindexEmbeddings(force)`, and leaves the store un-warmed; after reindex completes, a later `retrieve` restores the vector path (no permanent FTS-only).

## P0-B — Ship VSS on all platforms + smoke
- [x] Make `scripts/installVss.js` platform/arch-aware: remove the macOS early `return`; accept `--platform`/`--arch` selecting the **target** triple (not host arch), version-locked to `@duckdb/node-api`.
- [x] Invoke the arch-matching install from each build target (`build:mac:arm64` → `--platform darwin --arch arm64`, `build:mac:x64` → `--arch x64`, win/linux equivalents) so `runtime/duckdb/extensions/` is bundled by `electron-builder` (`electron-builder.yml:41-43`). Do not blanket-add host-arch `installRuntime:duckdb:vss` to all builds.
- [x] `memoryVectorStore.loadVss()`: load the bundled extension by explicit path; packaged builds fail closed to FTS when the bundled extension is missing or invalid, while dev/test keeps the logged network `INSTALL vss` fallback.
- [x] Extend `scripts/smoke-duckdb-vss.js` to assert the extension loads via `LOAD '<path>'` from the bundled path with no network `INSTALL`; run in CI / build preflight.

## P1 — Background prewarm
- [x] Add `warmActiveAgents()` (vector store + tiny embedding warm) for enabled managed agents.
- [x] Trigger an early startup warm pass and/or session/window-open warm, decoupled from `MAINTENANCE_START_DELAY_MS`; reuse `armActiveAgentsStaggered` staggering.
- [x] Test: warm pass opens each enabled agent's store once off the hot path; best-effort, no correctness dependency.

## Follow-up — Verified VSS and cold-store coverage
- [x] `scripts/installVss.js`: export import-safe helpers and guard CLI execution so tests can import parsing/download/validation logic without installing.
- [x] Add retry with exponential backoff for network errors, HTTP 408/429, and 5xx; fail permanent 4xx without retry and include version + triple + URL in the error.
- [x] Validate the downloaded extension footer (`duckdb_signature`, expected DuckDB version, expected target triple) before moving it into `runtime/duckdb/extensions/`.
- [x] Update macOS build workflow so x64 VSS smoke runs on `macos-15-intel` and arm64 runs on `macos-15`.
- [x] Add comments/tests for deliberate cold-store FTS-only behavior in `coordinateWrite` and `searchMemories`.
- [x] Drain `embeddingWarmups` during `dispose()` and `cleanupDeletedAgentResources()`.
- [x] Add `test/main/scripts/installVss.test.ts` for retry/no-retry, metadata validation, and argument parsing.
- [x] Add memory presenter tests for cold `searchMemories`, cold exact duplicate writes, cold semantic-neighbor writes, and embedding-warmup teardown.

## Remaining follow-up — Release parity and runtime polish
- [x] Update `.github/workflows/release.yml` to install and smoke-test target VSS extensions before each `electron-builder` call.
- [x] Change macOS release x64 packaging to run on `macos-15-intel`; keep arm64 on `macos-15`.
- [x] Update workflow tests to cover release/build VSS install+smoke and mac Intel runner wiring.
- [x] Cold `retrieve` also starts `warmEmbeddingConnection` without awaiting it.
- [x] Add 30s cooldown for failed warm dimension resolution keyed by `agentId::providerId::modelId`.
- [x] Add repository-level current-dimension and stale-embedding queries and use them in warm/drain ready checks.
- [x] Best-effort await `warmVectorStore` at the start of offline `mergeNearDuplicates`.
- [x] Rename the current-embedding guard and document warm-key/cache-key prefix matching.
- [x] Replace fixed-cycle background memory test flushing with a poll-until-condition helper where waiting for warm/reindex state matters.
- [x] Add/adjust tests for cold embedding prewarm, dimension cooldown, targeted repository queries, and consolidation warm-before-merge.

## CodeRabbit follow-up — Packaged VSS and guardrails
- [x] Document packaged VSS fail-closed behavior; network `INSTALL vss` is dev/test only.
- [x] Packaged `MemoryVectorStore` load fails closed instead of falling back to network install.
- [x] Track prewarm timers per agent and clear pending deleted-agent prewarm callbacks.
- [x] Make current embedding dimension lookup deterministic in SQL and fake repository.
- [x] Add per-attempt VSS download timeout and fail-fast smoke CLI parsing.
- [x] Add post-package VSS smoke checks to build and release workflows.
- [x] Tighten workflow runner assertions and targeted dimension fixtures/tests.
- [x] Close partially opened DuckDB handles when `MemoryVectorStore.create()` fails during open/init.
- [x] Cover same-`created_at` current-dimension tie-breaks in SQL and fake repository tests.
- [x] Align P0-B plan wording and Linux packaged VSS smoke shell configuration.

## macOS packaging follow-up — DuckDB VSS codesign compatibility
- [x] Document that macOS DuckDB VSS requires a footer that fails Apple strict codesign when shipped as a raw Mach-O.
- [x] Document that notarytool recursively scans raw gzip assets and rejects the contained unsigned DuckDB Mach-O.
- [x] Encode the macOS packaged VSS extension as base64(gzip) during `afterPack` and delete the raw extension before codesign/notarization.
- [x] Materialize packaged macOS VSS base64 assets into `userData` before runtime `LOAD`.
- [x] Extend smoke checks and macOS workflows to validate the packaged base64 path.
- [x] Add afterPack, smoke, runtime, and workflow tests for the base64 materialization path.
- [x] Make macOS base64 materialization async and process-coalesced to avoid repeated read/hash/inflate work.
- [x] Re-materialize packaged macOS VSS if a cached `userData` extension path is deleted mid-process.
- [x] Clean up smoke-test temp directories when base64/gzip materialization fails.
- [x] Keep smoke-test temp cleanup best-effort so cleanup errors do not mask original failures.

## Validation
- [ ] Manual: with 100–200 memories, cold-start the app and confirm the first normal text turn streams promptly; repeat with an attachment. Compare `logSlowPreStreamStep('memory-injection')` on the first and later turns and confirm memory injection is no longer the dominant pre-stream step; attachment overhead, if any, should show under `context-build`.
- [x] `pnpm run format && pnpm run i18n && pnpm run lint && pnpm run typecheck`.
- [x] Targeted `test/main` memory suites + `pnpm run smoke:duckdb:vss`.
- [x] Follow-up targeted tests: `test/main/scripts/installVss.test.ts`, `test/main/presenter/memoryPresenter.test.ts`, and `test/main/presenter/pluginPresenter.test.ts`.
- [x] Remaining follow-up targeted tests: `test/main/presenter/memoryPresenter.test.ts`, `test/main/presenter/pluginPresenter.test.ts`, and `test/main/scripts/installVss.test.ts`.
- [x] CodeRabbit follow-up targeted tests: `test/main/presenter/memoryPresenter.test.ts`, `test/main/presenter/memoryVectorStore.test.ts`, `test/main/presenter/pluginPresenter.test.ts`, `test/main/scripts/installVss.test.ts`, and `test/main/presenter/agentMemoryTable.test.ts`.
- [ ] Full `pnpm test -- --run` is not green because of existing renderer failures unrelated to this issue: `ChatTabView.test.ts`, `MemoryConfigPanel.test.ts`, and `NewThreadPage.test.ts`.
