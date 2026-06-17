# CUA Computer Use Workflow

This skill uses DeepChat's plugin-provided Computer Use tools.

Core workflow:

1. `list_apps`
2. `launch_app`
3. `list_windows`
4. `get_window_state`
5. UI action tool
6. `get_window_state`

Use element indices only after a snapshot for the same `pid` and `window_id`. Use pixel coordinates
when the vision capture clearly shows a target missing from the accessibility tree.

Supported bundled targets:

- `darwin/arm64`
- `darwin/x64`
- `win32/x64`
- `win32/arm64`
- `linux/x64`

Unsupported bundled targets:

- `linux/arm64`

Do not ask the user to install CUA manually for DeepChat's bundled plugin.
