# Feishu Plugin Bundling

## User Story

As a user starting a fresh DeepChat checkout or installing a packaged app, I need the Feishu/Lark
official plugin to appear and enable reliably so I can use its settings, MCP tools, and skill
guidance without manually packaging plugin assets.

## Acceptance Criteria

- Fresh development startup packages the expected official plugin artifacts into
  `build/bundled-plugins` before Electron starts.
- Development startup only packages a plugin artifact when the exact expected `.dcplugin` file is
  missing.
- Feishu is bundled for `darwin`, `linux`, and `win32` using the current app version, target
  platform, and target architecture.
- CUA remains bundled only for macOS and continues to build its runtime before packaging.
- Packaged apps on Windows, Linux, and macOS embed Feishu under
  `app.asar.unpacked/plugins`.
- Enabling Feishu still registers its settings contribution, `feishu-tools` MCP server, and plugin
  skill.

## Non-goals

- Rebuild existing dev plugin packages based on timestamps, hashes, or source changes.
- Change Feishu MCP behavior, settings UI, credential storage, or tool approval defaults.
- Publish standalone `.dcplugin` files as release assets.

## Constraints

- Keep official plugin packages trusted by using the existing `scripts/package-plugin.mjs`
  manifest hydration and checksums.
- Preserve the manual clean/rebundle path for stale local plugin packages.
- Do not move auto-packaging into `PluginPresenter`; dev packaging must happen before Electron
  startup.
