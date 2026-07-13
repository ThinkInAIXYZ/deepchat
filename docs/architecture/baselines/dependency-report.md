# Dependency Baseline

Generated on 2026-07-13.

## main

- Total files: 541
- Internal dependency edges: 1455
- Cycles detected: 36

### Top outgoing dependencies

- `presenter/index.ts`: 56
- `presenter/agentRuntimePresenter/index.ts`: 45
- `presenter/sqlitePresenter/index.ts`: 40
- `presenter/sqlitePresenter/schemaCatalog.ts`: 37
- `routes/index.ts`: 28
- `presenter/configPresenter/index.ts`: 27
- `presenter/lifecyclePresenter/hooks/index.ts`: 23
- `presenter/toolPresenter/agentTools/agentToolManager.ts`: 22
- `presenter/memoryPresenter/index.ts`: 19
- `presenter/llmProviderPresenter/index.ts`: 17
- `agent/acp/runtime/index.ts`: 15
- `presenter/agentSessionPresenter/index.ts`: 14
- `presenter/filePresenter/mime.ts`: 14
- `presenter/remoteControlPresenter/index.ts`: 14
- `presenter/agentRuntimePresenter/dispatch.ts`: 12

### Top incoming dependencies

- `presenter/index.ts`: 49
- `routes/publishDeepchatEvent.ts`: 44
- `presenter/remoteControlPresenter/types.ts`: 38
- `presenter/sqlitePresenter/tables/baseTable.ts`: 38
- `events.ts`: 30
- `eventbus.ts`: 29
- `agent/shared/agentSessionIds.ts`: 25
- `presenter/memoryPresenter/types.ts`: 22
- `presenter/remoteControlPresenter/services/remoteBindingStore.ts`: 22
- `presenter/memoryPresenter/ports.ts`: 20
- `presenter/sqlitePresenter/index.ts`: 19
- `presenter/remoteControlPresenter/services/remoteConversationRunner.ts`: 16
- `presenter/filePresenter/BaseFileAdapter.ts`: 13
- `presenter/memoryPresenter/context.ts`: 12
- `presenter/sqlitePresenter/tables/deepchatTapeEntries.ts`: 12

### Cycle samples

- `agent/acp/runtime/index.ts -> agent/acp/runtime/acpCompatibilityPromptBuilder.ts -> agent/acp/instance/ports.ts -> agent/acp/runtime/index.ts`
- `agent/acp/client/acpRuntimeOwner.ts -> agent/acp/client/index.ts -> agent/acp/client/acpRuntimeOwner.ts`
- `presenter/memoryPresenter/core/injectionPort.ts -> presenter/memoryPresenter/types.ts -> presenter/memoryPresenter/injection.ts -> presenter/memoryPresenter/core/injectionPort.ts`
- `presenter/sqlitePresenter/index.ts -> presenter/agentSessionPresenter/legacyImportService.ts -> presenter/sqlitePresenter/index.ts`
- `presenter/sqlitePresenter/index.ts -> presenter/agentSessionPresenter/legacyImportService.ts -> presenter/agentRuntimePresenter/messageStore.ts -> presenter/sqlitePresenter/index.ts`
- `presenter/agentRuntimePresenter/messageStore.ts -> presenter/agentRuntimePresenter/tapeFacts.ts -> presenter/agentRuntimePresenter/tapeViewManifest.ts -> presenter/agentRuntimePresenter/contextBuilder.ts -> presenter/agentRuntimePresenter/messageStore.ts`
- `presenter/index.ts -> presenter/windowPresenter/index.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/windowPresenter/index.ts -> presenter/tabPresenter.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/windowPresenter/index.ts -> presenter/windowPresenter/FloatingChatWindow.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/shortcutPresenter.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/llmProviderPresenter/index.ts -> presenter/llmProviderPresenter/managers/providerInstanceManager.ts -> presenter/llmProviderPresenter/providers/githubCopilotProvider.ts -> presenter/githubCopilotDeviceFlow.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/llmProviderPresenter/index.ts -> presenter/llmProviderPresenter/managers/providerInstanceManager.ts -> presenter/llmProviderPresenter/providers/ollamaProvider.ts -> presenter/llmProviderPresenter/aiSdk/index.ts -> presenter/llmProviderPresenter/aiSdk/runtime.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/sessionPresenter/index.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/sessionPresenter/index.ts -> presenter/sessionPresenter/managers/conversationManager.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/upgradePresenter/index.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/serverManager.ts -> presenter/mcpPresenter/mcpClient.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/serverManager.ts -> presenter/mcpPresenter/mcpClient.ts -> presenter/mcpPresenter/inMemoryServers/builder.ts -> presenter/mcpPresenter/inMemoryServers/deepResearchServer.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/serverManager.ts -> presenter/mcpPresenter/mcpClient.ts -> presenter/mcpPresenter/inMemoryServers/builder.ts -> presenter/mcpPresenter/inMemoryServers/autoPromptingServer.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/serverManager.ts -> presenter/mcpPresenter/mcpClient.ts -> presenter/mcpPresenter/inMemoryServers/builder.ts -> presenter/mcpPresenter/inMemoryServers/conversationSearchServer.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/serverManager.ts -> presenter/mcpPresenter/mcpClient.ts -> presenter/mcpPresenter/inMemoryServers/builder.ts -> presenter/mcpPresenter/inMemoryServers/builtinKnowledgeServer.ts -> presenter/index.ts`

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

- Total files: 110
- Internal dependency edges: 123
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
- `components/skills/SkillSyncDialog/ImportWizard.vue`: 3
- `App.vue`: 2

### Top incoming dependencies

- `components/control-center/SettingsPageShell.vue`: 13
- `components/skills/toolIcon.ts`: 6
- `components/memoryRedesignUtils.ts`: 5
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
