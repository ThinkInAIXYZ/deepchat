# Plan: Agent Provider Simplification (ACP-only)

## Summary

Replace the “agent provider” abstraction and detection logic with a single explicit rule: **ACP is the only agent provider and is identified by `providerId === 'acp'`.**

## Current Call Flow (relevant parts)

- Main:
  - `ProviderInstanceManager.createProviderInstance()` already special-cases `provider.id === 'acp'`.
  - `ProviderInstanceManager.isAgentProvider()` uses `instanceof BaseAgentProvider` and (if instance not created) a constructor prototype check (`isAgentConstructor`).
  - `LLMProviderPresenter.isAgentProvider()` exposes this to the renderer via `ILlmProviderPresenter`.
- Renderer:
  - `src/renderer/src/stores/modelStore.ts` calls `llmproviderPresenter.isAgentProvider(providerId)` over IPC to choose between:
    - `agentModelStore.refreshAgentModels(providerId)` (ACP path)
    - `refreshStandardModels + refreshCustomModels` (standard path)
  - Other renderer logic already treats ACP as special via `provider.id === 'acp'`.

## Proposed Changes

### 1) Remove agent-provider classification API

- Remove `isAgentProvider(providerId: string)` from:
  - `src/shared/types/presenters/llmprovider.presenter.d.ts`
  - `src/shared/types/presenters/legacy.presenters.d.ts`
  - `src/main/presenter/llmProviderPresenter/index.ts`
  - `src/main/presenter/llmProviderPresenter/managers/providerInstanceManager.ts`

Rationale: It is only used by the renderer for ACP gating, and ACP can be identified locally by ID.

### 2) Replace renderer gating with an explicit ACP check

- In `src/renderer/src/stores/modelStore.ts`:
  - Remove the async IPC call `llmP.isAgentProvider(providerId)`.
  - Replace with a local predicate: `providerId === 'acp'`.
  - Keep the existing ACP refresh path using `agentModelStore.refreshAgentModels('acp')` (no behavioral change).

### 3) Remove `BaseAgentProvider` (optional but preferred)

Because `BaseAgentProvider` is only used by `AcpProvider`, delete the base class and:

- Make `AcpProvider` extend `BaseLLMProvider` directly.
- Move `cleanup()` logic into `AcpProvider` (or delegate to `AcpSessionManager` / `AcpProcessManager`).
- Ensure `cleanup()` is safe to call multiple times and during shutdown.

Notes:
- `acpCleanupHook` currently awaits `cleanup()` even though `BaseAgentProvider.cleanup()` is `void`. Consider standardizing ACP cleanup to `Promise<void>` to match usage.

## Compatibility / Migration

- No user data migration.
- Provider ID `acp` remains unchanged and is treated as a stable internal contract.
- Any internal IPC typing generation must be updated to reflect removal of `isAgentProvider`.

## Test Strategy

Add minimal tests focusing on the only behavioral dependency (renderer model refresh selection):

- Renderer unit test for `modelStore.refreshProviderModels()`:
  - When `providerId === 'acp'`, it uses `agentModelStore.refreshAgentModels`.
  - When `providerId !== 'acp'`, it uses standard refresh path.

Main-process unit tests are optional; the change is mostly removal and ACP-id checks.

## Rollout

Single PR is acceptable if changes stay localized (types + modelStore + ACP provider base class cleanup).

