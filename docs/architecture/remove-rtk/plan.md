# Execution plan

- [x] Remove command rewriting, startup health checks, runtime discovery, and tool-call metadata.
- [x] Remove dashboard and message UI, retry routes, shared contracts, and unused translations.
- [x] Remove installation and CI integration; exclude stale binaries from packaging.
- [x] Update affected fixtures and maintained documentation; review historical-data compatibility.
- [x] Run focused suites, build/smoke checks where available, format, i18n, lint, and typecheck.
- [x] Review the complete change and record validation limits.

## Validation

- 88 focused main-process suites / 1146 tests and three renderer suites / 125 tests pass.
- Six Electron launch, settings navigation, and dashboard route smoke tests pass with isolated
  fixture profiles. The settings screenshots confirm the usage dashboard without the RTK card.
- Shell regression protection covers unchanged approved command text, one execution even after an
  unsupported-predicate error, shell environment inheritance, and caller override precedence.
- Historical Tape tool results retain their bounded response while retired metadata is omitted.
- Electron Builder's actual file matchers exclude stale RTK from both app files and extra resources,
  while retaining uv and cloudflared. This check uses a temporary probe, not a new abstraction.
- Format, i18n (23 locales), lint, both typechecks, frozen installation, and production build pass.
  Normal build-generated provider and ACP catalog refreshes are retained.
- All six Node archives match official SHASUMS256; executable hashes come from those archives.
  Six uv and five cloudflared assets match release asset digests. macOS cloudflared release-body
  checksums differ from the downloadable attachments; pins use verified attachment hashes.
- Standalone Node 24.22.1 reports ABI 137 / Undici 7.30.1. Existing image, raster PDF, Chinese PDF,
  and helper shutdown smoke assertions pass on CPU and auto/CoreML using the source package layout.
- Electron 43.8.3 reports embedded Node 24.22.0 / Undici 7.29.1 / ABI 148. Updating the standalone
  Node pin does not patch this separate embedded runtime.
- Encrypted SQLite open/write/reopen/read passes under the installed Electron native ABI.

## Limits

Windows, Linux, macOS x64, signed packages, and packaged OCR performance gates require platform CI.
The source-layout CPU smoke sampled about 368 MiB RSS; auto/CoreML sampled about 1047 MiB during
startup. Recognition correctness passed, but this does not establish the packaged memory budget.
Existing selected managed/system/custom toolchains remain selected; new defaults do not silently
upgrade them. Historical RTK preferences and its private database are left inert.
