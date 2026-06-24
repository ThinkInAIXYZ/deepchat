# CUA Permission Settings UX

## User Need

The CUA plugin works from the managed helper path, but the plugin settings page is confusing and the
permission check can fail with raw upstream CLI output. In packaged macOS builds, the page currently
shows a misleading PowerShell hint because DeepChat tries a DeepChat-specific permission probe command
that is not guaranteed to exist in the upstream CUA release binary.

## Goals

- Use a permission status check path that works with the upstream CUA release binary.
- Avoid surfacing misleading raw CLI hints, especially the PowerShell JSON hint, in the settings UI.
- Make the CUA settings page read as a setup/status surface:
  - overall plugin/runtime/MCP status
  - macOS Accessibility and Screen Recording status
  - clear actions for checking and opening the permission setup
  - technical details folded away by default
- Keep managed-helper, sidecar-only, and cross-platform runtime behavior unchanged.

## Non-Goals

- Do not compile upstream CUA source in this repository.
- Do not restore daemon relaunch.
- Do not redesign global DeepChat settings.
- Do not add a new native permission bridge in this issue.

## Acceptance Criteria

- macOS permission checks no longer call `deepchat-permission-probe` before `check_permissions`.
- `check_permissions` is invoked with explicit JSON arguments and parsed even when the process exits
  with a non-zero status but emits usable permission text.
- User-facing permission errors are normalized and do not include the PowerShell hint.
- The CUA settings page separates status, permissions, actions, and technical details.
- Tests cover the upstream-probe removal, sanitized permission errors, and the revised settings UI.

## Open Questions

None.
