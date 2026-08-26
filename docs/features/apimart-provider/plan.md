# APIMart Provider Plan

## Approach

Register APIMart on the existing OpenAI-compatible AI SDK runtime for chat, embeddings, speech,
and transcription. Add one dedicated provider adapter for APIMart's expanded model metadata and
asynchronous image/video task protocol. Keep routing in the main process and reuse existing
renderer configuration controls.

## Implementation

- [x] Add the disabled APIMart default profile and explicit runtime registry definition.
- [x] Add account-scoped expanded model discovery and metadata classification.
- [x] Route chat models from catalog endpoint metadata across Responses, Anthropic, Gemini, and
      Chat Completions.
- [x] Re-resolve APIMart routes per request so session model configuration cannot pin stale
      endpoints.
- [x] Add asynchronous image/video task submission, polling, cancellation, and output handling.
- [x] Select the dedicated adapter from the provider instance manager.
- [x] Add the official favicon to the renderer icon registry.
- [x] Add focused provider and renderer regression coverage.

## Validation

- [x] Run focused APIMart provider and icon tests.
- [x] Run provider/default/runtime regression tests affected by registration.
- [x] Run `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, and `pnpm run typecheck`.
