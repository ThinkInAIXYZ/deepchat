# Perf Audit Review Hardening Tasks

- [x] Fix duplicate foreground schema diagnosis and update F1 docs.
- [x] Harden MCP soft-timeout readiness, cancellation, auth restart, global disable, and shutdown.
- [x] Guard stale session activation navigation and notification.
- [x] Include shared icon sources and add generated icon freshness checking.
- [x] Convert backfills to batch/keyset reads without full-table materialization.
- [x] Preserve usage backfill progress fields across contract parsing.
- [x] Remove ambiguous MCP type re-exports.
- [x] Make pending assistant placeholder detection order-aware.
- [x] Let workspace preview stream large files or show explicit UI errors.
- [x] Add targeted regression tests and run validation.
  - Full `pnpm test` still has one existing failure in `agentSessionPresenter/integration.test.ts` for long converted steer input context rebudgeting.
