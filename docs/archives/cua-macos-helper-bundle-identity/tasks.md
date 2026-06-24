# CUA macOS Helper Bundle Identity Tasks

- [x] T0 Capture the macOS helper identity problem and proposed release-artifact post-processing approach.
- [x] T1 Update CUA macOS runtime staging to output `DeepChat Computer Use.app`.
- [x] T2 Rewrite macOS helper `Info.plist` to DeepChat-owned bundle identity.
- [x] T3 Rename the macOS helper executable to `deepchat-cua-driver` and update runtime detection.
- [x] T4 Remove packaged fallback to `/Applications/CuaDriver.app` or gate it behind development-only behavior.
- [x] T5 Extend CUA packaging validation for app name, bundle id, executable name, and signature.
- [x] T6 Add focused tests for macOS helper bundle rewriting and validation.
- [x] T7 Run formatting, i18n, lint, focused tests, and macOS bundle verification.
- [x] T8 Review and update the permission guide launch chain to open the detected DeepChat helper
  app on macOS before falling back to the external runtime guide.
- [x] T9 Address PR review feedback by filling the renderer MCP store CUA fixture with the
  resolved sidecar env used by the plugin-owned server config.

## Verification Notes

- `pnpm run plugin:bundle -- --name cua --platform darwin --arch x64` passed and the artifact
  contains `DeepChat Computer Use.app/Contents/MacOS/deepchat-cua-driver`.
- `pnpm run plugin:bundle -- --name cua --platform win32 --arch x64` passed.
- `pnpm run plugin:bundle -- --name cua --platform win32 --arch arm64` passed.
- `pnpm run plugin:bundle -- --name cua --platform linux --arch x64` passed.
- `pnpm run plugin:bundle -- --name cua --platform darwin --arch arm64` reached upstream asset
  download and failed with transient GitHub DNS/connection errors in this environment; package tests
  cover the darwin/arm64 manifest and staged runtime layout.
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`,
  `pnpm vitest run test/main/presenter/pluginPresenter.test.ts`, and
  `pnpm vitest run test/main/scripts/packagePlugin.test.ts test/main/scripts/buildCuaPluginRuntime.test.ts test/renderer/stores/mcpStore.test.ts`
  passed after the permission guide launch-chain review.
