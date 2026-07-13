# Basic API Key Providers

## User Need

DeepChat should expose more built-in API-key providers that already have public provider-db model
metadata and can run through existing OpenAI-compatible or Anthropic-compatible transports.

## Goal

Add a first batch of low-complexity providers:

- NVIDIA
- Hugging Face
- Moonshot AI global
- StepFun
- Upstage
- Alibaba Token Plan global
- Alibaba Token Plan China
- MiniMax global

## Acceptance Criteria

- Each provider appears in the built-in provider list with a default base URL, docs links, API-key
  link, model link, and disabled default state.
- OpenAI-compatible providers use the existing `openai-compatible` runtime.
- MiniMax global uses the existing Anthropic runtime.
- Provider model lists come from provider-db metadata where available.
- Provider-db backed model refresh recognizes the new built-in providers.
- Provider icons resolve through existing llm-icon assets without adding new image files.
- Connection checks use existing API-key handling and a small generate-text request.
- No special provider class, renderer-side provider execution, dynamic SDK install, or provider
  runtime manifest is added.
- Existing built-in MiniMax behavior remains compatible.

## Constraints

- Follow the current explicit provider registration pattern.
- Keep technical identifiers and code comments in English.
- Do not add `ProviderRuntimeDefinition` or generated runtime files.
- Do not change OAuth, Bedrock, Vertex, Azure, or local-provider behavior.

## Non-Goals

- Full parity with all provider-db or models.dev providers.
- New native SDK support for Cohere, Perplexity, AI21, or other non-selected providers.
- Credential migration for existing providers.
- Changing existing MiniMax users from the current `minimax` provider ID.

## Open Questions

None.
