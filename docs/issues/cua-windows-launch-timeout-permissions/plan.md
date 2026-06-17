# Plan

## Diagnosis

Local packaged CUA `cua-driver.exe mcp` can list tools and run `launch_app` when the target is
resolvable. On Windows, `launch_app` waits for the MCP SDK default timeout when called with
unresolvable names or macOS-style bundle ids. The settings-page permission failure is a DeepChat
parsing and presentation issue: Windows `check_permissions` returns JSON with `post_message`,
`uia`, elevation, and integrity fields rather than macOS Accessibility and Screen Recording text.

## Implementation

- Add a CUA-specific launch guard in `ToolManager` for plugin-owned
  `com.deepchat.plugins.cua` servers on Windows.
- Before dispatching `launch_app`, normalize Windows path-like `bundle_id` values to `path`.
- For `name` or plain `bundle_id` requests, call `list_apps` and match against known Windows app
  identifiers before dispatch. If there is no match, return a tool error immediately.
- Extend CUA runtime permission results with `platform` and a diagnostics object.
- Parse JSON from non-macOS `check_permissions` output.
- Update the CUA settings page to render platform-specific rows:
  - macOS: Accessibility, Screen Recording
  - Windows: UI Automation, PostMessage, Integrity Level, Elevated
  - Linux: permission check unavailable or runtime diagnostics

## Test Strategy

- Unit test the CUA launch guard in `ToolManager`.
- Unit test Windows JSON permission parsing in `PluginPresenter`.
- Run focused tests for touched presenters.
- Run project-required quality gates after implementation: format, i18n, lint.

## Compatibility

Existing macOS CUA permission probe and existing CUA tool names remain unchanged. The Windows guard
only intercepts unresolved or platform-mismatched `launch_app` inputs that previously hung.

