# OpenAI Codex Unsupported Responses Parameters Plan

## Root Cause

DeepChat calls AI SDK `streamText` with `maxOutputTokens`. The AI SDK OpenAI Responses provider serializes that option as `max_output_tokens`. The ChatGPT Codex backend currently rejects this parameter on the Codex compatibility endpoint.

## Implementation Approach

- Extend the Codex adapter JSON request-body normalization.
- Keep forcing `store: false`.
- Delete `max_output_tokens` from object request bodies before fetch.
- Keep the normalization inside `createOpenAICodexFetch` so ordinary OpenAI Responses requests keep their normal `max_output_tokens` behavior.

## Affected Files

- `src/main/presenter/llmProviderPresenter/openaiCodexAdapter.ts`
- `test/main/presenter/llmProviderPresenter/openaiCodexAdapter.test.ts`

## Test Strategy

- Update the Codex adapter request-body test to assert `max_output_tokens` is removed and `store` stays false.
- Run focused Codex adapter/provider-option tests, then project-required format, i18n, and lint commands.
