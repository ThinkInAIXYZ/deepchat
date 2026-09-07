# TypeScript Native Bridge

## Toolchain Contract

Renderer checking runs `vue-tsc` against the single `tsconfig.app.json`; main checking runs `tsc`
against `tsconfig.node.json`. The pnpm `typescript` override selects
`typescript-native-bridge@6.0.3-bridge.7.tsgo.7.0.2` for compiler-API consumers, preserving the TypeScript
6.0.3 API while delegating semantic checks to tsgo. Editors use `node_modules/typescript/lib`.

`vue-tsgo`, `tsconfig.app.tsgo.json`, and the direct `@typescript/native-preview` integration remain
absent. The repository's current Node and pnpm requirements are declared in `package.json`.

## User Story

As a DeepChat contributor, I want renderer type checking to use the standard `vue-tsc` workflow
backed by TNB so that Vue tooling keeps its normal API contract while retaining native checker
performance.

## Acceptance Criteria

- `pnpm run typecheck:web` runs `vue-tsc` against `tsconfig.app.json`.
- pnpm resolves every `typescript` consumer to
  `typescript-native-bridge@6.0.3-bridge.7.tsgo.7.0.2`.
- `vue-tsgo` and `tsconfig.app.tsgo.json` are absent from active configuration and the lockfile.
- Workspace TypeScript settings point editors at `node_modules/typescript/lib`.
- `pnpm run typecheck:node` runs TNB's `tsc` against `tsconfig.node.json`.
- `@typescript/native-preview` is absent from active configuration and the lockfile.
- Install, format, i18n, lint, Node type-check, and Web type-check gates pass.

## Non-goals

- Changing application runtime code or generated runtime resources.
- Introducing fallback type-check paths or opt-out flags.

## Constraints

- Pin the TNB release exactly because its platform packages and tsgo engine are released as one
  versioned unit.
- Keep `tsconfig.app.json` as the single renderer TypeScript configuration.
- The migration must not change production dependencies or packaged application behavior.

## Compatibility

TNB supports Node 20.19 and newer; DeepChat requires Node 24.18.0. `vue-tsc` accepts TypeScript 5
and newer, and TNB exposes the TypeScript 6.0.3 API expected by the current project.
