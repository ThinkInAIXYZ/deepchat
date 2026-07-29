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
- Agent/session permission port: currently provides approval mutation but no complete asynchronous
  permission request lifecycle.
- Main composition: still resolves MCP permission UI through `mcpService.grantPermission`.
- Existing tests: MCP form, config import, tool manager, plugin service, deeplink service, sync import.

## Target Behavior

MCP should execute tools when the agent/session layer has allowed the tool call to proceed. MCP
should still return normal tool errors for transport/server/tool failures, but it should not create
permission request blocks.

```text
Before
agent/session policy -> MCP autoApprove/session cache/plugin policy -> MCP tool call

After
model/App call -> ToolPermissionBroker -> agent/session policy -> MCP tool call
```

Agent-scoped MCP server/plugin selection stays outside this removal:

```text
agent selected servers/plugins -> tool list filtering -> ToolPermissionBroker -> MCP tool call
```

MCP Apps use the same final boundary:

```text
App request -> bind conversation/server/tool/arguments -> ToolPermissionBroker -> MCP tool call
```

An App's visible button or postMessage request is not itself a durable permission grant.

## Implementation Steps

1. Establish the single permission broker
   - Add a main-process `ToolPermissionBroker` with
     `evaluate`, `request`, `resume`, `deny`, `cancel`, and timeout behavior.
   - Bind every request to opaque `requestId`, conversation, immutable server ID, tool name,
     canonical bounded arguments, arguments hash, and source.
   - Route model-origin calls and MCP App-origin calls through the same broker.
   - Derive App context from the main-side sandbox descriptor; ignore App-supplied identity.
   - Use typed request/result events and validate the responding renderer/window context.
   - Cancel pending requests on caller abort, renderer destruction, conversation deletion, app
     teardown, or timeout.
   - Keep approval decisions ephemeral unless the existing agent/session policy already defines
     persistence; do not add App/MCP caches.

2. Runtime removal
   - Remove `checkToolPermission`, `determinePermissionType`, MCP session permission cache, and
     `updateServerPermissions` from `ToolManager`.
   - Remove MCP-generated `requiresPermission` / `permissionRequest` responses.
   - Remove `mcpService.grantPermission` composition after all callers use the broker.
   - Preserve server/tool availability checks and normal error handling.

3. Config migration and normalization
   - Strip `autoApprove` from persisted MCP server configs when reading or migrating settings.
   - Ensure built-in MCP defaults no longer include `autoApprove`.
   - Ensure imported/synced/deeplink/marketplace/plugin MCP configs drop `autoApprove`.
   - Treat unknown legacy `autoApprove` values as ignored until the field is fully removed from
     shared types.

4. UI removal
   - Remove auto-approve controls and state from `McpServerForm.vue`.
   - Remove `settings.mcp.serverForm.autoApprove*` and `mcp.server.autoApprove*` i18n keys after no
     code references them.
   - Update tests that currently assert editable auto-approve controls.

5. Type cleanup
   - Remove `autoApprove` from `MCPServerConfig` after all producers are updated.
   - If needed, introduce a private legacy input type for import/migration code only.
   - Keep route contracts structurally compatible by parsing legacy payloads and normalizing them
     before persistence.

6. Test strategy
   - Broker: evaluate/request/resume/deny/cancel/timeout and one-response-only semantics.
   - Broker context: changed arguments, wrong conversation/window, stale request ID, and App
     teardown cannot approve execution.
   - Tool manager: MCP tool calls no longer produce permission requests from `autoApprove`.
   - Config presenter: persisted legacy `autoApprove` is stripped on read/write migration.
   - MCP form: no auto-approve controls render or submit.
   - Import/deeplink/plugin/marketplace sync: incoming `autoApprove` is ignored.
   - Agent/session policy tests stay in the agent runtime suites; broker integration is covered at
     the shared execution boundary.
   - MCP App-origin calls prove they use the broker outside an active model turn and cannot target
     another server or reuse approval after arguments change.

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
- Deleting `ToolManager` checks before the broker is wired would bypass consent for App-origin calls;
  the broker checkpoint is therefore ordered first.
