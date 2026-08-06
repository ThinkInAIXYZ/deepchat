# Computer Use Workflow

This skill uses DeepChat's plugin-provided Computer Use tools.

Core workflow:

1. `start_session`
2. `list_apps`
3. `launch_app`
4. `list_windows`
5. `get_window_state`
6. UI action tool
7. inspect `## CUA action result` when the invoked tool uses that contract
8. `verify_state` for an expressible exact-window postcondition, otherwise a fresh state tool
9. `end_session`

Prefer a non-empty opaque element token from the latest snapshot for the same `pid` and
`window_id`. An index fallback must include both `element_index` and the exact `snapshot_id` from
that same snapshot; a bare index is invalid. When a local `snapshot_id_required` error or a
model-visible addressing `refusal.code` appears, take one fresh snapshot and retry only with a
token or index-plus-snapshot pair entirely from the replacement result. Use pixel coordinates when
an explicitly requested screenshot clearly shows a target missing from the accessibility tree.

Action delivery is not task completion. Treat only `verify_state` status `satisfied` with
`stable=true` as deterministic window-state success; use fresh window, browser, or desktop state
for effects outside its predicate contract. `clipboard_read` is intentionally denied because it
can expose privacy-sensitive plaintext.

Close apps cooperatively and verify exit.

For Chromium-family page content, bind the exact native window with `get_browser_state` and use the
typed `browser_*` tools. The legacy `page` tool is compatibility-only.

Supported bundled targets:

- `darwin/arm64`
- `darwin/x64`
- `win32/x64`
- `win32/arm64`
- `linux/x64`

Unsupported bundled targets:

- `linux/arm64`

Do not ask the user to install CUA manually for DeepChat's bundled plugin.
