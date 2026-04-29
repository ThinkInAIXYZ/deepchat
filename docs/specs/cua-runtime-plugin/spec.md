# CUA Runtime Plugin Spec

## Summary

DeepChat should move macOS Computer Use out of the core application bundle and into an
installable runtime plugin. The core app should provide reusable plugin infrastructure:
Plugin Host, Runtime Registry, Managed MCP Registry, Skill Registry, Tool Policy Registry, and
Settings Contribution Host. The CUA integration should live in a separate plugin package that
registers an external Cua Driver helper, MCP server, skill, settings card, and tool permission
policy only while the plugin is enabled.

This replaces the current `codex/mac-computer-use` branch direction where DeepChat bundles a
source-built helper app, vendored `cua-driver` source, CUA-specific settings UI, CUA typed routes,
CUA-specific skill visibility, and CUA-specific MCP permission rules directly in core.

## Current Findings

Treat the current built-in Computer Use implementation as a technical feasibility demo:

- `src/main/presenter/computerUsePresenter/index.ts` owns helper discovery, helper path layout,
  permission checks, enable state, and MCP registration.
- `src/shared/contracts/routes/computerUse.routes.ts`,
  `src/shared/types/computerUse.ts`, and `src/renderer/api/ComputerUseClient.ts` expose a
  CUA-specific renderer-main API surface.
- `src/renderer/settings/components/ComputerUseSettingsCard.vue` puts CUA settings directly inside
  core MCP settings.
- `src/main/presenter/mcpPresenter/toolManager.ts` contains CUA-only read/write tool buckets.
- `src/main/presenter/skillPresenter/index.ts` hides the built-in `cua-driver` skill with a
  `computer-use` feature flag.
- `src/main/presenter/agentRuntimePresenter/index.ts` auto-pins the `cua-driver` skill based on the
  built-in CUA MCP server.
- `scripts/build-cua-driver.mjs`, `scripts/update-cua-driver.mjs`, `scripts/afterPack.js`,
  `electron-builder.yml`, GitHub workflows, `build/entitlements.computer-use.plist`,
  `resources/skills/cua-driver`, and `vendor/cua-driver` make the helper a core packaging concern.

Treat `origin/dev` as the production baseline:

- There is no general Plugin Host for runtime plugins.
- MCP servers are persisted in the current MCP config store and can carry `source` / `sourceId`
  metadata, but there is no owner-aware managed resource registry.
- Skills are file-based and already support metadata, platform filters, scripts, and activation, but
  they do not yet support plugin-owned contribution roots.
- Tool permission is currently based on broad read/write heuristics plus server `autoApprove`.
  There is no declarative per-plugin tool policy registry.
- Remote channel code has a narrow channel plugin manifest shape, but it is not a general runtime
  plugin system.

## Goals

- Keep DeepChat core free of `cua`, `computerUse`, and `CuaDriver` product-specific code.
- Add generic plugin infrastructure that can support CUA and future runtime integrations.
- Ship CUA as `deepchat-plugin-cua`, a separately packaged `.dcplugin` artifact.
- Allow production plugin installation only from DeepChat official sources for the first release.
- Let CI build DeepChat app artifacts and CUA plugin artifacts separately.
- Use the official Cua Driver helper externally, rather than vendoring and notarizing driver source
  inside DeepChat app packages.
- Let the CUA plugin own its skills, settings UI, runtime detection, MCP contribution, and tool
  permission policy.
- Ensure disabling or deleting the plugin removes all DeepChat-side CUA capabilities.
- Keep the CUA helper runtime and macOS TCC grants outside DeepChat core.

## Non-Goals

- Do not merge the current built-in CUA helper as a core feature.
- Do not package `vendor/cua-driver` or `DeepChat Computer Use.app` inside DeepChat app artifacts.
- Package the signed `DeepChat Computer Use.app` helper inside the CUA `.dcplugin` artifact.
- Do not add DeepChat-owned Accessibility or Screen Recording permissions for CUA.
- Do not add Windows or Linux Computer Use support in this feature.
- Do not create a public third-party plugin marketplace in the first increment.
- Do not allow arbitrary local `.dcplugin` sideloading in production builds.
- Do not let plugins mutate arbitrary core state outside declared contribution APIs.

## User Stories

- As a DeepChat user, I can install the CUA runtime plugin and see it in Settings > Plugins.
- As a macOS user, I can enable the CUA plugin only after seeing its requested capabilities.
- As a macOS user without Cua Driver installed, I see a clear install guide and no active CUA tools.
- As a macOS user with Cua Driver installed, I see helper version, detected command path,
  Accessibility status, Screen Recording status, MCP status, and skill status.
