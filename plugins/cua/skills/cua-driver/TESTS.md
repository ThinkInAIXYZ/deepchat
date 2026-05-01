# Manual Checks

Use these checks after enabling the CUA plugin:

- `check_permissions` reports Accessibility and Screen Recording state for `DeepChat Computer Use.app`.
- `list_apps` returns installed macOS apps.
- `launch_app` starts a target app and returns a `pid`.
- `list_windows` returns windows for that `pid`.
- `get_window_state` returns a screenshot or accessibility tree for a selected `window_id`.
- `click` or `set_value` works after a same-window snapshot.
- Plugin disable removes the `cua-driver` tools after MCP refresh.
