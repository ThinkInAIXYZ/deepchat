# Implementation Tasks

This task list is intended for macOS developers taking over the implementation. Prefer small PRs in this
order so packaging, permissions, and UI can be reviewed independently.

## Phase 1: Source and Build Scaffold

- Add vendored CUA Driver source or reproducible source fetch pinned to `cua-driver-v0.0.5`.
- Add DeepChat patch set for helper bundle identity, app name, relaunch behavior, self-update disablement,
  and telemetry default disablement.
- Add mac-only helper build script with `--arch arm64|x64`.
- Stage helper into `runtime/computer-use/cua-driver/current/DeepChat Computer Use.app`.
- Add architecture validation for staged helper.

Done when:

- A macOS developer can build both helper architectures from source.
- The staged helper has correct app name, bundle id, and binary architecture.

## Phase 2: Packaging and Signing

- Update mac package scripts to build the helper before Electron packaging.
- Update GitHub mac build matrix to call the helper build script.
- Extend `scripts/afterPack.js` to sign and validate the nested helper on macOS.
- Add helper entitlements plist.
- Add CI validation for helper presence, architecture, codesign, and outer app codesign.

Done when:

- mac arm64 artifact contains only arm64 helper.
- mac x64 artifact contains only x86_64 helper.
- Release signing and notarization still pass.

## Phase 3: Main Process Integration

- Add `ComputerUsePresenter`.
- Add typed routes and renderer API client.
- Add shared status and permission types.
- Implement helper path resolution for dev and packaged modes.
- Implement mac-only enable state persistence.
- Implement permission status checks.
- Register/unregister `deepchat/computer-use` MCP server when enabled changes.

Done when:

- Unit tests cover platform gating, path resolution, missing helper, enable persistence, and MCP config.
- Non-mac platforms return unsupported and never register the server.

## Phase 4: MCP Permission Hardening

- Add CUA-specific tool classification for read/status vs action/write tools.
- Ensure `autoApprove` defaults to empty for `deepchat/computer-use`.
- Ensure built-in stdio server cannot be edited into an arbitrary command by renderer UI.
- Surface MCP startup failures as Computer Use status errors.

Done when:

- Default permission mode prompts before action tools.
- `full_access` behavior is consistent with existing DeepChat agent permission semantics.
- Missing macOS TCC grants are surfaced as setup state.

## Phase 5: Permission Guide

- Implement or integrate a small Swift permission guide layer based on permiso concepts.
- Open Accessibility and Screen Recording panes with `x-apple.systempreferences` URLs.
- Locate System Settings window and show a passive overlay.
- Poll permission status and auto-advance between required grants.
- Add fallback in-app checklist when overlay placement is unavailable.

Done when:

- Fresh macOS install can complete both grants through the guide.
- System Settings shows `DeepChat Computer Use`.
- Closing the guide leaves clear status in DeepChat.

## Phase 6: Renderer Settings UI

- Add Computer Use card to MCP settings on macOS.
- Add unsupported state for non-mac if the settings surface needs it.
- Add i18n keys for all user-facing strings.
- Wire enable/disable, open guide, check again, and restart actions.
- Hide raw executable path from normal UI.

Done when:

- UI matches the states in `permissions-ux.md`.
- Renderer tests cover disabled, missing permissions, ready, MCP disabled, and unsupported states.

## Phase 7: End-to-End Validation

- Manual test on macOS arm64.
- Manual test on macOS x64 or Rosetta-backed Intel environment.
- Validate:
  - enable Computer Use
  - grant permissions
  - run `check_permissions`
  - run `list_windows`
  - run `screenshot`
  - run one controlled action tool with a prompt
- Run repo quality gates:
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`
  - targeted Vitest suites
  - mac package build

Done when:

- All acceptance criteria in `spec.md` pass.
- Known macOS limitations are documented in release notes or user docs.