- As a privacy-sensitive user, I can disable or delete the plugin and have all CUA MCP tools,
  skills, settings cards, and policies disappear from DeepChat.
- As a release engineer, I can build and publish the DeepChat app without building, signing,
  notarizing, or vendoring CUA Driver.
- As a plugin maintainer, I can update `deepchat-plugin-cua` independently from DeepChat core.

## Functional Requirements

### Plugin Host

- Core must discover installed plugins from the DeepChat plugin install directory.
- Core must install plugins only from the DeepChat official plugin source in production builds.
- Core must parse a signed plugin manifest before activation.
- Core must reject packages whose publisher, source URL, signature, or checksum chain is not
  trusted by the official source policy.
- Core must support enable, disable, update, and delete plugin lifecycle operations.
- Core must expose a stable `PluginContext` with only declared contribution APIs.
- Core must persist plugin installation state separately from MCP, skills, and runtime state.
- Core must emit plugin lifecycle events so renderer settings can refresh plugin state.
- Development sideloading, if needed, must be gated behind a development build or explicit developer
  mode and must never be available as the normal production install path.

### Official Source Policy

- Production plugin discovery and update metadata must come from a DeepChat-owned source.
- Plugin package URLs must match the official source allowlist.
- Plugin signatures must chain to a DeepChat-controlled signing identity.
- Plugin ids must be reserved by the official source registry; a package cannot claim another
  official plugin id.
- The installer must show plugin capabilities before enabling a newly installed plugin.
- Plugin updates must preserve the same plugin id and trusted publisher identity.
- Local file install is allowed only for development builds or an explicit developer-mode workflow.

### Manifest

The CUA plugin manifest must be enough to describe first-party runtime integration:

```json
{
  "id": "com.deepchat.plugins.cua",
  "name": "CUA Computer Use Runtime",
  "version": "1.0.0",
  "publisher": "DeepChat",
  "engines": {
    "deepchat": ">=1.1.0",
    "platforms": ["darwin"]
  },
  "activationEvents": ["onEnable"],
  "capabilities": [
    "runtime.manage",
    "mcp.register",
    "skills.register",
    "settings.contribute",
    "shell.openExternal",
    "process.execDeclared"
  ],
  "settings": {
    "entry": "settings/index.html",
    "preloadTypes": "types/settings-preload.d.ts"
  }
}
```

The manifest may contain declarative runtime, MCP, skill, settings, and tool-policy contributions.
Activation code may refine those contributions after runtime detection.

### Plugin APIs

Plugins should primarily add agent capabilities through MCP servers and skills. If a plugin needs
DeepChat app capabilities that cannot be expressed through MCP or skills, core may expose a very
small main-process SDK through `PluginContext`.

Rules:

- Main SDK methods must be capability-gated by manifest declarations.
- Main SDK methods must be stable, typed, and reviewed as core API surface.
- Main SDK methods must not expose raw presenters, raw stores, arbitrary IPC, or Electron objects.
- Renderer-side plugin APIs must be defined by plugin-specific preload `.d.ts` files.
- Plugin developers should build settings pages against the preload type definitions, not against
  DeepChat renderer internals.

### Resource Ownership

Every resource registered by a plugin must have an owner:

```typescript
type ManagedResourceKind = 'runtime' | 'mcpServer' | 'skill' | 'settings' | 'toolPolicy'

type ManagedResource = {
  ownerPluginId: string
  kind: ManagedResourceKind
  key: string
  payload: unknown
  enabled: boolean
  createdAt: number
  updatedAt: number
}
```

Core must support:

- `disableByOwner(pluginId)` to unregister runtime-visible resources without deleting plugin files.
- `removeByOwner(pluginId)` to remove all resource records and stop owned runtime services.
- Owner-aware startup repair so stale plugin-owned MCP, skill, settings, and policies do not survive
  a deleted plugin.

### Runtime Registry

- Core must support plugin-owned external-helper runtimes.
- Runtime detection must be allowed only through declared commands and declared paths.
- Runtime records must store detected command, version, status, install source, last check time, and
  last error.
- CUA plugin runtime detection must check, at minimum:
  - `/Applications/CuaDriver.app/Contents/MacOS/cua-driver`
  - `~/.local/bin/cua-driver`
  - `PATH:cua-driver`
- The registry should tolerate additional official install paths if upstream changes them.
- Runtime install and uninstall actions must require user confirmation.

