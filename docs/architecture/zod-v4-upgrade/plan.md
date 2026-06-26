# Zod 4 Native Migration Plan

## Approach

1. Upgrade the dependency to `zod@^4.4.3`, remove `zod-to-json-schema` and the
   unused `@vee-validate/zod`, and refresh the lockfile.
2. Add `src/shared/lib/zodJsonSchema.ts` as the shared wrapper around
   `z.toJSONSchema(schema, { io: 'input', unrepresentable: 'throw' })`, returning
   the object schema shape required by project tool consumers.
3. Replace every `zodToJsonSchema(...)` call with the new helper.
4. Migrate Zod 3 legacy and deprecated APIs in source code:
   - `.strict()` -> `z.strictObject(...)`
   - `.passthrough()` -> `z.looseObject(...)`
   - `.strip()` -> plain `z.object(...)`
   - `.merge(...)` -> `.extend(...)` or shape spread
   - `z.nativeEnum(...)` -> `z.enum(...)`
   - one-argument `z.record(...)` -> `z.record(z.string(), ...)`
   - `z.string().url()` -> `z.url()`
   - `error.errors` -> `error.issues`
   - `error.flatten()` -> `z.flattenError(error)`
5. Add migration-focused tests under the main test suite.
6. Harden provider-facing JSON Schema output so root schemas remain plain object
   schemas without root composition or dialect keys.

## Affected Interfaces

- Dependency surface: `package.json`, `pnpm-lock.yaml`.
- Shared helper: `src/shared/lib/zodJsonSchema.ts`.
- Zod schema definitions in shared contracts, main presenter tools, MCP in-memory servers, browser tool definitions, scheduled task normalization, hooks notifications, remote-control types.
- Tests validating Zod 4 migration behavior.

## Compatibility

- IPC route/event names and payload fields remain unchanged.
- Existing tool and MCP schemas remain object schemas with `type`, `properties`, and optional `required`.
- Zod 4 native JSON Schema conversion runs in input mode so defaults/coercions are described as accepted input rather than post-parse output.
- Provider-facing root tool schemas must not expose root `$schema`, `$defs`,
  `$ref`, `oneOf`, `anyOf`, or `allOf`; safe root metadata such as
  `description` may be preserved, and nested property schemas may still use JSON
  Schema composition when needed to represent a real field-level union.
- Root `allOf` schemas produced by Zod intersections are rejected fail-fast
  because flattening them into a provider-facing object schema can weaken
  intersection semantics.
- AI SDK mapper normalization preserves root-level shared `properties` and
  `required` keys when externally supplied tool schemas combine a root object
  with root `oneOf`, `anyOf`, or `allOf` branches.
- Loose schemas intentionally preserve unknown keys, plain object schemas intentionally strip unknown keys, strict schemas intentionally reject unknown keys.

## Test Strategy

- Focused tests:
  - JSON Schema helper representative output.
  - strict object rejects extra keys.
  - loose object preserves extra keys.
  - plain object strips extra keys.
  - default/optional tool args behavior.
  - recursive JSON value record parsing.
  - clean provider-facing root schemas for object unions and nullable objects.
  - rejection of unsupported top-level records, mixed object/non-object unions,
    root intersections, and unrepresentable schema members.
  - AI SDK mapper preservation of shared root properties and required keys when
    normalizing composed external object schemas.
- Targeted commands:
  - `pnpm run test:main -- test/main/routes/contracts.test.ts`
  - `pnpm run test:main -- test/main/presenter/toolPresenter`
  - `pnpm run test:main -- test/main/presenter/mcpPresenter`
- Final commands:
  - `pnpm run format`
  - `pnpm run i18n`
  - `pnpm run lint`
  - `pnpm run typecheck`
  - `pnpm test`
