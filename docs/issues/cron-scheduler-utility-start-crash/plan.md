# Plan

1. Move `openSQLiteDatabase` into a small SQLite connection module.
2. Re-export it from the existing SQLite presenter index for current callers.
3. Import the small module directly from the cron scheduler utility host.
4. Build and inspect the scheduler utility output.

