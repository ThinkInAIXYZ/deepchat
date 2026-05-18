# Tasks

## Shared Types + Detection
- [x] Add `ModelType.VideoGeneration` and extend model-db parsing/schema for `videoGeneration`.
- [x] Add shared video detection/compatibility helpers for endpoint hints, modalities, and known model IDs.
- [x] Update model config inference to classify video models consistently in main and renderer flows.
- [x] Extend session generation settings/contracts and draft state to carry `videoGeneration` options.

## Runtime + Provider
- [x] Add `generateVideoStandalone` presenter contracts and implementation.
- [x] Add OpenAI-compatible `/v1/videos` request/response normalization in the AI SDK runtime/provider path.
- [x] Persist and sanitize session-level video generation settings through agent runtime and sqlite storage.
- [ ] Mark Seedance built-in model metadata as `videoGeneration` where available.

## Renderer
- [x] Expose video model detection for UI behavior alignment.
- [x] Add assistant message rendering for generated video media.
- [x] Update model list/type display for video generation models.
- [x] Expose video generation settings in chat status bar and model config dialog flows.

## Validation
- [x] Run `pnpm run typecheck`.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
