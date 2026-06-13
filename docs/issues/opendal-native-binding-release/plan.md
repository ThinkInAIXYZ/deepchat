# Plan

## Approach
Use the normal dependency-graph path used by native packages that are loaded through Node's module resolver. Add the platform OpenDAL binding packages as root optional dependencies so electron-builder sees them before creating `app.asar`, then unpack those packages with `asarUnpack`.

Keep the FFF-only `afterPack` copy path separate. FFF resolves copied binaries by explicit file path; OpenDAL's generated loader uses `require()`, so its binding package must exist in the packed dependency graph.

## Validation
- Run `pnpm run format`
- Run `pnpm run i18n`
- Run `pnpm run lint`
- Run `pnpm run typecheck`
- Run a local unpacked mac build if time allows to inspect app resources.
