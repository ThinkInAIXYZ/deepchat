# Non-macOS Handoff Notes

This implementation was completed on Windows, so the architecture and TypeScript integration were
validated locally, while macOS runtime behavior still needs a Mac pass.

## Implemented

- Official-source-only plugin installation path.
- Generic plugin resources for runtimes, MCP servers, skills, settings contributions, and tool
  policies.
- Plugin-owned MCP registration with `ownerPluginId`.
- Plugin-owned skill contribution support.
- Isolated plugin settings renderer preload API exposed as `window.deepchatPlugin`.
- Bundled official `plugins/cua` package using the external `CuaDriver.app` / `cua-driver` helper.
- CI/package scripts for `deepchat-plugin-cua.dcplugin`.
- App packaging no longer builds or signs the embedded DeepChat Computer Use helper.

## Requires macOS validation

- `cua-driver --version` output shape.
- `cua-driver check_permissions` output shape and permission parsing.
- `cua-driver mcp` startup under DeepChat MCP stdio management.
- TCC ownership remains with `/Applications/CuaDriver.app`.
- Plugin settings window can open the CUA permission guide and refresh status.
- Signed `.dcplugin` packaging and official source distribution metadata.

## Legacy Demo Code

The prior built-in Computer Use implementation is no longer initialized at startup and its settings
card has been removed from the MCP settings page. Some demo files still remain in the repository for
comparison and should be removed in a follow-up cleanup once the macOS plugin pass is complete:

- `src/main/presenter/computerUsePresenter`
- `src/shared/contracts/routes/computerUse.routes.ts`
- `src/shared/types/computerUse.ts`
- `src/renderer/api/ComputerUseClient.ts`
- `src/renderer/settings/components/ComputerUseSettingsCard.vue`
- `scripts/build-cua-driver.mjs`
- `scripts/update-cua-driver.mjs`
- `vendor/cua-driver`
