# Dependency Baseline

Generated on 2026-04-03.

## main

- Total files: 333
- Internal dependency edges: 826
- Cycles detected: 30

### Top outgoing dependencies

- `presenter/index.ts`: 39
- `presenter/llmProviderPresenter/managers/providerInstanceManager.ts`: 38
- `presenter/configPresenter/index.ts`: 22
- `presenter/agentRuntimePresenter/index.ts`: 20
- `presenter/lifecyclePresenter/hooks/index.ts`: 17
- `presenter/sqlitePresenter/index.ts`: 16
- `presenter/remoteControlPresenter/index.ts`: 15
- `presenter/llmProviderPresenter/index.ts`: 14
- `presenter/toolPresenter/agentTools/agentToolManager.ts`: 14
- `presenter/agentSessionPresenter/index.ts`: 13
- `presenter/llmProviderPresenter/acp/index.ts`: 12
- `presenter/filePresenter/mime.ts`: 11
- `presenter/mcpPresenter/inMemoryServers/builder.ts`: 11
- `presenter/skillSyncPresenter/adapters/index.ts`: 11
- `presenter/filePresenter/FileAdapterConstructor.ts`: 10

### Top incoming dependencies

- `events.ts`: 58
- `eventbus.ts`: 57
- `presenter/index.ts`: 44
- `presenter/llmProviderPresenter/runtimePorts.ts`: 34
- `presenter/llmProviderPresenter/baseProvider.ts`: 19
- `presenter/remoteControlPresenter/types.ts`: 18
- `presenter/sqlitePresenter/tables/baseTable.ts`: 16
- `presenter/sqlitePresenter/index.ts`: 12
- `presenter/configPresenter/modelCapabilities.ts`: 11
- `presenter/filePresenter/BaseFileAdapter.ts`: 11
- `presenter/proxyConfig.ts`: 10
- `lib/runtimeHelper.ts`: 9
- `presenter/configPresenter/providerDbLoader.ts`: 9
- `presenter/configPresenter/acpRegistryConstants.ts`: 8

### Cycle samples

- `presenter/index.ts -> presenter/windowPresenter/index.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/windowPresenter/index.ts -> presenter/tabPresenter.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/windowPresenter/index.ts -> presenter/windowPresenter/FloatingChatWindow.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/shortcutPresenter.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/llmProviderPresenter/index.ts -> presenter/llmProviderPresenter/baseProvider.ts -> presenter/devicePresenter/index.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/llmProviderPresenter/index.ts -> presenter/llmProviderPresenter/managers/providerInstanceManager.ts -> presenter/llmProviderPresenter/providers/githubCopilotProvider.ts -> presenter/githubCopilotDeviceFlow.ts -> presenter/index.ts`
- `presenter/filePresenter/mime.ts -> presenter/filePresenter/CsvFileAdapter.ts -> presenter/filePresenter/BaseFileAdapter.ts -> presenter/filePresenter/mime.ts`
- `presenter/index.ts -> presenter/sessionPresenter/index.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/sessionPresenter/index.ts -> presenter/sessionPresenter/managers/conversationManager.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/serverManager.ts -> presenter/mcpPresenter/mcpClient.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/serverManager.ts -> presenter/mcpPresenter/mcpClient.ts -> presenter/mcpPresenter/inMemoryServers/builder.ts -> presenter/mcpPresenter/inMemoryServers/deepResearchServer.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/serverManager.ts -> presenter/mcpPresenter/mcpClient.ts -> presenter/mcpPresenter/inMemoryServers/builder.ts -> presenter/mcpPresenter/inMemoryServers/autoPromptingServer.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/serverManager.ts -> presenter/mcpPresenter/mcpClient.ts -> presenter/mcpPresenter/inMemoryServers/builder.ts -> presenter/mcpPresenter/inMemoryServers/conversationSearchServer.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/serverManager.ts -> presenter/mcpPresenter/mcpClient.ts -> presenter/mcpPresenter/inMemoryServers/builder.ts -> presenter/mcpPresenter/inMemoryServers/builtinKnowledgeServer.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/mcpPresenter/toolManager.ts -> presenter/index.ts`
- `presenter/index.ts -> presenter/mcpPresenter/index.ts -> presenter/index.ts`
- `presenter/sqlitePresenter/index.ts -> presenter/agentSessionPresenter/legacyImportService.ts -> presenter/sqlitePresenter/index.ts`
- `presenter/index.ts -> presenter/syncPresenter/index.ts -> presenter/index.ts`

## renderer

- Total files: 235
- Internal dependency edges: 478
- Cycles detected: 4

### Top outgoing dependencies

- `App.vue`: 24
- `pages/ChatPage.vue`: 17
- `views/PlaygroundTabView.vue`: 16
- `components/message/MessageItemAssistant.vue`: 15
- `i18n/index.ts`: 12
- `components/chat/ChatStatusBar.vue`: 11
- `components/ChatConfig.vue`: 9
- `components/sidepanel/WorkspacePanel.vue`: 9
- `pages/NewThreadPage.vue`: 9
- `views/ChatTabView.vue`: 9
- `components/AppBar.vue`: 8
- `components/WindowSideBar.vue`: 8
- `components/mcp-config/components/McpServers.vue`: 8
- `components/message/MessageBlockContent.vue`: 8
- `components/chat/composables/useChatInputMentions.ts`: 7

### Top incoming dependencies

- `composables/usePresenter.ts`: 64
- `events.ts`: 32
- `components/chat/messageListItems.ts`: 16
- `stores/ui/session.ts`: 15
- `stores/artifact.ts`: 13
- `stores/providerStore.ts`: 13
- `stores/theme.ts`: 12
- `stores/modelStore.ts`: 11
- `stores/ui/agent.ts`: 11
- `stores/uiSettingsStore.ts`: 10
- `stores/mcp.ts`: 8
- `stores/ui/sidepanel.ts`: 8
- `components/icons/ModelIcon.vue`: 6
- `components/use-toast.ts`: 6
- `stores/language.ts`: 6

### Cycle samples

- `stores/ui/session.ts -> stores/ui/message.ts -> stores/ui/session.ts`
- `components/json-viewer/JsonValue.ts -> components/json-viewer/JsonObject.ts -> components/json-viewer/JsonValue.ts`
- `components/json-viewer/JsonArray.ts -> components/json-viewer/JsonValue.ts -> components/json-viewer/JsonArray.ts`
- `composables/usePageCapture.example.ts -> composables/usePageCapture.example.ts`
