# SQLite Fresh Schema Bootstrap Plan

## Approach

- Remove the `NewSessionsTable.createTable()` override so new `new_sessions` tables use
  `BaseTable.createTable()` and the table's latest create SQL.
- Simplify `DeepChatSessionsTable.createTable()` to keep only the downgrade guard, then create with
  latest SQL.
- Keep `SQLitePresenter.migrate()` fresh fast-path unchanged; latest table creation makes the
  fast-path safe.
- Extend `DatabaseInitializer.initialize()` to run advisory startup schema checks after basic
  connectivity and before returning the presenter.
- Store fresh-install table metadata in the schema catalog, then derive the startup schema catalog
  from that metadata instead of private denylists.
- Treat the startup catalog as the single boot-time actionability boundary. The full catalog remains
  the settings/manual repair boundary.

## Startup Flow

- Construct `SQLitePresenter`.
- Validate the connection with the existing empty transaction.
- Run `diagnoseSchema(getStartupSchemaCatalog())`; full catalog diagnosis may still include optional
  legacy tables in explicit settings/database repair.
- Continue startup if diagnosis itself fails.
- If startup repairable issues exist and no repair has been attempted, close the presenter, call
  `repairSQLiteDatabaseFile()` with the startup catalog, and retry initialization.
- If construction fails with a classified schema error, use the same startup catalog for the guarded
  repair retry so boot-time repair stays scoped to fresh-owned tables.
- If repairable startup issues remain after one repair attempt, log a warning and continue startup.
- If only manual issues remain, log a warning and continue startup.
- Reuse the existing `repairAttempted` guard for both construction-time schema errors and
  diagnosis-time schema drift.

## Compatibility

- Existing historical migration tests remain valid.
- Already affected databases can be repaired because the startup schema catalog contains repair SQL
  for the gated `new_sessions` and `deepchat_sessions` columns.
- Future fields still require updates to latest create SQL, migration SQL, and repair catalog.

## Test Strategy

- Update SQLite integration tests to assert startup-actionable fresh DB schema health and latest
  gated columns.
- Add mocked `DatabaseInitializer` tests for diagnosis-driven repair, diagnosis failure,
  post-repair residual drift, manual-only issues, and healthy startup no-op behavior.
- Add pure Node tests for fresh-install schema metadata and static guards tying optional legacy
  tables to catalog definitions and the `initTables()` fresh creation path.
- Run available targeted tests plus project format, i18n, and lint commands.
