# CUA Cross-Platform Computer Use Plan

## Design Principles

- Keep the DeepChat integration model unchanged: official plugin, skill, and DeepChat-owned tool
  startup.
- Treat upstream CUA release artifacts as immutable inputs pinned by tag, commit, asset name, and
  checksum.
- Fail closed when a target runtime is unavailable or an archive layout does not match expectations.
- Avoid runtime network activity. All downloads happen at build time.
- Keep packaging verification close to the produced `.dcplugin` files, not only source folders.

## Current-State Changes Required

### Plugin Manifest

Update `plugins/cua/plugin.json`:

- Change platform support from macOS-only to target-aware support for `darwin/arm64`,
  `darwin/x64`, `win32/x64`, `win32/arm64`, and `linux/x64`.
- Add or enforce arch-aware visibility metadata so `linux/arm64` does not show CUA as an available
  official plugin.
- Replace macOS-only runtime candidates with platform-specific candidates:
  - `plugin:runtime/darwin/${arch}/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver`
  - `plugin:runtime/win32/${arch}/cua-driver.exe`
  - `plugin:runtime/linux/${arch}/cua-driver`
- Keep plugin-local runtime candidates first.
- Update packaged download URL conventions to include target platform and arch.
- Update tool policies for upstream v0.6.7 tools.
- Keep the internal tool server declaration owned by the plugin host; do not add user-facing MCP
  setup instructions.

### Upstream Metadata

Update `plugins/cua/vendor/cua-driver/upstream.json` from the old Swift fork metadata to the pinned
Rust driver release:

- `source`: upstream `trycua/cua`.
- `tag`: `cua-driver-rs-v0.6.7`.
- `commit`: `d6dea4bc3c3a65ce821261752067cae8200fe5d6`.
- `version`: `0.6.7`.
- Include the expected asset map and checksums source.
- Record Windows arm64 as supported and Linux arm64 as unsupported for this pinned DeepChat
  integration.

### Runtime Staging

Replace the macOS-only Swift build path in `scripts/build-cua-plugin-runtime.mjs` with a staging
pipeline:

1. Resolve target platform and arch from CLI flags or host defaults.
2. Map supported DeepChat platform/arch targets to upstream asset names.
3. Download the upstream release archive and `checksums.txt` into a cache directory.
4. Verify the archive digest.
5. Extract into a temporary staging directory.
6. Validate the extracted layout.
7. Copy the normalized runtime files into `plugins/cua/runtime/<platform>/<arch>`.
8. Set executable permissions for macOS and Linux.
9. Run host-executable smoke checks where the host platform and runtime loader can execute the
   target binary.
10. Run macOS app bundle and signing checks for darwin targets.

The script should reject Linux arm64 and any other unsupported target with a clear message before
any partial runtime is staged.

### Plugin Packaging

Update `scripts/package-plugin.mjs`:

- Remove the darwin-only CUA guard.
- Keep only the selected `runtime/<platform>/<arch>` subtree in the `.dcplugin` artifact.
- Narrow the packaged manifest's `engines.targets` to the selected `<platform>/<arch>` target so
  target-specific artifacts cannot be discovered on the wrong architecture.
- Validate required files per target:
  - macOS: helper app executable.
  - Windows: `cua-driver.exe` and `cua-driver-uia.exe`.
  - Linux: `cua-driver`.
- Preserve executable bits on POSIX archive entries.
- Keep source manifest hydration deterministic for platform and arch.

### Build Scripts

Update `package.json` scripts so CUA can be staged, bundled, and verified on supported platforms:

- Add Windows x64 and arm64 CUA build scripts.
- Add Linux x64 CUA build script.
- Keep Linux arm64 unsupported unless it is explicitly validated for DeepChat.
- Avoid duplicate runtime staging when `plugin:bundle` already invokes a build script. Either make
  the build script idempotent and cheap when the target runtime is current, or split staging from
  bundling explicitly.
- Ensure supported Windows and Linux build scripts include the CUA bundle step without affecting
  unsupported Linux arm64 builds.

### CI and Release Workflows

Update `.github/workflows/build.yml` and `.github/workflows/release.yml`:

- Bundle and verify CUA on macOS arm64/x64.
- Bundle and verify CUA on Windows x64 and arm64.
- Bundle and verify CUA on Linux x64.
- Do not request Linux arm64 CUA artifacts until that target is explicitly supported.
- Keep CUA verification next to Feishu verification so missing official plugin artifacts fail the
  build.

### Skill Docs

Adapt CUA skill docs from upstream v0.6.7 into DeepChat-specific docs:

- Remove upstream manual install, PATH, and standalone MCP setup requirements.
- Describe the DeepChat tool surface and platform behavior.
- Add platform caveats for macOS permissions, Windows foreground/background dispatch, and Linux
  pre-release limitations.
- Replace Swift-era tool names with v0.6.7 tool names.
- Keep plugin support metadata aligned with the supported platform/arch matrix.

### Settings and Permission UX

Update plugin settings/runtime status code where needed:

- Keep macOS helper-app permission checks.
- Show platform-neutral runtime status for Windows and Linux.
- Avoid macOS-only permission copy on non-macOS platforms.
- Ensure missing Linux arm64 runtimes are reported as unsupported, not as broken installs.

### Plugin Discovery Cleanup

Update official plugin discovery so unsupported sibling artifacts for the same plugin id do not
disable an already installed supported artifact. Only remove persisted plugin state when no trusted
candidate for the current platform/arch exists in the discovery pass.

### Tests

Update and add focused tests for:

- Official plugin target metadata, visibility, and runtime candidate resolution.
- CUA manifest hydration and visibility for supported platform/arch targets.
- Runtime packaging validation per platform and arch.
- Unsupported Linux arm64 behavior.
- Tool policy coverage for upstream v0.6.7 known tools.
- Skill docs no longer asserting macOS-only or user-managed MCP-only language.
- Build and release workflow assertions for CUA on Windows x64/arm64, macOS, and Linux x64.

## Verification Plan

Run these after implementation:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm test -- test/main/presenter/pluginPresenter.test.ts
pnpm test -- test/main/scripts
```

Run packaging checks on supported host/CI targets:

```bash
pnpm run plugin:bundle -- --name cua --platform win32 --arch x64
pnpm run plugin:verify -- --name cua --platform win32 --arch x64
pnpm run plugin:bundle -- --name cua --platform win32 --arch arm64
pnpm run plugin:verify -- --name cua --platform win32 --arch arm64
pnpm run plugin:bundle -- --name cua --platform linux --arch x64
pnpm run plugin:verify -- --name cua --platform linux --arch x64
pnpm run plugin:bundle -- --name cua --platform darwin --arch arm64
pnpm run plugin:verify -- --name cua --platform darwin --arch arm64
pnpm run plugin:bundle -- --name cua --platform darwin --arch x64
pnpm run plugin:verify -- --name cua --platform darwin --arch x64
```

On Windows, also verify the built `.dcplugin` contains both `cua-driver.exe` and
`cua-driver-uia.exe`. On Linux, verify `cua-driver` is executable after extraction. On macOS,
verify the helper app executable path and signing state.

## Rollout Notes

- This change should land as one focused feature branch because manifest, packaging, docs, and CI
  must stay in sync.
- If upstream publishes a newer driver before implementation starts, re-run the release asset audit
  and update the pinned tag only after confirming asset names, tool names, and Linux availability.
- If macOS helper-app signing fails after staging the upstream bundle, keep the runtime update but
  isolate the signing fix in the staging script instead of changing the plugin host.
