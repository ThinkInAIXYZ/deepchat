# CUA Runtime Plugin Implementation Plan

Feature: `cua-runtime-plugin`
Spec: [spec.md](./spec.md)

## Summary

The implementation should land as two independent lines:

1. Generic plugin runtime infrastructure in DeepChat core.
2. First-party `deepchat-plugin-cua` packaged as an installable runtime plugin.

The current built-in Computer Use branch proves that CUA can drive DeepChat through MCP and skills.
It should not be used as the final architecture because it makes CUA a core app packaging, signing,
permission, route, renderer, and agent prompt concern.

## Architecture

```text
DeepChat Core
+-- PluginHost
+-- PluginResourceStore
+-- RuntimeRegistry
+-- ManagedMcpRegistry
+-- SkillRegistry
+-- ToolPolicyRegistry
+-- SettingsContributionHost
    |
    | enable / disable / delete
    v
Installed Plugin: com.deepchat.plugins.cua
+-- plugin.json
+-- dist/main.js
+-- settings/index.html
+-- types/settings-preload.d.ts
+-- skills/cua-driver/SKILL.md
+-- mcp/cua-driver.json
+-- policies/tool-policy.json
    |
    | detects / opens / executes declared helper commands
    v
Bundled Plugin Helper
+-- <installed-plugin>/runtime/darwin/<arch>/DeepChat Computer Use.app
    +-- Contents/MacOS/cua-driver
```

Core owns the registries, official-source trust policy, lifecycle, and renderer isolation. The
plugin owns CUA-specific runtime detection, bundled helper runtime, status, settings web bundle,
typed preload API, MCP contribution, skill content, tool policy, and helper guidance.

## Key Decisions

### 1. First-Party Signed Plugin Scope

The first production increment should install plugins only from the DeepChat official plugin source.
That is enough for `deepchat-plugin-cua` and deliberately avoids opening a dangerous third-party
execution surface before the trust model, review process, and isolation story are mature.

Required boundaries:

- Production builds reject arbitrary local `.dcplugin` sideloading.
- Production builds verify official source URL, plugin id reservation, checksums, and DeepChat
  signature metadata before install or update.
- Local plugin development is available only in development builds or explicit developer mode.
- A plugin cannot register arbitrary IPC routes.
- A plugin cannot write raw MCP config or raw skill cache.
- A plugin can only contribute through `PluginContext` registries.
- Process execution is only available through declared command IDs.
- Plugin packages require checksums and signature metadata before installation.

Longer-term untrusted plugin isolation is a separate feature.

### 2. Declarative First, Activation Code Second

The CUA plugin should use manifest-declared contributions wherever possible:

- runtime id and detection candidates
- MCP server shape
- skill path
- settings contribution id
- tool policy

Activation code should only handle runtime detection, version checks, permission checks, and helper
install/uninstall actions that need runtime state.

### 3. Owner-Aware Resources

Add a `PluginResourceStore` as the single source of truth for plugin-owned runtime resources. It may
start as an ElectronStore-backed store to match existing MCP settings, but it should be represented
behind an interface so it can move to SQLite later if needed.

Suggested records:

```typescript
interface PluginInstallationRecord {
  pluginId: string
  version: string
  path: string
  enabled: boolean
  trusted: boolean
  installedAt: number
  updatedAt: number
}

interface PluginResourceRecord {
  pluginId: string
  kind: 'runtime' | 'mcpServer' | 'skill' | 'settings' | 'toolPolicy'
  key: string
  payloadJson: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

interface RuntimeDependencyRecord {
  pluginId: string
  runtimeId: string
  provider: string
  command?: string
  version?: string
  installSource?: string
  state: 'missing' | 'installed' | 'running' | 'error'
}
```

### 4. MCP Ownership Wrapper

Do not let plugins call `configPresenter.addMcpServer` directly.

Add `ManagedMcpRegistry`:

- validates plugin ownership
- writes MCP server config with `ownerPluginId`
- maps plugin server id to a stable internal key
- stops server before unregistering it
- refreshes MCP client and tool caches after changes

