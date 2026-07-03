# Tasks

- [ ] Remove MCP runtime permission checks from `ToolManager`.
- [ ] Remove MCP session permission cache/update paths.
- [ ] Strip `autoApprove` from built-in/default MCP configs.
- [ ] Normalize persisted MCP server configs to remove historical `autoApprove`.
- [ ] Drop `autoApprove` from deeplink, marketplace, ModelScope, sync import, and plugin MCP mapping.
- [ ] Remove MCP server form auto-approve controls and related local state.
- [ ] Remove unused MCP auto-approve i18n keys after code references are gone.
- [ ] Remove `autoApprove` from shared MCP config types or confine it to legacy input normalization.
- [ ] Update tests and fixtures that still include `autoApprove`.
- [ ] Validate with format, i18n, lint, typecheck, and focused MCP/tool permission tests.
