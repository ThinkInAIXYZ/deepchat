# CUA MCP Workflow

This skill uses DeepChat's plugin-provided `cua-driver` MCP tools.

Core workflow:

1. `list_apps`
2. `launch_app`
3. `list_windows`
4. `get_window_state`
5. UI action tool
6. `get_window_state`

Use element indices only after a snapshot for the same `pid` and `window_id`. Use pixel coordinates when the screenshot clearly shows a target missing from the accessibility tree.

Permission setup uses `check_permissions`. The macOS grants belong to:

`${PLUGIN_ROOT}/runtime/darwin/${PROCESS_ARCH}/DeepChat Computer Use.app`