### Managed MCP Registry

- Plugins must be able to register MCP servers without writing raw MCP config directly.
- Plugin-owned MCP servers must be identifiable by `ownerPluginId`.
- Disabling the plugin must stop and unregister its MCP servers.
- Deleting the plugin must remove plugin-owned MCP config records.
- User-created MCP servers must never be removed by plugin disable/delete.
- CUA plugin must register a stdio MCP server equivalent to:

```json
{
  "id": "cua-driver",
  "displayName": "CUA Driver",
  "transport": "stdio",
  "command": "${runtime.cua-driver.command}",
  "args": ["mcp"],
  "autoApprove": []
}
```

### Skill Registry

- Plugins must be able to contribute skill roots without copying files into built-in resources or
  the user's personal skills directory.
- Plugin-owned skills must be visible only while the owning plugin is enabled.
- Plugin-owned skills must be removed from available skill metadata, `skill_view`, pinned prompt
  content, and active skill validation when the plugin is disabled or deleted.
- The CUA plugin must contribute `skills/cua-driver/SKILL.md`.
- The CUA plugin may copy upstream CUA skill content into the plugin package and maintain
  DeepChat-specific additions in plugin-owned files.

### Tool Policy Registry

- Core must replace CUA-specific permission logic with generic plugin-owned tool policy entries.
- Policy must be evaluated before fallback read/write name heuristics.
- Supported decisions:
  - `allow`
  - `ask`
  - `deny`
- CUA plugin default policy:

```json
{
  "cua-driver.check_permissions": "allow",
  "cua-driver.list_apps": "allow",
  "cua-driver.list_windows": "allow",
  "cua-driver.get_screen_size": "allow",
  "cua-driver.get_window_state": "allow",
  "cua-driver.get_accessibility_tree": "allow",
  "cua-driver.get_cursor_position": "allow",
  "cua-driver.screenshot": "allow",
  "cua-driver.launch_app": "ask",
  "cua-driver.click": "ask",
  "cua-driver.right_click": "ask",
  "cua-driver.double_click": "ask",
  "cua-driver.scroll": "ask",
  "cua-driver.move_cursor": "ask",
  "cua-driver.type_text": "ask",
  "cua-driver.type_text_chars": "ask",
  "cua-driver.press_key": "ask",
  "cua-driver.hotkey": "ask",
  "cua-driver.set_value": "ask",
  "cua-driver.set_config": "ask",
  "cua-driver.set_recording": "ask",
  "cua-driver.replay_trajectory": "ask",
  "cua-driver.zoom": "ask"
}
```

`autoApprove` must remain empty by default.

### Settings Contribution

- Core must provide a generic Settings > Plugins page.
- Plugins must package settings as a standalone web bundle.
- DeepChat must load plugin settings in an isolated renderer/webContents, not inside the main
  DeepChat renderer component tree.
- The isolated settings renderer must use `contextIsolation`, no Node integration, and a dedicated
  plugin preload.
- The dedicated preload must expose only plugin-scoped typed APIs declared for that plugin.
- Plugin settings UI must not access DeepChat renderer stores, global IPC, Vue app state, or raw
  Electron APIs.
- Plugin settings UI must not depend on CUA-specific core routes.
- Plugin settings data/config APIs must be defined as plugin-owned typed APIs and routed through the
  plugin host.
- CUA status text, permission guidance, install guidance, and helper uninstall actions belong to the
  plugin.

ASCII layout:

```text
Settings
+-- Plugins
    +-- CUA Computer Use Runtime
        +------------------------------------------------+
        | CUA Computer Use Runtime                       |
        | Runtime      CuaDriver 0.x                     |
        | Helper       /Applications/CuaDriver.app       |
        | MCP          Registered / Running              |
        | Skill        Active                            |
        | Permissions                                    |
        |   Accessibility      Granted                   |
        |   Screen Recording   Missing                   |
        |                                                |
        | [Open Permission Guide] [Check Again]          |
        | [Disable Plugin]        [Uninstall Helper]     |
        +------------------------------------------------+
```

### Packaging

- Add a top-level plugin source directory for first-party plugins, starting with CUA:

```text
plugins/
  cua/
    plugin.json
    package.json
    src/
    settings/
      index.html
      src/
    types/
      settings-preload.d.ts
    skills/cua-driver/
    mcp/cua-driver.json
    policies/tool-policy.json
```

- Add plugin packaging scripts that produce:

```text
dist/plugins/deepchat-plugin-cua-<version>.dcplugin
```

