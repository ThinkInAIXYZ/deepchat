# Cherry Studio Config Path Discovery Plan

## Implementation

- Extend provider import source path resolution for `cherry-studio`.
- Resolve the current default Cherry Studio LevelDB path using the existing source definition.
- Read `~/.cherrystudio/config/config.json`, matching Cherry Studio's `appDataPath` config shape.
- Support both legacy string `appDataPath` and array entries with `dataPath`.
- Treat each configured `dataPath` as a candidate Cherry Studio user data directory and use `<candidate>/Local Storage/leveldb` when it exists.
- Preserve the existing default path fallback when no valid candidate is found.

## Compatibility

- Default Cherry Studio imports keep the same path behavior.
- Symlink-based Cherry Studio data moves continue to work through the existing default path.
- The discovered path only changes where the LevelDB is read from; provider parsing remains unchanged.

## Test Strategy

- Add a scan test for a configured custom Cherry Studio data directory.
- Add fallback coverage for a discovered path without a LevelDB directory.
- Keep the existing Cherry Studio LevelDB snapshot import test passing.
