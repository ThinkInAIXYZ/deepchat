# CUA Cross-Platform Computer Use Tasks

## Task List

- [x] T01 - Update CUA upstream metadata
  - Replace old Swift fork metadata with pinned `cua-driver-rs-v0.6.7` metadata.
  - Record supported and unsupported platform/arch targets.
  - Add expected upstream asset names and checksum source.

- [x] T02 - Rewrite CUA runtime staging
  - Replace macOS-only Swift build logic in `scripts/build-cua-plugin-runtime.mjs`.
  - Add release asset download, checksum verification, extraction, layout validation, and runtime
    copy.
  - Add target mapping for darwin arm64/x64, win32 x64/arm64, and linux x64.
  - Fail clearly for linux arm64.

- [x] T03 - Validate staged runtime files
  - Validate macOS helper app executable path and signing state.
  - Validate Windows `cua-driver.exe` plus `cua-driver-uia.exe`.
  - Validate Linux `cua-driver` and executable permissions.
  - Add host-compatible `--version` smoke checks with a loader-version guard.

- [x] T04 - Update CUA plugin manifest
  - Expand support from macOS-only to the supported target matrix.
  - Add or enforce arch-aware plugin visibility.
  - Add platform-specific plugin-local runtime detect candidates.
  - Keep CUA hidden on linux arm64.
  - Update source URL pattern for platform and arch artifacts.
  - Keep the DeepChat-owned internal tool server startup path.

- [x] T05 - Update CUA tool policies
  - Remove Swift-era `screenshot` and `set_recording` assumptions.
  - Add policies for v0.6.7 read-only, action, recording, session, update, and platform-specific
    tools.
  - Add a test that fails when a known upstream tool lacks an explicit policy.

- [x] T06 - Update plugin packaging
  - Remove darwin-only CUA validation in `scripts/package-plugin.mjs`.
  - Package only the selected `runtime/<platform>/<arch>` subtree.
  - Scope packaged target metadata to the selected `runtime/<platform>/<arch>` subtree.
  - Preserve POSIX executable permissions.
  - Verify the `.dcplugin` artifact contains the expected files for each supported target.

- [x] T07 - Update package scripts
  - Add CUA build/bundle support for Windows x64/arm64 and Linux x64.
  - Include CUA in supported Windows and Linux app build scripts.
  - Keep Linux arm64 from bundling an unusable CUA plugin.
  - Avoid unnecessary duplicate staging during bundle commands.

- [x] T08 - Update CI and release workflows
  - Bundle and verify CUA in macOS, Windows x64/arm64, and Linux x64 build jobs.
  - Skip CUA for Linux arm64 jobs.
  - Skip CUA only where the target is intentionally unsupported.
  - Keep official plugin verification failing on missing expected artifacts.

- [x] T09 - Update DeepChat skill docs
  - Adapt upstream v0.6.7 skill guidance to DeepChat's bundled integration.
  - Remove manual installer, PATH, and user-managed MCP setup language.
  - Add macOS, Windows, and Linux platform caveats.
  - Replace old tool names with v0.6.7 tool names.

- [x] T10 - Update settings and permission status
  - Keep macOS accessibility and screen-capture permission handling.
  - Make Windows and Linux runtime status platform-aware.
  - Show unsupported runtime status for linux arm64 rather than broken-install language.
  - Avoid macOS-only instructions on non-macOS platforms.

- [x] T11 - Update tests
  - Update `test/main/presenter/pluginPresenter.test.ts` for cross-platform manifest behavior,
    skill docs, metadata, and workflow expectations.
  - Add or update package script tests for CUA target validation.
  - Keep macOS signing tests focused on macOS helper behavior.
  - Add negative tests for unsupported linux arm64 packaging and visibility.

- [x] T12 - Update packaging documentation
  - Update `docs/guides/plugin-packaging.md` so CUA is no longer described as macOS-only.
  - Document platform/arch artifact expectations.
  - Document the no-runtime-installer and plugin-local-runtime requirement.

- [x] T13 - Run local verification
  - Run formatting, i18n, lint, typecheck, and focused tests.
  - Bundle and verify the Windows x64 CUA plugin on the current Windows host.
  - Bundle and verify the Windows arm64 CUA plugin without running the non-host binary.
  - Inspect the generated `.dcplugin` archive contents.
  - On Linux hosts with an older glibc loader than the pinned upstream binary requires, verify that
    staging still validates checksum, layout, file presence, and executable permissions.

- [ ] T14 - Verify CI-only targets
  - Use CI to validate macOS arm64/x64 packaging and signing.
  - Use CI to validate Linux x64 packaging and executable permissions.
  - Use CI to validate Windows x64/arm64 packaging.
  - Confirm Linux arm64 jobs do not ship or show CUA.

- [x] T15 - Prevent unsupported sibling cleanup
  - Keep unsupported target artifacts from clearing installed state when a supported artifact for
    the same plugin id exists.
  - Add regression coverage for side-by-side CUA target artifacts with an active plugin-owned tool
    server.

- [x] T16 - Quiet unsupported optional MCP capabilities
  - Treat `-32601 Unknown method` from prompts and resources list requests as unsupported optional
    capabilities.
  - Cache empty prompts/resources lists so CUA does not repeatedly emit error stack traces.

## Implementation Order

1. T01, T02, and T03 establish the runtime input and safety checks.
2. T04, T05, and T09 align the plugin contract with the new runtime.
3. T06 and T07 make local packaging produce correct artifacts.
4. T08 and T12 keep release infrastructure and documentation aligned.
5. T10 and T11 close platform UX and regression coverage.
6. T13 and T14 verify the final artifacts.

## Done Definition

- CUA `.dcplugin` artifacts are produced and verified for every supported target.
- Packaged DeepChat builds include CUA where the upstream runtime exists.
- DeepChat users can access computer-use capability through the built-in skill/tool path without
  manual CUA setup.
- Unsupported targets fail clearly during packaging and do not ship broken plugins.
- Tests and docs reflect cross-platform support and current upstream tool names.
