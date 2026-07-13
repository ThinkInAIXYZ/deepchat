# CUA macOS Helper Bundle Identity Plan

## Approach

Implement macOS-only release artifact rebranding in the staging script. Treat upstream assets as
immutable inputs and DeepChat's staged `.app` as the mutable packaged output.

## Staging Flow

1. Download upstream macOS CUA release asset and `checksums.txt`.
2. Verify the asset checksum before extraction.
3. Extract and locate the upstream `CuaDriver.app`.
4. Copy the app bundle to:

   ```text
   plugins/cua/runtime/darwin/<arch>/DeepChat Computer Use.app
   ```

5. Rename the main executable from `cua-driver` to `deepchat-cua-driver`.
6. Rewrite `Contents/Info.plist` with:
   - `CFBundleIdentifier = com.deepchat.computeruse.helper`
   - `CFBundleName = DeepChat Computer Use`
   - `CFBundleDisplayName = DeepChat Computer Use`
   - `CFBundleExecutable = deepchat-cua-driver`
7. Preserve upstream-required non-identity plist keys, resources, frameworks, and entitlements.
8. Remove stale `_CodeSignature` content if present or rely on `codesign --force` after mutation.
9. Sign the final helper bundle using the existing `signMacHelperForRelease` path for release builds
   and ad-hoc signing for local builds.
10. Validate the final staged bundle.

## Manifest And Detection Changes

Update CUA macOS runtime detection from:

```text
plugin:runtime/darwin/${arch}/CuaDriver.app/Contents/MacOS/cua-driver
```

to:

```text
plugin:runtime/darwin/${arch}/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver
```

For packaged official CUA, remove `/Applications/CuaDriver.app/Contents/MacOS/cua-driver` as a
normal runtime fallback. If a development override is still useful, keep it outside the packaged
manifest path or behind an explicit development-only mechanism.

Update `DEEPCHAT_COMPUTER_USE_APP_PATH` and `DEEPCHAT_COMPUTER_USE_BINARY_PATH` resolution through
the existing runtime variable expansion, not hardcoded plugin settings code.

## Permission Guide Flow

For `runtime.openPermissionGuide` on macOS:

1. Resolve the installed plugin and refresh the runtime status.
2. If `helperAppPath` is present, open that `.app` bundle with Electron `shell.openPath`.
3. Return immediately when the helper app opens successfully, allowing the helper-owned permission
   UI/TCC prompts to use the DeepChat-owned bundle identity.
4. If the helper path is missing or cannot be opened, fall back to the manifest `guideUrl`.

For Windows and Linux, keep the existing guide URL behavior. Permission diagnostics continue to use
the existing `check_permissions` fallback and do not change the CUA MCP tool policy.

## Validation

Extend CUA packaging/runtime validation to assert on macOS:

- The staged helper directory is `DeepChat Computer Use.app`.
- `Contents/Info.plist` exists and has `CFBundleIdentifier = com.deepchat.computeruse.helper`.
- `CFBundleExecutable` matches `deepchat-cua-driver`.
- `Contents/MacOS/deepchat-cua-driver` exists and is executable.
- The old `CuaDriver.app/Contents/MacOS/cua-driver` path is not the packaged runtime command.
- `codesign --verify --deep --strict --verbose=2` passes.
- `lipo -archs` contains the target architecture when validating on macOS.
- The staged executable can run `--version` on matching macOS hosts.

## Tests

- Add unit coverage around CUA packaging validation so manifests that still reference
  `CuaDriver.app`, `com.trycua.driver`, or `cua-driver` as the macOS command are rejected.
- Add staging-script tests for plist rewriting with a fixture `.app` bundle.
- Add PluginPresenter coverage for macOS permission guide helper launch and guide URL fallback.
- Keep Windows and Linux packaging tests unchanged except for shared fixture updates.
- Run:
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`
  - focused package/staging tests
  - macOS CUA bundle + verify flow on a macOS runner

## Risks And Mitigations

- Renaming the executable could expose upstream assumptions about `argv[0]` or expected binary
  names. Mitigate with macOS smoke tests for `--version`, `mcp --help`, and `check_permissions`.
- TCC grants will move from the upstream identity to the DeepChat identity. Document this as a
  one-time permission re-grant.
- Upstream archive layout may change. Keep staging fail-closed and validate the expected app bundle
  before mutation.
- If upstream adds bundled frameworks or resources, preserve the bundle structure and only mutate
  identity fields and executable naming.
