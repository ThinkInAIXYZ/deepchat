# Settings Environments

## Summary

Add a new settings page, `Environments / 目录环境`, to show project directories that have actually been used by sessions. Users can review basic metadata, open a directory, and set or clear a default directory for new chats.

## User Stories

- As a user, I want to see which project directories my sessions have used so I can reopen them quickly.
- As a user, I want to set one default directory for new chats without overriding a directory I select manually later.
- As a user, I want temporary workspace directories separated from regular directories so the primary list stays clean.

## Acceptance Criteria

- Settings navigation includes `settings-environments` after `Display` and before provider settings.
- The page shows:
  - a single merged environments list
  - a temp environments section collapsed by default and controlled by a switch
- Environment entries come from directories used by non-draft sessions, using `new_sessions.project_dir` first and falling back to ACP `workdir` history when `project_dir` is missing.
- Each entry shows:
  - directory name
  - full path
  - session count
  - last used time based on `new_sessions.updated_at`
  - badges for default, temp, missing, and synthetic default states when applicable
- Users can:
  - open a directory with one click
  - set a directory as default directly on the item
  - clear the current default directory directly on the default item
- Temp directories are determined by whether the path is under `app.getPath('temp')` or an app-managed workspace root under app data / legacy user data.
- Default directory only preselects the project on the new thread page. Manual user selection remains higher priority.
- If the default directory is not present in recent projects, the new thread page still surfaces it through a synthetic project entry.

## Non-Goals

- Git status, rename, delete, or add-environment actions
- Tracking directories that were only opened in a picker without being used by a session
- Trigger-based SQLite maintenance

## Constraints

- Follow existing settings visual language instead of reproducing the reference screenshot.
- Use i18n for all user-facing strings.
- Use a derived SQLite table for environment history to avoid scanning `new_sessions` on every page load.

## Migration Notes

- Introduce `new_environments` as a derived table.
- Backfill it once from existing session history in schema migration `v18`, including ACP `workdir` fallback when `project_dir` is absent.
- Keep it synchronized in application code when sessions change.
