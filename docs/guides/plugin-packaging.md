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
deepchat-plugin-feishu-<version>-win32-x64.dcplugin
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

## CI and Release

The build matrix in `.github/workflows/build.yml` bundles plugins before running `electron-builder`
on every platform:

- **macOS**: bundles both CUA and feishu plugins for arm64 and x64.
- **Linux x64**: bundles both CUA and feishu plugins.
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

Each matrix job verifies the expected bundled `.dcplugin` files exist inside the app before
uploading artifacts.

The release workflow (`.github/workflows/release.yml`) repeats the same steps. Final release
uploads app artifacts only; `.dcplugin` files are not published as separate GitHub Release assets.

Expected embedded files across platform-specific app packages:

```text
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-darwin-x64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-darwin-arm64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-win32-x64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-win32-arm64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-linux-x64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-feishu-<version>-darwin-x64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-feishu-<version>-darwin-arm64.dcplugin
```

## Adding a New Plugin

1. Create `plugins/<name>/plugin.json` with required fields (`id`, `name`, `version`, `publisher`,
   `source`, `engines.platforms`, skills, settings contributions).
2. If the plugin needs a native build step, create `scripts/build-<name>-plugin-runtime.mjs`.
3. Test locally: `pnpm run plugin:validate -- --name <name> --platform <platform> --arch <arch>`
4. Add bundling commands to the CI workflows for the relevant platforms.
5. Add verification steps to CI to confirm the `.dcplugin` is embedded in the built app.
