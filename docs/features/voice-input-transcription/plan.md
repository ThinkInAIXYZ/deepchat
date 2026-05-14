# Voice Input Transcription Plan

## Implementation Approach

1. Keep the existing model-level `speechRecognition` gate and page-level availability checks unchanged.
2. Replace the renderer speech-recognition implementation with local microphone capture that records audio and normalizes it to `wav` before upload.
3. Add a typed `models.transcribeAudio` route plus renderer `ModelClient` wrapper that accepts `providerId`, `modelId`, `audioBase64`, `mimeType`, and optional `filename`, then returns plain text.
4. Add `LLMProviderPresenter.transcribeAudioStandalone` as a provider-agnostic main-process entry point that prefers provider-native OpenAI-style `/audio/transcriptions` uploads and falls back to `ChatMessage` `input_audio` plus `generateCompletionStandalone` when no direct endpoint is available or the third-party endpoint is unsupported.
5. Keep button/shortcut wiring in `ChatInputBox`, `ChatPage`, and `NewThreadPage`, but only inject text after the transcription route resolves.
6. Keep transcription failures observable by letting the standalone transcription path rethrow provider errors instead of silently returning an empty string.
7. Race the renderer transcription await against local abort/timeout handling so loading clears on cancellation or stalled provider calls.
8. Render recording mode with a waveform-style SVG animation so active capture is obvious.
9. Update existing i18n/button copy from generic voice input wording to local recording wording where needed.

## Affected Areas

- `src/shared/contracts/routes/models.routes.ts`
- `src/shared/contracts/routes.ts`
- `src/shared/types/presenters/llmprovider.presenter.d.ts`
- `src/shared/types/presenters/legacy.presenters.d.ts`
- `src/main/routes/models/modelRouteHandler.ts`
- `src/main/presenter/llmProviderPresenter/index.ts`
- `src/main/presenter/llmProviderPresenter/baseProvider.ts`
- `src/main/presenter/llmProviderPresenter/providers/aiSdkProvider.ts`
- `src/renderer/src/components/chat/ChatInputToolbar.vue`
- `src/renderer/api/ModelClient.ts`
- `src/renderer/src/components/chat/composables/useAudioRecorder.ts`
- `src/renderer/src/components/chat/composables/useSpeechRecognition.ts`
- `src/renderer/src/pages/ChatPage.vue`
- `src/renderer/src/pages/NewThreadPage.vue`
- `src/renderer/src/i18n/**/chat.json`
- `test/renderer/composables/useSpeechRecognition.test.ts`
- `test/main/presenter/llmProviderPresenter/openAICompatibleProvider.test.ts`
- `test/main/presenter/llmProviderPresenter/openAIResponsesProvider.test.ts`
- `test/renderer/components/ChatInputToolbar.test.ts`

## Test Strategy

- Update the focused speech-recognition composable test to cover local recording, wav conversion, transcription success, failure handling, and stalled-request timeout cleanup.
- Add a focused main-presenter test ensuring standalone audio transcription propagates provider errors.
- Run a focused renderer test for the composable first.
- Run a narrow type-aware validation for the touched route/presenter/renderer files, then finish with repo-required format/i18n/lint.
