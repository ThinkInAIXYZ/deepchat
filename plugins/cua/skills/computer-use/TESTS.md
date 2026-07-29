# Manual Checks

Use these checks after enabling the CUA plugin:

- `check_permissions` reports platform permission state or an explicit unavailable status.
- `list_apps` returns installed desktop apps.
- `launch_app` starts a target app and returns a `pid` when the platform can provide one.
- `list_windows` returns windows for that `pid`.
- `get_window_state` with `include_screenshot: true` returns a screenshot and accessibility tree
  for a selected `window_id`; `include_screenshot: false` returns the cheap tree-only path.
- `get_desktop_state` returns a full-display snapshot where desktop-scope capture is supported.
- `start_session` keeps `capture_scope: auto` window-only until an explicit `escalate_session`.
- `click` or `set_value` works with a non-empty token from the latest same-window snapshot.
- An empty optional token does not override a valid element index or pixel coordinate.
- Each `stale_element_token`, `generation_mismatch`, or `invalid_element_token` refusal triggers
  one fresh snapshot and retry with the replacement token, without using an older snapshot index.
- `get_browser_state` either creates an exact browser/window binding or returns a structured
  refusal; typed browser mutation never proceeds from a heuristic binding.
- `browser_type({ replace: true, text: "" })` clears a current editable ref and a fresh browser
  snapshot confirms the empty value.
- Cursor state/mutation calls require the declared `session`; motion calls contain no appearance
  fields, and the verified bundled theme id is `cua.default`.
- A normal `start_session` omits `cursor_theme`; an explicit appearance request goes through
  `set_agent_cursor_theme`.
- DeepChat denies `kill_app` without showing an approval prompt. Verify app exit through a
  cooperative close path instead.
- `start_recording`, `stop_recording`, and `get_recording_state` are permission-gated.
- `end_session` clears the run's cursor and session state.
- Plugin disable removes the `cua-driver` tools after the tool surface refreshes.

For the v0.13.1 upstream ownership regression smoke, call the native driver directly rather than
through DeepChat policy. Launch a disposable fixture process through the driver, then confirm its
schema-conforming `kill_app({ pid })` call returns `foreign_process_termination_denied`. Bind this
expected failure to driver version 0.13.1; on a later upgrade, require owned-process termination to
succeed while an unrelated process remains denied.
