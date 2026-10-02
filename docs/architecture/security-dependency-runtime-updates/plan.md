# Execution plan

## Dependency security patches

- [x] Update existing security pins and compatible transitive resolutions.
- [x] Review upstream compatibility against actual consumers; complete necessary source changes.
- [x] Select minimal regression protection for reachable parser failures after implementation.
- [x] Verify audit, frozen install, targeted tests, and static checks; commit this slice.

Dependency validation: frozen install and audit pass (zero known advisories). Seven targeted suites
pass with 121 tests, including two adversarial glob exclusion regressions. Both failed with stack
exhaustion through the bundled glob entry before the `glob/raw` correction. Format, i18n, lint, and
both typechecks pass. An existing vue-router / @pinia/colada peer-range warning is unchanged.

## Runtime security patches

- [x] Verify six Node 24.21.0 archives and derive executable integrity metadata.
- [x] Update Electron, managed Node, development requirements, CI pins, and affected contract tests.
- [x] Review Electron permission/download/capture behavior and adapt affected callers if necessary.
- [x] Verify native modules, runtime contracts, full main/renderer tests, build, and Electron smoke.

Runtime validation on macOS ARM64:

- All six archives match official SHASUMS256 and manifest archive/executable hashes.
- The actual installer succeeds in an isolated directory. Standalone Node reports 24.21.0,
  Undici 7.29.1, and ABI 137. Electron reports 43.7.0, Node 24.21.0, and Undici 7.29.1.
- `pnpm test:main`: 673 files / 9630 tests pass; two files / four tests remain skipped.
- `pnpm test:renderer`: 283 files / 2609 tests pass.
- `pnpm build` passes, including both typechecks and CLI build. Normal provider and ACP registry
  refreshes are retained as required by repository guidance.
- `pnpm e2e:smoke:ci`: all five tests pass with fixture-owned profiles. A temporary additional
  Playwright probe verifies the actual Electron versions and visible v24.21.0 toolchain settings;
  the screenshot was inspected and the probe removed.
- Encrypted SQLite open/write/reopen/read and OpenDAL/DuckDB VSS smoke pass under Electron.
  OpenDAL and DuckDB also pass under standalone Node.
- The built OCR helper passes the existing image, raster PDF, and Chinese PDF smoke assertions,
  including shutdown, with the installed Node 24.21.0 and both auto/CoreML and CPU backends.
  These use the source dependency layout, not a packaged application.

Compatibility review found no required signature migrations in the existing Electron permission,
download, worker, or capture callers. Security checks were not weakened.

## Whole-change verification and handoff

- [x] Review the complete diff for compatibility, security, unrelated drift, and artifact consistency.
- [x] Run format, i18n, lint, typecheck, final audit, and frozen-install verification.
- [x] Remove temporary probes/downloads, record verification limitations, and commit remaining work.
- [x] Report local commit state; do not push or publish without separate authorization.

Final audit: zero known advisories. Frozen installation passes; native dependencies were rebuilt
by the preceding normal installation. Format, i18n, lint, and node/web typechecks pass. All 23 locale
changes are exact runtime-version substitutions; no translation keys changed.

Limitations: Windows/Linux/macOS x64 execution, signed packaged artifacts, and packaged OCR
size/performance gates require the native packaging CI. The first source-layout CoreML run sampled
about 1071 MiB RSS (above the smoke CLI's default 768 MiB budget); a repeat sampled 518 MiB, matching
the old Node 24.18.0 comparison at 519 MiB, while the new CPU backend sampled 362 MiB. This suggests
startup/cache effects but does not establish a cold-start performance guarantee. Do not claim that
the packaged memory gate passed. The existing vue-router/Colada peer warning and build chunk-size
warnings remain outside this security update. No live provider credentials or production data were
used, and no remote branch, PR, release, or Dependabot alert state was changed.
