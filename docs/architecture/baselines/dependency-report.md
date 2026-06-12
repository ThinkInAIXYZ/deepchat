# Dependency Baseline

Generated on 2026-06-11.

## main

- Total files: 428
- Internal dependency edges: 1080
- Cycles detected: 31

### Top outgoing dependencies

- `presenter/index.ts`: 45
- `presenter/sqlitePresenter/index.ts`: 29
- `presenter/agentRuntimePresenter/index.ts`: 27
- `presenter/configPresenter/index.ts`: 27
- `presenter/sqlitePresenter/schemaCatalog.ts`: 27
- `presenter/lifecyclePresenter/hooks/index.ts`: 21
- `presenter/toolPresenter/agentTools/agentToolManager.ts`: 20
- `routes/index.ts`: 19
- `presenter/agentSessionPresenter/index.ts`: 14
- `presenter/filePresenter/mime.ts`: 14
- `presenter/llmProviderPresenter/index.ts`: 14
- `presenter/remoteControlPresenter/index.ts`: 14
- `presenter/agentRuntimePresenter/dispatch.ts`: 13
- `presenter/llmProviderPresenter/acp/index.ts`: 12
- `presenter/llmProviderPresenter/acp/acpProcessManager.ts`: 11

### Top incoming dependencies

- `events.ts`: 55
- `eventbus.ts`: 54
- `presenter/index.ts`: 48
- `presenter/remoteControlPresenter/types.ts`: 37
- `presenter/sqlitePresenter/tables/baseTable.ts`: 28
- `routes/publishDeepchatEvent.ts`: 28
- `presenter/remoteControlPresenter/services/remoteBindingStore.ts`: 22
- `presenter/sqlitePresenter/index.ts`: 17
- `presenter/remoteControlPresenter/services/remoteConversationRunner.ts`: 16
- `presenter/filePresenter/BaseFileAdapter.ts`: 13
- `presenter/llmProviderPresenter/baseProvider.ts`: 11
- `presenter/configPresenter/acpRegistryConstants.ts`: 9
- `presenter/configPresenter/storeLike.ts`: 8
- `presenter/llmProviderPresenter/acp/index.ts`: 8
- `presenter/llmProviderPresenter/runtimePorts.ts`: 8

### Cycle samples

- `presenter/index.ts -> presenter/windowPresenter/index.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/windowPresenter/index.ts -> presenter/tabPresenter.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/windowPresenter/index.ts -> presenter/windowPresenter/FloatingChatWindow.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/shortcutPresenter.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/llmProviderPresenter/index.ts -> presenter/llmProviderPresenter/baseProvider.ts -> presenter/devicePresenter/index.ts -> presenter/index.ts`
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
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/toolManager.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/index.ts`
- `presenter/sqlitePresenter/index.ts -> presenter/agentSessionPresenter/legacyImportService.ts -> presenter/sqlitePresenter/index.ts`
- `presenter/sqlitePresenter/index.ts -> presenter/agentSessionPresenter/legacyImportService.ts -> presenter/agentRuntimePresenter/messageStore.ts -> presenter/sqlitePresenter/index.ts`
- `presenter/index.ts -> presenter/syncPresenter/index.ts -> presenter/index.ts`

## renderer-main

- Total files: 261
- Internal dependency edges: 458
- Cycles detected: 3

### Top outgoing dependencies

- `App.vue`: 29
- `pages/ChatPage.vue`: 27
- `i18n/index.ts`: 20
- `components/message/MessageItemAssistant.vue`: 18
- `pages/NewThreadPage.vue`: 18
- `components/chat/ChatStatusBar.vue`: 17
- `views/ChatTabView.vue`: 12
- `components/ChatConfig.vue`: 8
- `components/sidepanel/WorkspacePanel.vue`: 8
- `components/sidepanel/viewer/WorkspacePreviewPane.vue`: 8
- `components/WindowSideBar.vue`: 7
- `components/chat/ChatInputBox.vue`: 7
- `components/markdown/MarkdownRenderer.vue`: 7
- `components/mcp-config/components/McpServers.vue`: 7
- `components/mcp-config/components/index.ts`: 7

### Top incoming dependencies

- `components/chat/messageListItems.ts`: 22
- `stores/ui/session.ts`: 16
- `stores/providerStore.ts`: 14
- `stores/artifact.ts`: 13
- `stores/theme.ts`: 13
- `stores/ui/agent.ts`: 13
- `stores/uiSettingsStore.ts`: 12
- `stores/modelStore.ts`: 11
- `stores/ui/sidepanel.ts`: 10
- `components/use-toast.ts`: 9
- `stores/mcp.ts`: 8
- `components/icons/ModelIcon.vue`: 6
- `lib/onboardingResume.ts`: 6
- `stores/language.ts`: 6
- `stores/ui/draft.ts`: 5

### Cycle samples

- `components/json-viewer/JsonValue.ts -> components/json-viewer/JsonObject.ts -> components/json-viewer/JsonValue.ts`
- `components/json-viewer/JsonArray.ts -> components/json-viewer/JsonValue.ts -> components/json-viewer/JsonArray.ts`
- `composables/usePageCapture.example.ts -> composables/usePageCapture.example.ts`

## renderer-settings

- Total files: 92
- Internal dependency edges: 98
- Cycles detected: 0

### Top outgoing dependencies

- `main.ts`: 19
- `components/ModelProviderSettingsDetail.vue`: 10
- `components/skills/SkillsSettings.vue`: 8
- `components/KnowledgeBaseSettings.vue`: 7
- `components/CommonSettings.vue`: 5
- `components/ModelProviderSettings.vue`: 5
- `components/BedrockProviderSettingsDetail.vue`: 4
- `components/SettingsOverview.vue`: 4
- `components/DataSettings.vue`: 3
- `components/PromptSetting.vue`: 3
- `components/skills/SkillSyncDialog/ImportWizard.vue`: 3
- `App.vue`: 2
- `components/DisplaySettings.vue`: 2
- `components/McpSettings.vue`: 2
- `components/skills/SkillSyncDialog/SkillSyncDialog.vue`: 2

### Top incoming dependencies

- `components/control-center/SettingsPageShell.vue`: 12
- `lib/guidedOnboardingSettings.ts`: 3
- `components/ProviderDialogContainer.vue`: 2
- `components/ProviderModelManager.vue`: 2
- `components/ProviderRateLimitConfig.vue`: 2
- `components/ProviderSettingsShell.vue`: 2
- `components/common/SettingToggleRow.vue`: 2
- `components/skills/SkillSyncDialog/ConflictResolver.vue`: 2
- `App.vue`: 1
- `components/AboutUsSettings.vue`: 1
- `components/AcpDebugDialog.vue`: 1
- `components/AcpSettings.vue`: 1
- `components/AddCustomModelButton.vue`: 1
- `components/AddCustomProviderDialog.vue`: 1
- `components/AzureProviderConfig.vue`: 1

### Cycle samples

- None

