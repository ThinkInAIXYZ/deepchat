# Offline Light OCR Attachment Routing Tasks

Status: implemented; reusable packaging workflow remote validation pending.

- [x] Inspect DeepChat turn, context, queue, remote, persistence, export, settings and packaging paths.
- [x] Verify light-ocr `0.3.0` package matrix, API, bundle identity and bounded/tiled behavior.
- [x] Write feature spec, plan and ordered tasks.
- [x] Pin bundled runtime toolchains from one version source.
- [x] Add standalone helper protocol and `LightOcrProcessHost` with focused tests.
- [x] Bundle and verify offline facade/model/native/helper assets and legal notices.
- [x] Add `OcrRuntimeAssetResolver` and supported-platform availability.
- [x] Add immutable preprocessing, resource limits and adaptive bounded/tiled selection.
- [x] Add encrypted derived `OcrArtifactStore`, singleflight and GC.
- [x] Add shared attachment representation and preparation contracts.
- [x] Persist and materialize exact attachment representations.
- [x] Update synchronous context building, export and search projections.
- [x] Add `AttachmentCapabilityRouter` and main-owned direct/new-thread preflight.
- [x] Add blocked pending-input persistence, dispatch behavior and resolve actions.
- [x] Cover remote, queue, steer, retry and compaction behavior.
- [x] Add per-attachment Auto/Image/OCR actions and preflight UI.
- [x] Add OCR file-processing settings, runtime status and cache controls.
- [x] Add route, lifecycle, renderer, security and packaged integration tests.
- [x] Run protected formatting, i18n validation, lint, typecheck and test suites.
- [x] Run current-platform packaged offline OCR smoke and record size/latency/RSS.
- [x] Perform final cumulative review and update SDD status with verified limitations.

## Light OCR 0.3.4 Upgrade

- [x] Verify the published `0.3.4` facade, unchanged model bundle identity and six-package upstream
  native matrix.
- [x] Enable the published CPU-only Windows arm64 runtime in the existing Windows arm64 artifact
  and require the same network-isolated packaged smoke used by Windows x64.
- [x] Enable the published CPU-only Linux arm64 runtime after DeepChat added a native Linux arm64
  installer and runner in #2006.
- [x] Run the Windows arm64 DeepChat packaged smoke remotely in Build Application run
  `29978292769`.
- [x] Run the Linux arm64 DeepChat packaged smoke and installer-size comparison remotely in Build
  Application run `29978292769`.
- [ ] Run the refactored six-target reusable packaging workflows after this branch is pushed by a
  maintainer.

## Composer Progressive Disclosure

- [x] Add a typed attachment-node context without mixing reactive state into node actions.
- [x] Hide representation controls and badges for ACP while preserving stored draft preferences.
- [x] Make `auto` implicit and expose advanced choices through a hover- and focus-accessible menu.
- [x] Fail open for unresolved capability reads while preserving known OCR state during refresh.
- [x] Prevent new `image` overrides for known non-vision models without rewriting existing intent.
- [x] Reuse the existing vision-model picker action from the attachment menu.
- [x] Add focused renderer regression coverage and run the repository validation gate.

## Merge-blocking Review Hardening

- [x] Make legacy attachment detection tolerate missing and malformed metadata.
- [x] Scope CI credentials and launch production/smoke helpers with an environment allowlist.
- [x] Run packaged offline smoke under OS network isolation with independent target expectations.
- [x] Verify bundled Node version and executable SHA-256 at install and `afterPack`; require exact
  bytes or an application-matching Apple signature for signed macOS smoke artifacts.
- [x] Keep uv/RTK accounting separate from OCR and bind installer comparisons to the committed
  six-target baseline.
- [x] Pin every GitHub-hosted Ubuntu build, release and PR-check job to `ubuntu-24.04` for the
  published Linux native ABI baseline.
- [x] Report OCR, Node and other-runtime sizes separately and compare candidate installers with a
  committed, digest-bearing six-target baseline.
- [x] Isolate composer drafts, blocked attempts and initial recovery by session.
- [x] Add submission-scoped attachment-preparation cancellation without stopping generation.
- [x] Release pending-input claims for every pre-user-fact failure.
- [x] Translate all OCR attachment and recovery strings in every shipped locale.
- [x] Run the cumulative review and validation gate, then record actual results below.

