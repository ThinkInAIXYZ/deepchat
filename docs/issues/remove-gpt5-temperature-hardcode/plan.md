# Remove GPT-5 Temperature Hardcode Plan

## Implementation

- Extend `useModelCapabilities` to expose `supportsTemperatureControl`, using
  `supportsTemperatureControl` first and `temperatureCapability` as the fallback.
- Remove `isGPT5Model` from `useModelTypeDetection` and stop passing it through `ChatConfig`.
- Update `useChatConfigFields` to show temperature unless `supportsTemperatureControl` is exactly
  `false`.

## Test Strategy

- Update model type detection tests to cover only type and provider detection plus reasoning loading.
- Add focused `useChatConfigFields` tests for unsupported, supported, and unknown temperature
  capability states.

## Compatibility

- Capability `null` preserves the previous default-visible behavior for unknown and custom models.
