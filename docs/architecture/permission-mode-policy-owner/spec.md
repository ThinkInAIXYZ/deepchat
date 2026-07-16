# Permission Mode Policy Ownership

## Status

Implemented and validated.

## Problem

Before this contract was introduced, permission mode passed through several unrelated functions
named `normalizePermissionMode`. Those functions hid two different policies:

- session assignment treats a missing value as `full_access`;
- runtime settings and deferred tool execution treat a missing or unknown value as `default`.

The same value was defaulted again after assignment, persistence, hydration, and tool execution.
That weakened the internal contract and allowed deferred execution to use a stale or invented
permission value.

## Goal

Give each policy one explicit owner:

- assignment is the only owner of the `full_access` default for omitted create, ACP draft, subagent,
  and transfer configuration;
- persistence decoding owns validation of stored permission values and uses `default` for missing
  or invalid stored data;
- the runtime initialization boundary owns its historical `default` fallback for direct callers;
- agent-context updates, settings updates, and deferred execution accept and propagate an exact
  `PermissionMode` without normalization.

## Acceptance Criteria

- No function named `normalizePermissionMode` remains in main-process code.
- Assignment resolves an omitted permission mode to `full_access` and preserves all three explicit
  modes.
- Persistence decoding preserves all three valid modes and resolves missing or invalid stored data
  to `default`.
- Application lifecycle initialization always supplies the assignment policy's exact
  `PermissionMode`; the lower-level runtime boundary keeps the existing `default` behavior for
  direct callers that omit it.
- Agent-context replacement requires `PermissionMode` in its internal TypeScript contract.
- `setPermissionMode` writes the exact validated mode it receives.
- Deferred tool execution loads the session state after asynchronous tool preparation and uses that
  latest permission mode without inventing a fallback.
- Persistence create APIs require an exact `PermissionMode`; they cannot default omission to
  `full_access`.
- Existing renderer routes and user-visible behavior remain unchanged.
- Security-focused tests cover assignment defaulting, persistence decoding, exact runtime updates,
  and deferred execution from hydrated state.

## Constraints

- Keep `PermissionMode` as the existing union: `default | auto_approve | full_access`.
- Do not add a policy class, registry, dependency, or shared utility module.
- Do not modify renderer code.
- Keep create and assignment behavior at `full_access` when no mode is configured.
- Keep the conservative persisted-data fallback at `default`.

## Non-Goals

- Changing the meaning of any permission mode.
- Changing the renderer permission selector or route payloads.
- Redesigning per-tool permission grants or auto-approval review.
- Migrating existing valid database rows.
- General cleanup of other normalization helpers.

## Decisions

1. Assignment defaulting remains a small named function inside `agentAssignmentPolicy.ts`; it is a
   policy, not a reusable normalizer.
2. Stored data is decoded at `DeepChatSessionsTable.get`, the first point where an untrusted
   database string enters the typed domain.
3. Runtime state never represents a missing permission mode. The low-level initialization boundary
   resolves an omitted direct input to `default`; application lifecycle callers already supply the
   assignment result. Context update contracts make the field required.
4. Deferred execution loads session state immediately before tool invocation so a permission change
   made during asynchronous preparation takes effect.
5. Agent configuration merging preserves an omitted mode; only assignment resolves it to
   `full_access`. Persistence create APIs require the resolved value.

## Open Questions

None.
