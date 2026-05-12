# Implementation Plan

## UI

- Remove status badges from the provider navigation rows and provider detail header.
- Keep the enabled model count badge in the provider detail header.
- Remove the outer rounded/shadow treatment from `ProviderModelManager`.
- Replace the four-tab provider detail layout with three tabs.
- Render `ProviderRateLimitConfig` inside Advanced above provider-specific settings.

## Compatibility

The change is presentation-only. Existing provider, model, and rate limit data flows remain unchanged.

## Validation

- Run repository-required `pnpm run format`, `pnpm run i18n`, and `pnpm run lint`.
- Run `pnpm run typecheck:web` for Vue template safety.
