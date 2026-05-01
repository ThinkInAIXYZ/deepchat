# Web App Patterns

Use `launch_app({ bundle_id, urls: [...] })` for browser and webview navigation. This creates a stable target that can be inspected with `list_windows` and `get_window_state`.

Recommended browser flow:

1. Launch the browser with the requested URL.
2. Select the relevant window from `list_windows`.
3. Snapshot with `get_window_state`.
4. Use `page` for supported browser/webview operations.
5. Use visible UI tools for controls outside page automation.
6. Re-snapshot to verify state.

For Electron apps with sparse AX trees, prefer `page` after launching with `electron_debugging_port: 9222` when possible. If DOM access is unavailable, use `screenshot({ window_id })` for broad visual confirmation and one `zoom({ pid, window_id, ... })` only for small details before a window-local pixel click.

For multiple URLs, prefer separate windows so each workflow keeps its own `window_id`.
