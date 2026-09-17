# DeepChat Plugin Packaging

This guide documents `.dcplugin` packaging for official DeepChat plugins bundled with DeepChat
release packages.

## Package Format

A `.dcplugin` file is a zip archive built from one plugin directory.

Required files:

- `plugin.json`: hydrated manifest used by the installer.
- `checksums.json`: SHA-256 checksums for packaged files.
- every file declared by manifest skills and settings contributions.
- runtime payloads required by the target platform and architecture.

The packager excludes development-only sources such as `vendor/`, `build/`, `node_modules/`,
`.build/`, `.DS_Store`, and symlinks.

Official packages keep DeepChat release asset URLs in their manifest metadata:

```text
https://github.com/ThinkInAIXYZ/deepchat/releases/download/v<version>/<asset-name>.dcplugin
```

Output naming pattern: `deepchat-plugin-<name>-<version>[-<platform>-<arch>].dcplugin`

## Generic Commands

All plugins share a common set of commands powered by `scripts/plugin.mjs`, which delegates to
`scripts/package-plugin.mjs` for the actual packaging logic.

### Validate

Dry-run: validates the manifest and file references without producing a `.dcplugin`.

```bash
pnpm run plugin:validate -- --name <plugin> --platform <platform> --arch <arch>
```

### Package

Package into a `.dcplugin` under `dist/plugins/`. Run a plugin's native build command first when the
package needs native runtime payloads.

```bash
pnpm run plugin:package -- --name <plugin> --platform <platform> --arch <arch>
```

### Bundle

Package into `build/bundled-plugins/` for embedding into the Electron app.

```bash
pnpm run plugin:bundle -- --name <plugin> --platform <platform> --arch <arch>
```

### Verify

Verify expected bundled official plugin artifacts from plugin metadata.

```bash
pnpm run plugin:verify -- --name <plugin> --platform <platform> --arch <arch> --plugin-root <plugins-dir>
```

When `--name` is omitted, the script verifies all official plugins supported by the target platform.

### Clean

Remove all bundled plugin artifacts:

```bash
pnpm run plugin:bundle:clean
```

## Plugins with Native Build Steps

Some plugins (like CUA) include pre-compiled native binaries. These require an additional build
step before packaging. The `bundle` action automatically detects and runs
`scripts/build-<name>-plugin-runtime.mjs` when it exists. Standalone `package` expects the native
runtime payload to be built already.

CUA native runtime staging commands download pinned upstream release assets and verify their
checksums. They do not run upstream installers and do not require a PATH-installed `cua-driver`.

```bash
pnpm run plugin:cua:build              # host platform and architecture
pnpm run plugin:cua:build:mac:arm64    # macOS arm64
pnpm run plugin:cua:build:mac:x64      # macOS x64
pnpm run plugin:cua:build:win:x64      # Windows x64
pnpm run plugin:cua:build:win:arm64    # Windows arm64
pnpm run plugin:cua:build:linux:x64    # Linux x64
```

## CUA Plugin Artifacts

The CUA plugin is target-gated by platform and architecture. Supported bundled targets:

- `darwin/arm64`
- `darwin/x64`
- `win32/x64`
- `win32/arm64`
- `linux/x64`

Unsupported targets:

- `linux/arm64`

The bundled package filename includes both platform and architecture:

```text
deepchat-plugin-cua-<version>-darwin-arm64.dcplugin
deepchat-plugin-cua-<version>-darwin-x64.dcplugin
deepchat-plugin-cua-<version>-win32-x64.dcplugin
deepchat-plugin-cua-<version>-win32-arm64.dcplugin
deepchat-plugin-cua-<version>-linux-x64.dcplugin
```

Runtime detection inside the package uses architecture-specific paths. Packaged macOS builds prefer
the helper staged into the main app bundle, then fall back to the plugin-local helper:

```text
app-helper:DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver
plugin:runtime/darwin/<arch>/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver
plugin:runtime/win32/<arch>/cua-driver.exe
plugin:runtime/linux/<arch>/cua-driver
```

