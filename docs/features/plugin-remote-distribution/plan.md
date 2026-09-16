# Plugin Remote Distribution — Implementation Plan

Tracker for the slices defined in [spec.md](./spec.md). Phase P0 first; P1a/P1b follow in
separate slices once P0 lands.

## P0 — Host foundation

### Slice 1: Shared contracts

- [x] Catalog schema types + zod contract in `src/shared/types/` (artifact entry, target,
      channel, mirrors) with validation helpers
- [x] Plugin routes contract additions: catalog list, install status, install/cancel/retry
      invocations following `src/shared/contracts/routes/plugins.routes.ts` patterns
- [x] Install progress event contract in `src/shared/contracts/events` (bytes, totalBytes,
      phase, error)
- Completion: typecheck passes; contracts reviewed against existing route conventions.

### Slice 2: Catalog loader

- [x] `resources/plugin-catalog.json` skeleton (schemaVersion 1, empty artifacts list)
- [x] Loader in main process: parse + validate against shared contract, resolve current
      platform/arch target, filter by channel (stable builds resolve stable only)
- [x] Dev-only override hook: `DEEPCHAT_PLUGIN_CATALOG` env → alternate catalog path;
      ignored when packaged
- Completion: unit tests cover schema validation, target resolution, channel filtering,
  override behavior (packaged vs dev).

### Slice 3: PluginRemoteInstaller

- [x] Staging layout under plugin install root `.staging/<operationId>/`
- [x] URL attempt ordering: direct (probe) → mirror prefixes; fastest successful probe wins,
      direct URL attempted even when every probe fails
- [x] sha256 + size verification before any move (toolchains `downloadVerifiedFile` reuse)
- [x] Package handoff through `PluginService.installOfficialPluginPackage` (existing
      checksums + trust + install path, no duplication)
- [x] AbortController cancel; retry on transient errors; progress callback; single-flight
      per plugin id
- Completion: unit tests with injected fetch cover download, mirror fallback, sha256
  failure, cancel, single-flight, package-id mismatch.

### Slice 4: PluginService integration + routes

- [x] Wire installer into `PluginService` (composition boundary)
- [x] Route handlers: catalog list merged with installed state; install / cancel
- [x] Progress events emitted through the existing typed event bus
- Completion: typecheck + main tests pass; smoke via dev override pending (covered by unit
  tests until the e2e fixture lands).

### Slice 5: Renderer UX

- [x] `PluginClient` API additions mirroring the new routes + progress subscription
- [x] Plugins catalog page: "Downloadable plugins" section with install/progress/cancel/
      retry states
- [x] i18n strings for all 23 locales (validated)
- Completion: renderer typecheck + i18n validation pass.

### Slice 6: L1 e2e fixture + gates

- [x] L1 chain coverage: catalog override + injected fetch + real `.dcplugin` + real
      `PluginService` install (`test/main/plugin/remoteDistribution.integration.test.ts`);
      OCR chain: fixture payload → installer → resolver identity verification
      (`test/main/ocr/runtimeAssetInstaller.test.ts`)
- [x] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`,
      `pnpm run test:main` (and renderer suite if Slice 5 touched it)
- Completion: all gates green on the feature branch.

## P1a — CUA unbundle (host side landed; release flip pending)

- [x] Enable flow: `plugins.enable` falls back to catalog install (silent download) when the
      plugin is missing locally; catalog page install action enables after install
- [x] Release tooling: `scripts/plugin-catalog.mjs` (generate + verify) with npm scripts
      `plugin:catalog` / `plugin:catalog:verify`; locally verified against fixtures
- [x] `resources/plugin-catalog.json` shipped via electron-builder extraResources
- [ ] Build scripts stop bundling cua `.dcplugin`; CI publishes artifacts to a prerelease
      staging release, then stable — **requires GitHub release publishing (remote); to be
      flipped by the release owner after catalog entries are generated with real URLs**
- [ ] Catalog entry for cua with real artifact URLs + sha256 (generated at release time)
- Completion: staged on prerelease, verified via L2, then promoted. Host-side is complete.

## P1b — LightOCR payload remote (landed)

- [x] Catalog `runtimeAssets` schema (shared types + zod + loader resolution)
- [x] `OcrRuntimeAssetInstaller`: download → sha256 → unzip → structural validation →
      versioned install root; payload layout mirrors the unpacked app root so the resolver
      validates downloaded installs with the same identity checks as bundled ones
- [x] Resolver fallback: bundled root first, then installed roots
      (`installedRuntimeRoots`)
- [x] First-use silent download via `OcrRuntimeInstallCoordinator` (attachment availability
      gate); the triggering turn degrades per the existing unavailable path; 5-minute
      failure cooldown; explicit install resets it
- [x] Settings toggle `ocrRuntimeAutoDownload` (default on) in the settings contract,
      snapshot, and OCR settings UI
- [x] `ocr.installRuntime` / `ocr.cancelRuntimeInstall` routes + `ocr.runtimeInstall.progress`
      event + status extensions (`runtimeInstall`, `runtimeAsset`)
- [x] OCR settings page: runtime download section (install / progress / cancel / retry)
- [x] i18n for all 23 locales
- [x] Build-side packaging: `plugin-catalog.mjs generate` produces the OCR payload zip
      (`runtime/ocr/**` + built helper) and pins its sha256
- [ ] electron-builder stops shipping `runtime/ocr` — **release flip, same gate as P1a;
      the payload continues to ship bundled until the catalog carries real URLs**
- Completion: OCR installs from a downloaded payload on a clean profile (verified via the
  fixture chain test); offline degradation path preserved.
