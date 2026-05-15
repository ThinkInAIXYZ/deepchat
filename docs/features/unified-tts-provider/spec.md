# Unified TTS Provider (Model-Level)

## User Need
Users want TTS integrated as a model capability (`ModelType.TTS`) instead of per-provider custom integration, so any OpenAI-compatible provider can work if its model metadata marks TTS support.

## Goal
Enable model-level TTS routing in DeepChat similar to image generation routing, including:
- Standard OpenAI `/v1/audio/speech` TTS models
- Chat-completions-audio TTS models that return base64 audio

## Acceptance Criteria
1. `ModelType.TTS` is available in shared model contracts and model-db schema.
2. Runtime can route TTS models by model capability metadata and endpoint hints.
3. Runtime supports both TTS patterns and emits `image_data` events with `audio/*` MIME type for existing renderer playback.
4. Model DB can represent TTS model type for built-in provider entries.
5. Frontend model type detection exposes TTS model state for UI behavior alignment.
6. Validation commands pass:
- `pnpm run typecheck`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`

## Constraints
- Reuse existing audio rendering path via `image_data`; avoid introducing new stream event types.
- Keep provider integration generic for OpenAI-compatible providers.
- Do not introduce dedicated UI for TTS settings in this scope.

## Non-Goals
- New TTS player UI.
- Voice catalog fetching UX.
- VoiceAI provider refactor.

## Open Questions
- None for current scope.
