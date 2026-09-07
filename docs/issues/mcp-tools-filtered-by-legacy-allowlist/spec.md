# MCP Tools Filtered by Legacy Agent Allowlist

## Issue

DeepChat sessions can omit every normal MCP tool from provider requests even when MCP is globally
enabled and an MCP server is running. The affected built-in `deepchat` Agent has a persisted legacy
`enabledMcpServerIds: []` value.

## Impact

- Provider requests contain built-in Agent tools but no normal MCP tool definitions.
- The global MCP settings page can show a server as enabled while the current Agent still receives
  no tools, making the failure look like an MCP connection or provider-injection problem.
- Manual DeepChat Agents that inherit the built-in Agent policy are affected as well.

## Root Cause

Agent-scoped MCP policy intentionally defines `[]` as "disable every MCP server" and
`null`/missing as "inherit compatible global behavior." Before Agent-scoped MCP shipped, historical
config could already contain an empty allowlist. The earlier runtime workaround stopped applying
that legacy value, but the later Agent-scoped policy restored strict empty-list filtering without a
one-time data migration.

The current path is:

1. `DeepChatToolResolver` reads `enabledMcpServerIds: []` from the resolved Agent config.
2. `ToolService` forwards it as `enabledServerIds` to MCP tool discovery.
3. `ToolManager` rejects every normal MCP server because none can match the empty allowlist.
4. The provider receives only built-in Agent tool definitions.

## Fix Plan

Add a versioned startup compatibility migration that runs before the first application window is
created:

- Inspect only the built-in `deepchat` Agent's stored config.
- On the first migration run, convert a legacy empty `enabledMcpServerIds` array to `null`.
- Preserve missing, `null`, and non-empty values.
- Record completion even when no update is needed.
- After completion, never reinterpret a future explicit `[]`; it remains the supported
  Agent-scoped "disable all" policy.
- Keep runtime filtering unchanged.

The first-run conversion necessarily treats any pre-migration built-in empty list as legacy because
the old stored value has no provenance marker. This is the narrow compatibility tradeoff required
to restore existing users while preserving explicit empty-list semantics after migration.

## Constraints

- Do not disable or bypass Agent-scoped MCP filtering.
- Do not modify manual Agent configs.
- Do not modify MCP server definitions, credentials, authentication, or global enablement.
- Do not add renderer state, IPC routes, or user-facing strings.
- The migration must be idempotent and retry after failure.

## Task Checklist

- [x] Confirm the persisted empty allowlist and provider trace symptom.
- [x] Document the compatibility boundary and migration semantics.
- [x] Add the versioned startup migration.
- [x] Run it before the first window can accept a chat request.
- [x] Add focused tests for migration, preservation, idempotency, and failure retry.
- [x] Run format, i18n, lint, typecheck, and focused tests.

## Validation

- A pre-migration built-in config with `enabledMcpServerIds: []` is updated to `null` exactly once.
- Missing, `null`, and non-empty allowlists are not changed.
- Once the migration is complete, a later explicit `[]` is not changed.
- A failed migration records failure and succeeds on the next run.
- Existing MCP filtering tests continue to prove that explicit Agent allowlists are enforced.

Validated with `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck`, and 87
focused main-process tests (with two environment-gated SQLite tests skipped).

## GitHub Issue

Not synced; local SDD only.
