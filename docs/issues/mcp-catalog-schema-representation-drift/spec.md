# MCP Catalog Schema Representation Drift

Status: implemented and validated locally.

GitHub issue: not created; this is a local SDD record.

## Issue

Catalog-backed plugin tools fail live revalidation after the MCP v2 migration even when the live
input schema and packaged catalog contain identical JSON. `McpClient` now validates untrusted MCP
values into null-prototype objects, while the catalog parser clones schemas through
`JSON.parse(JSON.stringify(...))`. `ToolManager` compares those values with Node's
prototype-sensitive `isDeepStrictEqual`, so an internal JavaScript representation detail is
mistaken for protocol drift.

## Impact

- A valid on-demand CUA runtime can start successfully but every catalog-backed call fails before
  dispatch with a misleading schema-drift error.
- Replacing the driver or catalog cannot resolve the failure because the compared JSON is already
  identical.
- Tests that inject plain object tool definitions bypass the MCP validation boundary and do not
  reproduce the production representation mismatch.

## Root Cause

The catalog verifier combines three individually reasonable behaviors whose contracts do not
align:

1. the packaged catalog is immutable and revalidated against the live tool before dispatch;
2. MCP v2 boundary validation clones object nodes with a null prototype to prevent inherited-key
   behavior and prototype pollution;
3. `isDeepStrictEqual` treats object prototypes as part of equality even though JSON and MCP do
   not.

The CUA 0.17 upgrade exposed the latent regression through a real native runtime call; it did not
introduce the comparison or the two clone strategies.

## Fix Design

- Parse catalog input schemas through the same bounded JSON Schema validator used for live MCP
  tools. Keep the catalog-specific root-object, properties, required-list, and safety-annotation
  checks.
- Compare validated schemas with explicit JSON structural semantics:
  - ignore object prototypes and object key insertion order;
  - preserve array order and exact key, type, and primitive-value equality;
  - report the first deterministic difference as an escaped JSON Pointer and a bounded category;
  - never include the complete schema or arbitrary values in the runtime error.
- Cache successful validation per live client and tool. Existing registry invalidation and MCP tool
  list-change handling remain the cache invalidation authority.
- Preserve requested-tool revalidation. Do not make an unrelated, denied, or platform-conditional
  tool drift block every tool in an otherwise usable runtime.

## Compatibility And Non-Goals

- Real schema drift remains fail-closed before tool dispatch.
- Catalog schemas rejected by the shared validator would already be rejected when returned by the
  live MCP server; activation now reports that incompatibility earlier and consistently.
- Tool descriptions, output schemas, metadata, annotations, policy decisions, runtime integrity,
  and MCP transport negotiation are unchanged.
- This change does not weaken null-prototype cloning, serialize schemas for comparison, introduce a
  second catalog cache, or change the packaged catalog format.

## Task Checklist

- [x] Share bounded JSON Schema validation between live MCP tools and packaged catalogs.
- [x] Add prototype-independent JSON structural comparison with deterministic difference paths.
- [x] Cache successful per-client/per-tool catalog validation.
- [x] Add regression coverage for prototype and key-order differences, real drift, diagnostics,
      and prototype-pollution-shaped property names.
- [x] Run formatting, i18n, lint, type checking, and focused main-process tests.
- [x] Review the final diff for compatibility, security, performance, edge cases, and maintenance
      cost before commit.

## Validation

- The installed macOS arm64 CUA 0.17.0 catalog contains 54 tools; all input schemas pass the shared
  validator.
- Focused MCP, ToolManager, catalog, plugin lifecycle, integrity, and package tests passed: 169
  tests across seven files.
- The complete main-process suite passed: 486 files and 5791 tests; 21 files and 285 tests were
  skipped by their existing environment gates.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck` passed.