## macOS Distribution Container Hardening

- [x] Preserve app notarization for the updater ZIP and separately finalize the generated DMG.
- [x] Sign the DMG with Developer ID, require a secure timestamp, notarize it and staple its ticket.
- [x] Disable stale DMG update metadata while retaining ZIP update metadata and artifacts.
- [x] Fail the build on invalid DMG checksum, signature, team identity, ticket or Gatekeeper open
  assessment.
- [x] Add focused hook/configuration tests and record local versus CI-only validation limits.

## Initial 0.3.0 Local Validation Record

Validated on 2026-07-22 with an unsigned macOS arm64 directory build:

- Bundled Node handshake: `v24.14.1`.
- Light OCR facade/core: `0.3.0`; explicit bundle:
  `ppocrv6-small-native-20260719.1`.
- Packaged OCR assets: 113,644,068 bytes unpacked (108.38 MiB); 64,619,495 bytes
  (61.63 MiB) using the smoke script's sum-of-file gzip-9 estimate.
- Bundled Node: 131,073,864 bytes unpacked (125.00 MiB); 43,031,537 bytes (41.04 MiB)
  using the same estimate. Existing macOS uv/RTK runtimes are reported separately at 23,555,936
  compressed bytes (22.46 MiB) and are not attributed to OCR.
- The unsigned macOS arm64 zip built from baseline commit
  `2f6852b388e36e568859ee4845916b1d2f8d81f7`, artifact
  `DeepChat-1.1.0-beta.4-mac-arm64.zip`, was 304,780,853 bytes. The candidate artifact with the
  same name, built on the same runner with the same pinned Node/uv/RTK versions, was 373,060,062
  bytes: a 68,279,209 byte (65.12 MiB) increase, below the 90 MiB contract.
- The original frozen size budgets were 90 MiB compressed for OCR assets, 50 MiB compressed for
  bundled Node, zero unexpected runtime bytes on Linux x64, 90 MiB installer growth on macOS and
  Windows, and 115 MiB installer growth on Linux x64. After #2006 made uv/Node/RTK part of both
  official Linux application targets, the current contract measures those runtimes separately,
  caps uv/RTK at 32 MiB compressed, and compares installer roles against a committed baseline. The
  historical same-runner baseline rebuild described here has been removed from CI.
- Auto/CoreML FP16: 2,188.28 ms initialization, 1,777.96 ms cold recognition, 26.61 ms
  warm recognition and 534,921,216 bytes peak helper RSS (510.14 MiB).
- CPU FP32: 606.62 ms initialization, 185.84 ms cold recognition, 182.23 ms warm
  recognition and 371,441,664 bytes peak helper RSS (354.23 MiB).
- A second Auto smoke completed with macOS `sandbox-exec` denying all network access. RSS is
  recorded from the non-sandboxed run because the sandbox also prevents `ps` from reading helper
  process memory.
- Both backends recognized the deterministic fixture and exited cleanly after shutdown. Unit tests
  separately cover host idle reclamation, timeout, cancellation and crash-only restart.
- Manual QA found that changing an attachment representation could retain nested Vue proxies and
  fail before main-process preflight with an Electron structured-clone error. Renderer attachment
  routes now normalize against their route schemas before crossing the bridge, and the portalled
  attachment menu forwards its DOM listeners to the content primitive. Regression tests cover new
  sessions, direct sends, steer, queue, queue updates and the backend selector interaction.
- The final gate rebuilt an unsigned macOS arm64 directory package from the reviewed source. A
  network-denied Auto/CoreML smoke completed with 30,748.48 ms initialization, 1,672.78 ms cold
  recognition and 27.55 ms warm recognition. A second run completed with 558.45 ms initialization,
  1,650.34 ms cold recognition, 27.00 ms warm recognition and 534,708,224 bytes peak helper RSS
  (509.94 MiB). Both runs stayed within the 60-second initialization, 120-second recognition and
  768 MiB RSS contracts, recognized the fixture twice and observed clean helper shutdown.
- The DMG hardening gate built an unsigned local macOS arm64 DMG and updater ZIP from the reviewed
  source. The artifact hook skipped cleanly without release credentials, `hdiutil verify` passed,
  no DMG blockmap was produced, and `latest-mac.yml` contained only the stable ZIP payload and its
  blockmap. Focused script tests cover release credentials, Developer ID/team and secure-timestamp
  enforcement, final DMG notarization/stapling, disk-image verification and Gatekeeper's primary
  signature assessment.
