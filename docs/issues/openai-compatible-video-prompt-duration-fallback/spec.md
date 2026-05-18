# OpenAI-Compatible Video Prompt Duration Fallback

## User Need
When users send prompts such as `生成 马斯克 喝酒的视频 2s` to OpenAI-compatible video models, DeepChat should preserve the obvious structured duration hint instead of sending only the raw prompt body.

## Goal
Infer an explicit video duration from clear prompt suffixes like `5s` or `5秒` when the session has no structured video duration configured and the parsed value is valid for the target model.

## Acceptance Criteria
1. OpenAI-compatible video requests derive `duration` from obvious prompt hints when neither `duration` nor `seconds` is already configured and the parsed value is valid for the current model.
2. Explicit structured video settings still take precedence over any prompt-derived fallback.
3. The emitted request trace matches the actual `/videos` body for this fallback.
4. Focused validation passes for the touched runtime slice.

## Constraints
- Keep the fallback narrow and conservative; do not attempt broad natural-language parameter parsing.
- Preserve existing request-shape compatibility and polling behavior.

## Non-Goals
- Adding or changing video settings UI.
- Parsing arbitrary style, ratio, or resolution hints from prompts.
- Changing provider safety or moderation behavior.

## Open Questions
- None.
