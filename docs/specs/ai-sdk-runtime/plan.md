# AI SDK Runtime Plan

1. Add hidden runtime resolution and keep `legacy` available for rollback.
2. Introduce shared AI SDK runtime modules without changing upper-layer interfaces.
3. Migrate OpenAI-compatible and OpenAI responses providers first.
4. Migrate Anthropic / Gemini / Vertex / Bedrock / Ollama to the shared runtime.
5. Keep routing providers (`new-api`, `zenmux`) as thin delegates over migrated providers.
6. Freeze `LLMCoreStreamEvent` behavior with adapter-focused tests.
7. Remove legacy state machines only after the rollback window closes.
