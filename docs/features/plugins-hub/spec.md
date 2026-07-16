# Plugins Hub Contract

Status: implemented and maintained.

## Product surface

`/plugins` is the primary extension hub. It exposes official plugin detail routes plus the existing MCP,
Skills and Remote management surfaces. ACP availability is shown as a boundary state rather than pretending
ACP is an installable Plugin.

The hub must preserve direct navigation, back/refresh behavior, loading/empty/error states and platform
availability. Plugin-specific settings render in a Desktop-owned settings window; Plugin code does not create
its own unmanaged BrowserWindow.

## Plugin ownership

`src/main/plugin/` owns package discovery, installation state, manifest validation, runtime lifecycle and
contribution registration. A plugin may declare MCP servers, Skills, settings contributions, tool policies and
an optional managed runtime.

- Only trusted official source metadata and supported platform/arch targets are accepted.
- Relative manifest paths stay inside the plugin root.
- Enable/start first removes stale contributions from the same owner, then registers the complete manifest.
- Disable/uninstall/failed validation removes owned MCP, Skill, settings, tool-policy and runtime resources.
- Plugin contributes capabilities but MCP, Skill and Tool modules remain their runtime owners.
- Settings windows are opened through the Desktop port and close when the plugin becomes unavailable.

## Runtime and packaging

Managed runtimes use explicit detection/install/launch metadata and declared executable permissions. Package
and bundled runtime rules are defined in `docs/guides/plugin-packaging.md`; platform/arch mismatch fails before
launch. Persistent installation records cannot make a missing or untrusted package appear available.

## Renderer contract

Renderer routes use typed Plugin clients. Official detail pages display install/enable/runtime/MCP/settings
state and surface action errors without exposing filesystem secrets. Virtual cards for MCP, Skills and Remote
route to their real owners instead of duplicating configuration inside Plugin state.

## Validation

Tests cover manifest trust/path/platform checks, package install/update/uninstall, contribution replacement and
cleanup, runtime lifecycle, settings availability and hub routing/render states.
