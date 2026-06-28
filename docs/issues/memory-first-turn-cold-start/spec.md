# Memory First-Turn Cold Start Latency

## Problem

With ~100–200 stored memories, the **first chat turn after app start** is very slow: the
user's message is sent but no token streams back for a long time, even though the network is
healthy. Subsequent turns are fine. The stall also reproduces when an attachment is added.

## Root Cause

Memory injection is `await`ed before the first token streams
(`agentRuntimePresenter/index.ts:1005-1014` → `appendMemoryInjection` → `buildInjection` →
`retrieve`). On the first recall of the process, `retrieve` awaits opening the per-agent DuckDB
(VSS) vector store (`memoryPresenter/index.ts:1664` → `memoryVectorStore.ts:62-129`):
`DuckDBInstance.create` + `LOAD/INSTALL vss` + `SET hnsw_enable_experimental_persistence` +
materializing the persisted HNSW index. The opened store is cached in `this.vectorStores`
(`index.ts:2430-2432`), so the cold cost is paid once per process — which is exactly why only
the first turn is slow.

Two amplifiers make the cold open severe rather than merely noticeable:

1. **VSS extension is not bundled, so the first open hits a network `INSTALL vss`.**
   `scripts/installVss.js:11-14` returns early on macOS (`Skipping DuckDB extension
   installation on macOS`); `installRuntime` (package.json:65) and the `build:*` scripts never
   run `installRuntime:duckdb:vss` (package.json:72); `electron-builder.yml:41-43` only copies
   `./runtime/` as-is. So `memoryVectorStore.ts:72-74` falls back to `INSTALL vss; LOAD vss;`,
   downloading the extension binary on the first recall. A failed/slow `LOAD` by path then
   degrades silently to FTS via `retrieve`'s catch (`index.ts:1714`).
2. The persisted HNSW index load grows with corpus size; combined with users only stabilizing
   embedding-recall usage after accumulating memories, this produces the perceived
   "starts after 100–200 memories" correlation. (Note: the vector path is attempted whenever
   `memoryEmbedding` is configured and the query is non-empty, regardless of row count —
   `index.ts:1642-1647` — so row count is an amplifier, not a gate.)

The attachment scenario shares the **same** memory-injection bottleneck (the recall query is
`normalizedInput.text` only, `index.ts:1011`; attachments never enter the memory query or
vector store). The attachment adds a separate, smaller `context-build` cost: prompt
concatenation, token estimation, a larger request body, and a synchronous `fs.readFileSync`
for audio (`contextBuilder.ts:314`). Fixing memory injection improves both scenarios.

## Goal

The first chat turn after app start must stream its first token without blocking on a DuckDB/VSS
cold open or a network `INSTALL vss`, regardless of memory count or attachments, while keeping
recall useful on that turn and restoring full hybrid (FTS + vector) recall on later turns.

## Acceptance Criteria

- **Hot path never blocks on a cold store open.** On a turn where the agent's vector store is
  not yet warm, `retrieve` returns FTS-based recall without awaiting `getVectorStore`/the query
  embedding, and schedules a background warm. First-token latency is bounded even when
  `createVectorStore` is artificially slow.
- **Graceful degrade, not empty.** A cold first turn still returns keyword (FTS) recalled
  memories; persona and working-memory injection are unaffected.
- **Full recall recovers.** After the background warm completes (or on any later turn with a
  warm store), `retrieve` uses the full FTS + vector hybrid path as today.
- **Embedding-model switch still self-heals (no reindex regression).** Skipping the query
  embedding on a cold turn must not skip the existing reindex triggers. After the user changes the
  embedding model/dimension, a cold `retrieve` does not block; the background warm detects the
  unusable / identity-mismatched store and fires `reindexEmbeddings(force)` exactly as the online
  path does today (`index.ts:1659/1708`), without marking the store warm; once reindex completes,
  later turns restore vector recall. No path can leave an agent permanently FTS-only.
- **VSS shipped on all platforms incl. macOS.** Packaged builds contain the matching-version VSS
  extension under `runtime/duckdb/extensions/`; macOS packages store it as a base64(gzip) data asset
  and materialize it into `userData` before `LOAD`, while Windows/Linux packages load the raw bundled
  extension directly. No packaged path performs network `INSTALL vss`.
