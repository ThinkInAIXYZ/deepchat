# Plan

## Approach
Treat video generation as a first-class model capability parallel to image generation and TTS:
- Extend shared model/type enums and model-db parsing to include `videoGeneration`.
- Add a shared video compatibility helper that can recover video intent from model metadata, endpoint hints, modalities, or known model ID patterns when upstream data is incomplete.
- Add an OpenAI-compatible video runtime path that sends requests to `/v1/videos`, normalizes provider responses, and emits media output into the assistant stream.
- Reuse the current assistant media block transport by carrying video payloads through the existing message block structure with video MIME detection on the renderer side.

## Affected Areas
- Shared types/contracts:
  - `src/shared/model.ts`
  - `src/shared/types/model-db.ts`
  - `src/shared/types/presenters/llmprovider.presenter.d.ts`
  - `src/shared/types/presenters/legacy.presenters.d.ts`
  - `src/shared/videoGenerationSettings.ts` (new)
- Main runtime/provider:
  - `src/main/presenter/configPresenter/index.ts`
  - `src/main/presenter/configPresenter/modelConfig.ts`
  - `src/main/presenter/llmProviderPresenter/index.ts`
  - `src/main/presenter/llmProviderPresenter/providers/aiSdkProvider.ts`
  - `src/main/presenter/llmProviderPresenter/aiSdk/runtime.ts`
- Renderer:
  - `src/renderer/src/composables/useModelTypeDetection.ts`
  - `src/renderer/src/components/chat/messageListItems.ts`
  - `src/renderer/src/components/message/MessageItemAssistant.vue`
  - `src/renderer/src/components/message/MessageBlockVideo.vue` (new)
  - `src/renderer/settings/components/ProviderModelList.vue`
- Model DB:
  - `resources/model-db/providers.json`

## Compatibility
- Existing text, image, and TTS paths remain unchanged.
- Existing assistant block persistence remains compatible by reusing the current media payload field rather than changing the storage shape.
- Future video models can plug in through shared detection helpers or explicit `videoGeneration` metadata.

## Verification Strategy
Run:
- `pnpm run typecheck`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
