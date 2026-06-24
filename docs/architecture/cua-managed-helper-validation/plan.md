# CUA Managed Helper Validation Plan

## Runtime Resolution

Add an `app-helper:` runtime detect prefix for official plugin manifests. It resolves to
`DeepChat.app/Contents/Helpers/<relative-path>` only when all of the following are true:

- the current platform is `darwin`
- the app is packaged
- `process.resourcesPath` is available
- the relative path stays inside `Contents/Helpers`

If any condition fails, the candidate returns `null` and normal detect iteration continues to the
plugin-local helper path.

## Build Staging

When `pnpm run plugin:bundle -- --name cua --platform darwin --arch <arch>` runs:

1. `scripts/build-cua-plugin-runtime.mjs` stages the target CUA helper under
   `plugins/cua/runtime/darwin/<arch>/DeepChat Computer Use.app`.
2. `scripts/plugin.mjs` copies that helper to
   `build/managed-helpers/DeepChat Computer Use.app`.
3. `electron-builder.yml` copies `build/managed-helpers/*` into macOS `Contents/Helpers`.

The standalone plugin package still contains the helper runtime as a fallback and for non-managed
contexts.

## Validation

Package validation will require the CUA manifest to contain the managed-helper candidate first for
macOS:

```text
app-helper:DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver
plugin:runtime/darwin/<arch>/DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver
plugin:runtime/win32/<arch>/cua-driver.exe
plugin:runtime/linux/<arch>/cua-driver
```

## Risk Notes

- This validates packaging identity and launch path. macOS TCC attribution still requires testing a
  signed packaged build on macOS.
- A copied helper inside `Contents/Helpers` must be included before signing/notarization so the final
  app bundle remains valid.
- Running multiple macOS arch builds in one workspace should re-stage the helper before each
  electron-builder invocation.
