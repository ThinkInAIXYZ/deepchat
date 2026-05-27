# Chat Audio TTS Routing Plan

## Implementation

- Tighten `isChatAudioTtsModel` so MiMo IDs must match the known MiMo prefixes and include a standalone `tts` segment.
- Update `executeTtsPatternB` to treat `message.content` as unknown response data.
- Extract audio parts only after checking `Array.isArray(message.content)`.
- Keep `message.audio.data` as the first-preference extraction path.
- Leave the existing missing-audio error path in place for responses that contain no audio data.

## Test Strategy

- Add shared helper coverage for MiMo TTS and non-TTS model IDs.
- Extend `test/main/presenter/llmProviderPresenter/aiSdkRuntime.test.ts`.
- Cover `mimo-v2.5-pro` using normal chat streaming instead of direct TTS `fetch`.
- Cover a successful HTTP response with string `message.content` and no audio payload.
- Assert the runtime rejects with the expected missing-audio error, not `content.find is not a function`.

## Compatibility

This change is backward-compatible for actual MiMo TTS models. Non-TTS MiMo chat models stop being routed through TTS handling, while providers returning `message.audio.data` or array content audio parts keep the same behavior.