Existing `source` / `sourceId` can remain for external catalogs. Add `ownerPluginId` for plugin
ownership instead of overloading those fields.

### 5. Skill Contributions

Extend SkillPresenter discovery to merge:

- user skill directory
- built-in resource skills
- plugin-owned skill roots from `SkillRegistry`

Plugin-owned skills should not be copied into `resources/skills` or `~/.deepchat/skills`.

Required behavior:

- hidden when plugin disabled
- unavailable to `skill_view` when disabled
- removed from prompt loading and active skill validation
- hot reloaded in development mode if plugin path changes

### 6. Tool Policies

Add `ToolPolicyRegistry` and call it from MCP tool permission pre-check and execution paths before
fallback name heuristics.

Policy evaluation order:

1. Session-scoped permission cache.
2. Plugin-owned exact tool policy.
3. Server `autoApprove`.
4. Existing read/write heuristic.

Decision mapping:

- `allow` returns no permission request.
- `ask` returns a permission request.
- `deny` returns a clear blocked response.

CUA action tools should use `ask` by default. Read/status tools can use `allow`, but should still be
overridable by stricter global settings later.

### 7. Settings Contribution Host

Add a generic Settings > Plugins surface before adding CUA UI.

Plugin settings contribution contract:

```typescript
interface SettingsContribution {
  id: string
  ownerPluginId: string
  title: string
  entry: string // standalone HTML entry inside the plugin package
  preloadTypes: string
  placement: 'plugins'
}
```

DeepChat should not render plugin settings inside the normal Vue renderer tree. The contribution
host should create an isolated renderer/webContents for the plugin settings page:

```text
DeepChat Settings > Plugins
  |
  | owns container and lifecycle only
  v
Isolated plugin settings renderer
  |
  | contextIsolation + no Node integration
  v
Dedicated plugin preload
  |
  | plugin-scoped typed API
  v
PluginHost / Plugin main module
```

The plugin settings web bundle can be implemented with any frontend stack that compiles to static
assets. It talks to DeepChat only through the dedicated preload API. Plugin developers should code
against the shipped `.d.ts` file, not against DeepChat renderer internals.

Generic host APIs available through preload:

- `plugins.list`
- `plugins.getStatus`
- `plugins.enable`
- `plugins.disable`
- `plugins.delete`
- `plugins.invokeAction`

Plugin-specific APIs available through preload are declared by the plugin and handled through the
plugin host, for example:

```typescript
interface CuaSettingsApi {
  getRuntimeStatus(): Promise<CuaRuntimeStatus>
  checkPermissions(): Promise<CuaPermissionStatus>
  openPermissionGuide(): Promise<void>
  uninstallHelper(): Promise<void>
}
```

No CUA-specific typed route should exist in core.

### 8. Minimal Main SDK

Plugins should provide agent-facing capabilities through MCP and skills first. If a plugin needs
DeepChat capabilities outside MCP/skills, add a small main-process SDK method to `PluginContext`.

Rules:

- SDK methods require manifest capability declarations.
- SDK methods expose stable typed functions, not presenters or stores.
- SDK methods are reviewed as core API surface.
- SDK methods should be narrow enough that a future untrusted-plugin host can mediate them.

CUA expected SDK needs are limited to:

- declared process execution for `cua-driver` status/version/permission checks
- opening official external URLs or macOS permission panes
- plugin storage
- managed runtime/MCP/skill/settings/tool-policy registries

### 9. CUA Helper Integration

The CUA plugin should detect official helper candidates:

```text
/Applications/CuaDriver.app/Contents/MacOS/cua-driver
~/.local/bin/cua-driver
PATH:cua-driver
```

Runtime actions:

- `cua-driver.version`: run detected command with `--version`
- `cua-driver.status`: run detected command with status/check command when available
- `cua-driver.permissions`: run helper permission check command
- `cua-driver.open-permissions`: open official permission guide or helper-driven prompt
- `cua-driver.uninstall`: run official uninstall flow only after user confirmation

