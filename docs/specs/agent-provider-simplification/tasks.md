# Tasks: Agent Provider Simplification (ACP-only)

1. Update renderer to stop using IPC for agent-provider detection
   - Remove `llmproviderPresenter.isAgentProvider` usage from `src/renderer/src/stores/modelStore.ts`.
   - Gate ACP behavior by `providerId === 'acp'`.

2. Remove `isAgentProvider` from the presenter contract
   - Remove from `src/shared/types/presenters/llmprovider.presenter.d.ts`.
   - Remove from `src/shared/types/presenters/legacy.presenters.d.ts`.
   - Remove implementation from `src/main/presenter/llmProviderPresenter/index.ts`.

3. Remove main-side agent-provider classification implementation
   - Delete `ProviderInstanceManager.isAgentProvider()` and `isAgentConstructor()` in `src/main/presenter/llmProviderPresenter/managers/providerInstanceManager.ts`.
   - Ensure no other code path depends on `BaseAgentProvider` type checks.

4. Remove `BaseAgentProvider` abstraction (preferred)
   - Delete `src/main/presenter/llmProviderPresenter/baseAgentProvider.ts`.
   - Update `src/main/presenter/llmProviderPresenter/providers/acpProvider.ts` to extend `BaseLLMProvider` directly.
   - Keep/adjust ACP cleanup semantics (safe shutdown, provider disable, app quit).

5. Add/adjust tests
   - Add a Vitest suite under `test/renderer/**` validating model refresh selection for ACP vs non-ACP.

6. Quality gates
   - Run `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, and `pnpm test`.

