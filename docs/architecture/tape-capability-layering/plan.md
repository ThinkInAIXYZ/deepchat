# Tape Capability Layering - Plan

## Capability Policy

- Define `AgentToolExposure` as `user-configurable`, `system-model`, `runtime-only`, or
  `diagnostic` in a shared Agent tool policy module.
- Keep the five Tape names and their classifications in one registry. Treat unregistered existing
  Agent tools as `user-configurable` to avoid unrelated behavior changes.
- Require every Agent tool assembly site to state its expected exposure and assert that it matches
  the shared registry. This preserves the compatibility fallback while preventing a capability
  registered as internal from silently entering the configurable catalog.
- Keep exposure metadata out of provider-bound `MCPToolDefinition` values. Main-process catalog
  selection and execution checks consume the policy directly.

## Catalog Separation

- Keep `ToolPresenter.getAllToolDefinitions()` as the runtime catalog. Apply
  `disabledAgentTools` only to `user-configurable` definitions and publish only this catalog into
  the per-conversation `ToolMapper`.
- Track the conversation provenance of the compatibility mapper. A published per-conversation
  mapper is authoritative; an absent tool, or a missing/cleared mapper while the compatibility
  snapshot belongs to another conversation, is unavailable. Preserve only the no-ID draft snapshot
  as the bridge into the first persisted turn and for legacy no-ID calls.
- Add `getConfigurableAgentToolDefinitions()` for renderer configuration. Return only
  `user-configurable` Agent definitions and do not resolve MCP definitions, publish mappings, or
  remember conversation MCP access.
- Preserve the existing IPC route name and payload while routing it to the configurable catalog.
  Rename the renderer client method so callers cannot confuse it with the runtime catalog.
- Update the new-thread tool popover and Agent settings to consume the configurable catalog without
  hard-coded Tape-name filtering.

### Renderer Behavior

```text
BEFORE

New-thread draft          -> runtime catalog -> no agent-tape group (no persisted session)
Persisted DeepChat thread -> runtime catalog -> agent-tape group with user-facing switches

AFTER

New-thread draft          -> configurable catalog -> user-configurable Agent tools only
Persisted DeepChat thread -> configurable catalog -> user-configurable Agent tools only
```

## Tape Model Boundary

- Restrict `AgentTapeToolHandler` definitions and execution to the atomic `tape_search` and
  `tape_context` recall pair.
- Require a DeepChat session plus both recall runtime ports before advertising either definition.
- Remove diagnostic and handoff descriptions from the tool system prompt.
- Narrow `AgentToolRuntimePort` to model-callable Tape operations. Retain Tape info, anchor listing,
  and handoff on the lower runtime/application Tape boundary for future diagnostics and runtime use.
- Reject known non-model Tape names at the Agent tool execution boundary, including stale deferred
  calls, while keeping their historical facts replayable.
- Revalidate the DeepChat session and complete recall pair at execution time before calling either
  runtime port.

## Handoff and Persistence

- Require a trimmed non-empty summary for runtime handoff. Validate before appending and continue to
  derive cursor, range, and source message IDs from the effective Tape.
- Leave automatic compaction and context-overflow recovery on their existing compare-and-set path.
- Normalize all disabled-tool writes to drop non-configurable Tape names.
- Add a separately keyed, idempotent startup cleanup for existing session and Agent configuration
  rows. Reuse the existing bounded-yield migration pattern and do not alter transcript or Tape data.
- Persist session cleanup through a migration-owned transaction that updates both disabled-tool
  stores without touching `updated_at` or synchronizing environment activity.

## Compatibility

- Keep the IPC route wire shape, provider tool shape, Tape schema, replay schema, and database schema
  unchanged.
- Keep Tape names reserved so an MCP server cannot reinterpret a historical/internal name.
- A downgraded build may show Tape tools again after the cleanup removed obsolete disabled values;
  no conversation or Tape data is lost, and the upgraded build remains deterministic.
- Leave pre-existing untracked documentation untouched. Update only maintained tracked contracts
  that describe the old five-tool model surface.

## Test Strategy

- Cover runtime/configurable catalog membership and prove configurable reads have no mapper/access
  side effects.
- Cover concurrent conversation mappings and prove a missing, cleared, or incomplete conversation
  catalog cannot resolve through another conversation's latest mapping, while draft-origin mapping
  compatibility remains intact.
- Cover DeepChat, ACP, missing-session, missing-port, stale-disabled-list, same-name MCP, and deferred
  call behavior.
- Cover pre-append handoff validation and derived provenance for valid handoffs.
- Cover v2 cleanup idempotence, preservation of ordinary disabled tools, Agent config cleanup, and
  bounded session iteration. Use a real SQLite test to preserve session ordering and environment
  recency.
- Run focused main and renderer tests before each implementation commit, then the full repository
  validation sequence before final handoff.

## Commit Slices

1. `docs(tape): define capability layering`
2. `refactor(tools): split tool catalogs`
3. `fix(tape): limit model capabilities`
4. `fix(config): remove tape tool toggles`
