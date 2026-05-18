# Image Generation Context Budget Bypass Plan

## Approach

- Add a model-aware Agent runtime helper that returns true only when DeepChat should use its chat
  context budget.
- Keep ACP bypass behavior, and also bypass when the model config explicitly identifies
  `ImageGeneration`, `TTS`, a non-chat API endpoint, or `endpointType === 'image-generation'`.
- Treat missing legacy model metadata as chat-compatible.

## Runtime Changes

- Use the helper in new user turns and resume/retry context construction before deciding whether to
  compact, trim, or use a finite chat context length.
- Use the helper inside the provider-call wrapper before running preflight/recovery or shrinking the
  per-call `maxTokens`.
- Leave `contextBudget.ts`, public contracts, IPC, and renderer code unchanged.

## Test Strategy

- Add an Agent runtime regression for an image endpoint request that would fail chat-budget
  preflight, asserting the provider is still called and max tokens are preserved.
- Keep chat-model pressure tests verifying the existing budget preflight path still runs.
- Run the targeted Agent runtime/context budget tests plus repository format, i18n, and lint checks.