- The DMG hardening focused suite passed 79 script tests, node typecheck, i18n, lint, format check,
  production build and unsigned macOS arm64 packaging. A fresh full main run passed 4,709 tests
  (2 skipped) and retained 9 pre-existing failures in `mainDatabase.test.ts`,
  `schedulerService.test.ts` and `sessionDataMigrations.sqlite.test.ts`; all 9 reproduce when those
  files run in isolation and none imports or executes the changed packaging hooks.
- Final repository gates passed: full main tests (395 files passed, 19 skipped; 4,477 tests passed,
  230 skipped), full typecheck, i18n validation, lint, format check and production build. The full
  renderer run passed 183 files and 1,400 tests; its only failures were the 15 pre-existing
  `App.startup.test.ts` cases documented below.

Known validation limits:

- The local packages are unsigned and unnotarized; signed/notarized installer delta was not
  measured. The recorded zip comparison is an exact unsigned artifact delta, while component
  compressed sizes remain sum-of-file gzip-9 estimates.
- This machine has no Developer ID identity, so the final DMG signature, Apple notary submission,
  stapled outer ticket and `spctl --type open` success remain CI-only checks. Release builds fail
  closed on any of those checks before electron-builder emits the DMG to publishers.
- At the time of this initial record the repository did not track `pnpm-lock.yaml`. The lockfile is
  now committed and every reusable package workflow performs frozen installation before and after
  `install:sharp`.
- During this initial validation, the full renderer suite had a failure in `App.startup.test.ts`:
  its `initAppStores` mock returned `undefined` while `ChatMainApp` awaited the returned promise.
  That historical failure is no longer present; the CI packaging refactor's final validation passed
  the complete renderer suite.
- Build Application run `29978292769` subsequently passed all six native targets and is the source
  of the committed installer baseline. It proves the platform package behavior before the reusable
  workflow refactor; the refactored orchestration and real macOS distribution checks still require
  a maintainer-authorized remote run.

## 0.3.4 Upgrade Validation Record

Validated on 2026-07-23:

- The published facade, model and native packages resolve to exact version `0.3.4`; the model keeps
  bundle identity `ppocrv6-small-native-20260719.1`.
- Upstream release jobs completed real OCR on Windows arm64 and Linux arm64. Both ARM64 runtimes are
  CPU-only; WebGPU remains available only on Windows/Linux x64.
- DeepChat initially enabled only Windows arm64 because Linux arm64 had no application artifact.
  After #2006 added a native `ubuntu-24.04-arm` build and release artifact, Linux arm64 now packages
  the upstream CPU runtime and uses the same network-isolated real-OCR smoke and 90 MiB
  installer-growth gate.
- Using the smoke script's sum-of-file gzip-9 method, the pinned Linux x64 uv/RTK executables total
  27,101,085 bytes (25.85 MiB), while Linux arm64 totals 25,888,702 bytes (24.69 MiB). Both remain
  below the explicit 32 MiB other-runtime component budget.
- The Linux arm64 manifest, asset resolver, runtime service, `afterPack`, runtime installer, direct
  native-layout smoke, package-size comparison and workflow contracts pass the expanded OCR suite:
  154 tests passed and 2 cache tests were skipped across 18 files on macOS.
- A fresh unsigned macOS arm64 directory package completed network-denied real OCR with facade/core
  `0.3.4`: 3,883.36 ms initialization, 1,714.76 ms cold recognition and 26.18 ms warm recognition.
  The helper recognized both fixture runs and exited cleanly after shutdown.
- The focused OCR/package/settings suites passed 141 tests across 17 files. Typecheck, i18n, lint,
  protected formatting, production build and workflow/JSON parsing also passed locally.
- The packaged macOS arm64 OCR component contains 57 files and 90,120,035 unpacked bytes. The
  bundled Node remains `v24.14.1` and 131,073,864 unpacked bytes.
- Build Application run `29978292769` completed both ARM64 jobs and all four other native targets.
  Its six target artifacts and source commit
  `dfb4ba0f34c008c27cfb6bd98a08fdbd36f7b343` now form the committed installer-size baseline.
