# Packaging, Codesign, and CI Plan

## Source Layout

Recommended source layout:

```text
vendor/
  cua-driver/
    upstream.json
    source/
      Package.swift
      Sources/...
runtime/
  computer-use/
    cua-driver/
      current/
        DeepChat Computer Use.app/
```

The implementation uses a vendored source snapshot. `vendor/cua-driver/source` is the build source of
truth, with DeepChat changes committed directly in Swift source. `vendor/cua-driver/upstream.json`
records the upstream location and base revision:

```json
{
  "upstreamRepo": "https://github.com/trycua/cua.git",
  "upstreamSubdir": "libs/cua-driver",
  "tag": "cua-driver-v0.0.5",
  "commit": "1a53f4bc33075be1fac5fceee7c7214452d6fda1",
  "version": "0.0.5",
  "updatedAt": "2026-04-28"
}
```

Build requirements:

- The source snapshot is present in `vendor/cua-driver/source`.
- The pinned upstream commit/tag is recorded in `upstream.json`.
- DeepChat source changes are reviewed as normal repository diffs.
- Release builds depend on local source and never on upstream binary release assets.

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
- Build CUA Driver with Swift release configuration:
  - `swift build -c release --arch <arch> --product cua-driver --package-path vendor/cua-driver/source --scratch-path <tmp>`
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
- Avoid `git clone`, `git fetch`, source copying, and runtime patching during normal builds.

## Upstream CUA Patch Requirements

CUA Driver currently assumes `CuaDriver.app` in some relaunch paths. DeepChat maintains the vendored
source with these local changes:

- App name and bundle id used by LaunchServices relaunch.
- Any hardcoded `CuaDriver` app lookup.
- First-run permission UI labels.
- Self-update command behavior.
- Telemetry defaults.
- DeepChat-specific permission probe command.
- Non-blocking permission startup.
- Background click dispatch behavior verified for DeepChat integration.

The target behavior is that all macOS TCC prompts and System Settings rows display
`DeepChat Computer Use`.

## Upstream Updates

Use the update helper only when a developer intentionally moves the upstream base:

```text
pnpm run cua:update -- --tag <tag> --commit <sha>
pnpm run cua:update -- --tag <tag> --commit <sha> --dry-run
pnpm run cua:diff-upstream
```

Update flow:

1. Read the current base from `vendor/cua-driver/upstream.json`.
2. Fetch the old base and target commit from upstream into a temporary clone.
3. Generate a binary patch from old upstream `libs/cua-driver` to current
   `vendor/cua-driver/source`.
4. Build a temporary candidate repository with old upstream as the first commit and new upstream as
   the second commit.
5. Apply the DeepChat delta with `git apply --3way --whitespace=nowarn`.
6. On success, copy the merged candidate source into `vendor/cua-driver/source` and update
   `upstream.json`.
7. On conflict, copy conflicted source files with conflict markers into `vendor/cua-driver/source`
   during real update runs, print the conflict list, and leave manual resolution to the reviewer.

Conflict handling rules:

- Resolve conflicts in `vendor/cua-driver/source` as normal source conflicts.
- Keep DeepChat identity, permission probe, non-blocking permission startup, telemetry defaults, and
  background click dispatch behavior unless upstream adds an equivalent implementation.
- Run the helper build and package validation after resolving conflicts.

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
- Exclude `vendor/**` from Electron app files; packaged apps should receive the staged helper from
  `runtime/` only.

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
