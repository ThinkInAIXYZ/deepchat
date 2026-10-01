# Retiring the agent plan capability

## Context and goal

PR #2384 removed the built-in `update_plan` tool and ACP plan capability. The remaining code must
describe a retired data format, not an available agent feature. This follow-up establishes that
boundary without changing the appearance or interpretation of existing conversations.

## Ownership and data flow

- Main-process tool catalogs, prompts, stream events and routes have no built-in plan capability.
  ACP initialization does not advertise `plan`; `plan`, `plan_update` and `plan_removed` notifications
  are ignored. Unrelated agent configuration modes and third-party MCP tools remain supported.
- `shared/types/legacy-agent-plan.ts` owns only the persisted plan metadata shape. All message-extra
  contracts reuse that shape instead of independently declaring its fields. These are read
  compatibility types, not schemas for new writes or tool arguments.
- `renderer/src/lib/legacyAgentPlan.ts` owns interpretation and presentation of historical
  `update_plan` tool arguments. It has no session state, IPC, runtime lifecycle or Vue composable.
  The message tool card remains its rendering owner.
- Saved ACP run plan blocks keep their existing renderer. The main transcript continues filtering
  old standalone plan blocks, as it did before retirement. This work does not add new history UI.

## Compatibility and invariants

1. Successful historical built-in calls retain their own checklist, explanation and status labels.
   Legacy `content` and `done` aliases remain accepted. Malformed calls retain diagnostic details.
2. MCP tools called `update_plan` are ordinary MCP tools, not built-in history cards or prohibited
   names. Removing a built-in capability does not reserve a global name.
3. Existing persisted field names and status values remain readable. No database migration,
   destructive field stripping or disabled-tool-list rewrite is performed. Old ACP extension
   fields may remain in stored snapshots but cannot enable a capability or produce new plan state.
4. No runtime plan schemas, terminal-state normalizers, dead terminal presentation branches or
   obsolete mocks remain. Only translations reachable from historical display remain.
5. Maintained tool-mode, ACP, permission and ChatPage specs describe the retired capability
   consistently. Historical implementation records are marked as historical, not rewritten as
   current requirements.

## Non-goals

No new compatibility service, registry, configuration switch, dependency or background migration.
No changes to user questions, permissions, queues, subagent execution or plan modes supplied by an
external agent. No repository-wide documentation cleanup or message-type consolidation.

## Acceptance and rollback

Actual built-in catalogs and generated prompts do not expose the retired tool, while adjacent
question functionality and third-party tool handling continue working. ACP clients omit plan
capabilities and all three plan notifications produce no events or blocks. Historical rendering
and malformed-input fallback remain unchanged, including accessibility labels. Repository checks
pass. The change can be reverted without touching persisted data.

## Open questions

None. Compatibility is intentionally read-only and has no automatic expiry until support for the
corresponding saved conversation format is explicitly retired.
