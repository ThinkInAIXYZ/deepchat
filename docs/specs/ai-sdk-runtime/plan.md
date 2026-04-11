# AI SDK Runtime Plan

Status: completed, rollback retired. See [../legacy-llm-provider-runtime-retirement/plan.md](../legacy-llm-provider-runtime-retirement/plan.md).

1. Introduce shared AI SDK runtime modules without changing upper-layer interfaces.
2. Migrate OpenAI-compatible and OpenAI responses providers first.
3. Migrate Anthropic / Gemini / Vertex / Bedrock / Ollama to the shared runtime.
4. Keep routing providers (`new-api`, `zenmux`) as thin delegates over migrated providers.
5. Freeze `LLMCoreStreamEvent` behavior with adapter-focused tests.
6. Retire the rollback path and delete legacy state machines.
