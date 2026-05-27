# Chat Audio TTS Routing

## User Story

When a MiMo chat model is selected, DeepChat should only enter chat-audio TTS handling for model IDs that are actually TTS variants. Regular MiMo chat models such as `MiMo-V2.5-Pro` should use the normal chat streaming runtime.

## Acceptance Criteria

- `mimo-v2.5-pro` and provider-prefixed variants are not classified as TTS models.
- MiMo model IDs with a `tts` segment, such as `mimo-v2.5-tts`, continue to use chat-audio TTS Pattern B.
- Chat-audio TTS responses with `choices[0].message.audio.data` continue to emit cached audio.
- Chat-audio TTS responses with array `choices[0].message.content` can still extract an audio content part.
- Chat-audio TTS responses with string `choices[0].message.content` do not throw a `TypeError`.
- If no audio payload exists, DeepChat raises the existing missing-audio error instead of a response-shape crash.

## Non-Goals

- No changes to renderer audio display behavior.
- No changes to request body construction for chat-audio TTS models.

## Constraints

- Keep the fix localized to the AI SDK runtime.
- Keep TTS model classification in shared helpers so provider and agent runtime checks agree.
- Preserve current OpenAI-compatible chat-audio behavior.
- Add focused regression coverage for the reported MiMo Pro misrouting and response shape.
