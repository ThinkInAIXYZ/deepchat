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
- A Chromium window snapshot projects browser-chrome coverage without claiming that a prompt is
  present; only a verified ineffective window action follows the declared desktop recovery path.
- `click` or `set_value` works with a non-empty token from the latest same-window snapshot.
- An index action succeeds only with `element_index` plus the exact same-result `snapshot_id`; a
  bare index fails before native dispatch with `snapshot_id_required` and enters the same one-fresh-
  snapshot recovery path as a structured addressing refusal.
- An empty optional token does not override a valid index-plus-snapshot pair or pixel coordinate.
- Each projected snapshot-addressing `refusal.code` triggers one fresh snapshot and one retry using
  only a replacement token or replacement index-plus-snapshot pair.
- Successful ActionResult-contract tools append a closed `## CUA action result`; delivery is not
  interpreted as task completion, and partial/unverifiable/suspected-noop/refused effects enter
  recovery.
- `verify_state` returns `satisfied`, `unsatisfied`, or `unknown`; only stable satisfied output is
  accepted, and `observed_json` application text is not projected into model instructions.
- Malformed non-error action or verification results append a fixed contract warning and are not
  interpreted as success; error responses never publish snapshot handles or recovery instructions.
- `set_window_frame` is approval-gated and its requested bounds are checked with `verify_state`.
- `invoke_menu` is approval-gated, targets an exact app/menu path, and verifies the resulting state.
- `clipboard_read` is denied; `clipboard_write` remains approval-gated and is used only when the
  task requires shared clipboard state.
- `get_browser_state` either creates an exact browser/window binding or returns a structured
  refusal; typed browser mutation never proceeds from a heuristic binding.
- `browser_type({ replace: true, text: "" })` clears a current editable ref and a fresh browser
  snapshot confirms the empty value.
- Cursor state/mutation calls require the declared `session`; motion calls contain no appearance
  fields, and the verified bundled theme id is `cua.default`.
- The bundled cursor theme uses the v2 action-only profile; a separately installed retired v1
  theme fails clearly instead of silently losing session-badge context.
- A normal `start_session` omits `cursor_theme`; an explicit appearance request goes through
  `set_agent_cursor_theme`.
- App exit uses a cooperative close path and verifies that the process/window exited.
- `start_recording`, `stop_recording`, and `get_recording_state` are permission-gated.
- `end_session` clears the run's cursor and session state.
- Plugin disable removes the `cua-driver` tools after the tool surface refreshes.
