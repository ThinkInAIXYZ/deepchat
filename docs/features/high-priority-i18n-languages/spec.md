# High Priority i18n Languages

## User Stories

- As a DeepChat desktop user in Spain, Germany, Turkey, Indonesia, Malaysia, Italy, Poland, or Vietnam, I can select my language in Display settings and use the app with readable local UI text.
- As a user whose system locale is one of the supported locales, DeepChat can resolve the matching app language when language is set to System.
- As an Agent Skills user, product and technical names such as DeepChat, Agent, Skills, MCP, Dify, and model/provider names remain recognizable and are not mistranslated.

## Acceptance Criteria

- Add full renderer i18n bundles for `es-ES`, `de-DE`, `tr-TR`, `id-ID`, `ms-MY`, `it-IT`, `pl-PL`, and `vi-VN`.
- Each new locale has the same JSON files and key structure as `zh-CN`.
- New locales are registered in renderer, settings renderer, floating renderer, language selector options, system-locale matching, shared chat settings types, and DeepChat settings Agent tool language schema.
- Shared native menu and error-label translations support the new locales where the shared i18n helper is used.
- Translation wording follows the Chinese source meaning, with English used as length/reference for Latin-script languages.
- Product and domain terms stay untranslated where requested: DeepChat, Agent, Skills, MCP, Dify, model/provider brand names, API, JSON, URL, token, prompt, and similar technical identifiers.
- `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` pass.

## Non-Goals

- No UI layout redesign.
- No new runtime language-loading architecture.
- No locale-specific date, number, or plural-rule behavior beyond existing vue-i18n support unless needed by validation.

## Constraints

- Preserve existing keys, placeholders, interpolation variables, markdown, and JSON syntax.
- Keep translations clear for desktop application users; avoid jargon-heavy or literal machine-style phrasing.
- Resolve implementation without `[NEEDS CLARIFICATION]` markers.
