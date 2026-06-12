# Cherry Studio Config Path Discovery

## Goal

DeepChat should import Cherry Studio providers from Cherry Studio's active custom data directory when users move the app data outside the default platform path.

## User Stories

- As a user who launches Cherry Studio with a custom user data directory, I can import the providers visible in Cherry Studio.
- As a user with a stale default Cherry Studio data directory, I do not get outdated or empty import results when the active LevelDB is elsewhere.
- As a user without a custom Cherry Studio directory, existing default-path import behavior remains unchanged.

## Acceptance Criteria

- Cherry Studio import can discover a custom data directory recorded in Cherry Studio's home config.
- If the configured directory contains `Local Storage/leveldb`, DeepChat scans that LevelDB before the default one.
- If the discovered directory is missing, invalid, or does not contain a LevelDB directory, DeepChat falls back to the existing default path behavior.
- The scan result `configPath` reflects the LevelDB path actually used.
- Provider parsing, credential filtering, and provider mapping behavior remain unchanged.

## Non-Goals

- Scanning arbitrary user directories such as Downloads for Cherry Studio data.
- Importing Cherry Studio data beyond model providers.
- Adding a user-facing manual path picker.
