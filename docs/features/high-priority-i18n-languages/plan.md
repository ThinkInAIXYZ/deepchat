# High Priority i18n Languages Plan

## Scope

Implement the requested locales by following the existing static i18n bundle pattern. The source of truth for required keys is `src/renderer/src/i18n/zh-CN`, with `en-US` as a secondary reference for shorter Latin-script phrasing.

## Implementation

- Create one locale directory per target locale under `src/renderer/src/i18n/`.
- Reuse the existing locale `index.ts` import/export shape for each new locale.
- Register new locale modules in `src/renderer/src/i18n/index.ts`.
- Add language options in `src/renderer/settings/components/DisplaySettings.vue`.
- Add new locale codes to `ConfigPresenter.getSystemLanguage()`, `ChatLanguage`, and the DeepChat settings Agent tool schema.
- Extend shared context-menu and error-message translations in `src/shared/i18n.ts`.
- Keep RTL handling unchanged because all requested locales are LTR.

## Validation

- Run a structural comparison against `zh-CN` for all target locale JSON files.
- Run `pnpm run format`.
- Run `pnpm run i18n`.
- Run `pnpm run lint`.

## Risks

- The largest risk is incomplete or malformed JSON translation files. Mitigation: validate parseability and exact key parity.
- Some UI strings may become long in German, Polish, Turkish, or Vietnamese. Mitigation: prefer natural but concise desktop UI wording and use English as a length reference where appropriate.
