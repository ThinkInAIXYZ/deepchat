# OpenAI Codex Store Flag Error Plan

## Root Cause

The AI SDK OpenAI Responses provider defaults `openai.store` to `true` when the option is omitted. The ChatGPT Codex backend rejects Codex compatibility requests unless the request body contains `store: false`.

## Implementation Approach

- Add `store: false` to the existing `openai-codex` branch in `buildProviderOptions` alongside `instructions`.
- Add a defensive JSON body rewrite in `createOpenAICodexFetch` so any Codex Responses request body sent through the adapter has `store: false` even if a caller bypasses provider options.
- Preserve non-string bodies and invalid JSON bodies unchanged except for the existing header/auth behavior.

## Affected Files

- `src/main/presenter/llmProviderPresenter/aiSdk/providerOptionsMapper.ts`
- `src/main/presenter/llmProviderPresenter/openaiCodexAdapter.ts`
- `test/main/presenter/llmProviderPresenter/aiSdkProviderOptionsMapper.test.ts`
- `test/main/presenter/llmProviderPresenter/openaiCodexAdapter.test.ts`

## Test Strategy

- Update the provider options mapper tests to assert Codex options include both `instructions` and `store: false`.
- Add an adapter test that inspects the outgoing request body and verifies `store` is forced to `false` even when input JSON contains `store: true`.
- Run focused tests for the touched files, then run project-required format, i18n, and lint commands.
