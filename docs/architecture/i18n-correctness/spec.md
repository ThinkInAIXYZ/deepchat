# I18n Correctness Contract

## Locale Ownership

`src/shared/locales.ts` is the single manifest for the 20 supported renderer locales, display names,
direction, and resolution policy. Renderer bootstrap, main, Settings, Agent settings tools, and shared
types derive their supported values from this manifest. The manifest does not import renderer
translation resources.

`resolveSupportedLocale()` first matches the normalized complete locale, then applies an explicit
language fallback map. Unknown values resolve to `en-US`. Chinese script and region distinctions
preserve Simplified Chinese, Taiwan Traditional Chinese, and Hong Kong Traditional Chinese.

Native menu lookup uses the resolved exact locale and merges missing fields from `en-US` so callers
always receive a complete result. Existing language-specific translations remain available.

## Translation Resource Contract

- Each locale's `index.ts` registers every JSON namespace in that locale directory.
- Every message preserves the named interpolation parameters of its `en-US` counterpart.
- Literal braces use Vue I18n literal interpolation; a literal `{query}` is not a named parameter.
- Namespace completeness and interpolation checks use Node standard-library code and run through
  `pnpm run i18n:validate`, including from `pnpm run i18n`.
- Vue I18n uses its composition API with `legacy: false` and the `en-US` runtime fallback.

## Compatibility

The stored language remains `system` or a supported full locale code. Invalid and legacy spellings
are normalized deterministically. Locale chunks retain their lazy-loading contract.

This contract does not authorize bulk removal of apparently unused keys, namespace consolidation,
translation rewrites, or deletion of keys that may remain in persisted messages.

## Regression Protection

Shared resolver and native-menu tests cover exact/fallback behavior. Resource-validation fixtures
must detect missing namespace imports/exports and interpolation mismatches. Renderer tests cover
loader, fallback, language-switch races, and direction. Locale resources must satisfy the validation
script before release.
