# Offline Light OCR Attachment Routing Tasks

Status: implementation review hardening in progress; cross-platform packaged validation pending.

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

## Merge-blocking Review Hardening

- [x] Make legacy attachment detection tolerate missing and malformed metadata.
- [x] Scope CI credentials and launch production/smoke helpers with an environment allowlist.
- [x] Run packaged offline smoke under OS network isolation with independent target expectations.
- [x] Verify bundled Node version and executable SHA-256 at install and `afterPack`; require exact
  bytes or an application-matching Apple signature for signed macOS smoke artifacts.
- [x] Install only bundled Node for the Linux OCR packaging path.
- [x] Pin every GitHub-hosted Ubuntu build, release and PR-check job to `ubuntu-24.04` for the
  published Linux native ABI baseline.
- [x] Report OCR, Node and other-runtime sizes separately and compare real merge-base/candidate
  installers.
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

## Local Validation Record

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
- Frozen size budgets are 90 MiB compressed for OCR assets, 50 MiB compressed for bundled Node,
  zero unexpected runtime bytes on Linux x64, 90 MiB installer growth on macOS arm64/x64 and
  Windows x64, and 115 MiB installer growth on Linux x64.
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
- The repository does not track `pnpm-lock.yaml`. Local baseline and candidate dependencies were
  resolved to the same versions immediately before packaging; CI repeats both builds on one runner,
  but registry changes during a job remain a small source of measurement noise.
- Remote run `29907278559` passed both Windows targets. Its macOS arm64 job reached the signed
  packaged smoke and exposed code-signing hash drift; this fix still requires a remote rerun, while
  macOS x64 was cancelled. The independent Linux failure is intentionally outside this fix.
- The full renderer suite has a pre-existing failure in `App.startup.test.ts`: its `initAppStores`
  mock returns `undefined` while `ChatMainApp` awaits the returned promise. The two files are outside
  this feature diff. All renderer tests changed by this feature pass.
- The latest complete main suite passed without idle workers. macOS x64 and the corrected signed
  macOS arm64 smoke remain CI-only validation gaps until a maintainer reruns the workflow.
