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

## CUA Plugin Artifacts

The CUA plugin ships one macOS helper app per CPU architecture. The bundled package filename
includes both platform and architecture:

```text
deepchat-plugin-cua-<version>-darwin-arm64.dcplugin
deepchat-plugin-cua-<version>-darwin-x64.dcplugin
```

The manifest inside each package keeps the official DeepChat release-download namespace for trust
metadata. Runtime detection inside the package uses the same architecture-specific plugin path:

```text
plugin:runtime/darwin/<arch>/DeepChat Computer Use.app/Contents/MacOS/cua-driver
```

Architecture mapping:

| DeepChat arch | Swift arch | Runtime directory |
| --- | --- | --- |
| `arm64` | `arm64` | `runtime/darwin/arm64/` |
| `x64` | `x86_64` | `runtime/darwin/x64/` |

Each `.dcplugin` contains only the runtime directory for its target architecture.

## Local Commands

Validate the package metadata for the current host architecture:

```bash
pnpm run plugin:cua:validate
```

Build and package the current host architecture:

```bash
pnpm run plugin:cua:package
```

Build and package explicit macOS architectures:

```bash
pnpm run plugin:cua:package:mac:arm64
pnpm run plugin:cua:package:mac:x64
```

Build the package that will be embedded into the macOS app:

```bash
pnpm run plugin:cua:bundle:mac:arm64
pnpm run plugin:cua:bundle:mac:x64
```

Validate explicit macOS architectures after their helper runtimes have been staged:

```bash
pnpm run plugin:cua:validate:mac:arm64
pnpm run plugin:cua:validate:mac:x64
```

Standalone packages are written to:

```text
dist/plugins/
```

Bundled packages are written to:

```text
build/bundled-plugins/
```

## CI And Release

The macOS build matrix in `.github/workflows/build.yml` builds the matching CUA plugin bundle before
running `electron-builder`. Electron Builder embeds it into:

```text
DeepChat.app/Contents/Resources/app.asar.unpacked/plugins/
```

Each matrix job verifies the expected bundled `.dcplugin` exists inside the app before uploading
artifacts.

The release workflow repeats the same bundled package step. The final release uploads app artifacts
only; `.dcplugin` files are not published as separate GitHub Release assets.

Expected embedded files:

```text
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-darwin-x64.dcplugin
app.asar.unpacked/plugins/deepchat-plugin-cua-<version>-darwin-arm64.dcplugin
```