- **Background prewarm reduces cold turns.** After startup (and/or on session/window open),
  enabled agents' vector stores and embedding connections are warmed off the hot path, decoupled
  from the 60s maintenance delay — but correctness never depends on warm completing first.
- **No behavior change** when memory is disabled or no embedding model is configured.
- **Both reported scenarios improve**; the attachment's residual cost is limited to
  `context-build`, with `memory-injection` no longer dominating the first turn.
- **VSS packaging is reliable and verifiable.** Build-time VSS downloads retry transient network
  failures, fail fast on permanent 4xx errors with the DuckDB version and target triple in the
  message, and validate the downloaded extension footer before it can be bundled.
- **macOS x64 VSS is truly smoke-tested.** CI must run the macOS x64 VSS smoke on an Intel runner
  so that `LOAD '<path>'` executes instead of only checking that the file exists.
- **Cold-store secondary callers are explicit.** Memory writes, maintenance duplicate scans, and
  management search intentionally inherit the cold FTS-only behavior from `retrieve`; tests cover the
  user-visible write/search cases so this does not remain an undocumented semantic change.
- **Embedding prewarm teardown is drained.** `dispose()` and deleted-agent cleanup wait for in-flight
  embedding warmups just like vector warmups, keeping background-task teardown invariants consistent.
- **Release packaging matches CI packaging.** Release workflows must install and smoke-test the
  matching VSS extension before packaging, and macOS x64 release packaging must run on an Intel
  runner so the smoke performs a real `LOAD`.
- **Cold turns also prewarm embedding connections.** A cold vector store still returns FTS-only
  immediately, but it also kicks a best-effort embedding connection warm in the background so the
  next vector turn is less likely to pay provider cold-start cost.
- **Repeated warm dimension failures are throttled.** If an agent has no stored current embedding
  dimension and `getDimensions` fails, subsequent cold turns suppress repeated dimension calls for a
  short cooldown while continuing to answer from FTS.
- **Warm metadata checks are targeted.** Warm/reindex decisions use repository-level dimension and
  stale-existence queries instead of materializing every embedded row.
- **Packaged VSS failures never download at runtime.** In packaged builds, a missing or unloadable
  bundled VSS extension fails the vector store open and recall degrades to FTS; network `INSTALL vss`
  is allowed only in dev/test paths.

## Non-Goals

- Do not redesign the vector store engine, switch vector DB, or change the HNSW parameters.
- Do not change memory extraction, consolidation, forgetting, or persona logic.
- Do not change which memories are semantically recalled — only **when** the vector path engages
  on a cold first turn.
- Do not optimize attachment `context-build` (audio sync read, token estimation) here; track as a
  follow-up if profiling shows it material after the memory fix.

## Decisions

- **macOS uses a base64(gzip) packaged VSS data asset.** DuckDB's macOS extension requires a footer
  (`duckdb_signature` metadata) that makes the Mach-O fail Apple `codesign --strict`
  validation. The footer cannot be removed because DuckDB then refuses to load the extension. A raw
  gzip asset also fails notarization because notarytool recursively expands known archives and scans
  the contained Mach-O. Decision: install and smoke-test macOS VSS before packaging, then write a
  base64(gzip) data asset during `afterPack` and remove the raw Mach-O from the `.app`; at runtime a
  packaged app decodes the asset, materializes the original extension into `userData`, and loads that
  file. If materialization or load fails, vector store open fails closed and recall stays on FTS.
  Network `INSTALL vss` remains a dev/test fallback only.
- **The VSS install script becomes platform/arch-aware** (`--platform`/`--arch`) and is invoked by
  each build target with its matching target triple; cross-builds must never bundle the host
  machine's architecture. See plan P0-B.
- **No checksum pin in this follow-up.** The build-time guard is DuckDB extension footer validation
  (`duckdb_signature`, version, and target triple) plus real load-by-path smoke. `--repository` and
  `DUCKDB_EXTENSION_REPOSITORY` remain available for mirrors and CI.
- **Release workflow parity is required.** Package-level `build:*` VSS install hooks protect local
  and manual builds, but release jobs call `electron-builder` directly and must explicitly run
  install/smoke before packaging.

## Open Questions

None.
