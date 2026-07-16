# Plan

## Current Owners

- MCP runtime permission checks: `src/main/mcp/toolManager.ts`
- MCP server config defaults and normalization: `src/main/mcp/settings.ts`
- Deep link and marketplace MCP import defaults: `src/main/deeplink/index.ts`,
  `src/main/mcp/mcprouterManager.ts`,
  `src/main/provider/modelScopeMcp.ts`
- Plugin MCP manifest mapping: `src/main/plugin/index.ts`
- MCP server form UI: `src/renderer/src/components/mcp-config/McpServerForm.vue`
- Public MCP config type: `src/shared/types/mcp.ts`
- Existing tests: MCP form, config import, tool manager, plugin service, deeplink service, sync import.

## Target Behavior

MCP should execute tools when the agent/session layer has allowed the tool call to proceed. MCP
should still return normal tool errors for transport/server/tool failures, but it should not create
permission request blocks.

```text
Before
agent/session permission -> MCP autoApprove/session cache/plugin policy -> MCP tool call

After
agent/session permission -> MCP tool call
```

Agent-scoped MCP server/plugin selection stays outside this removal:

```text
agent selected servers/plugins -> tool list filtering -> agent/session permission -> MCP tool call
```

## Implementation Steps

1. Runtime removal
   - Remove `checkToolPermission`, `determinePermissionType`, MCP session permission cache, and
     `updateServerPermissions` from `ToolManager`.
   - Remove MCP-generated `requiresPermission` / `permissionRequest` responses.
   - Preserve server/tool availability checks and normal error handling.

2. Config migration and normalization
   - Strip `autoApprove` from persisted MCP server configs when reading or migrating settings.
   - Ensure built-in MCP defaults no longer include `autoApprove`.
   - Ensure imported/synced/deeplink/marketplace/plugin MCP configs drop `autoApprove`.
   - Treat unknown legacy `autoApprove` values as ignored until the field is fully removed from
     shared types.

3. UI removal
   - Remove auto-approve controls and state from `McpServerForm.vue`.
   - Remove `settings.mcp.serverForm.autoApprove*` and `mcp.server.autoApprove*` i18n keys after no
     code references them.
   - Update tests that currently assert editable auto-approve controls.

4. Type cleanup
   - Remove `autoApprove` from `MCPServerConfig` after all producers are updated.
   - If needed, introduce a private legacy input type for import/migration code only.
   - Keep route contracts structurally compatible by parsing legacy payloads and normalizing them
     before persistence.

5. Test strategy
   - Tool manager: MCP tool calls no longer produce permission requests from `autoApprove`.
   - Config presenter: persisted legacy `autoApprove` is stripped on read/write migration.
   - MCP form: no auto-approve controls render or submit.
   - Import/deeplink/plugin/marketplace sync: incoming `autoApprove` is ignored.
   - Agent/session permission tests stay in the agent runtime suites, not MCP suites.

## Migration Notes

Prefer normalizing at the config boundary so old configs cannot leak back into renderer state:

```text
read stored mcpServers
  -> normalize server config
  -> delete autoApprove
  -> persist normalized config when settings are next saved or during explicit migration
```

This keeps runtime code simple and prevents UI/API clients from seeing obsolete permission data.

## Risks

- Some tests or fixtures assume `autoApprove: []` is required. Those should be updated to omit the
  field.
- Plugin manifests may still carry `autoApprove`; import code should ignore it instead of rejecting
  older manifests.
- Removing MCP permission requests must not remove agent/session permission prompts.
