# OpenAI Image Generation Settings Plan

## Architecture

- Keep the shared `ImageGenerationOptions` type and contracts.
- Rename gpt-image-2-specific helpers, constants, validators, and UI component names to OpenAI image generation settings names.
- Store session image settings as JSON in `deepchat_sessions`; keep the existing v27 migration.
- Keep model-level settings in the existing model config JSON store.

## Data Flow

- Settings dialog writes model-level `imageGeneration` when `supportsOpenAIImageGenerationSettings(...)` is true.
- Chat status bar writes session-level `imageGeneration` under the same capability check.
- Agent runtime merges effective session settings into `ModelConfig`.
- AI SDK runtime passes `size` at the `generateImage()` top level and OpenAI provider options through `providerOptions`.

## Compatibility

- Existing sessions without image settings behave exactly as before.
- Empty or invalid stored image settings are treated as unset.
- Existing chat-model settings remain unchanged for models outside the OpenAI image settings capability.
- The `deepchat_sessions` migration stays at version 27 because the global schema version is already 26.

## Tests

- Runtime tests use `gpt-image-2` for empty options and option forwarding.
- Contract and SQLite tests verify config round trips.
- Renderer component tests use `gpt-image-2` as the positive image settings fixture and existing chat model ids as generic fallbacks.
