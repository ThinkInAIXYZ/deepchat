# Electron Vite 5 Upgrade

## Summary

Upgrade `electron-vite` from `^4.0.1` to `5.0.0` using the official migration guide at
`https://cn.electron-vite.org/guide/migration`.

## Goals

- keep current development and build scripts working with `electron-vite@5.0.0`
- remove deprecated v4-only config usage from `electron.vite.config.ts`
- preserve the existing dependency bundling behavior for `main` and `preload`

## Acceptance Criteria

- `package.json` depends on `electron-vite@5.0.0`
- `electron.vite.config.ts` no longer imports or uses `externalizeDepsPlugin`
- the current `main` config still bundles `mermaid` instead of externalizing it
- `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` pass
- typecheck/build validation still passes after the migration

## Non-Goals

- no renderer architecture changes
- no Electron version upgrade
- no bytecode or isolated build adoption as part of this migration

## Migration Notes

- `externalizeDepsPlugin()` is deprecated in v5 and replaced by `build.externalizeDeps`
- this repository does not use `bytecodePlugin`
- this repository already uses static `main`, `preload`, and `renderer` config objects
