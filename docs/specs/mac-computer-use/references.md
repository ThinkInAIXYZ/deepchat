# External References and Research Notes

Research date: 2026-04-26.

## CUA

- Repository: https://github.com/trycua/cua
- CUA Driver docs: https://cua.ai/docs/cua-driver/guide/getting-started/introduction
- Latest GitHub release observed: https://github.com/trycua/cua/releases/tag/cua-driver-v0.0.13

Observed release facts:

- Latest release tag: `cua-driver-v0.0.13`
- Published: 2026-04-28
- Assets observed:
  - `cua-driver-0.0.13-darwin-arm64.pkg.tar.gz`
  - `cua-driver-0.0.13-darwin-arm64.tar.gz`
  - generic darwin aliases
- No x64 release asset was observed, so DeepChat must build from source for x64 support.

Key source facts from `libs/cua-driver`:

- `Package.swift` declares macOS 14 minimum.
- Products include:
  - executable `cua-driver`
  - library `CuaDriverCore`
  - library `CuaDriverServer`
- `cua-driver mcp` runs the stdio MCP server.
- `cua-driver serve` runs a long-lived daemon over a Unix socket.
- `cua-driver mcp-config` prints an MCP config that uses command `<binary>` and args `['mcp']`.
- Permissions use:
  - `AXIsProcessTrusted()`
  - `AXIsProcessTrustedWithOptions(...)`
  - `CGRequestScreenCaptureAccess()`
  - `SCShareableContent.current`
- Upstream helper entitlement includes `com.apple.security.automation.apple-events`.
- Upstream app wrapper uses a stable bundle id because TCC grants are tied to app identity.

Integration implication:

- DeepChat should use `cua-driver mcp` for MCP.
- DeepChat should maintain vendored helper source with DeepChat identity and ship the branded
  `DeepChat Computer Use.app`.
- DeepChat should build helper source for both `arm64` and `x86_64`.
- DeepChat should disable helper self-update so app updates remain controlled by DeepChat releases.

## Permiso

- Repository: https://github.com/zats/permiso

Key source facts:

- `PermisoPanel` uses System Settings URLs:
  - `Privacy_Accessibility`
  - `Privacy_ScreenCapture`
  - `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?<panel>`
- `SettingsWindowLocator` finds System Settings with bundle id `com.apple.systempreferences`.
- Window location uses `CGWindowListCopyWindowInfo`.
- `OverlayWindowController` creates a passive `NSPanel` with `.nonactivatingPanel`.
- Overlay window level uses `.statusBar`.

Integration implication:

- DeepChat can copy the UX pattern without copying unrelated app structure.
- Permission guide should open System Settings, locate its window, and show a passive overlay.
- If overlay placement fails, fallback to regular in-app checklist.

## DeepChat Existing Architecture

Relevant current facts:

- App id: `com.wefonk.deepchat`.
- mac artifact naming already includes `${arch}`.
- `electron-builder.yml` already copies `runtime/` to `app.asar.unpacked/runtime`.
- mac builds already run separate `x64` and `arm64` matrix jobs.
- `afterPack` is `scripts/afterPack.js`.
- `afterSign` is `scripts/notarize.js`.
- Existing MCP config supports `stdio`, `sse`, `http`, and `inmemory`.
- Built-in mac server `deepchat/apple-server` already exists as an `inmemory` platform-specific server.
- New renderer-main capabilities should use typed route/client instead of new direct legacy presenter calls.

Integration implication:

- Runtime placement can reuse existing `runtime/` packaging behavior.
- Signing should be added to the existing `afterPack` mac branch.
- Computer Use should be represented as a DeepChat-owned built-in MCP server, not a user-editable custom server.
