# SQLite Fresh Schema Bootstrap

## User Need

Fresh DeepChat installs must create a usable `agent.db` schema on first launch. Existing beta
databases that were stamped to the latest schema version while missing columns must repair
automatically during startup.

## Goal

- Fresh `agent.db` creation uses latest schema for active tables.
- Startup detects repairable schema drift before session creation reaches SQLite writes.
- Repairable missing tables, columns, and indexes are repaired through the existing database repair
  service for tables created on fresh install.
- Startup schema diagnosis is advisory: diagnosis failures, manual schema issues, and repair
  residuals are logged but do not block opening the app.

## Acceptance Criteria

- A new `agent.db` contains the latest `new_sessions` and `deepchat_sessions` columns immediately
  after initialization.
- Fresh startup does not diagnose or auto-repair missing optional legacy conversation tables.
- A database with latest `schema_versions` but missing `new_sessions.is_draft` is repaired during
  `DatabaseInitializer.initialize()`.
- Startup repair attempts are guarded so one initialization call does not create duplicate backups
  for the same schema drift.
- Startup health is defined as no startup-actionable schema issues in the fresh-install catalog, not
  full catalog health; optional legacy conversation tables can remain absent on clean new-stack DBs.
- If startup diagnosis fails or a one-shot startup repair leaves residual drift, initialization
  continues so existing in-app repair affordances can still surface later runtime errors.
- No IPC, route, renderer API, or data model contract changes are required.

## Constraints

- Keep `migrate()` fresh fast-path so new installs do not run historical `ALTER TABLE` steps.
- Do not solve the native SQLite ABI issue that can skip `sqlitePresenter.test.ts` in some local
  Vitest environments.
- Do not add automatic synthesized repair SQL in this change.
- Keep explicit settings/database repair on the full schema catalog; startup repair intentionally
  uses the filtered fresh-install catalog.

## Non-Goals

- Changing legacy `conversations` bootstrap behavior.
- Replacing the existing schema repair service.
- Adding user-facing settings or prompts.

## Open Questions

None.
