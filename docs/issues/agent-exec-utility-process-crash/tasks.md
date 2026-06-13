# Tasks

- [x] Refactor `appMain` startup into an explicit function.
- [x] Add a dedicated utility-host main entrypoint.
- [x] Update `index.ts` to be the normal app bootstrap only.
- [x] Keep the app bootstrap graph out of the utility host.
- [x] Resolve the utility host entrypoint from development and packaged main builds.
- [x] Normalize utility-host parent-port message events.
- [x] Keep the utility host alive while waiting for RPC messages.
- [x] Remove the utility-host logger dependency on `@electron-toolkit/utils`.
- [x] Remove the utility-host shell-env dependency on `electron.app`.
- [x] Remove the utility-host session-path dependency on `electron.app`.
- [x] Add tests for raw payload and MessageEvent payload handling.
- [x] Run focused runtime tests and build/probe validation.
- [x] Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
- [x] Replace `shellEnvHelper` shared logger import with a utility-host-safe logger.
- [x] Add a build-output guard for background exec utility host `@electron-toolkit/utils` imports.
- [x] Rebuild and probe the dedicated utility host entrypoint after the logger-chain fix.
