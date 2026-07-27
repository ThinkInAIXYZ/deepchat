# Plan

## Dependency Design

Keep `typescript` as the dependency name consumed by tools and add a pnpm override to resolve it to
`typescript-native-bridge@6.0.3-bridge.7.tsgo.7.0.2`. This follows TNB's pnpm integration contract
and ensures `vue-tsc` and any other compiler-API consumer share the same implementation.

Replace `vue-tsgo` with `vue-tsc@^3.3.8`. Restore the standard renderer check command:

```sh
vue-tsc --noEmit -p tsconfig.app.json --composite false
```

The Node check also uses TNB's standard compiler entry point:

```sh
tsc --noEmit -p tsconfig.node.json --composite false
```

## Configuration

- Delete `tsconfig.app.tsgo.json`; it only exists for the retired CLI.
- Set `moduleResolution` to `bundler` in `tsconfig.app.json`, preserving the option that the
  dedicated tsgo config previously supplied and avoiding TypeScript 6's retired `node10` default.
- Configure VS Code to load `node_modules/typescript/lib` and prompt contributors to use the
  workspace TypeScript version.
- Remove the experimental native-preview editor recommendation and setting so the editor does not
  bypass the workspace TNB package.

The standard Vue checker reports unused locals that `vue-tsgo` omitted. Remove declarations with no
runtime consumers; preserve the chat search focus contract with an explicit typed function ref.

## Lockfile

Regenerate `pnpm-lock.yaml` with the repository's declared pnpm 10.33.4 release. Confirm the lock
records the TNB package and matching platform optional dependencies and contains no `vue-tsgo` or
`@typescript/native-preview` entries.

## Validation

1. Resolve `typescript` and confirm it points to the TNB package.
2. Run `pnpm run typecheck:node`.
3. Run `pnpm run typecheck:web` and confirm the TNB activation banner appears.
4. Run `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
5. Search tracked source and lock data for retired `vue-tsgo` and `tsconfig.app.tsgo` references.
6. Review the final diff for toolchain-only scope and no generated runtime-resource drift.

## Validation Result

- TNB resolution and activation banner confirmed under Node 24.14.1 and pnpm 10.33.4.
- Format, i18n, lint, Node type-check, and Web type-check passed.
- Focused chat search and ChatPage tests passed: 94 tests.
- Full renderer suite passed: 198 files and 1,567 tests.

## Rollback

Revert the dependency override, restore `vue-tsgo` and its dedicated config, and regenerate the
lockfile. There is no application data or runtime migration.
