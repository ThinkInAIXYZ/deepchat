# Plan

## Scope

The scan found four real missing key paths that are referenced from renderer code:

- `mcp.errors.loadClientsFailed`
- `mcp.prompts.required`
- `promptSetting.uploadFailed`
- `settings.mcp.noServersDescription`

`searchDisclaimer` is supplied from each locale `index.ts`, and `settings.display.*` is dynamically built from existing `text-sm`, `text-base`, `text-lg`, `text-xl`, and `text-2xl` keys, so those are not changed.

## Implementation

- Add the missing keys to every locale JSON file in the matching namespace.
- Re-run the i18n type generator so `src/types/i18n.d.ts` reflects the source locale.
- Validate with format, i18n check, and lint.

## Test Strategy

- Run `pnpm run i18n:types`.
- Run `pnpm run format`.
- Run `pnpm run i18n`.
- Run `pnpm run lint`.
