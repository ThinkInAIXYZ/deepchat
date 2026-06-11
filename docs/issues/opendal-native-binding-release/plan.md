# Plan

## Approach
Use the existing `afterPack` native-package copy pattern already used for FFF and extend it to OpenDAL. Resolve the package from either root `node_modules` or pnpm's virtual root, then copy it into `app.asar.unpacked/node_modules/@opendal/<package>` for the current target platform.

Add `asarUnpack` patterns for `@opendal/lib-*` so native `.node` files are kept outside `app.asar`.

## Validation
- Run `pnpm run format`
- Run `pnpm run i18n`
- Run `pnpm run lint`
- Run `pnpm run typecheck`
- Run a local unpacked mac build if time allows to inspect app resources.
