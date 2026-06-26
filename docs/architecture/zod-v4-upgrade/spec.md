# Zod 4 Native Migration

## User Need

The user wants DeepChat to upgrade Zod from 3.x to the current stable 4.x release
and adopt the recommended Zod 4 APIs instead of doing a minimal compatibility
upgrade.

## Goal

Upgrade to `zod@^4.4.3`, remove Zod 3 legacy and deprecated API usage, and keep
the existing IPC contracts, MCP/tool schemas, persisted data formats, and business
behavior stable.

## Acceptance Criteria

- `package.json` uses `zod@^4.4.3` and no longer declares direct dependencies on
  `zod-to-json-schema` or the unused `@vee-validate/zod`.
- Project Zod schemas use the recommended Zod 4 APIs:
  - `z.strictObject(...)`
  - `z.looseObject(...)`
  - plain `z.object(...)` for strip behavior
  - `z.flattenError(...)`
  - `z.enum(EnumName)`
  - two-argument `z.record(...)`
  - top-level string format helpers such as `z.url()`
- MCP/tool JSON Schema conversion uses the native Zod 4 `z.toJSONSchema(...)`
  API through a project helper that returns the object schema shape required by
  existing tool consumers.
- Provider-facing tool schemas keep root JSON Schema composition out of the
  published root object shape; Zod intersection/root `allOf` schemas are
  rejected fail-fast until their semantics can be represented safely.
- AI SDK tool schema normalization preserves shared root object fields when it
  flattens externally supplied root composition schemas.
- Route and event contract public wire shapes remain unchanged.
- Migration-focused tests cover strict, loose, and strip behavior, the JSON
  Schema helper, default and optional tool parameters, and recursive JSON record
  parsing.
- `format`, `i18n`, `lint`, `typecheck`, and relevant tests pass.

## Constraints

- Do not introduce `zod/mini`.
- Do not refactor business logic.
- Do not change IPC route or event names, payload fields, persisted schemas, or
  MCP tool names.
- Keep the existing `import { z } from 'zod'` import style.

## Non-goals

- Do not migrate to a new form validation approach.
- Do not redesign MCP/tool business parameters.
- Do not refactor the typed route/event contract abstraction.
- Do not track Zod canary releases.

## Open Questions

None.