Each `.dcplugin` contains only the runtime directory for its target platform and architecture.
Direct CUA packaging for unsupported targets fails before producing an artifact.

## Feishu Plugin Artifacts

The feishu plugin targets all platforms (darwin, linux, win32). Its MCP server uses
`node serve.mjs` which calls `npx` at runtime to download the `@larksuiteoapi/lark-mcp`
package on first use.

```text
deepchat-plugin-feishu-<version>-darwin-arm64.dcplugin
deepchat-plugin-feishu-<version>-darwin-x64.dcplugin
deepchat-plugin-feishu-<version>-linux-x64.dcplugin
deepchat-plugin-feishu-<version>-linux-arm64.dcplugin
deepchat-plugin-feishu-<version>-win32-x64.dcplugin
deepchat-plugin-feishu-<version>-win32-arm64.dcplugin
```

## Output Locations

Standalone packages:

```text
dist/plugins/
```

Bundled packages (embedded into the Electron app):

```text
build/bundled-plugins/
```

Managed macOS helpers copied into the Electron app bundle:

```text
build/managed-helpers/
```

## Testing Remote Installs Without a Release

The distribution catalog accepts plain `http` for loopback hosts, so the full download → sha256
verify → `.dcplugin` verify → install → enable chain runs against a local static server. Draft
GitHub releases are not usable (their assets need authentication and cannot be mirrored).

```bash
# 1. Build the package, then move it out of the discovery path: a development
#    build also loads `.dcplugin` files from build/bundled-plugins/ directly.
pnpm run plugin:bundle -- --name cua --platform darwin --arch arm64
mkdir -p /tmp/dc-fixture && mv build/bundled-plugins/*.dcplugin /tmp/dc-fixture/

# 2. Remove the staged runtime so the plugins/ source tree no longer resolves a
#    driver; the host then treats the payload as missing and offers a download.
rm -rf plugins/cua/runtime

# 3. Pin the artifact into a dev-only catalog. --channel pre-release keeps the
#    entry invisible to packaged stable builds.
node scripts/plugin-catalog.mjs generate \
  --artifacts-dir /tmp/dc-fixture \
  --base-url http://127.0.0.1:8787 \
  --channel pre-release \
  --catalog /tmp/dc-catalog.json \
  --write

# 4. Serve the artifacts and run the app against the override.
(cd /tmp/dc-fixture && python3 -m http.server 8787) &
DEEPCHAT_PLUGIN_CATALOG=/tmp/dc-catalog.json pnpm run dev
```

`DEEPCHAT_PLUGIN_CATALOG` is ignored in packaged builds. To exercise mirror fallback, pass
`--mirror http://127.0.0.1:8788/` (mirrors are URL prefixes) and point the second port at a
server that serves a corrupted copy: the pinned sha256 must reject it. For the OCR payload,
stage the runtime layout first (`node scripts/stage-ocr-runtime.mjs --platform darwin --arch
arm64 --out build/ocr-runtime-staging`, after `pnpm run build` and the platform's
`installRuntime` script), then pass `--runtime-dir
build/ocr-runtime-staging/<resources>/app.asar.unpacked/runtime` so `generate` packages the
full closure — `runtime/ocr/**`, the helper, the pinned Node binary, and the light-ocr
packages the manifest references. Build the app with `DEEPCHAT_UNBUNDLE_OCR=1` so the
bundled copy is absent.

Staging on a real prerelease (spec layer L2) is the next step up: publish the `.dcplugin` assets
to a `--prerelease` GitHub release, regenerate the catalog with the real base URL, and verify
with `pnpm run plugin:catalog:verify`.

## Building Without the Bundled Payloads

Two environment switches move an optional payload out of the app so the catalog serves it on
demand. Both default to off, and both keep producing the artifact the catalog needs to pin.

