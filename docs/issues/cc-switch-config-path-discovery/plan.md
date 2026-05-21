# CC Switch Config Path Discovery Plan

## Implementation

- Extend CC Switch source path resolution in `ProviderImportService`.
- Look for CC Switch Desktop `app_paths.json` at platform-specific locations:
  - macOS: `~/Library/Application Support/com.ccswitch.desktop/app_paths.json`
  - Windows: `%APPDATA%/com.ccswitch.desktop/app_paths.json`
  - Linux: `$XDG_CONFIG_HOME/com.ccswitch.desktop/app_paths.json`, falling back to `~/.config/com.ccswitch.desktop/app_paths.json`
- Read `app_config_dir_override` and use `<override>/cc-switch.db` when it exists.
- Fall back to the existing default path and Windows HOME fallback when the override cannot be used.
- Keep read errors on the selected database visible as a source read error.

## Compatibility

- Existing CC Switch imports keep the same default path when no Desktop override is configured.
- Other provider import sources keep their existing path logic.
- The provider parser and app-type allowlist remain unchanged.

## Test Strategy

- Add a scan test for a Desktop override database containing Claude-compatible providers.
- Add fallback tests for invalid or missing override databases.
- Add a Codex-only override test to confirm Codex rows are still ignored.
- Keep the Windows HOME fallback test passing.
