# Provider Layer Simplification

## Status

Completed on `2026-04-11`.

## Goal

Collapse the AI SDK-backed provider layer into one internal implementation while keeping all
user-visible provider contracts unchanged.

The simplified structure is:

- registry-driven provider resolution
- one generic `AiSdkProvider` for AI SDK-backed providers
- special-case providers kept only when they own non-generic responsibilities

## In Scope

- replace vendor class selection in `ProviderInstanceManager` with a registry lookup
- move runtime choice, routing, model source, health-check strategy, and provider-specific hooks
  into provider definitions
- keep `AcpProvider`, `GithubCopilotProvider`, `VoiceAIProvider`, and `OllamaProvider` as
  independent classes
- keep `AiSdkProvider` as the single generic implementation for AI SDK-backed providers
- move ModelScope MCP sync helpers out of `ModelscopeProvider`
- delete obsolete vendor provider classes once they have no remaining callers

## Out of Scope

- removing providers from the settings UI or changing the default provider list
- changing persisted provider IDs, model configs, or conversation history
- refactoring `OllamaProvider` local model management into a different subsystem
- redesigning prompts or harmonizing provider-specific output behavior

## Compatibility Constraints

The following must remain stable:

- `providerId`
- `apiType`
- provider configuration schema
- model configuration schema
- history and `function_call_record` compatibility
- `LLMProviderPresenter.getProviderInstance()` behavior
- `LLMCoreStreamEvent` names and payload structure

## Result

After this simplification:

- `ProviderInstanceManager` acts as a registry-backed factory
- AI SDK-backed providers no longer rely on vendor-specific provider classes
- `providers/` retains only:
  - `acpProvider.ts`
  - `aiSdkProvider.ts`
  - `githubCopilotProvider.ts`
  - `ollamaProvider.ts`
  - `voiceAIProvider.ts`

## Acceptance Criteria

- registry resolution honors `providerId` first and `apiType` second
- routing providers (`new-api`, `zenmux`, `grok`) continue to route by model capability
- ModelScope MCP sync works without `ModelscopeProvider` instance methods
- no remaining runtime imports of deleted vendor provider classes
- targeted provider tests pass on the generic path
