# Windows ARM64 DuckDB Upgrade Plan

## Planning Summary

The safest first increment is to upgrade DuckDB to a Windows ARM64-capable release and add a narrow CI smoke check for DuckDB + `vss` before launching the Electron app.

This isolates two independent risks:

1. native binding availability on `win32-arm64`
2. `vss` extension install/load compatibility on the upgraded DuckDB release

## Current Repository Constraints

- DeepChat imports DuckDB through `src/main/presenter/knowledgePresenter/database/duckdbPresenter.ts`.
- The main-process startup path reaches built-in knowledge base code early enough that a missing native binding crashes the app before E2E can observe a window.
- DeepChat's DuckDB flow uses both online `INSTALL/LOAD vss` and an offline copied extension path through `scripts/installVss.js` and runtime extension loading.
- Project guidance requires keeping an SDD folder for active issue work and running `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` after implementation.

## Proposed Changes

### 1. Dependency Upgrade

Update `package.json` to `@duckdb/node-api@1.5.3-r.1` and refresh `pnpm-lock.yaml`.

Expected effect:

- pnpm resolves `@duckdb/node-bindings@1.5.3-r.1`
- pnpm resolves `@duckdb/node-bindings-win32-arm64@1.5.3-r.1`
- Windows ARM64 can load the native binding instead of failing during module initialization

### 2. Early Windows ARM64 Verification

Add a dedicated workflow step before build/E2E that runs a repository script to verify:

- `@duckdb/node-api` imports successfully
- `DuckDBInstance.create(':memory:')` works
- `INSTALL vss` succeeds
- `LOAD vss` succeeds
- the script prints the resolved DuckDB package version for diagnostics

This step should fail with a narrow error message instead of allowing the workflow to proceed to a generic Electron launch timeout.

### 3. Reuse Existing VSS Flow

Keep the existing DeepChat runtime logic unchanged unless the upgraded API breaks it:

- `scripts/installVss.js` still performs `INSTALL vss` and copies the installed extension into `runtime/duckdb/extensions`
- `duckdbPresenter.ts` still prefers the bundled extension and falls back to online `INSTALL/LOAD`

This keeps the change focused on compatibility validation rather than behavior redesign.

## Validation Strategy

### Local / Repository Validation

Run:

- a targeted DuckDB/VSS smoke command
- any focused tests touching the changed code or scripts
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`

### CI Validation

The Windows ARM64 workflow itself becomes part of the validation by:

1. installing dependencies for `win32-arm64`
2. running the dedicated DuckDB/VSS smoke check
3. only then building and launching the Electron app

## Risks And Mitigations

### Risk 1: `vss` fails on Windows ARM64 even after the binding upgrade

Mitigation:

- fail in the dedicated verification step with a precise error
- keep a fallback path available for a later issue to disable built-in knowledge base on Windows ARM64 if needed

### Risk 2: DuckDB package upgrade changes API behavior

Mitigation:

- keep changes minimal and avoid refactoring knowledge-base code in the first pass
- use the existing `DuckDBInstance`/`connect`/`run` usage pattern already supported by current code

### Risk 3: Offline extension installation path changes

Mitigation:

- validate `scripts/installVss.js` against the upgraded package
- prefer a dedicated smoke script that exercises the same `INSTALL vss` and `LOAD vss` sequence used by production code