The plugin should prefer the app-bundled binary path when present so macOS TCC grants are owned by
`CuaDriver.app`.

### 10. Plugin Package Layout

Source:

```text
plugins/
  cua/
    plugin.json
    package.json
    tsconfig.json
    src/
      main.ts
      runtime/locator.ts
      runtime/permissions.ts
      runtime/actions.ts
    settings/
      index.html
      src/CuaRuntimeSettings.ts
      src/style.css
    types/
      settings-preload.d.ts
    skills/
      cua-driver/
        SKILL.md
        README.md
        RECORDING.md
        TESTS.md
        WEB_APPS.md
    mcp/
      cua-driver.json
    policies/
      tool-policy.json
```

Packaged artifact:

```text
deepchat-plugin-cua.dcplugin
+-- plugin.json
+-- dist/main.js
+-- settings/index.html
+-- settings/assets/index.js
+-- settings/assets/index.css
+-- types/settings-preload.d.ts
+-- skills/cua-driver/SKILL.md
+-- skills/cua-driver/README.md
+-- skills/cua-driver/RECORDING.md
+-- skills/cua-driver/TESTS.md
+-- skills/cua-driver/WEB_APPS.md
+-- mcp/cua-driver.json
+-- policies/tool-policy.json
+-- checksums.json
+-- signature.sig
```

### 11. Build And CI

Add plugin scripts without coupling them to core app packaging:

```text
pnpm run plugin:cua:build
pnpm run plugin:cua:package
pnpm run plugin:cua:validate
```

Release shape:

- Core app jobs build Windows, Linux, and macOS artifacts without CUA helper steps.
- Plugin job builds `deepchat-plugin-cua-<version>.dcplugin`.
- Plugin job validates official-source metadata, checksums, and signature metadata.
- Release job uploads plugin artifact separately from app artifacts.
- No Swift build, helper entitlements, nested helper signing, or CUA notarization path is required
  for DeepChat app release.

### 12. Demo Branch Migration

Remove CUA-specific core changes from the final app:

```text
remove:
  src/main/presenter/computerUsePresenter
  src/renderer/api/ComputerUseClient.ts
  src/shared/contracts/routes/computerUse.routes.ts
  src/shared/types/computerUse.ts
  src/renderer/settings/components/ComputerUseSettingsCard.vue
  resources/skills/cua-driver
  vendor/cua-driver
  scripts/build-cua-driver.mjs
  scripts/update-cua-driver.mjs
  build/entitlements.computer-use.plist
  runtime/computer-use

refactor into generic infrastructure:
  typed route pattern -> plugin routes
  MCP source/sourceId usage -> ownerPluginId-aware managed MCP
  skill visibility gate -> plugin-owned skill contribution visibility
  CUA tool buckets -> ToolPolicyRegistry
  CUA settings card -> isolated SettingsContributionHost renderer
  helper path/status -> RuntimeRegistry
```

Also remove CUA helper steps from macOS build and release workflows.

## Implementation Milestones

### M1 Core Plugin Contracts

Add shared plugin types, manifest schema, official-source trust policy, package validation,
installation records, and lifecycle routes.

Exit criteria:

- Core can list installed plugins.
- A fixture plugin manifest validates.
- Invalid package paths, ids, versions, and unsupported platforms are rejected.
- Production installation rejects non-official source URLs and untrusted signatures.

### M2 Plugin Resource Store And Registries

Add owner-aware resource records plus runtime, MCP, skill, settings, and tool policy registry shells.

Exit criteria:

- `disableByOwner(pluginId)` disables every owned resource type.
- `removeByOwner(pluginId)` removes every owned record.
- Startup repair removes resources for missing plugin installations.

### M3 Managed MCP And Tool Policy Integration

Wire managed MCP registration into existing MCP presenter/config flow. Wire tool policies into MCP
permission pre-check and execution.

Exit criteria:

- Plugin-owned MCP server appears in MCP runtime state when plugin enabled.
- Plugin-owned MCP server disappears on disable.
- Exact tool policy overrides fallback name heuristic.
- User-owned MCP servers are unaffected.

