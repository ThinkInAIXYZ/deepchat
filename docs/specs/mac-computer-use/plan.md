# macOS Computer Use Implementation Plan

## Architecture Overview

DeepChat 通过一个 macOS nested helper app 承载 CUA Driver。Electron main process 负责：

- 发现 helper 路径和架构。
- 查询 helper 权限状态。
- 维护 Computer Use enable 状态。
- 在启用时注册/更新内置 stdio MCP server。
- 把 renderer 设置页操作映射到 typed route。

Renderer 只展示状态和触发操作，不直接拼接 helper 路径或执行系统命令。

```text
--------------------+        typed route        +--------------------------+
| Renderer Settings | -------------------------> | ComputerUsePresenter     |
+--------------------+                           +-----------+--------------+
                                                             |
                                                             | helper path/status
                                                             v
                                                +--------------------------+
                                                | DeepChat Computer Use.app |
                                                | Contents/MacOS/cua-driver |
                                                +-------------+------------+
                                                              |
                                      stdio MCP: cua-driver mcp |
                                                              v
                                                +--------------------------+
                                                | McpPresenter/McpClient   |
                                                +--------------------------+
```

## Main Process Components

### ComputerUsePresenter

Add a mac-only presenter under `src/main/presenter/computerUsePresenter`.

Responsibilities:

- Return unsupported status on non-macOS.
- Resolve packaged helper path:
  - dev: `runtime/computer-use/cua-driver/current/DeepChat Computer Use.app`
  - packaged: `app.asar.unpacked/runtime/computer-use/cua-driver/current/DeepChat Computer Use.app`
- Resolve binary path:
  - `DeepChat Computer Use.app/Contents/MacOS/cua-driver`
- Read persisted enable state from config.
- Query permissions by invoking a helper status/check command or a small DeepChat wrapper command.
- Register or unregister `deepchat/computer-use` MCP server when enabled state changes.
- Restart MCP server after permission changes or helper updates.

Do not let renderer provide arbitrary executable paths.

### Typed Routes

Add a new typed route group, for example `computerUse.routes.ts`.

Recommended methods:

- `computerUse.getStatus(): Promise<ComputerUseStatus>`
- `computerUse.setEnabled(enabled: boolean): Promise<ComputerUseStatus>`
- `computerUse.openPermissionGuide(target?: ComputerUsePermissionTarget): Promise<void>`
- `computerUse.checkPermissions(): Promise<ComputerUsePermissionStatus>`
- `computerUse.restartMcpServer(): Promise<ComputerUseStatus>`

Recommended shared types:

```typescript
type ComputerUsePlatform = 'darwin' | 'unsupported'
type ComputerUsePermissionName = 'accessibility' | 'screenRecording'
type ComputerUsePermissionState = 'granted' | 'missing' | 'unknown'
type ComputerUseMcpState = 'notRegistered' | 'registered' | 'running' | 'error'

interface ComputerUseStatus {
  platform: ComputerUsePlatform
  available: boolean
  enabled: boolean
  arch: 'arm64' | 'x64' | 'unknown'
  helperPath?: string
  helperVersion?: string
  permissions: Record<ComputerUsePermissionName, ComputerUsePermissionState>
  mcpServer: ComputerUseMcpState
  lastError?: string
}
```

The exact file names can follow the current route/client naming conventions.

## MCP Integration

Add a built-in server only on macOS and only when Computer Use is enabled:

```json
{
  "deepchat/computer-use": {
    "type": "stdio",
    "command": "<resolved helper binary>",
    "args": ["mcp"],
    "env": {
      "DEEPCHAT_COMPUTER_USE": "1",
      "CUA_DRIVER_AUTO_UPDATE": "0",
      "CUA_DRIVER_TELEMETRY": "0"
    },
    "descriptions": "DeepChat built-in macOS computer use service",
    "icons": "computer-use",
    "autoApprove": [],
    "enabled": true,
    "source": "deepchat",
    "sourceId": "computer-use"
  }
}
```

The existing MCP config model does not distinguish built-in stdio servers from user-added stdio servers.
Implementation should add a stable built-in marker using `source: 'deepchat'` and `sourceId`, then update
renderer grouping logic if needed.

## Tool Permission Policy

CUA tools need explicit classification instead of relying only on generic name heuristics.

Recommended read/status tools:

- `check_permissions`
- `list_apps`
- `list_windows`
- `get_screen_size`
- `get_window_state`
- `get_accessibility_tree`
- `get_cursor_position`
- `screenshot`

Recommended action/write tools:

- `launch_app`
- `click`
- `right_click`
- `scroll`
- `type_text`
- `type_text_chars`
- `press_key`
- `hotkey`
- `set_value`
- `set_agent_cursor_enabled`
- recording/config mutation tools

Default server `autoApprove` stays empty. If the user selects DeepChat `full_access`, DeepChat can skip
its own per-tool prompts, but macOS Accessibility and Screen Recording grants are still required.

## State Flow

Enable flow:

```text
User toggles Computer Use on
  -> renderer calls computerUse.setEnabled(true)
  -> presenter resolves helper and checks platform
  -> presenter persists enabled=true
  -> presenter ensures MCP server config
  -> presenter starts/restarts MCP server if global MCP is enabled
  -> presenter returns current status
```

Permission flow:

```text
User clicks Open Permission Guide
  -> renderer calls computerUse.openPermissionGuide('all')
  -> presenter launches helper permission UI
  -> helper opens System Settings pane
  -> helper shows permiso-style overlay
  -> presenter/renderer polls checkPermissions
  -> UI updates to granted/missing
```

MCP startup flow:

```text
McpClient spawns packaged cua-driver with args ['mcp']
  -> CUA checks TCC permissions
  -> if missing, process exits with clear stderr
  -> presenter maps failure into ComputerUseStatus.lastError
  -> UI offers permission guide
```

## Renderer UI Placement

Preferred placement: existing MCP settings area, because Computer Use is implemented as an MCP server and
already depends on MCP enablement. If product wants stronger discoverability, add a dedicated
`Settings > Computer Use` subsection later; do not start with two separate settings pages.

Renderer should:

- Show card only on macOS, or show a disabled unsupported message on other platforms.
- Use i18n keys for all user-facing strings.
- Never expose command/path editing for this built-in server.
- Link to MCP state if global MCP is disabled.

## Error Handling

Surface these states distinctly:

- `unsupported`: platform is not macOS.
- `missingHelper`: helper app is not packaged or cannot be found.
- `archMismatch`: packaged binary does not match expected arch.
- `missingPermissions`: one or more TCC grants missing.
- `mcpStartFailed`: helper exists but `cua-driver mcp` exits or fails handshake.
- `codesignInvalid`: dev/release build validation found an invalid helper signature.

## Security Notes

- Do not auto-enable Computer Use.
- Do not auto-approve action tools by default.
- Do not allow model-generated input to change helper command path.
- Do not bypass macOS TCC or store private permission workarounds.
- Disable helper self-update. Updates should come from DeepChat release packages.
- Keep permission identity stable across releases so TCC grants persist.

