# Legacy Provider Runtime Retirement Spec

## Status

Completed on `2026-04-11`.

The hidden rollback window is closed. `llmProviderPresenter` now runs on AI SDK only.

## Goal

Retire the legacy provider runtime and remove obsolete provider SDK dependencies without changing upper-layer contracts:

- `BaseLLMProvider`
- `LLMProviderPresenter`
- `LLMCoreStreamEvent`
- existing provider IDs, model configs, conversation history, and `function_call_record` compatibility

## Scope

- Remove `DEEPCHAT_LLM_RUNTIME`
- Remove config key `llmRuntimeMode`
- Delete `src/main/presenter/llmProviderPresenter/aiSdk/runtimeMode.ts`
- Remove legacy-only provider branches, stream parsers, and MCP conversion ports
- Keep provider-managed responsibilities that still matter:
  - `ollama` local model management
  - `@aws-sdk/client-bedrock` model discovery

## Runtime State After Retirement

- Single runtime: `ai-sdk`
- No hidden fallback
- No provider-specific MCP conversion APIs exposed from presenters
- Vendor-specific request body customization is handled via AI SDK provider options mapping

## Historical Anchors

- AI SDK migration landed in commit `4c8345a7`
- Legacy provider implementation can be inspected at commit `3add4093b46f15072d5ec3a65c8097e23b4907c4`

## Compatibility Commitments

- `LLMCoreStreamEvent` names and fields remain unchanged
- Provider IDs and provider settings remain unchanged
- Existing message history and `function_call_record` remain reusable
- Routing providers (`new-api`, `zenmux`) stay as thin delegates over migrated providers
