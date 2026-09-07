# Usage Stats V68 Migration Recovery

Status: Implemented

## Issue

Some databases already record schema version 68 while `deepchat_usage_stats` still uses the legacy
`message_id` primary key. The settings usage dashboard then attempts to write `usage_id` and fails
with `table deepchat_usage_stats has no column named usage_id`.

## Root Cause

Schema versions are a global monotonic high-water mark. The category-aware usage migration was
assigned to version 68 after affected databases had already recorded version 68, so startup never
evaluates that migration for those profiles. Generic schema repair cannot fix the primary-key shape
with `ALTER TABLE ADD COLUMN`.

## Required Behavior

- Allocate a new schema version for the compatibility migration.
- Rebuild only legacy or partially repaired usage tables.
- Preserve every legacy row and map its `message_id` to `usage_id` with category `chat`.
- Leave already-correct category-aware tables unchanged, including compaction rows whose
  `message_id` is null.
- Restore all usage indexes after a rebuild.

## Non-Goals

- Adding `usage_id` without replacing the legacy primary key.
- Changing usage aggregation or dashboard presentation.
- Editing user database files outside normal application migration.

## Tasks

- [x] Add a compatibility migration after version 68.
- [x] Cover an already-version-68 legacy table with preserved data.
- [x] Cover an already-correct version-68 table with compaction data.
- [x] Run focused database migration validation and static checks.

## Validation

- A version-68 legacy database opens without manual schema repair and records version 69.
- The migrated table has `usage_id` as its primary key and `message_id` as a nullable non-key.
- Existing chat rows and already-correct compaction rows remain unchanged.

Validated with the Electron-native SQLite runtime against both regression fixtures and a temporary
copy of the affected release profile. The profile migrated from version 68 to 69 with all 916 usage
rows preserved. The temporary copy was removed after verification.
