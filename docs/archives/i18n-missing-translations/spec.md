# Missing i18n Translations

## User Story

As a DeepChat user, I want every supported locale to provide translations for UI keys that are currently used by the app so that the interface never falls back to raw i18n key strings.

## Acceptance Criteria

- All statically used i18n keys found missing from the active locale bundles are added to every supported locale.
- `pnpm run i18n` reports no missing or invalid translations.
- The generated i18n type definitions include the restored source-locale keys.

## Non-Goals

- Do not rewrite existing translations unrelated to missing keys.
- Do not remove stale extra keys that are not currently used by the UI.
- Do not change runtime i18n loading behavior.

## Constraints

- Keep the existing locale file layout under `src/renderer/src/i18n/<locale>/`.
- Preserve interpolation placeholders such as `{count}` and `{serverName}` exactly where needed.
