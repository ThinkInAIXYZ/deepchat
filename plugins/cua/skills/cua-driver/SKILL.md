---
name: cua-driver
description: Drive native macOS apps through DeepChat's plugin-provided Computer Use MCP tools. Use when the user asks to operate, inspect, automate, or perform a GUI task in a real macOS application.
platforms:
  - darwin
metadata:
  deepchatFeature: computer-use
---

# cua-driver

Use DeepChat's CUA plugin MCP tools for macOS app automation. Treat the tools exposed by the `cua-driver` MCP server as the only action surface for this skill.

## Runtime Context

- Plugin id: `${OWNER_PLUGIN_ID}`.
- Plugin root: `${PLUGIN_ROOT}`.
- Helper app bundle: `${PLUGIN_ROOT}/runtime/darwin/${PROCESS_ARCH}/DeepChat Computer Use.app`.
- Helper binary: `${PLUGIN_ROOT}/runtime/darwin/${PROCESS_ARCH}/DeepChat Computer Use.app/Contents/MacOS/cua-driver`.
- Permissions belong to the helper app bundle shown above.

## Required Loop

1. Resolve the app with `list_apps`. Match user language, localized names, English names, romanized names, bundle identifiers, and common abbreviations. Prefer `bundle_id` as the identity signal.
2. Start or reuse the target with `launch_app({ bundle_id })`. Use the returned `pid` when available.
3. Inspect windows with `list_windows({ pid })` when the launch result lacks a usable window.
4. Snapshot before every UI action with `get_window_state({ pid, window_id })`.
5. Act with the matching MCP tool: `click`, `right_click`, `double_click`, `drag`, `scroll`, `type_text`, `type_text_chars`, `press_key`, `hotkey`, `set_value`, `page`, or `launch_app` with `urls`.
6. Snapshot again after each action and verify visible evidence: selected state, changed text, playback progress, new panels, highlighted rows, or updated window content.

Element indices come from the latest `get_window_state` result for the same `pid` and `window_id`. Re-snapshot when an index is missing, stale, or from another window.

## Permissions

Use `check_permissions` for permission status and prompting. If Accessibility or Screen Recording is missing, tell the user to grant it to `DeepChat Computer Use.app` from the helper app bundle path in this skill's runtime context.

## Sparse UI Fallback

Many media and Electron apps expose a shallow accessibility tree while still showing actionable pixels. Continue with the visible UI when the screenshot clearly identifies the target:

- Re-snapshot once when the first tree is sparse.
- Use `zoom` for dense, wide, or small targets.
- Prefer visible in-window controls: primary buttons, cards, sidebars, search fields, and player controls.
- Use pixel coordinates with `click({ pid, window_id, x, y })` for visible controls missing from the AX tree.
- Re-snapshot after each action and compare the resulting state.

Ask the user only when visible candidates are ambiguous, the requested action is destructive, or the target is outside the current visible window.

## Navigation Patterns

- For app launch: use `launch_app({ bundle_id })`.
- For opening files or URLs in an app: use `launch_app({ bundle_id, urls: [...] })`.
- For browser-like apps: prefer new windows via `launch_app({ bundle_id, urls: [...] })` so each URL has a stable `window_id`.
- For menu actions: use visible in-window controls first. Use menu-bar actions only when the target app is already the active app and the menu state is visible through the MCP snapshot.

## Linked References

- `README.md`: compact MCP workflow reference.
- `WEB_APPS.md`: browser and webview patterns.
- `RECORDING.md`: recording and replay tool notes.
- `TESTS.md`: manual verification scenarios.
