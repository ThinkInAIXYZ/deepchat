# Computer Use Workflow

This skill uses DeepChat's plugin-provided Computer Use tools.

Core workflow:

1. `start_session`
2. `list_apps`
3. `launch_app`
4. `list_windows`
5. `get_window_state`
6. UI action tool
7. `get_window_state`
8. `end_session`

Prefer a non-empty opaque element token from the latest snapshot for the same `pid` and
`window_id`. When the model-visible `refusal.code` is `stale_element_token`,
`generation_mismatch`, or `invalid_element_token`, take one fresh snapshot and retry only with its
replacement token. Element indices are the compatibility fallback, but never reuse an index from
the rejected token's older snapshot. Use pixel coordinates when an explicitly requested screenshot
clearly shows a target missing from the accessibility tree.

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
