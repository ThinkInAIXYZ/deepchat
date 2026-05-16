# Tasks

## Shared Types + Runtime
- [x] Add `ModelType.TTS` and `ApiEndpointType.AudioSpeech` in shared model enums.
- [x] Extend model-db schema and parser for `tts` type.
- [x] Add `src/shared/ttsSettings.ts` helpers for pattern detection and format normalization.
- [x] Extend presenter model config contracts with optional `tts` settings.
- [x] Add TTS route in runtime supporting pattern A and pattern B.
- [x] Inject `shouldUseTts` capability check from AI SDK provider.

## Model DB
- [x] Mark relevant `aihubmix` models as `type: "tts"` in provider model list.
- [x] Evaluate whether built-in `xiaomimimo` provider entry exists; it does not, so built-in DB coverage is skipped.

## Renderer
- [x] Extend `useModelTypeDetection` to include `tts` and expose `isTtsModel`.

## Validation
- [x] Run `pnpm run typecheck`.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
