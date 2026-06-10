# Agent FFF Node API Search Tasks

## Spec And Design

- [x] Create SDD folder under `docs/architecture/agent-fff-node-api-search/`.
- [x] Define FFF-only search behavior and JSON result shape.
- [x] Document `glob` and `grep` tool schemas.
- [x] Document search order: `glob -> grep -> read`.
- [x] Revise design to remove ripgrep fallback and bundled ripgrep injection.

## FFF Service

- [x] Add `@ff-labs/fff-node` dependency.
- [x] Implement `FffSearchService.findFiles()`.
- [x] Implement `FffSearchService.grep()`.
- [x] Support regex-like `grep` queries and hydrate full snippets from disk.
- [x] Implement `FffSearchService.globFiles()` for workspace file picker search.
- [x] Cache `FileFinder` instances by workspace root.
- [x] Support abort during initial scan wait and search calls.
- [x] Return stable JSON-safe fields: `path`, `lineNumber`, `snippet`, `score`.

## Agent Tool Integration

- [x] Add `AgentFffSearchHandler`.
- [x] Validate tool arguments with zod.
- [x] Enforce path-scope read permissions.
- [x] Register `glob` and `grep` in `AgentToolManager`.
- [x] Return visible JSON content plus raw `source: "fff"` metadata.
- [x] Map legacy skill/search names to FFF tool names.
- [x] Clean legacy persisted disabled-tool `grep` values without blocking new `grep` updates.

## Prompt Updates

- [x] Add FFF search guidance to agent filesystem prompt.
- [x] Remove positive `rg`, shell `grep`, `find`, `fd`, and `ls` search recommendations.
- [x] Tell the model not to use shell commands for code search.
- [x] Update default system prompt search guidance.

## Ripgrep Removal

- [x] Delete `FffRipgrepFallback`.
- [x] Delete `runRipgrepSearch` from the legacy filesystem handler.
- [x] Remove ripgrep discovery from `RuntimeHelper`.
- [x] Remove ripgrep from bundled runtime PATH injection.
- [x] Remove `rg` replacement from `replaceWithRuntimeCommand`.
- [x] Remove `tiny-runtime-injector --type ripgrep` from runtime install scripts.
- [x] Delete workspace `ripgrepSearcher.ts`.
- [x] Replace workspace file search with FFF glob search.

## Tests

- [x] Add FFF service unit tests for file, grep, glob, timeout, and abort behavior.
- [x] Add FFF handler tests for JSON output, unavailable error, validation, and permissions.
- [x] Add tool manager tests for `glob` and `grep`.
- [x] Add prompt/tool-name mapping tests.
- [x] Add workspace file search test for FFF glob and default excludes.
- [x] Update runtime helper tests after ripgrep removal.
- [x] Add build config test for FFF native dependency ASAR unpacking.

## Packaging

- [x] Check whether FFF native dependencies affect macOS signing/package loading.
- [x] Unpack `@ff-labs/fff-node`, `@ff-labs/fff-bin-*`, `ffi-rs`, and `@yuuang/ffi-rs-*` for
  packaged app loading and macOS codesign visibility.
- [x] Copy target `@ff-labs/fff-bin-*` package during `afterPack` when electron-builder misses the
  transitive optional dependency under pnpm.
- [x] Verify an unpacked macOS package contains FFF native files under `app.asar.unpacked`.
- [x] Cover both darwin arm64 and x64 FFF native package copying in `afterPack` tests.

## Validation

- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run focused main tests listed in `plan.md`.
- [x] Run or document full `pnpm test` status: full suite currently fails with existing
  unrelated failures outside this FFF change.
- [x] Start a separate review agent.
- [x] Fix review findings.
- [x] Run focused build config and `afterPack` tests.
- [x] Commit, push, and create MR against `dev`.
