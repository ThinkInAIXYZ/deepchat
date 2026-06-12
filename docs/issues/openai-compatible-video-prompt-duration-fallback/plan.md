# Plan

## Approach
Add a small runtime helper that extracts an integer duration from obvious prompt hints only when structured video settings are absent and the parsed value is supported by the active model, then reuse that helper for both request tracing and the actual `/videos` request body.

## Implementation
- Add a focused runtime test that exercises the OpenAI-compatible `/videos` flow and asserts `duration: 2` is sent for prompts like `... 2s`.
- Add a conservative prompt-duration extractor for `Ns`, `N sec`, `N seconds`, and `N秒`.
- Enforce model-specific validity before injecting the derived duration (for Seedance, `4~15`).
- Apply the fallback only when `videoGeneration.duration` and `videoGeneration.seconds` are both unset.

## Affected Files
- `src/main/presenter/llmProviderPresenter/aiSdk/runtime.ts`
- `test/main/presenter/llmProviderPresenter/aiSdkRuntime.test.ts`
- `docs/issues/openai-compatible-video-prompt-duration-fallback/tasks.md`

## Validation
- Focused AI SDK runtime tests for video request bodies.
- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
