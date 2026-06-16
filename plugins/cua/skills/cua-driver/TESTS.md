# Manual Checks

Use these checks after enabling the CUA plugin:

- `check_permissions` reports platform permission state or an explicit unavailable status.
- `list_apps` returns installed desktop apps.
- `launch_app` starts a target app and returns a `pid` when the platform can provide one.
- `list_windows` returns windows for that `pid`.
- `get_window_state` returns a screenshot or accessibility tree for a selected `window_id`.
- `click` or `set_value` works after a same-window snapshot.
- `start_recording`, `stop_recording`, and `get_recording_state` are permission-gated.
- Plugin disable removes the `cua-driver` tools after the tool surface refreshes.
