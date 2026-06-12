# Windows ARM64 DuckDB Upgrade Tasks

Feature: `windows-arm64-duckdb-upgrade`
Spec: [spec.md](./spec.md)
Plan: [plan.md](./plan.md)

## Epic E1 Spec And Scope

- [x] `T1.1` Create the SDD issue folder with `spec.md`, `plan.md`, and `tasks.md` for the Windows ARM64 DuckDB startup failure.
  Owner: Maintainer
  Effort: XS
  Status: Completed

## Epic E2 Upgrade And Verification

- [x] `T2.1` Upgrade `@duckdb/node-api` to `1.5.3-r.1` and refresh the lockfile.
  Owner: Maintainer
  Effort: S
  Status: Completed
- [x] `T2.2` Add a dedicated DuckDB/VSS smoke script that verifies import, in-memory startup, `INSTALL vss`, and `LOAD vss`.
  Owner: Maintainer
  Effort: S
  Status: Completed
- [x] `T2.3` Add the dedicated DuckDB/VSS smoke verification to the Windows ARM64 workflow before app smoke tests.
  Owner: Maintainer
  Effort: S
  Status: Completed
- [x] `T2.4` Scope the Windows ARM64 E2E workflow to launch-only Playwright coverage because this platform gate only needs to prove startup viability.
  Owner: Maintainer
  Effort: XS
  Status: Completed

## Epic E3 Validation

- [x] `T3.1` Run targeted validation for the new DuckDB/VSS smoke path.
  Owner: Maintainer
  Effort: S
  Status: Completed
- [x] `T3.2` Run repository-required quality gates: `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
  Owner: Maintainer
  Effort: S
  Status: Completed
- [ ] `T3.3` Re-run Windows ARM64 CI after scoping the E2E workflow to launch-only coverage.
  Owner: Maintainer
  Effort: S
  Status: Pending
