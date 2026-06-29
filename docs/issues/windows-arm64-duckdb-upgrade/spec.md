# Windows ARM64 DuckDB Upgrade

## Status

Implemented in current code as of 2026-06-13.

## Goal

Restore Windows ARM64 desktop startup and smoke E2E coverage by upgrading DeepChat's DuckDB Node bindings to a release that ships `win32-arm64` native binaries and preserves built-in knowledge base behavior.

## Background

The Windows ARM64 E2E startup failure was caused by DeepChat loading
`@duckdb/node-api@1.3.2-alpha.25` during boot.

That package version only ships native bindings for:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64`
- `win32-x64`

It does not ship a `win32-arm64` binding, so the app crashed while loading the built-in knowledge
base presenter on Windows ARM64.

DeepChat now depends on `@duckdb/node-api@1.5.4-r.1`. The matching lockfile includes
`@duckdb/node-bindings-win32-arm64@1.5.4-r.1`, and the Windows ARM64 workflow runs
`pnpm run smoke:duckdb:vss` before app launch smoke coverage.

## User Stories

- As a maintainer, I want the Windows ARM64 smoke workflow to launch DeepChat successfully instead of crashing on boot.
- As a maintainer, I want built-in knowledge base support to continue working on supported platforms after the DuckDB upgrade.
- As a maintainer, I want Windows ARM64 CI to verify DuckDB and `vss` availability early so failures are easier to diagnose than a generic Electron launch timeout.

## In Scope

- Upgrade `@duckdb/node-api` to a release that includes Windows ARM64 support
- Refresh the lockfile to pull the matching `@duckdb/node-bindings-win32-arm64` package
- Add a Windows ARM64 CI smoke check that verifies DuckDB can load and `vss` can be installed/loaded before app E2E launch
- Keep DeepChat's built-in knowledge base DuckDB/VSS flow unchanged if the newer release remains compatible

## Acceptance Criteria

- The repository no longer depends on `@duckdb/node-api@1.3.2-alpha.25`.
- The lockfile includes `@duckdb/node-bindings-win32-arm64` for the selected DuckDB version.
- The Windows ARM64 workflow runs a targeted DuckDB/VSS verification step before app smoke tests.
- The targeted verification step proves that a Windows ARM64 runner can:
  - load `@duckdb/node-api`
  - create an in-memory DuckDB instance
  - `INSTALL vss`
  - `LOAD vss`
- Existing built-in knowledge base code paths remain on the DuckDB + `vss` implementation.
- Repository quality gates required by project guidance still pass after the change.

## Non-Goals

- Replacing DuckDB with another vector store
- Redesigning built-in knowledge base UX
- Hiding or disabling knowledge base features on Windows ARM64 in this first attempt
- Reworking unrelated Windows ARM packaging behavior

## Risks And Constraints

- `vss` remains experimental in DuckDB, especially with persistence enabled.
- A DuckDB version upgrade may introduce API or SQL behavior changes even if the package API shape is stable.
- The CI verification step should fail fast and produce clear logs if `INSTALL vss` or `LOAD vss` breaks on Windows ARM64.

## Open Questions

None currently.