- The `.dcplugin` package must contain manifest, compiled plugin code, settings bundle, skills,
  preload type definitions, bundled helper runtime, checksums, and signature metadata.
- DeepChat app packaging must not include CUA Driver binaries or vendored CUA source.
- Release CI must upload the CUA plugin as a separate artifact.

### Migration

- The current built-in branch should be split:
  - Generic plugin infrastructure PR.
  - `deepchat-plugin-cua` PR.
- Current CUA-specific core files should not survive in final core.
- Existing `deepchat/computer-use` MCP config entries created by the demo branch should be removed
  or migrated to plugin-owned `cua-driver` entries only if the CUA plugin is installed and enabled.
- Existing user-created MCP servers and skills must not be affected.

## Acceptance Criteria

### Core Grep

- `src/main`, `src/renderer`, and `src/shared` contain no CUA-specific symbols:
  - `computerUse`
  - `ComputerUse`
  - `cua-driver`
  - `CuaDriver`
- Allowed generic symbols include:
  - `PluginHost`
  - `RuntimeRegistry`
  - `ManagedMcpRegistry`
  - `SkillRegistry`
  - `SettingsContribution`
  - `ToolPolicy`
  - `ownerPluginId`

### Official Source

- Production builds can install/update plugins only from the official DeepChat plugin source.
- A local `.dcplugin` chosen by a user is rejected in production builds.
- A plugin with an untrusted publisher, unknown signature, mismatched checksum, or non-official
  source URL is rejected before activation.
- Developer sideloading works only in development builds or explicit developer mode.

### Plugin Enable

- CUA plugin appears in Settings > Plugins.
- CUA plugin settings are rendered in an isolated plugin renderer with its own preload.
- CUA settings code can call only the CUA plugin typed preload API and generic plugin host APIs.
- Missing helper state shows install guidance and registers no running CUA tools.
- Installed helper state shows detected path and version.
- Accessibility and Screen Recording state is read from Cua Driver helper behavior.
- `cua-driver` MCP contribution registers and can start through the normal MCP flow.
- `cua-driver` skill appears in available skills and can be injected into agent context.
- `click`, `type_text`, and `hotkey` default to a tool approval prompt.

### Plugin Disable

- CUA MCP server disappears from DeepChat MCP runtime state.
- CUA skill disappears from available skills and active prompt context.
- CUA tool policies are not evaluated.
- CUA settings card disappears or changes to disabled plugin state.
- Existing sessions cannot call CUA tools after registry refresh.
- External `CuaDriver.app` remains installed.

### Plugin Delete

- Plugin files are removed from the plugin install directory.
- Plugin storage is removed.
- Plugin-owned resource records are removed.
- DeepChat restart does not restore stale CUA MCP, skill, settings, or policy records.
- Optional helper uninstall only runs after explicit user confirmation.

### External Helper

- Cua Driver macOS permissions are granted to `CuaDriver.app`, not DeepChat.
- DeepChat app does not request Accessibility or Screen Recording for CUA.
- DeepChat build and notarization do not depend on Swift, CUA source, or CUA helper entitlements.

### CI

- DeepChat core app build succeeds without CUA plugin build steps.
- CUA plugin build produces a `.dcplugin` artifact.
- Release CI publishes app artifacts and plugin artifacts separately.
- Plugin package validation verifies manifest schema, checksums, signature metadata, and required
  files.

### Settings Isolation

- Plugin settings cannot import or access DeepChat renderer stores/components.
- Plugin settings cannot call arbitrary DeepChat IPC channels.
- Plugin settings cannot access Node APIs.
- Plugin settings preload API has generated or checked TypeScript declarations.
- Plugin development docs point plugin authors at the preload `.d.ts` API surface.

## Assumptions

- First production increment supports only signed official-source plugins.
- Local plugin development is available only through development builds or an explicit developer
  mode that is not part of normal production installation.
- Broader third-party plugin execution requires a stronger isolated extension host, review process,
  and marketplace policy, and is outside this CUA migration scope.
- Official Cua Driver continues to expose a stdio MCP mode through `cua-driver mcp`.
- Official Cua Driver remains responsible for macOS TCC permission ownership and helper lifecycle.

## References

- Existing demo spec: `docs/specs/mac-computer-use/`
- Existing SDD guide: `docs/spec-driven-dev.md`
- Cua Driver introduction: https://cua.ai/docs/cua-driver/guide/getting-started/introduction
- Cua Driver installation and MCP registration: https://cua.ai/docs/cua-driver/guide/getting-started/installation
