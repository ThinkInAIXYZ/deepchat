# Voice Input Transcription

## User Need

Users can click the chat mic button, speak directly, and have recognized text inserted into the input box without manually attaching audio files.

## Goal

- Add local audio capture plus model-based transcription support in renderer chat inputs.
- Let each model opt into the mic affordance through a model-level `语音识别` setting.
- Insert recognized speech into the existing text input flow only after transcription succeeds.
- Keep the transcription entry point provider-agnostic so providers beyond Xiaomi Mimo can reuse it.

## Acceptance Criteria

- Chat and new-thread input areas can start/stop local recording from the mic button or shortcut.
- The mic button and shortcut only work when the effective current model config has `speechRecognition === true`.
- Local recording is converted to `wav`, sent through a typed route with `{ providerId, modelId, audioBase64, mimeType, filename? }`, and returns `{ text }`.
- The main-process transcription flow prefers an OpenAI-compatible `multipart/form-data` `/audio/transcriptions` request for providers that support it, while automatically falling back to the existing `ChatMessage` `input_audio` + standalone completion path when that endpoint is unavailable on third-party OpenAI-compatible services.
- Recognized speech is inserted into the current input box text only after the transcription response returns successfully.
- A model-level `语音识别` setting controls whether the mic entry point is available for that model.
- The mic button shows a clearly active recording state with a waveform-style SVG animation while the microphone is capturing.
- Unsupported browsers, denied microphone permissions, or transcription failures show an i18n user-facing explanation instead of failing silently.
- Provider/runtime transcription errors surface a user-facing failure state instead of being collapsed into an empty transcript.
- If transcription stalls, the UI must leave the loading state after a bounded timeout or user cancellation instead of spinning indefinitely.

## Constraints

- Keep capture local in the renderer, but allow a transient audio upload to the selected model runtime for transcription.
- Use the typed route system rather than Mimo-only branches or ad hoc IPC.
- Preserve the existing mic gate logic in page components.
- Reuse the existing chat input/editor flow rather than introducing a parallel composer.
- Prefer OpenAI-style audio transcription compatibility when the selected provider/runtime exposes that endpoint.
- Preserve current send, queue, and command-submission behavior.
- Do not persist raw microphone audio after transcription completes.

## Non-Goals

- Persisting raw microphone audio.
- Wake-word detection or always-on listening.
- Building a Xiaomi-only transcription code path.
