# Perf Audit Review Hardening Plan

## Approach

- Treat startup soft timeouts and foreground API readiness as separate concerns.
- Prefer batch/keyset reads over cursor iteration when the same SQLite connection writes during
  backfill processing.
- Add narrowly targeted tests for each reviewed regression rather than broad refactors.

## Affected Interfaces

- MCP client/presenter lifecycle behavior around startup, cancellation, shutdown, and foreground
  tool/list/resource calls.
- Session store activation routing guards in the renderer.
- Generated icon collection inputs and freshness validation.
- Usage dashboard contract schema for backfill status progress fields.
- Shared MCP type exports through `@shared/presenter`.

## Compatibility

- Existing MCP servers can still start in the background after the startup soft timeout.
- Existing workspace preview URLs remain valid; large files are streamed instead of rejected.
- Existing SQLite repair startup behavior remains intact.

## Test Strategy

- Add unit tests for startup diagnosis scheduling, MCP soft timeout readiness/cancellation, session
  activation races, icon whitelist generation, contract schema preservation, and placeholder history
  loading.
- Run existing main and renderer test suites after targeted tests pass.
