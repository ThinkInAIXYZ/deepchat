# Plan

## Cause

`BaseLLMProvider.fetchModels()` wraps `this.fetchProviderModels().then(...)` in a synchronous `try/catch`. If `fetchProviderModels()` rejects asynchronously (for example `AiSdkProvider.requestProviderJson()` throws `ProviderHttpError` after fetch returns a 404), the rejection bypasses the catch block and propagates to `ModelManager.getModelList()` and the `models:list` route.

## Implementation

- Convert `BaseLLMProvider.fetchModels()` to `async`/`await` so both synchronous throws and asynchronous rejections are caught by the existing error handling.
- Preserve `suppressErrors` semantics:
  - default `true` returns `[]` on failure;
  - `false` rethrows.
- Keep model validation and `configPresenter.setProviderModels()` behavior unchanged.

## Test strategy

- Add a regression test with a provider whose `fetchProviderModels()` rejects asynchronously.
- Assert default `fetchModels()` returns `[]` and does not throw.
- Assert `fetchModels({ suppressErrors: false })` still rejects.
