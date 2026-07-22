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

- [ ] Make legacy attachment detection tolerate missing and malformed metadata.
- [ ] Scope CI credentials and launch production/smoke helpers with an environment allowlist.
- [ ] Run packaged offline smoke under OS network isolation with independent target expectations.
- [ ] Verify bundled Node version and executable SHA-256 at install, afterPack and smoke boundaries.
- [ ] Install only bundled Node for the Linux OCR packaging path.
- [ ] Report OCR, Node and other-runtime sizes separately and compare real merge-base/candidate
  installers.
- [ ] Isolate composer drafts, blocked attempts and initial recovery by session.
- [ ] Add submission-scoped attachment-preparation cancellation without stopping generation.
- [ ] Release pending-input claims for every pre-user-fact failure.
- [ ] Translate all OCR attachment and recovery strings in every shipped locale.
- [ ] Run the cumulative review and validation gate, then record actual results below.

## Local Validation Record

Validated on 2026-07-22 with an unsigned macOS arm64 directory build:

- Bundled Node handshake: `v24.14.1`.
- Light OCR facade/core: `0.3.0`; explicit bundle:
  `ppocrv6-small-native-20260719.1`.
- Packaged OCR assets: 113,644,068 bytes unpacked (108.38 MiB); 64,619,492 bytes
  (61.63 MiB) using the smoke script's sum-of-file gzip-9 estimate.
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

Known validation limits:

- The local package is unsigned and unnotarized. Signing, notarization and installer delta were not
  measured.
- The compressed metric is an OCR-asset estimate, not an exact installer-size delta.
- macOS x64, Windows x64 and Linux x64 packaged smoke jobs are configured but have not run remotely
  because this branch was not pushed. Windows arm64 verifies the unsupported/no-assets layout; Linux
  arm64 remains outside the current build matrix.
- The full renderer suite has a pre-existing failure in `App.startup.test.ts`: its `initAppStores`
  mock returns `undefined` while `ChatMainApp` awaits the returned promise. The two files are outside
  this feature diff. All renderer tests changed by this feature pass.
- The first full main-suite run left idle Vitest workers after more than two minutes and was stopped.
  The complete set of main test files changed by this feature then passed deterministically.
