# Provider Validation Disabled State Plan

## Scope

The regression is limited to provider settings verification controls in renderer components.

## Implementation

- Gate verify-key entry points on `provider.enable` in the affected settings components.
- Disable the visible verify buttons so the UI matches the runtime behavior.
- Add a focused renderer regression test around `ProviderApiConfig`, which is the shared verify
  entry point for generic providers.

## Test Strategy

- Run the focused renderer test for `ProviderApiConfig`.
- Run repository-required formatting, i18n, and lint checks when dependencies are available.

## Risks

- Low. The change only blocks verification while a provider is explicitly disabled.
