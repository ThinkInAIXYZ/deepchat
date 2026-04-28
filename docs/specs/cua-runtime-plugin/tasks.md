# CUA Runtime Plugin Tasks

Feature: `cua-runtime-plugin`
Spec: [spec.md](./spec.md)
Plan: [plan.md](./plan.md)

## Status Legend

- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete

## M0 Specification

- [x] Create SDD artifacts under `docs/specs/cua-runtime-plugin/`.
- [x] Capture current built-in CUA demo coupling points.
- [x] Define final target as generic Plugin Host plus installable CUA runtime plugin.
- [x] Define production plugin installation as official-source only for the first increment.
- [x] Define plugin settings isolation through a standalone web bundle, isolated renderer, and
  plugin-specific typed preload API.
- [x] Keep implementation code untouched during the specification step.

## M1 Core Plugin Contracts

- [ ] Add shared plugin manifest types and schema.
- [ ] Add official plugin source trust policy:
  - source URL allowlist
  - publisher identity
  - plugin id reservation
  - checksum verification
  - signature metadata verification
- [ ] Add plugin lifecycle route contracts:
  - `plugins.list`
  - `plugins.get`
  - `plugins.install`
  - `plugins.enable`
  - `plugins.disable`
  - `plugins.delete`
  - `plugins.invokeAction`
- [ ] Add renderer API client for generic plugin routes.
- [ ] Add package path validation that rejects absolute paths, `..`, drive-letter paths, and unsafe
  symlinks inside plugin packages.
- [ ] Reject arbitrary local `.dcplugin` install in production builds.
- [ ] Gate local plugin development behind development builds or explicit developer mode.
- [ ] Add tests for valid and invalid plugin manifests.
- [ ] Add tests for unsupported `engines.deepchat` and unsupported platform manifests.
- [ ] Add tests for non-official source, untrusted publisher, bad signature, and checksum mismatch.

Validation:

- [ ] `pnpm test -- test/main/routes/contracts.test.ts`
- [ ] Focused plugin manifest test suite passes.
- [ ] Production install path rejects non-official plugin packages before activation.

## M2 Plugin Installation And Resource Store

- [ ] Add `PluginHost` initialization in main presenter startup.
- [ ] Add `PluginInstallationRecord` persistence.
- [ ] Add `PluginResourceRecord` persistence.
- [ ] Add `RuntimeDependencyRecord` persistence or store abstraction.
- [ ] Implement `disableByOwner(pluginId)`.
- [ ] Implement `removeByOwner(pluginId)`.
- [ ] Implement startup repair for resources whose owning plugin is missing.
- [ ] Add tests for disable, delete, update, and startup repair.

Validation:

- [ ] Disabling a fixture plugin disables all owned resources.
- [ ] Deleting a fixture plugin removes all owned resources and plugin storage.
- [ ] Restart simulation does not revive stale owned resources.

## M3 Runtime Registry

- [ ] Add `RuntimeRegistry.register`.
- [ ] Add `RuntimeRegistry.unregisterByOwner`.
- [ ] Add runtime status refresh support.
- [ ] Add declared command execution API:
  - command id
  - executable/path arguments
  - timeout
  - stdout/stderr size limit
  - environment allowlist
- [ ] Add shell open API for declared external URLs or system settings URLs.
- [ ] Add tests for declared command allow/deny behavior.
- [ ] Add minimal main SDK capability gate for plugin storage, declared process execution, shell
  opening, and registry access.
- [ ] Add tests that plugins cannot access raw presenters, raw stores, arbitrary IPC, or Electron
  objects through the SDK.

Validation:

- [ ] Plugins cannot execute undeclared commands.
- [ ] Runtime records carry owner, status, command, version, and last error.
- [ ] Plugin main code can use only declared SDK capabilities.

## M4 Managed MCP Registry

- [ ] Add `ownerPluginId` to plugin-owned MCP server records without breaking user MCP config.
- [ ] Add `ManagedMcpRegistry.register`.
- [ ] Add `ManagedMcpRegistry.unregisterByOwner`.
- [ ] Stop running plugin-owned MCP servers before unregistering them.
- [ ] Refresh MCP clients and tool caches after managed changes.
- [ ] Add conflict handling for user-owned server names.
- [ ] Add tests that user-owned MCP servers survive plugin disable/delete.

Validation:

