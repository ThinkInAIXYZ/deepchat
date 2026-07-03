# Cron Scheduler Utility Start Crash

## Problem

The cron scheduler utility process can exit with code 1 immediately on startup.

The utility host imports `openSQLiteDatabase` from `sqlitePresenter/index.ts`. That index module owns
the full main-process SQLite presenter and pulls Electron main-process dependencies into the
scheduler utility bundle. The utility process only needs a lightweight SQLite connection helper.

## Acceptance Criteria

- The scheduler utility host must open the database without importing the SQLite presenter index.
- Existing SQLite presenter callers must keep importing `openSQLiteDatabase` from the index module.
- The scheduler utility build output must not import Electron-only dependencies through the SQLite
  presenter path.

