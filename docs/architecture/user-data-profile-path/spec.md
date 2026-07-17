# User Data Profile Path

Status: implemented as a runtime profile path contract and maintained as an architecture spec.

## Summary

DeepChat stores profile-scoped application files under one Electron `userData` profile path, used for settings,
SQLite databases, provider catalog cache, plugin data, OAuth credentials, generated assets, temporary files, and logs.

By default DeepChat uses Electron's standard `userData` path and does not override it. Development, preview, E2E, and
build validation may launch DeepChat with an explicit profile path through `process.env.DEEPCHAT_E2E_USER_DATA_DIR`.

## Path Contract

### Definitions

- **Profile path**: the effective directory returned by `app.getPath('userData')` after startup path selection has run.
- **Default profile path**: Electron's standard `userData` path, `path.join(app.getPath('appData'), 'DeepChat')`. The
  `appData` base directory follows Electron's default and is platform-dependent. App name must stay `DeepChat`, as
  configured in `package.json` and `electron-builder.yml`.
- **Explicit profile path**: a profile path set through `process.env.DEEPCHAT_E2E_USER_DATA_DIR`. When it holds a
  trimmed non-whitespace value, it overrides the default profile path for the current process.

### Explicit Profile Source

The explicit profile path is process-local and does not migrate, copy, or delete data from any other profile.
`DEEPCHAT_E2E_USER_DATA_DIR` reaches the application from two sources:

1. **User-defined**: a user sets it manually for local development, preview, or packaged-build validation,
   e.g. `export DEEPCHAT_E2E_USER_DATA_DIR=/tmp/deepchat-profile`. The Playwright fixture reuses this profile and
   preserves directory after the run.
2. **E2E-defined**: when the variable is unset, the Playwright fixture creates a temporary profile under
   `os.tmpdir()/deepchat-e2e-user-data-*` and deletes it after the run.

## Required Behavior

- Modules covered by this contract must resolve profile-scoped files under the effective profile path.
- Startup must apply the explicit profile path before presenters, windows, databases, caches, or profile-backed
  services are created.
- Modules that resolve profile paths before normal startup must follow the same rule. They may either delay path
  resolution until after startup applies `app.setPath('userData', ...)`, or read `DEEPCHAT_E2E_USER_DATA_DIR` directly
  and fall back to Electron's default path.
- Main-process logs must be written under `<profile-path>/logs/main.log`.
- Provider database cache files must be written under `<profile-path>/provider-db/`.
- While an explicit profile is in effect, the process must confine all profile-scoped reads and writes to that
  profile and must not touch the default profile path, so a default-profile build and an explicit-profile build can
  run at the same time.
- Selecting a profile path must not bypass privacy mode, credential handling, database encryption, or normal app
  settings semantics.
- During E2E test runs, the fixture must pass its selected profile to the launched Electron process through
  `DEEPCHAT_E2E_USER_DATA_DIR`.

## Current Implementation

`src/main/appMain.ts` applies the explicit profile path at the start of `startApp()`:

```typescript
const e2eUserDataDir = process.env.DEEPCHAT_E2E_USER_DATA_DIR?.trim()
if (e2eUserDataDir) {
  app.setPath('userData', e2eUserDataDir)
}
```

Once the Electron app has started and is ready, normal profile data resolves through `app.getPath('userData')`:
application settings (`app-settings.json`), SQLite databases (`app_db/`), OAuth credentials (`*-auth/`), plugins
(`plugins/`), workspaces (`workspaces/`), and generated images (`images/`).

**Early path resolvers** run before startup applies `app.setPath('userData', ...)`, so they should read
`DEEPCHAT_E2E_USER_DATA_DIR` first and fall back to the default profile path.

| Resolver | File | Provides | Rationale (Why not `app.getPath`) |
| --- | --- | --- | --- |
| `log.transports.file.resolvePathFn` | `src/shared/logger.ts` | log `logs/main.log` | `appMain.ts` → `logger.ts` |
| `ProviderDbLoader.userDataDir` | `src/main/provider/providerDbLoader.ts` | model provider `provider-db/` | `appMain.ts` → `app/mainProcess.ts` → `app/composition.ts` → `providerDbLoader.ts` |
| `getDefaultUserDataDir()` | `test/e2e/fixtures/electronApp.ts` | profile root | No Electron `app` |

## Acceptance Criteria

- With `DEEPCHAT_E2E_USER_DATA_DIR` unset or whitespace-only, startup does not call `app.setPath('userData', ...)` and
  DeepChat runs on Electron's default profile path.
- With `DEEPCHAT_E2E_USER_DATA_DIR` set to a non-empty absolute path, startup applies that path before profile-backed
  runtime initialization.
- In application startup and early path resolvers, whitespace-only `DEEPCHAT_E2E_USER_DATA_DIR` is treated as unset.
- Main-process logs are created under `<profile-path>/logs/main.log`.
- Provider database cache files are created under `<profile-path>/provider-db/`.
- With `DEEPCHAT_E2E_USER_DATA_DIR` already set, the E2E fixture uses that directory and must not delete it.
- With `DEEPCHAT_E2E_USER_DATA_DIR` unset, the E2E fixture creates a temporary profile and deletes only that
  fixture-owned directory after the run.
- No code path uses `DEEPCHAT_E2E_USER_DATA_DIR` as a signal for smoke tests, CI, mocks, disabled network access, or
  alternate provider behavior.

## Non-Goals

- Profile-path override mechanism other than `DEEPCHAT_E2E_USER_DATA_DIR`.

## Validation

- Launch with `DEEPCHAT_E2E_USER_DATA_DIR` set to a profile directory and verify profile-backed files appear under
  that directory.
- Verify `logs/main.log` is created under the selected profile path.
- Verify provider DB cache files are created under the selected profile path.
- Run a Playwright spec with `DEEPCHAT_E2E_USER_DATA_DIR` unset and verify the fixture-owned temporary directory is
  deleted.

## Open Questions

None.
