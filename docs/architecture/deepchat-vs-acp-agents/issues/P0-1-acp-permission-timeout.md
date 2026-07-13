# P0-1 ACP Permission Timeout

Status: fixed.

Linked issue: [#1881](https://github.com/ThinkInAIXYZ/deepchat/issues/1881)

## Problem

ACP permission requests could remain pending when generation was cancelled or when no permission
decision arrived. The provider promise stayed in `pendingPermissions`, while the runtime could remove
its active permission handle without settling the provider-side request.

## Root Cause

- `AcpProvider.registerPendingPermission()` created a promise with no timeout.
- `AcpProvider.resolvePermissionRequest()` removed the map entry only when the user answered.
- `AgentRuntimePresenter.clearActiveProviderPermissionsForSession()` deleted active permission
  records without calling their resolver.

## Fix

- Add a 60-second timeout to ACP pending permissions.
- Store and clear the timeout for explicit resolve, session cleanup, and provider cleanup.
- Resolve timed-out permissions with ACP `cancelled` outcome.
- Resolve active runtime ACP permissions with `false` when clearing a session.

## Validation

```bash
pnpm vitest run test/main/presenter/acpProvider.test.ts test/main/presenter/agentRuntimePresenter/agentRuntimePresenter.test.ts
```

Covered cases:

- pending ACP permission requests cancel on timeout;
- explicit permission resolution clears the timeout;
- runtime session cleanup calls the live ACP provider resolver with `false`.
