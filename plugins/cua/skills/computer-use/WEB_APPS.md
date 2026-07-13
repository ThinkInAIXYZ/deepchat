# Web App Patterns

Use `launch_app` with URLs for browser and webview navigation when the target platform supports it.
This creates a stable target that can be inspected with `list_windows` and `get_window_state`.

Recommended browser flow:

1. Launch the browser with the requested URL.
2. Select the relevant window from `list_windows`.
3. Snapshot with `get_window_state`.
4. Use `page` for supported browser or webview operations.
5. Use visible UI tools for controls outside page automation.
6. Re-snapshot to verify state.

For Electron apps with sparse accessibility trees, prefer `page` when possible. If DOM access is
unavailable, use `get_window_state` with vision capture for broad visual confirmation and one
`zoom({ pid, window_id, ... })` only for small details before a window-local pixel click.

For multiple URLs, prefer separate windows so each workflow keeps its own `window_id`.