- [ ] Enabling a fixture plugin registers its MCP server.
- [ ] Disabling the fixture plugin removes only its MCP server.
- [ ] User-created MCP servers with similar names are untouched.

## M5 Tool Policy Registry

- [ ] Add `ToolPolicyRegistry.register`.
- [ ] Add `ToolPolicyRegistry.unregisterByOwner`.
- [ ] Add exact policy lookup by server id and original tool name.
- [ ] Evaluate policy in MCP permission pre-check before fallback heuristics.
- [ ] Evaluate policy in MCP execution path before fallback heuristics.
- [ ] Add `allow`, `ask`, and `deny` behavior tests.
- [ ] Remove CUA-specific read/write tool sets from core.

Validation:

- [ ] `allow` skips permission prompt.
- [ ] `ask` returns a permission request.
- [ ] `deny` blocks execution with a clear message.
- [ ] Unknown tools still use existing fallback heuristics.

## M6 Skill Registry Contributions

- [ ] Add `SkillRegistry.register`.
- [ ] Add `SkillRegistry.unregisterByOwner`.
- [ ] Extend SkillPresenter discovery to merge plugin-owned skill roots.
- [ ] Hide plugin-owned skills when owner plugin is disabled.
- [ ] Filter disabled plugin-owned skills from:
  - metadata list
  - `skill_view`
  - active skill validation
  - prompt content loading
  - allowed tools lookup
- [ ] Remove CUA-specific skill visibility and auto-pin logic from core.
- [ ] Add tests for plugin-owned skill enable/disable/delete behavior.

Validation:

- [ ] Plugin-owned skill appears while plugin enabled.
- [ ] Plugin-owned skill disappears while plugin disabled.
- [ ] Existing user skills continue to work.

## M7 Isolated Settings Contribution Host

- [ ] Add Settings > Plugins page or section.
- [ ] Add generic plugin list UI.
- [ ] Add settings contribution registry.
- [ ] Define settings contribution metadata:
  - standalone HTML entry
  - settings asset root
  - dedicated preload path
  - preload type declaration path
- [ ] Load plugin settings as a standalone web bundle in an isolated renderer/webContents.
- [ ] Enable `contextIsolation` for plugin settings renderers.
- [ ] Disable Node integration for plugin settings renderers.
- [ ] Add a dedicated plugin settings preload that exposes only plugin-scoped typed APIs.
- [ ] Add generated or checked `settings-preload.d.ts` support for plugin developers.
- [ ] Add generic plugin action bridge for settings UI actions.
- [ ] Add plugin-owned typed API bridge for CUA settings actions.
- [ ] Block plugin settings access to DeepChat renderer stores, global IPC, Vue app state, and raw
  Electron APIs.
- [ ] Remove CUA-specific settings card from core MCP settings.
- [ ] Add renderer tests for plugin list and settings contribution states.

Validation:

- [ ] A fixture plugin settings web bundle appears when plugin enabled.
- [ ] The settings renderer is destroyed or shows disabled state when plugin disabled.
- [ ] Plugin settings can call only its preload API and generic plugin host APIs.
- [ ] Plugin settings cannot call arbitrary DeepChat IPC channels.
- [ ] Plugin developers can compile against the preload `.d.ts` without importing DeepChat renderer
  internals.
- [ ] No CUA-specific renderer route or component remains in core.

## M8 Plugin Packaging Toolchain

- [ ] Add top-level `plugins/` workspace support if needed.
- [ ] Add `.dcplugin` package builder.
- [ ] Add `.dcplugin` validator.
- [ ] Add checksum generation.
- [ ] Add signature metadata handling.
- [ ] Add official-source metadata validation.
- [ ] Require settings HTML and preload type declarations when `settings.contribute` is declared.
- [ ] Add package fixture tests.
- [ ] Add scripts:
  - `plugin:cua:build`
  - `plugin:cua:package`
  - `plugin:cua:validate`

Validation:

- [ ] Valid fixture package passes.
- [ ] Missing `plugin.json` fails.
- [ ] Missing declared skill file fails.
- [ ] Missing declared settings entry fails.
- [ ] Missing declared preload `.d.ts` fails.
- [ ] Checksum mismatch fails.
- [ ] Non-official source metadata fails in production validation.

## M9 CUA Plugin Source

