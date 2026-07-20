# StepFun Token Plan Provider Plan

## Approach

Add `stepfun-step-plan` as a second explicit built-in profile. Keep the provider on the existing
OpenAI-compatible runtime because the official Step Plan quick start documents the Chat
Completions base URL and standard Step API Key authentication.

## Source Changes

1. Add the disabled profile to `src/main/provider/defaults.ts` next to `stepfun`, including Step
   Plan subscription, API-key, quick-start, model, and default-base-URL links.
2. Register `stepfun-step-plan` in `src/main/provider/providerRegistry.ts` with:
   - the Chinese summary behavior preset;
   - provider-db model source `stepfun-step-plan`;
   - `Token Plan` model group;
   - generate-text connection check using `step-3.7-flash`;
   - API-key credential validation.
3. Add the provider ID to `src/shared/providerDbCatalog.ts` so main and renderer refresh flows treat
   it as provider-db-backed.
4. Reuse the existing StepFun icon. `resolveModelIconKey('stepfun-step-plan')` already resolves the
   `stepfun` key, so no renderer asset or component change is required.

## Compatibility

The existing `stepfun` ID and defaults remain unchanged. Provider settings already append newly
introduced default IDs without overwriting stored profiles, so upgrades receive a disabled Step
Plan profile while retaining all existing StepFun data.

No data migration is required. Each provider ID owns its own encrypted API-key setting and model
selection state.

## Test Strategy

- Assert both built-in profiles retain their distinct base URLs and Step Plan documentation.
- Assert `stepfun-step-plan` resolves to the OpenAI-compatible runtime, matching provider-db source,
  API-key validation, and `step-3.7-flash` check model.
- Assert provider-db model discovery requests the `stepfun-step-plan` catalog and assigns returned
  models to the new provider ID.
- Assert the connection check invokes the generic runtime with the Step Plan base URL and official
  validation model.
- Assert provider-db refresh classification includes the new ID and remains case/whitespace
  tolerant.

## Validation

Run the focused provider tests, followed by repository-required formatting, i18n validation, lint,
and node/web type checks.
