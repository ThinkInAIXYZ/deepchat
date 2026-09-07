# StepFun Token Plan Provider Spec

## Status

Implemented and maintained.

## Context

DeepChat exposes separate built-in StepFun profiles for standard pay-as-you-go and Step Plan
requests. Each profile has its own provider ID, base URL, credentials, enabled state, and selected
models, so a user can configure both billing routes without replacing an existing profile.

## Goal

Expose the standard StepFun endpoint and Step Plan endpoint as two independent built-in provider
profiles while preserving existing StepFun settings.

## Provider Contract

| Billing mode           | Provider ID         | Display name       | Base URL                               | Model source        | Check model      |
| ---------------------- | ------------------- | ------------------ | -------------------------------------- | ------------------- | ---------------- |
| Standard pay-as-you-go | `stepfun`           | StepFun            | `https://api.stepfun.com/v1`           | `stepfun`           | `step-3.5-flash` |
| Step Plan              | `stepfun-step-plan` | StepFun Token Plan | `https://api.stepfun.com/step_plan/v1` | `stepfun-step-plan` | `step-3.7-flash` |

Both profiles use the existing OpenAI-compatible runtime and API-key credential strategy. API keys
remain stored in main-process provider settings under each provider ID. A user may enter the same
Step API Key in both profiles, but the configurations remain independent.

The built-in provider database already contains separate `stepfun` and `stepfun-step-plan` model
catalogs. DeepChat must bind each profile to its matching catalog so Step Plan-only models such as
`step-router-v1` are not inferred from the standard billing profile.

## User Experience

```text
Providers
  StepFun                 https://api.stepfun.com/v1
  StepFun Token Plan      https://api.stepfun.com/step_plan/v1
```

The existing StepFun profile keeps its ID, name, URL, API key, enabled state, and selected models.
The new StepFun Token Plan profile is added disabled, following the normal built-in-provider merge
behavior. The existing StepFun icon is reused through the model icon registry's provider-ID match.

## Acceptance Criteria

- Existing `stepfun` configurations continue using `https://api.stepfun.com/v1` without migration.
- A disabled `stepfun-step-plan` built-in profile is available at
  `https://api.stepfun.com/step_plan/v1`.
- The Step Plan profile uses OpenAI-compatible Chat Completions with Bearer API-key authentication.
- The Step Plan profile reads models from the `stepfun-step-plan` provider database entry.
- Connection checks use `step-3.7-flash`, as recommended by the official Step Plan quick start.
- Refreshing a Step Plan profile refreshes provider-db metadata before materializing its models.
- Default configuration, runtime mapping, model discovery, and connection-check behavior have
  focused tests.

## Constraints

- Do not replace or mutate the existing `stepfun` profile.
- Do not introduce a StepFun-specific provider class or SDK; the documented API is OpenAI
  compatible.
- Do not share stored credentials implicitly between the two profiles.
- Keep renderer credential handling unchanged; raw API keys remain main-process-owned.
- Use the current generated provider database entry instead of duplicating model metadata in
  source.

## Non-Goals

- Adding StepFun Global (`stepfun.ai`) profiles.
- Adding the Anthropic-compatible Step Plan endpoint used by Claude Code.
- Changing StepFun pricing, quota display, or account subscription management.
- Migrating custom providers that happen to use a StepFun URL.

## References

- Step Plan quick start: <https://platform.stepfun.com/docs/zh/step-plan/quick-start>
- Step Plan subscription: <https://platform.stepfun.com/step-plan>
- Step API keys: <https://platform.stepfun.com/interface-key>
