# Test Plan

## Unit Tests

Main process:

- `ComputerUsePresenter` returns unsupported on non-macOS.
- Helper path resolution maps dev and packaged app paths correctly.
- Architecture detection maps `process.arch` to expected helper architecture.
- Missing helper produces `available=false` and a specific error.
- Enable/disable persists state and updates MCP server config.
- Permission parser maps helper output to `granted`, `missing`, or `unknown`.
- MCP server config uses `command=<helper binary>` and `args=['mcp']`.
- Built-in stdio server is marked as DeepChat-owned and not treated as a user custom server.

Tool permissions:

- CUA read/status tools are classified as read.
- CUA action tools are classified as write/action.
- Default `autoApprove=[]` does not silently approve action tools.
- Existing non-CUA MCP permission behavior is unchanged.

Packaging script tests:

- Build script reads `vendor/cua-driver/source` and does not run upstream clone/fetch during builds.
- `vendor/cua-driver/upstream.json` missing required fields fails with a clear error.
- Update script `--dry-run` generates the DeepChat delta and applies it to a local upstream test repo.
- Update script `--dry-run` reports conflict files when upstream and DeepChat edit the same source.
- `--arch arm64` maps to Swift arch `arm64`.
- `--arch x64` maps to Swift arch `x86_64`.
- Non-macOS build exits with clear unsupported message.
- Wrong or missing architecture validation fails.

## Renderer Tests

- macOS disabled card renders correct status and actions.
- Enabled with missing permissions renders permission guide action.
- Ready state renders granted permissions and running MCP status.
- Global MCP disabled state explains that Computer Use is configured but inactive.
- Non-macOS state does not offer an enable action.
- User actions call the typed client, not legacy presenter APIs.
- i18n keys exist for all Computer Use strings.

## Package Validation

For each macOS artifact:

- Confirm helper exists in:
  - `DeepChat.app/Contents/Resources/app.asar.unpacked/runtime/computer-use/cua-driver/current/DeepChat Computer Use.app`
- Confirm architecture:
  - arm64 build: helper binary reports `arm64`
  - x64 build: helper binary reports `x86_64`
- Confirm signing:
  - helper passes `codesign --verify --deep --strict`
  - outer app passes `codesign --verify --deep --strict`
  - outer app passes `spctl -a -vvv -t exec`
- Confirm notarization completes in release flow.

## Manual macOS Acceptance

Fresh install:

- Install DeepChat to `/Applications`.
- Open Settings > MCP.
- Confirm Computer Use is off.
- Confirm no `deepchat/computer-use` tools are active.

Permission setup:

- Turn Computer Use on.
- Open permission guide.
- Grant Accessibility for `DeepChat Computer Use`.
- Grant Screen Recording for `DeepChat Computer Use`.
- Restart app if macOS requires it.
- Confirm status becomes granted for both permissions.

Tool behavior:

- Run an agent task that calls `check_permissions`.
- Run an agent task that calls `list_windows`.
- Run an agent task that calls `screenshot`.
- Run a controlled action such as clicking a known harmless UI target.
- In default permission mode, confirm action tool prompt appears before execution.

Disable behavior:

- Turn Computer Use off.
- Confirm MCP server stops or is unregistered.
- Confirm active tool list no longer includes CUA tools.

TCC reset regression:

- Reset Accessibility and ScreenCapture grants manually with `tccutil`.
- Relaunch DeepChat.
- Confirm UI returns to missing permission state.

## Risks to Watch During Testing

- macOS TCC may attribute permissions to the parent Electron app if helper is launched incorrectly.
- Upstream CUA relaunch logic may still search for `CuaDriver.app` unless patched.
- Screen Recording permission may require app restart on some macOS versions.
- Intel/x64 build may fail if Swift package or dependencies assume arm64-only paths.
- Nested helper signing order can break notarization if helper is modified after signing.
