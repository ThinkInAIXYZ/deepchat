# Provider Layer Simplification Plan

1. Add a provider definition registry that captures runtime kind, model source, health check, and
   hook strategy per provider.
2. Introduce a generic `AiSdkProvider` that owns AI SDK-backed text, stream, summary, image,
   embeddings, and provider check flows.
3. Switch `ProviderInstanceManager` from vendor constructor maps to:
   - special providers for `acp`, `github-copilot`, `voiceai`, `ollama`
   - generic `AiSdkProvider` for all other AI SDK-backed providers
4. Move ModelScope MCP sync HTTP logic into shared helpers so `ModelscopeProvider` is no longer
   required.
5. Adapt provider tests to assert behavior through the generic provider instead of vendor classes.
6. Delete obsolete vendor provider classes after import scans confirm they have no remaining
   callers.
7. Run format, i18n, lint, typecheck, and targeted provider tests.
