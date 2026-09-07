# StepFun Token Plan Provider Tasks

## Specification

- [x] Confirm the official OpenAI-compatible Step Plan base URL.
- [x] Confirm API-key authentication and the recommended validation model.
- [x] Verify separate standard and Step Plan entries exist in the provider database.
- [x] Define compatibility and non-goals.

## Implementation

- [x] Add the `stepfun-step-plan` default provider profile.
- [x] Add the explicit runtime and provider-db registry definition.
- [x] Include the provider in provider-db refresh classification.
- [x] Keep the existing `stepfun` profile unchanged.

## Tests And Validation

- [x] Cover default profile metadata and distinct URLs.
- [x] Cover registry mapping and credential/check behavior.
- [x] Cover Step Plan provider-db model discovery.
- [x] Run focused provider tests.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
