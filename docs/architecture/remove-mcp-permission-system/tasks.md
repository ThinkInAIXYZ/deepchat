# Tasks

- [ ] Add one main-process `ToolPermissionBroker` with evaluate/request/resume/deny/cancel/timeout
      behavior.
- [ ] Bind broker requests to opaque request ID, conversation, immutable server ID, tool,
      canonical bounded arguments, arguments hash, and `model`/`mcp-app` source.
- [ ] Route both model and MCP App calls through the broker, including App calls outside an active
      model turn.
- [ ] Validate permission responses against sender context and resolve each request at most once.
- [ ] Cancel pending requests on abort, timeout, renderer destruction, conversation deletion, and
      App teardown.
- [ ] Remove MCP runtime permission checks from `ToolManager`.
- [ ] Remove MCP session permission cache/update paths.
- [ ] Remove the legacy `mcpService.grantPermission` composition path.
- [ ] Strip `autoApprove` from built-in/default MCP configs.
- [ ] Normalize persisted MCP server configs to remove historical `autoApprove`.
- [ ] Drop `autoApprove` from deeplink, marketplace, ModelScope, sync import, and plugin MCP mapping.
- [ ] Remove MCP server form auto-approve controls and related local state.
- [ ] Remove unused MCP auto-approve i18n keys after code references are gone.
- [ ] Remove `autoApprove` from shared MCP config types or confine it to legacy input normalization.
- [ ] Update tests and fixtures that still include `autoApprove`.
- [ ] Prove App-origin calls cannot choose another conversation/server/tool, reuse a stale request,
      or reuse approval after arguments change.
- [ ] Keep broker decisions ephemeral and add no App or server permission cache.
- [ ] Validate with format, i18n, lint, typecheck, and focused MCP/tool permission tests.
