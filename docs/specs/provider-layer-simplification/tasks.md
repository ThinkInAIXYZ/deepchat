# Provider Layer Simplification Tasks

- [x] Add `providerRegistry.ts` as the single source of AI SDK-backed provider definitions.
- [x] Add generic `AiSdkProvider` and move shared provider behavior into it.
- [x] Route `ProviderInstanceManager` through registry definitions plus special providers.
- [x] Decouple ModelScope MCP sync from `ModelscopeProvider` instance methods.
- [x] Update provider-layer tests to target the generic provider behavior.
- [x] Delete obsolete vendor provider classes from `src/main/presenter/llmProviderPresenter/providers/`.
- [x] Run `pnpm run format`.
- [x] Run `pnpm run i18n`.
- [x] Run `pnpm run lint`.
- [x] Run `pnpm run typecheck`.
- [x] Run targeted provider-layer tests.
