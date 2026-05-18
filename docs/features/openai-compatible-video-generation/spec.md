# OpenAI-Compatible Video Generation

## User Need
Users need DeepChat to recognize and run video generation models such as `doubao-seedance-2-0-fast-260128` through the same model-driven provider flow used by text and audio generation, without hardcoding one-off provider logic for each future video model.

## Goal
Enable first-class video generation routing in DeepChat for OpenAI-compatible providers, starting with AIHubMix Seedance models and leaving a compatibility layer for future video models.

## Acceptance Criteria
1. Shared model/type contracts support `videoGeneration` and preserve compatibility with existing model metadata.
2. DeepChat can recognize `doubao-seedance-2-0-fast-260128` as a video generation model even when upstream metadata is incomplete or still marked as `chat`.
3. Main runtime can route video generation requests through an OpenAI-compatible `/v1/videos` flow.
4. Video generation responses are normalized into a stable internal result shape that future providers/models can reuse.
5. Generated video output reaches the existing assistant message pipeline and renders in the chat UI.
6. Validation commands pass:
- `pnpm run typecheck`
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`

## Constraints
- Keep the provider integration generic for OpenAI-compatible video endpoints.
- Reuse the current assistant media block pipeline where practical instead of introducing a parallel storage format.
- Do not scope in advanced video editing controls or provider-specific parameter UIs for this change.

## Non-Goals
- Dedicated video generation settings panels.
- Agent-level video generation tool configuration.
- Non-OpenAI-compatible video provider protocols.

## Open Questions
- None for current scope.
