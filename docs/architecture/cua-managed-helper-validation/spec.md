# CUA Managed Helper Validation

## Context

The current CUA macOS runtime is a sidecar helper extracted from the official plugin package under
DeepChat user data. That avoids a long-running daemon and gives the helper a DeepChat-owned bundle
identifier, but the user still has to grant permissions to an external helper location. That flow is
hard to explain and easy to distrust.

This validation changes packaged macOS builds to prefer a DeepChat-managed helper app embedded in
the main app bundle under `Contents/Helpers`, while keeping the plugin-local helper as a fallback.

## Goals

- Packaged macOS DeepChat should look for the CUA helper in the app bundle first:
  `DeepChat.app/Contents/Helpers/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver`.
- The helper must still be DeepChat-owned:
  - app directory: `DeepChat Computer Use.app`
  - executable: `deepchat-cua-driver`
  - bundle identifier: `com.deepchat.computeruse.helper`
- The CUA MCP server must keep sidecar-only mode:
  - args: `mcp --no-daemon-relaunch`
  - env: `CUA_DRIVER_RS_MCP_NO_RELAUNCH=1`
- macOS dev builds, unpackaged runs, and failed managed-helper staging should still fall back to
  the plugin-local helper.
- Windows and Linux runtime behavior must stay unchanged.
- Package validation and tests must guard the managed-helper detect order and the fallback path.

## Non-Goals

- Do not sync or build the full upstream CUA source from this repository.
- Do not restore the CUA background daemon or relaunch path.
- Do not mutate the signed `.app` bundle at runtime.
- Do not remove the plugin-local CUA runtime from packaged artifacts during this validation.
- Do not claim TCC permission inheritance is proven before a real packaged macOS build is tested.

## Acceptance Criteria

- `plugins/cua/plugin.json` declares a packaged macOS managed-helper runtime detect candidate before
  the plugin-local candidate.
- `PluginPresenter` resolves the managed-helper candidate only for packaged macOS apps and skips it
  elsewhere.
- The CUA bundle step copies the staged macOS helper to `build/managed-helpers` for electron-builder.
- `electron-builder.yml` includes the staged helper under `Contents/Helpers` for macOS packages.
- `plugin:bundle:clean` removes both bundled plugin artifacts and staged managed helpers.
- CUA package validation rejects manifests that do not prefer the managed-helper candidate on
  macOS.
- Focused tests cover managed-helper resolution, manifest detect order, and package validation.

## Open Questions

None.