- [ ] Add `plugins/cua/plugin.json`.
- [ ] Add CUA runtime locator.
- [ ] Add CUA helper version/status checks.
- [ ] Add CUA permission status checks.
- [ ] Add CUA install guide action.
- [ ] Add optional CUA helper uninstall action with confirmation.
- [ ] Add `mcp/cua-driver.json`.
- [ ] Add `policies/tool-policy.json`.
- [ ] Add `skills/cua-driver/SKILL.md` and related upstream skill docs.
- [ ] Add CUA settings standalone web bundle for missing helper, installed helper, permissions, MCP,
  and skill state.
- [ ] Add CUA plugin settings preload `.d.ts`.
- [ ] Add CUA plugin-specific typed settings API implementation:
  - `getRuntimeStatus`
  - `checkPermissions`
  - `openPermissionGuide`
  - `uninstallHelper`
- [ ] Add CUA plugin tests with mocked runtime detection.

Validation:

- [ ] Missing helper shows install guidance.
- [ ] Installed helper shows version and path.
- [ ] Plugin enable registers CUA MCP, skill, settings, and policy resources.
- [ ] Plugin disable unregisters CUA MCP, skill, settings, and policy resources.
- [ ] CUA settings UI works through only the plugin-specific preload API.

## M10 Remove Built-In CUA Demo Code

- [ ] Remove `src/main/presenter/computerUsePresenter`.
- [ ] Remove `src/renderer/api/ComputerUseClient.ts`.
- [ ] Remove `src/shared/contracts/routes/computerUse.routes.ts`.
- [ ] Remove `src/shared/types/computerUse.ts`.
- [ ] Remove `src/renderer/settings/components/ComputerUseSettingsCard.vue`.
- [ ] Remove `resources/skills/cua-driver`.
- [ ] Remove `vendor/cua-driver`.
- [ ] Remove `scripts/build-cua-driver.mjs`.
- [ ] Remove `scripts/update-cua-driver.mjs`.
- [ ] Remove `build/entitlements.computer-use.plist`.
- [ ] Remove CUA helper handling from `scripts/afterPack.js`.
- [ ] Remove CUA helper steps from build and release workflows.
- [ ] Remove CUA-specific tests or convert them into plugin/generic infrastructure tests.

Validation:

- [ ] Core grep acceptance passes.
- [ ] macOS app packaging no longer contains CUA helper or vendored source.
- [ ] Existing MCP, skills, and settings tests still pass.

## M11 CI And Release

- [ ] Add plugin build job to build workflow.
- [ ] Add plugin build job to release workflow.
- [ ] Upload `.dcplugin` as a separate artifact.
- [ ] Publish or attach official-source metadata for the CUA plugin artifact.
- [ ] Keep core app artifact naming unchanged.
- [ ] Ensure app release jobs do not depend on plugin jobs unless publishing requires all artifacts.
- [ ] Document plugin artifact installation path and manual QA flow.

Validation:

- [ ] Core app CI succeeds without CUA helper build.
- [ ] Plugin CI produces `deepchat-plugin-cua-<version>.dcplugin`.
- [ ] Release assets include app artifacts and plugin artifact separately.
- [ ] Production install validates the released CUA plugin as official-source trusted.

## M12 End-To-End QA

- [ ] macOS without Cua Driver:
  - plugin installs from official source
  - plugin enables
  - missing helper state appears
  - no CUA MCP tools run
- [ ] macOS with Cua Driver:
  - helper version detected
  - permissions detected
  - MCP starts
  - skill appears
  - read/status tools work
  - action tools ask for approval
- [ ] Settings isolation:
  - CUA settings load in isolated renderer
  - CUA settings preload exposes only CUA typed API
  - CUA settings cannot access DeepChat renderer globals or arbitrary IPC
- [ ] Disable:
  - MCP stops
  - skill disappears
  - settings contribution disappears or becomes disabled
  - policies disappear
- [ ] Delete:
  - plugin directory removed
  - resource records removed
  - restart has no stale CUA records
- [ ] External helper:
  - `CuaDriver.app` remains installed after plugin disable/delete
  - DeepChat has no CUA TCC permission ownership

Validation:

- [ ] Acceptance criteria from [spec.md](./spec.md) are checked and recorded in the PR.

## Quality Gates

- [ ] `pnpm run format`
- [ ] `pnpm run i18n`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] Focused main process tests
- [ ] Focused renderer tests
- [ ] Manual macOS CUA plugin QA
