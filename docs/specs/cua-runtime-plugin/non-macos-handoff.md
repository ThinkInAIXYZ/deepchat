# Non-macOS Handoff Notes

This implementation was completed on Windows, so the architecture and TypeScript integration were
validated locally, while macOS runtime behavior still needs a Mac pass.

## Implemented

- Official-source-only plugin installation path with GitHub Release download and local
  `.dcplugin` selection.
- Generic plugin resources for runtimes, MCP servers, skills, settings contributions, and tool
  policies.
- Plugin-owned MCP registration with `ownerPluginId`.
- Plugin-owned skill contribution support.
- Isolated plugin settings renderer preload API exposed as `window.deepchatPlugin`.
- Official `plugins/cua` package with a bundled macOS `DeepChat Computer Use.app` helper runtime.
- CI/package scripts for `deepchat-plugin-cua.dcplugin`.
- App packaging no longer embeds the CUA helper inside the DeepChat app bundle.
- App packaging no longer embeds the CUA plugin source; the app and plugin artifacts are built
  independently.

## Manual Install Flow

1. Build the plugin package:
   `pnpm run plugin:cua:package`
2. Open Settings > Plugins.
3. Click Install on `com.deepchat.plugins.cua`.
   - DeepChat first downloads
     `https://github.com/ThinkInAIXYZ/deepchat/releases/download/v<app-version>/deepchat-plugin-cua-<app-version>-darwin-<arch>.dcplugin`.
   - If the asset is missing, DeepChat opens the matching GitHub Release page.
4. Click Choose `.dcplugin` and select the downloaded package when automatic download is not
   available.
5. Enable `com.deepchat.plugins.cua`, then verify runtime status, permission check, MCP
   registration, skill visibility, and tool policy prompts.

## Requires macOS validation

- `cua-driver --version` output shape.
- `cua-driver check_permissions` output shape and permission parsing.
- `cua-driver mcp` startup under DeepChat MCP stdio management.
- TCC ownership remains with the bundled `DeepChat Computer Use.app` helper inside the installed
  plugin.
- Plugin settings window can open the CUA permission guide and refresh status.
- Signed `.dcplugin` packaging and official source distribution metadata.

## Legacy Demo Code

The prior built-in Computer Use implementation is removed from startup, routes, renderer API,
settings, helper packaging, vendored source, and tests. The remaining CUA-specific source of truth is
`plugins/cua`.
