# AI SDK Runtime Spec

## Status

Completed in commit `4c8345a7`.

As of `2026-04-11`, the rollback path is retired. See [../legacy-llm-provider-runtime-retirement/spec.md](../legacy-llm-provider-runtime-retirement/spec.md).

## Goal

Unify DeepChat's low-level LLM request pipeline on Vercel AI SDK while keeping the upper-layer contracts unchanged:

- `BaseLLMProvider`
- `LLMProviderPresenter`
- `LLMCoreStreamEvent`
- existing provider IDs, model configs, and conversation history

The AI SDK runtime is the only remaining implementation.

## Non-Negotiable Compatibility

- No functional regression in text streaming, reasoning streaming, tool call streaming, image output, prompt cache, proxy handling, request tracing, routing, and embeddings.
- `LLMCoreStreamEvent` event names, field names, and stop reasons remain unchanged.
- Existing `function_call_record` history must stay reusable across providers.
- Existing provider list / model list / provider check / key status responsibilities remain in provider classes.

## Runtime Mode

- Single runtime: `ai-sdk`
- `DEEPCHAT_LLM_RUNTIME` has been removed
- config setting `llmRuntimeMode` has been removed

## Scope

Shared runtime under `src/main/presenter/llmProviderPresenter/aiSdk/` provides:

- provider factory
- model / message mapper
- MCP tool mapper
- streaming adapter
- image runtime
- embedding runtime
- provider-options mapper
- reasoning middleware
- legacy function-call compatibility middleware

## Provider Rollout

Phase 1:

- `OpenAICompatibleProvider`
- `OpenAIResponsesProvider`
- all `extends OpenAICompatibleProvider` providers

Phase 2:

- `AnthropicProvider`
- `GeminiProvider`
- `VertexProvider`
- `AwsBedrockProvider`
- `OllamaProvider`

Phase 3:

- `NewApiProvider`
- `ZenmuxProvider`

Out of scope for first unification pass:

- `AcpProvider`
- `VoiceAIProvider`

## Validation Matrix

- pure text
- reasoning native
- reasoning via `<think>`
- native tool streaming
- legacy `<function_call>` fallback
- multi-tool history replay
- image input
- image output
- usage mapping
- prompt cache mapping
- proxy / trace / abort
- embeddings
- retired rollback path verification

## Legacy Removal Exit Criteria

- AI SDK runtime passes the provider regression matrix
- duplicated legacy stream parsers / tool parsers have no remaining callers
- retirement is documented in [../legacy-llm-provider-runtime-retirement/spec.md](../legacy-llm-provider-runtime-retirement/spec.md)
