# Packaging, Codesign, and CI Plan

## Source Layout

Recommended source layout:

```text
vendor/
  cua-driver/
    upstream/
      libs/cua-driver/...
    patches/
      0001-deepchat-helper-identity.patch
      0002-disable-self-update-and-telemetry.patch
runtime/
  computer-use/
    cua-driver/
      current/
        DeepChat Computer Use.app/
```

The implementation can use a git subtree, vendored snapshot, or pinned source archive. The important
requirements are:

- The source is present or reproducibly fetched during build.
- The pinned upstream commit/tag is recorded.
- DeepChat patches are reviewable.
- Release builds never depend on upstream binary release assets.

## Build Script

Add a build script such as:

```text
node scripts/build-cua-driver.mjs --arch arm64
node scripts/build-cua-driver.mjs --arch x64
```

Responsibilities:

- Verify host platform is macOS.
- Verify Xcode/Swift toolchain is available.
- Map `arm64 -> arm64`, `x64 -> x86_64`.
- Build CUA Driver with Swift release configuration.
- Wrap binary into `DeepChat Computer Use.app`.
- Patch `Info.plist`:
  - `CFBundleIdentifier = com.wefonk.deepchat.computeruse`
  - `CFBundleName = DeepChat Computer Use`
  - `CFBundleDisplayName = DeepChat Computer Use`
  - `CFBundleExecutable = cua-driver`
  - `LSUIElement = true`
  - `LSMinimumSystemVersion = 14.0`
- Copy app resources/icons.
- Remove stale staged helper before writing new one.
- Verify binary architecture with `lipo -archs` or `file`.

## Upstream CUA Patch Requirements

CUA Driver currently assumes `CuaDriver.app` in some relaunch paths. DeepChat needs a branded helper,
so patches must cover:

- App name and bundle id used by LaunchServices relaunch.
- Any hardcoded `CuaDriver` app lookup.
- First-run permission UI labels.
- Self-update command behavior.
- Telemetry defaults.

The target behavior is that all macOS TCC prompts and System Settings rows display
`DeepChat Computer Use`.

## Runtime Placement

DeepChat already copies `runtime/` into:

```text
DeepChat.app/Contents/Resources/app.asar.unpacked/runtime
```

Stage the helper at:

```text
runtime/computer-use/cua-driver/current/DeepChat Computer Use.app
```

The packaged binary path becomes:

```text
DeepChat.app/Contents/Resources/app.asar.unpacked/runtime/computer-use/cua-driver/current/DeepChat Computer Use.app/Contents/MacOS/cua-driver
```

Only the target arch helper should exist in `current/` for a given build artifact.

## Electron Builder Hooks

Extend `scripts/afterPack.js` for macOS:

- Locate staged nested helper inside the app output.
- Sign nested helper before outer app signing completes.
- Use a dedicated helper entitlements plist.
- Fail fast if helper is missing on macOS release builds.
- Skip helper validation on Windows/Linux.

Recommended helper entitlements:

```xml
<key>com.apple.security.automation.apple-events</key>
<true/>
```

Do not add unrelated entitlements unless a failing macOS validation proves they are required.

DeepChat outer app entitlements should remain minimal. Add `com.apple.security.automation.apple-events`
to the outer app only if DeepChat itself sends Apple Events outside the helper.

## Codesign

Release signing should use the same Developer ID Application identity already used for DeepChat.

Recommended validation commands in CI:

```text
codesign --verify --deep --strict --verbose=2 "<helper-app>"
codesign --verify --deep --strict --verbose=2 "<DeepChat.app>"
spctl -a -vvv -t exec "<DeepChat.app>"
```

Expected signing order:

```text
build helper source
stage helper under runtime
electron-builder afterPack signs nested helper
electron-builder signs DeepChat.app
afterSign notarizes DeepChat.app
```

## CI Changes

Current GitHub mac build matrix already separates `x64` and `arm64`. Add helper build before
`pnpm run build` or before `electron-builder`:

```text
pnpm run installRuntime:mac:${{ matrix.arch }}
pnpm run build:cua-driver:mac:${{ matrix.arch }}
pnpm run build
pnpm exec electron-builder --mac --${{ matrix.arch }} --publish=never
```

Local package scripts should mirror CI:

```text
build:mac:arm64 -> build helper arm64 -> build renderer/main -> electron-builder --mac --arm64
build:mac:x64   -> build helper x64   -> build renderer/main -> electron-builder --mac --x64
```

## Architecture Validation

For arm64:

```text
lipo -archs ".../DeepChat Computer Use.app/Contents/MacOS/cua-driver"
# expected: arm64
```

For x64:

```text
lipo -archs ".../DeepChat Computer Use.app/Contents/MacOS/cua-driver"
# expected: x86_64
```

Fail the build if:

- The helper is missing.
- The helper contains the wrong architecture.
- The helper is unsigned in release mode.
- Codesign verification fails.
- Notarization fails.

## Local Development

On non-macOS machines:

- Build script should print a clear unsupported message and exit without modifying runtime artifacts.
- Unit tests for path resolution can run with platform mocks.
- Full helper build, TCC permission flow, and codesign validation require macOS.

On macOS development machines:

- Allow ad-hoc signing for local debug builds.
- Keep release signing strict.
- Document how to reset TCC grants during manual testing:
  - `tccutil reset Accessibility com.wefonk.deepchat.computeruse`
  - `tccutil reset ScreenCapture com.wefonk.deepchat.computeruse`

Use the reset commands only in manual developer docs, never inside app code.

