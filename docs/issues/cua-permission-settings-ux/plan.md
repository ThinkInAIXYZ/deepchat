# CUA Permission Settings UX Plan

## Permission Check

- Remove the macOS-first `deepchat-permission-probe` path from `PluginPresenter`.
- Use the existing `check_permissions` CLI tool for every platform.
- Pass `{"prompt":false}` explicitly. The settings page should read status; the permission guide
  action opens the helper app for the guided prompt flow.
- If the CLI exits non-zero, still parse stdout/stderr for permission status before returning an
  error result.
- Sanitize known upstream argument-parser hints from user-facing errors.

## Settings Page

- Rename the page surface to "Computer Use" and make "Official Runtime Plugin" secondary.
- Show compact status chips for plugin, runtime, and MCP.
- Show macOS permissions as the primary setup checklist.
- Move command/helper details into a collapsed technical details section.
- Keep project link and disable action available but secondary.

## Test Strategy

- Add presenter tests for:
  - no `deepchat-permission-probe` dependency
  - parsing permission output from failed CLI executions
  - PowerShell hint sanitization
- Update CUA settings page tests for:
  - successful permission check clears the main message
  - MCP errors show a friendly status with raw detail folded away
  - technical details include helper path/command without dominating the page
