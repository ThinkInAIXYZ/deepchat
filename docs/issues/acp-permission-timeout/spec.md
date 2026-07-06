# ACP Permission Timeout

Linked GitHub issue: [#1881](https://github.com/ThinkInAIXYZ/deepchat/issues/1881)

## Issue

ACP permission requests could remain pending after generation cancel/stop or after the user never
answers the permission prompt. This left the ACP provider promise unresolved.

## Impact

- ACP prompt handling could hang until broader provider/process cleanup.
- Runtime state could drop the active permission record without waking the provider request.
- Users could see a permission interaction that no longer had a useful live backend path.

## Root Cause

- `src/main/presenter/llmProviderPresenter/providers/acpProvider.ts` stored pending permission
  promises without a timeout.
- `src/main/presenter/agentRuntimePresenter/index.ts` cleared active ACP provider permissions by
  deleting them from `activeProviderPermissions` only.

## Fix Plan

- Add a bounded timeout for ACP pending permissions.
- Clear pending permission timers on explicit resolve and cleanup.
- Cancel provider-side permissions when runtime session cleanup removes active ACP permission state.
- Add focused tests for provider timeout cleanup and runtime cleanup.

## Tasks

- [x] Add ACP pending permission timeout.
- [x] Clear timeout on explicit permission resolution.
- [x] Clear timeout on session/provider cleanup.
- [x] Resolve live ACP provider permission as denied during runtime session cleanup.
- [x] Add focused tests.
- [x] Update architecture docs and remove unsupported review findings.

## Validation

- [x] `pnpm vitest run test/main/presenter/acpProvider.test.ts test/main/presenter/agentRuntimePresenter/agentRuntimePresenter.test.ts`
