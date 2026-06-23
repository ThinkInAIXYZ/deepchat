---
name: cua-driver
description: Drive native desktop apps through DeepChat's built-in Computer Use tools. Use when the user asks to operate, inspect, automate, or perform a GUI task in a real desktop application.
platforms:
  - darwin
  - win32
  - linux
metadata:
  deepchatFeature: computer-use
---

# cua-driver

Use DeepChat's plugin-provided Computer Use tools as the only action surface for this skill. Do not
ask the user to install `cua-driver`, configure an external server, or put anything on PATH for the
bundled DeepChat plugin.

## Runtime Context

- Plugin id: `${OWNER_PLUGIN_ID}`.
- Plugin root: `${PLUGIN_ROOT}`.
- Process arch: `${PROCESS_ARCH}`.
- Supported targets: `darwin/arm64`, `darwin/x64`, `win32/x64`, `win32/arm64`,
  `linux/x64`.
- Unsupported targets: `linux/arm64`.
- macOS helper app: packaged builds prefer
  `DeepChat.app/Contents/Helpers/DeepChat Computer Use.app`; the plugin-local fallback is
  `${PLUGIN_ROOT}/runtime/darwin/${PROCESS_ARCH}/DeepChat Computer Use.app`.
- Windows helper binary: `${PLUGIN_ROOT}/runtime/win32/${PROCESS_ARCH}/cua-driver.exe`.
- Linux helper binary: `${PLUGIN_ROOT}/runtime/linux/${PROCESS_ARCH}/cua-driver`.

## Required Loop

1. Resolve the app with `list_apps`. Match localized names, English names, romanized names, bundle
   identifiers, executable names, and common abbreviations. Prefer stable identifiers when a result
   provides them.
2. Start or reuse the target with `launch_app`. Use the returned `pid` when available.
3. Inspect windows with `list_windows({ pid })` when the launch result lacks a usable window.
4. Snapshot before every UI action with `get_window_state({ pid, window_id })`. Use a vision
   capture mode when visual evidence is needed.
5. Act with the matching DeepChat tool: `click`, `right_click`, `double_click`, `drag`, `scroll`,
   `type_text`, `press_key`, `hotkey`, `set_value`, `page`, or `launch_app` with URLs/files when
   supported by the platform.
6. Snapshot again after each action and verify visible evidence: selected state, changed text,
   playback progress, new panels, highlighted rows, or updated window content.

Element indices come from the latest `get_window_state` result for the same `pid` and `window_id`.
Re-snapshot when an index is missing, stale, or from another window.

## Platform Notes

- macOS: use `check_permissions` for Accessibility and Screen Recording status. If a grant is
  missing, ask the user to grant it to the detected `DeepChat Computer Use.app` helper opened by
  DeepChat.
- Windows: prefer background dispatch when available. Resolve targets with `list_apps`, then call
  `launch_app` with a Windows `name`, `path`, `launch_path`, or `aumid`. Do not use macOS bundle
  ids on Windows. Use `bring_to_front` only when foreground interaction is necessary for the task.
- Linux: support is pre-release. Some compositors, sessions, and background interactions may be
  unavailable. Use extra snapshots and report platform limits clearly when a tool cannot complete.

## Sparse UI Fallback

Many media, browser, and Electron apps expose a shallow accessibility tree while still showing
actionable pixels.

Use this fallback order:

1. Re-snapshot once with `get_window_state({ pid, window_id })` when the first tree is sparse.
2. For browser-like windows, use `page` when DOM access identifies the target more reliably than
   pixels.
3. Use `get_window_state` with vision capture for broad visual confirmation when window contents or
   active overlays are unclear.
4. Use at most one `zoom({ pid, window_id, x1, y1, x2, y2 })` for small text or dense icons.
   Repeated zoom calls are a failure signal; return to the full-window snapshot or ask for
   clarification.
5. Use pixel coordinates from the latest same-window state with `click({ pid, window_id, x, y })`,
   or from the single zoom image with `click({ pid, window_id, x, y, from_zoom: true })`.
6. Re-snapshot after each action and compare the resulting state.

Ask the user only when visible candidates are ambiguous, the requested action is destructive, or the
target is outside the current visible window.

## Navigation Patterns

- For app launch: use `launch_app`.
- For opening files or URLs in an app: use `launch_app` with the platform-supported file or URL
  arguments.
- For browser-like apps: prefer new windows where possible so each URL has a stable `window_id`.
- For menu actions: use visible in-window controls first. Use menu-bar actions only when the target
  app is active enough for the platform to expose menu state reliably.

## Agent Cursor

Use `get_agent_cursor_state` to inspect the cursor overlay. Use `set_agent_cursor_enabled`,
`set_agent_cursor_motion`, or `set_agent_cursor_style` only when the user asks to show, hide,
animate, or restyle the agent cursor.

## Recording

Use `start_recording`, `stop_recording`, `get_recording_state`, and `replay_trajectory` for
recording workflows. Use `install_ffmpeg` only with explicit user approval.

## Linked References

- `README.md`: compact workflow reference.
- `WEB_APPS.md`: browser and webview patterns.
- `RECORDING.md`: recording and replay tool notes.
- `TESTS.md`: manual verification scenarios.
