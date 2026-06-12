# Plan

## Diagnosis

The source entrypoint gates `appMain` behind `runBackgroundExecUtilityHostIfRequested()`, but the
main build inlines dynamic imports. The built `out/main/index.js` still contains `appMain` top-level
startup code after the utility-host branch, so a utility child process can continue into the normal
app lifecycle and exit before responding to exec RPCs.

The utility host also listens to `process.parentPort` as if the callback receives the raw payload.
Electron sends a message event object whose `data` field contains the payload.

The formal `v1.0.5-beta.4` and `v1.0.5-beta.5` macOS arm64 artifacts both contain the same fragile
main-bundle utility entrypoint. A direct `utilityProcess.fork()` probe against those artifacts exits
with code 1 while loading `@electron-toolkit/utils`, because utility processes do not expose
main-process-only Electron exports such as `BrowserWindow`.

## Design

- Move `appMain` side effects into an exported `startApp()` function.
- Add a dedicated `backgroundExecUtilityHost` main build entrypoint that only loads the exec runtime.
- Keep `src/main/index.ts` as the normal app bootstrap and call `startApp()` there.
- Resolve the utility host entrypoint to `out/main/backgroundExecUtilityHost.js` in development,
  unpacked, and packaged app layouts.
- Normalize parent-port messages in the utility host so both raw test payloads and Electron
  `MessageEvent` payloads work.
- Keep the utility host event loop alive while it waits for parent-port RPC messages.
- Remove utility-host imports of `@electron-toolkit/utils`, because it statically imports
  main-process-only Electron exports such as `BrowserWindow`.
- Keep shell environment and session path helpers free of `electron.app` imports so the utility
  process can load the exec runtime.
- Add focused unit coverage for the host message normalization.

## Validation

- Run focused Vitest coverage for background exec runtime tests.
- Rebuild the main bundle and probe `utilityProcess.fork(out/main/backgroundExecUtilityHost.js)`
  with `list` and `start` RPCs.
- Run project formatting, i18n check, and lint after implementation.
