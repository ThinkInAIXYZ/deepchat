# Tasks: shadcn-vue + VueUse Alignment

## Wave 1

- [x] Write `spec.md` / `plan.md` / `tasks.md`
- [x] Update `Agents.md` standing rule (shadcn + VueUse prefer)
- [x] Skeleton: `MessageItemPlaceholder.vue`, `ChatSessionSkeleton.vue`, `WindowSideBar.vue`, settings pages
- [x] Spinner: `ModelCheckDialog.vue`, media blocks, MCP/artifact/popup loaders
- [x] Empty: `MemoryEmptyState.vue`, `WindowSideBar.vue` empty list
- [x] VueUse: `sidepanel.ts`, `ProviderModelList.vue`, selected listeners/intervals
- [x] Delete dead `ScrollablePopover.vue`
- [x] `pnpm run format` / `i18n` / `lint`

## Wave 2

- [x] `AgentTransferDialog` RadioGroup + Select
- [x] `ModelConfigItem` Tooltip + i18n capability keys
- [x] Skills/Knowledge Spinner/Skeleton/Empty batch (agents, sync, git install, folder tree, knowledge search)
- [x] VueUse: MemoryListView debounce, WorkspaceCodePane `useResizeObserver`, clipboard helpers
- [x] Remaining settings Spinner (AcpSettings, SkillInstallDialog, Export/Import wizards, ImportExport tab, etc.)

## Wave 3

- [x] `AcpDebugDialog` → Dialog (fullscreen) + Spinner/Empty; skipped upstream overwrite
- [x] `providerStore` order sync → `useDebounceFn`
- [ ] Optional upstream shadcn refresh via CLI smart merge (blocked by Node fetch/proxy; deferred)

## Wave 4

- [x] Settings remaining Spinner: `App`, `DataSettings`, `RemoteSettings`, OAuth (GitHub/Grok/Codex), MCP market/settings, provider list/manager/api/config import, Dashboard/Environments/About/Shortcuts/Cron/Notifications/BuiltinKnowledge/KnowledgeFileItem/ModelScope
- [x] Main renderer remaining Spinner: `ChatStatusBar`, `ChatInputToolbar`, `SkillsIndicator`, artifacts (`Svg`/`Preview`/`ToolCall`), `PluginsCatalogPage`, `McpServerCard`, `SpotlightOverlay` empty/loading
- [x] Fix `MemoryListView` `useDebounceFn().cancel()` (VueUse 14 has no cancel API; requestId stale-guard)
- [ ] Optional: remaining `animate-pulse` skeletons → `Skeleton` (Dashboard plugins pages etc., separate from Spinner)
- [ ] Optional: domain status metadata (`useAgentPlanStatus` loader icon class) if product wants Spinner there
