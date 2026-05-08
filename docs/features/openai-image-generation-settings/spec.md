# OpenAI Image Generation Settings Spec

## User Story

Users who select an OpenAI or OpenAI-compatible image generation model can configure image generation parameters without seeing chat-only settings that do not affect image generation.

## Acceptance Criteria

- OpenAI image-generation routes, image endpoints, imageGeneration model types, and the current `gpt-image-2` fallback use the image-specific settings UI.
- Default UI choices do not persist or send image generation parameters.
- Model-level image settings define defaults for new sessions.
- Session-level image settings can override model-level settings.
- Runtime forwards only valid OpenAI image options to AI SDK image generation.
- Invalid custom sizes cannot be saved from the UI.

## Non-goals

- Do not add support for `n`, `partial_images`, streaming partial images, `input_fidelity`, `style`, or `user`.
- Do not add transparent background support.
- Do not test future or unconfirmed model ids.

## Constraints

- Public config fields remain under `imageGeneration`.
- Unset options must remain `undefined` so OpenAI defaults apply.
- Supported stored fields are `size`, `quality`, `outputFormat`, `outputCompression`, `background`, and `moderation`.
- Custom sizes must use `{width}x{height}`, both dimensions must be multiples of 16, each side must be at most 3840, aspect ratio must be at most 3:1, and total pixels must be between 655360 and 8294400.
