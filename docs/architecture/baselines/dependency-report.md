# Dependency Baseline

Generated on 2026-07-16.

## main

- Total files: 605
- Internal dependency edges: 1836
- Cycles detected: 10

### Top outgoing dependencies

- `app/composition.ts`: 136
- `agent/deepchat/runtime/deepChatRuntimeCoordinator.ts`: 47
- `data/schemaCatalog.ts`: 41
- `agent/deepchat/runtime/deepChatLoopRunner.ts`: 31
- `agent/deepchat/runtime/turnCoordinator.ts`: 30
- `tool/agentTools/agentToolManager.ts`: 26
- `memory/index.ts`: 21
- `session/data/database.ts`: 21
- `agent/acp/compatibility/dependencies.ts`: 18
- `app/mainProcess.ts`: 18
- `mcp/inMemoryServers/builder.ts`: 18
- `provider/index.ts`: 16
- `agent/acp/runtime/index.ts`: 15
- `remote/index.ts`: 15
- `file/mime.ts`: 14

### Top incoming dependencies

- `data/baseTable.ts`: 40
- `provider/settings.ts`: 40
- `remote/types.ts`: 39
- `agent/settings.ts`: 32
- `config/settingsStore.ts`: 32
- `agent/shared/agentSessionIds.ts`: 31
- `memory/types.ts`: 23
- `remote/binding/store.ts`: 22
- `routes/routeRegistry.ts`: 22
- `agent/deepchat/runtime/types.ts`: 21
- `memory/ports.ts`: 20
- `session/data/transcript.ts`: 19
- `session/data/database.ts`: 18
- `memory/domain/types.ts`: 17
- `remote/conversation/runner.ts`: 16

### Cycle samples

- `agent/acp/runtime/index.ts -> agent/acp/runtime/acpCompatibilityPromptBuilder.ts -> agent/acp/instance/ports.ts -> agent/acp/runtime/index.ts`
- `agent/acp/client/acpRuntimeOwner.ts -> agent/acp/client/index.ts -> agent/acp/client/acpRuntimeOwner.ts`
- `hook/observer.ts -> hook/index.ts -> hook/observer.ts`
- `memory/core/injectionPort.ts -> memory/types.ts -> memory/injection.ts -> memory/core/injectionPort.ts`
- `desktop/browser/YoBrowserPresenter.ts -> desktop/browser/YoBrowserToolHandler.ts -> desktop/browser/YoBrowserPresenter.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/subagentOrchestratorTool.ts -> tool/agentTools/agentToolManager.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/agentTapeTools.ts -> tool/agentTools/agentToolManager.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/agentMemoryTools.ts -> tool/agentTools/agentToolManager.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/cronJobTool.ts -> tool/agentTools/agentToolManager.ts`
- `skill/sync/toolScanner.ts -> skill/sync/security.ts -> skill/sync/toolScanner.ts`

## renderer-main

- Total files: 280
- Internal dependency edges: 494
- Cycles detected: 2

### Top outgoing dependencies

- `App.vue`: 29
- `pages/ChatPage.vue`: 29
- `i18n/index.ts`: 20
- `components/message/MessageItemAssistant.vue`: 19
- `pages/NewThreadPage.vue`: 18
- `components/chat/ChatStatusBar.vue`: 17
- `views/ChatTabView.vue`: 12
- `components/WindowSideBar.vue`: 9
- `components/chat/ChatInputBox.vue`: 9
- `components/ChatConfig.vue`: 8
- `components/markdown/MarkdownRenderer.vue`: 8
- `components/sidepanel/WorkspacePanel.vue`: 8
- `components/sidepanel/viewer/WorkspacePreviewPane.vue`: 8
- `components/mcp-config/components/McpServers.vue`: 7
- `components/mcp-config/components/index.ts`: 7

### Top incoming dependencies

- `components/chat/messageListItems.ts`: 21
- `stores/ui/session.ts`: 17
- `stores/ui/agent.ts`: 15
- `stores/providerStore.ts`: 14
- `stores/theme.ts`: 14
- `stores/artifact.ts`: 13
- `components/use-toast.ts`: 12
- `stores/uiSettingsStore.ts`: 12
- `stores/modelStore.ts`: 11
- `stores/ui/sidepanel.ts`: 10
- `stores/mcp.ts`: 8
- `components/icons/ModelIcon.vue`: 6
- `lib/onboardingResume.ts`: 6
- `stores/language.ts`: 6
- `lib/utils.ts`: 5

### Cycle samples

- `components/json-viewer/JsonValue.ts -> components/json-viewer/JsonObject.ts -> components/json-viewer/JsonValue.ts`
- `components/json-viewer/JsonArray.ts -> components/json-viewer/JsonValue.ts -> components/json-viewer/JsonArray.ts`

## renderer-settings

- Total files: 109
- Internal dependency edges: 122
- Cycles detected: 0

### Top outgoing dependencies

- `main.ts`: 20
- `components/ModelProviderSettingsDetail.vue`: 10
- `components/skills/SkillsSettings.vue`: 9
- `components/KnowledgeBaseSettings.vue`: 7
- `components/MemorySettings.vue`: 6
- `components/CommonSettings.vue`: 5
- `components/ModelProviderSettings.vue`: 5
- `components/BedrockProviderSettingsDetail.vue`: 4
- `components/SettingsOverview.vue`: 4
- `components/skills/SkillAgentsTab.vue`: 4
- `components/DataSettings.vue`: 3
- `components/MemoryListView.vue`: 3
- `components/PromptSetting.vue`: 3
- `components/ProviderApiConfig.vue`: 3
- `components/skills/SkillSyncDialog/ImportWizard.vue`: 3

### Top incoming dependencies

- `components/control-center/SettingsPageShell.vue`: 13
- `components/memoryRedesignUtils.ts`: 5
- `components/skills/toolIcon.ts`: 5
- `lib/guidedOnboardingSettings.ts`: 3
- `components/ProviderDialogContainer.vue`: 2
- `components/ProviderModelManager.vue`: 2
- `components/ProviderRateLimitConfig.vue`: 2
- `components/ProviderSettingsShell.vue`: 2
- `components/common/SettingToggleRow.vue`: 2
- `components/skills/SkillDetailDialog.vue`: 2
- `components/skills/SkillSyncDialog/ConflictResolver.vue`: 2
- `App.vue`: 1
- `components/AboutUsSettings.vue`: 1
- `components/AcpDebugDialog.vue`: 1
- `components/AcpSettings.vue`: 1

### Cycle samples

- None
