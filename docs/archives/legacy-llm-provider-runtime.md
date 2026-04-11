# Legacy LLM Provider Runtime Archive

## Summary

DeepChat previously maintained two low-level provider runtimes under `llmProviderPresenter`:

- the original provider-specific SDK implementations
- the newer shared AI SDK runtime

That rollback window is now closed. The active codebase only keeps the AI SDK runtime.

## Timeline

- AI SDK migration landed in commit `4c8345a7`
- Legacy runtime retirement and dependency cleanup landed after the migration stabilized

## Where To Find The Old Provider Implementation

Use commit `3add4093b46f15072d5ec3a65c8097e23b4907c4` to inspect the historical provider implementation and legacy runtime code.

That commit is the canonical source for:

- legacy provider request code
- legacy stream parsing branches
- provider-specific MCP conversion APIs
- legacy rollback-path wiring

## Current State

- no `DEEPCHAT_LLM_RUNTIME`
- no `llmRuntimeMode`
- no legacy provider SDK fallback branches in active providers
- no provider-specific MCP conversion APIs exposed from presenters

For current implementation details, read:

- [docs/specs/ai-sdk-runtime/spec.md](../specs/ai-sdk-runtime/spec.md)
- [docs/specs/legacy-llm-provider-runtime-retirement/spec.md](../specs/legacy-llm-provider-runtime-retirement/spec.md)
