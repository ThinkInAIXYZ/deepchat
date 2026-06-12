# CC Switch Config Path Discovery

## Goal

DeepChat should import CC Switch providers from the active CC Switch Desktop data directory when CC Switch is configured to use a custom config path.

## User Stories

- As a user who moved CC Switch data to a sync directory, I can import the providers visible in CC Switch Desktop.
- As a user with a stale default `~/.cc-switch/cc-switch.db`, I do not get an empty import result when the active database is elsewhere.
- As a user with Codex-only CC Switch rows, DeepChat continues to hide Codex provider rows from provider import.

## Acceptance Criteria

- CC Switch import reads `app_config_dir_override` from CC Switch Desktop `app_paths.json` when available.
- If `<app_config_dir_override>/cc-switch.db` exists, that database is used before the default `~/.cc-switch/cc-switch.db`.
- If the override file is missing, invalid, empty, or points to a missing database, import falls back to the existing default path behavior.
- The scan result `configPath` reflects the database path actually used.
- Existing CC Switch app-type support stays limited to `claude`, `claude-desktop`, `gemini`, `opencode`, `openclaw`, and `hermes`.

## Non-Goals

- Importing CC Switch `codex` providers.
- Scanning the filesystem for arbitrary `cc-switch.db` files.
- Changing provider mapping or credential filtering rules.
