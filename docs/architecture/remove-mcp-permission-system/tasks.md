# MCP Permission Ownership Tasks

Status: implementation and repository validation complete.

## Broker

- [x] Add one main-process `ToolPermissionBroker` with evaluate/request/resume/deny/cancel/timeout
      behavior.
- [x] Bind requests to an opaque request ID, conversation, immutable server ID/generation/binding,
      tool, canonical bounded arguments/hash, permission type, and `model`/`mcp-app` source.
- [x] Route model and MCP App calls through the same broker, including App calls outside a model
      turn.
- [x] Validate permission responses against request/conversation context and settle once.
- [x] Cancel pending decisions on abort, timeout, renderer destruction, conversation deletion, App
      teardown, and process shutdown.
- [x] Keep decisions ephemeral with no App/server approval cache.

## Legacy MCP Permission Removal

- [x] Remove permission evaluation and session approval storage from `ToolManager`.
- [x] Remove the legacy `mcpService.grantPermission` composition and route path.
- [x] Strip historical `autoApprove` from persisted MCP settings during normalization.
- [x] Ignore legacy `autoApprove` from deeplink, marketplace, ModelScope, sync, and plugin inputs.
- [x] Remove `autoApprove` from built-in and bundled-plugin MCP definitions.
- [x] Remove the MCP server form controls, local state, shared config field, and server-form i18n
      keys.
- [x] Update active fixtures while retaining explicit legacy-normalization and legacy-plugin
      compatibility cases.

## Verification

- [x] Run the repository final validation matrix recorded in the MCP v2 architecture tasks.
- [x] Prove App-origin calls cannot select another conversation/server/tool, reuse a stale request,
      or reuse approval after argument changes in the focused broker/App suites.