| Switch                   | Effect when set to `1`                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEEPCHAT_UNBUNDLE_CUA`  | `plugin:bundle -- --name cua` writes to `build/remote-plugins/` instead of `build/bundled-plugins/` and skips staging the macOS managed helper            |
| `DEEPCHAT_UNBUNDLE_OCR`  | `afterPack` skips `packageLightOcrAssets`, so the app ships without `runtime/ocr`                                                                         |

`build/remote-plugins/` sits outside the electron-builder `extraResources` glob, and the macOS
helper is what `detect`'s `app-helper:` candidate resolves — skipping both is what makes the
driver genuinely absent rather than merely unreferenced. `plugin:verify --name cua` inverts with
the same switch and fails if the artifact turns up inside the packaged app, so a half-applied
flip cannot pass CI.

```bash
# Package an unbundled build, then pin its artifact for the catalog.
DEEPCHAT_UNBUNDLE_CUA=1 DEEPCHAT_UNBUNDLE_OCR=1 pnpm run build:mac:arm64
node scripts/plugin-catalog.mjs generate \
  --artifacts-dir build/remote-plugins \
  --base-url https://github.com/ThinkInAIXYZ/deepchat/releases/download/v<version> \
  --write
```

The three `_package-*.yml` workflows declare `DEEPCHAT_UNBUNDLE_CUA: '0'`. Flipping it to `'1'`
is the release-side change; it also requires publishing `build/remote-plugins/*.dcplugin` as
release assets and adding them to the fail-closed assembly list. Flipping the OCR switch
additionally requires the packaged Light OCR smoke steps to stop expecting a bundled runtime.

## CI and Release

Native plugin bundling belongs to the three reusable package workflows:

- `.github/workflows/_package-windows.yml`
- `.github/workflows/_package-linux.yml`
- `.github/workflows/_package-macos.yml`

`build.yml`, `release.yml`, and `package-regression.yml` call those workflows with an architecture
matrix instead of repeating plugin logic. The target behavior is:

- **macOS**: bundles both CUA and feishu plugins for arm64 and x64.
- **Linux x64**: bundles both CUA and feishu plugins.
- **Linux arm64**: bundles feishu and deliberately omits unsupported CUA.
- **Windows x64**: bundles both CUA and feishu plugins.
- **Windows arm64**: bundles both CUA and feishu plugins.

Electron Builder embeds `.dcplugin` files from `build/bundled-plugins/` into:

```text
<app>/Contents/Resources/app.asar.unpacked/plugins/     (macOS)
<app>/resources/app.asar.unpacked/plugins/               (Windows/Linux)
```

On macOS, Electron Builder also embeds `build/managed-helpers/DeepChat Computer Use.app` into:

```text
<app>/Contents/Helpers/DeepChat Computer Use.app
```

Each reusable target job verifies the expected bundled `.dcplugin` files inside the packaged app
before creating its package manifest. A missing required plugin fails the job, unless the plugin
was built unbundled, in which case its presence fails the job instead. Linux ARM64 never invokes
CUA packaging, and direct CUA packaging for that unsupported target remains rejected.

Build and Release use distribution mode; package regression uses verification mode. The latter
uploads diagnostics only, so unsigned macOS verification installers and their embedded plugins
never become distributable artifacts. Release accepts the same six target manifests and publishes
app artifacts only; `.dcplugin` files are not separate GitHub Release assets.

Expected embedded files across platform-specific app packages:

```text
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-darwin-x64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-darwin-arm64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-win32-x64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-win32-arm64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-linux-x64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-feishu-<version>-darwin-x64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-feishu-<version>-darwin-arm64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-feishu-<version>-win32-x64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-feishu-<version>-win32-arm64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-feishu-<version>-linux-x64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-feishu-<version>-linux-arm64.dcplugin
```

## Adding a New Plugin

1. Create `plugins/<name>/plugin.json` with required fields (`id`, `name`, `version`, `publisher`,
   `source`, `engines.platforms`, skills, settings contributions).
2. If the plugin needs a native build step, create `scripts/build-<name>-plugin-runtime.mjs`.
3. Test locally: `pnpm run plugin:validate -- --name <name> --platform <platform> --arch <arch>`
4. Add bundling commands once to the relevant OS reusable package workflow.
5. Add verification steps to that reusable workflow and update target/workflow contract tests.
6. If the plugin changes packaged resources, keep its paths covered by the package-impact
   classifier so PR package regression cannot be skipped.
