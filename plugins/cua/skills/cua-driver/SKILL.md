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
5. Act with the matching MCP tool: `click`, `right_click`, `double_click`, `drag`, `scroll`, `type_text`, `press_key`, `hotkey`, `set_value`, `page`, or `launch_app` with `urls`. For web inputs that reject AX text insertion, call `type_text({ pid, text, delay_ms })` and let the driver use its CGEvent fallback.
6. Snapshot again after each action and verify visible evidence: selected state, changed text, playback progress, new panels, highlighted rows, or updated window content.

Element indices come from the latest `get_window_state` result for the same `pid` and `window_id`. Re-snapshot when an index is missing, stale, or from another window.

## Permissions

Use `check_permissions` for permission status and prompting. If Accessibility or Screen Recording is missing, tell the user to grant it to `DeepChat Computer Use.app` from the helper app bundle path in this skill's runtime context.

## Sparse UI Fallback

Many media and Electron apps expose a shallow accessibility tree while still showing actionable pixels. `get_window_state` automatically attempts Electron AX enablement through `AXManualAccessibility`, `AXEnhancedUserInterface`, and an AXObserver before returning a sparse-tree warning.

Use this fallback order:

1. Re-snapshot once with `get_window_state({ pid, window_id })` when the first tree is sparse.
2. For Electron or browser-like windows, use `page` or relaunch with `launch_app({ bundle_id, electron_debugging_port: 9222 })` when DOM access would identify the target more reliably than pixels.
3. Use `screenshot({ window_id })` for broad visual confirmation when the window contents or active overlay are unclear.
4. Use at most one `zoom({ pid, window_id, x1, y1, x2, y2 })` for small text or dense icons. Repeated zoom calls are a failure signal; return to the full-window screenshot or ask for clarification.
5. Use pixel coordinates from the latest `get_window_state` screenshot with `click({ pid, window_id, x, y })`, or from the single zoom image with `click({ pid, window_id, x, y, from_zoom: true })`.
6. Re-snapshot after each action and compare the resulting state.

Ask the user only when visible candidates are ambiguous, the requested action is destructive, or the target is outside the current visible window.

## Navigation Patterns

- For app launch: use `launch_app({ bundle_id })`.
- For opening files or URLs in an app: use `launch_app({ bundle_id, urls: [...] })`.
- For browser-like apps: prefer new windows via `launch_app({ bundle_id, urls: [...] })` so each URL has a stable `window_id`.
- For menu actions: use visible in-window controls first. Use menu-bar actions only when the target app is already the active app and the menu state is visible through the MCP snapshot.

## Agent Cursor

Use `get_agent_cursor_state` to inspect the cursor overlay. Use `set_agent_cursor_enabled`, `set_agent_cursor_motion`, or `set_agent_cursor_style` only when the user asks to show, hide, animate, or restyle the agent cursor.

## Linked References

- `README.md`: compact MCP workflow reference.
- `WEB_APPS.md`: browser and webview patterns.
- `RECORDING.md`: recording and replay tool notes.
- `TESTS.md`: manual verification scenarios.