### M4 Skill And Settings Contributions

Wire plugin-owned skills into SkillPresenter and plugin settings into isolated settings renderers.

Exit criteria:

- Plugin-owned skill appears only while plugin enabled.
- `skill_view` cannot read disabled plugin-owned skills.
- Settings > Plugins lists plugin cards through contribution metadata.
- Plugin settings load in a separate renderer with a dedicated preload.

### M5 Plugin Packaging Toolchain

Add packaging and validation scripts for `.dcplugin`.

Exit criteria:

- Package contains required files.
- Checksums cover all package files except signature.
- Invalid manifests or missing files fail validation.
- Missing settings HTML or preload type declarations fail validation when a settings contribution is
  declared.
- CI can build a plugin artifact without building DeepChat app.

### M6 CUA Plugin

Move CUA-specific integration into `plugins/cua`.

Exit criteria:

- Missing helper state is visible.
- Installed helper version and path are detected.
- MCP server `cua-driver` starts through normal MCP.
- CUA skill is contributed by the plugin.
- CUA action tools trigger approval prompts.
- CUA read/status tools follow plugin policy.

### M7 Demo Core Removal

Remove the built-in Computer Use branch changes and keep only generic infrastructure plus plugin
source.

Exit criteria:

- Core grep acceptance passes.
- macOS app package contains no CUA Driver helper or vendored CUA source.
- DeepChat build workflows no longer run CUA helper build steps.

### M8 Release Validation

Validate end-to-end behavior on macOS with and without official Cua Driver installed.

Exit criteria:

- Fresh app install has no CUA capability until plugin installation.
- Plugin enable/disable/delete acceptance passes.
- App release and plugin release artifacts are independent.

## Test Strategy

Main process tests:

- manifest schema validation
- package path safety
- plugin lifecycle
- resource store owner disable/delete
- managed MCP register/unregister
- tool policy exact match and fallback behavior
- plugin skill visibility and prompt injection
- stale resource startup repair

Renderer tests:

- Settings > Plugins plugin list
- plugin enable/disable actions
- isolated settings contribution host lifecycle
- plugin preload API availability
- blocked access to DeepChat renderer globals
- CUA settings states: missing helper, installed helper, permission missing, permission granted

Script tests:

- `.dcplugin` package validation
- checksum generation and validation
- missing file failure
- unsupported platform manifest failure
- non-official source rejection
- missing preload type declarations

Manual macOS checks:

- Cua Driver official install
- Cua Driver permission ownership in System Settings
- `cua-driver mcp` tool discovery
- click/type/hotkey approval prompt
- plugin disable removes tools from current session after refresh
- plugin delete survives restart without stale resources

## Rollout

1. Land the generic plugin foundation without CUA plugin.
2. Add CUA plugin package and CI artifact.
3. Remove built-in CUA demo code from core.
4. Validate macOS external helper flow.
5. Publish DeepChat app and CUA plugin as separate artifacts.

## Risks And Mitigations

- Risk: plugin code becomes an unbounded execution surface.
  - Mitigation: production installs only official-source signed plugins, settings run in isolated
    renderers, APIs are capability-declared, and there is no public marketplace scope.
- Risk: settings UI can pierce DeepChat renderer privileges.
  - Mitigation: standalone settings web bundle in an isolated renderer with dedicated preload,
    context isolation, no Node integration, and plugin-scoped typed APIs only.
- Risk: plugin-owned MCP config leaves stale tools after disable/delete.
  - Mitigation: owner-aware resource records, stop-before-unregister, and startup repair.
- Risk: skills stay pinned after plugin disable.
  - Mitigation: skill validation must filter disabled owner resources before prompt composition.
- Risk: user already has an MCP server named `cua-driver`.
  - Mitigation: use an internal owner-aware key and a user-facing display name, or block enable with
    a clear conflict message.
- Risk: official Cua Driver install paths change.
  - Mitigation: detect declared canonical paths plus PATH, keep install guidance in the plugin, and
    update plugin independently from core.
