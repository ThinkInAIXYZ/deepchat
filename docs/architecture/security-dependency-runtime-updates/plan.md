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

- [ ] Verify six Node 24.21.0 archives and derive executable integrity metadata.
- [ ] Update Electron, managed Node, development requirements, CI pins, and affected contract tests.
- [ ] Review Electron permission/download/capture behavior and adapt affected callers if necessary.
- [ ] Verify native modules, runtime contracts, full main/renderer tests, build, and Electron smoke.

## Whole-change verification and handoff

- [ ] Review the complete diff for compatibility, security, unrelated drift, and artifact consistency.
- [ ] Run format, i18n, lint, typecheck, final audit, and frozen-install verification.
- [ ] Remove temporary probes/downloads, record verification limitations, and commit remaining work.
- [ ] Report local commit state; do not push or publish without separate authorization.
