# Plan

## Approach
Treat TTS as a first-class model capability and follow the `ImageGeneration` routing strategy:
- Extend shared model/type schema to include `tts`.
- Add runtime TTS routing ahead of default chat generation.
- Dispatch by model pattern:
  - Pattern A: `/v1/audio/speech`
  - Pattern B: `/v1/chat/completions` with `audio` output
- Normalize returned audio into data URL and cache through existing device cache, then emit `image_data` with audio MIME type.

## Affected Areas
- Shared types/contracts:
  - `src/shared/model.ts`
  - `src/shared/types/model-db.ts`
  - `src/shared/types/presenters/legacy.presenters.d.ts`
  - `src/shared/contracts/common.ts`
  - `src/shared/contracts/domainSchemas.ts`
  - `src/shared/ttsSettings.ts` (new)
- Main runtime/provider:
  - `src/main/presenter/llmProviderPresenter/aiSdk/runtime.ts`
  - `src/main/presenter/llmProviderPresenter/providers/aiSdkProvider.ts`
- Model DB:
  - `resources/model-db/providers.json`
- Renderer model type detection:
  - `src/renderer/src/composables/useModelTypeDetection.ts`

## Compatibility
- Existing chat and image generation paths remain unchanged.
- Existing renderer audio playback remains unchanged because it already handles `image_data` with `audio/*` MIME.

## Verification Strategy
Run:
- `pnpm run typecheck`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
