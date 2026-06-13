# Vite Presenter Dynamic Import Warning Plan

## Approach

Replace the `DevicePresenter -> presenter/index` dynamic import with a narrow reset-runtime port.
The concrete `Presenter` owns the actual SQLite and Knowledge presenter instances and injects only
the cleanup operations needed by `DevicePresenter.resetDataByType()`.

## Changes

- Add a local `DeviceResetRuntime` type with `closeSqlite` and `destroyKnowledge` callbacks.
- Let `DevicePresenter` accept and update that runtime dependency without importing the presenter
  registry.
- Inject the runtime from `Presenter` after `KnowledgePresenter` is constructed.
- Add focused unit coverage for the injected reset cleanup path.

## Validation

- `pnpm exec vitest run test/main/presenter/devicePresenter.test.ts --silent --reporter=dot`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm exec electron-vite build`
