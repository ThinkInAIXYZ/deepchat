# Dependency Baseline

Generated on 2026-09-16.

## main

- Total files: 901
- Internal dependency edges: 2406
- Cycles detected: 9

### Top outgoing dependencies

- `app/composition.ts`: 185
- `data/schemaCatalog.ts`: 46
- `tool/agentTools/agentToolManager.ts`: 37
- `memory/index.ts`: 24
- `session/data/database.ts`: 24
- `tool/index.ts`: 24
- `agent/deepchat/harness/runtimeServices.ts`: 23
- `tape/application/sessionTape.ts`: 23
- `mcp/index.ts`: 21
- `app/mainProcess.ts`: 20
- `cli/index.ts`: 20
- `mcp/inMemoryServers/builder.ts`: 18
- `provider/settings.ts`: 18
- `agent/acp/compatibility/dependencies.ts`: 17
- `provider/index.ts`: 16

### Top incoming dependencies

- `data/baseTable.ts`: 45
- `routes/routeRegistry.ts`: 43
- `remote/types.ts`: 39
- `config/settingsStore.ts`: 35
- `provider/settings.ts`: 34
- `agent/settings.ts`: 30
- `memory/types.ts`: 24
- `tape/ports/capabilities.ts`: 24
- `agent/shared/agentSessionIds.ts`: 23
- `memory/ports.ts`: 23
- `remote/binding/store.ts`: 22
- `tape/domain/entry.ts`: 21
- `mcp/settings.ts`: 19
- `memory/domain/types.ts`: 18
- `cli/errors.ts`: 17

### Cycle samples

- `session/data/tables/deepchatAssistantBlocks.ts -> session/data/messageContent.ts -> session/data/tables/deepchatAssistantBlocks.ts`
- `agent/acp/runtime/index.ts -> agent/acp/runtime/acpCompatibilityPromptBuilder.ts -> agent/acp/instance/ports.ts -> agent/acp/runtime/index.ts`
- `agent/acp/client/index.ts -> agent/acp/client/acpRuntimeOwner.ts -> agent/acp/client/index.ts`
- `desktop/browser/YoBrowserPresenter.ts -> desktop/browser/YoBrowserToolHandler.ts -> desktop/browser/YoBrowserPresenter.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/agentTapeTools.ts -> tool/agentTools/agentToolManager.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/agentMemoryTools.ts -> tool/agentTools/agentToolManager.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/cronJobTool.ts -> tool/agentTools/agentToolManager.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/liveDelegationTool.ts -> tool/agentTools/agentToolManager.ts`
- `skill/sync/toolScanner.ts -> skill/sync/security.ts -> skill/sync/toolScanner.ts`

## renderer-main

- Total files: 361
- Internal dependency edges: 683
- Cycles detected: 2

### Top outgoing dependencies

- `features/chat-page/ChatPage.vue`: 46
- `apps/chat-main/ChatMainApp.vue`: 32
- `i18n/index.ts`: 24
- `pages/NewThreadPage.vue`: 22
- `components/message/MessageItemAssistant.vue`: 20
- `components/chat/ChatStatusBar.vue`: 19
- `components/WindowSideBar.vue`: 16
- `apps/chat-main/ChatTabView.vue`: 15
- `components/tape-inspector/TapeInspectorPanel.vue`: 11
- `components/chat/ChatInputBox.vue`: 10
- `features/chat-page/composables/useComposerSubmit.ts`: 10
- `stores/ui/session.ts`: 10
- `components/ChatConfig.vue`: 9
- `components/markdown/MarkdownRenderer.vue`: 9
- `components/message/MessageBlockToolCall.vue`: 9

### Top incoming dependencies

- `stores/ui/session.ts`: 33
- `features/chat-page/model/displayMessage.ts`: 32
- `stores/theme.ts`: 16
- `stores/ui/agent.ts`: 15
- `stores/ui/sidepanel.ts`: 14
- `stores/uiSettingsStore.ts`: 14
- `stores/artifact.ts`: 13
- `stores/providerStore.ts`: 13
- `stores/modelStore.ts`: 12
- `stores/ui/message.ts`: 10
- `stores/mcp.ts`: 8
- `stores/ui/project.ts`: 8
- `components/tape-inspector/model.ts`: 7
- `lib/onboardingResume.ts`: 7
- `components/icons/ModelIcon.vue`: 6

### Cycle samples

- `components/json-viewer/JsonValue.ts -> components/json-viewer/JsonObject.ts -> components/json-viewer/JsonValue.ts`
- `components/json-viewer/JsonArray.ts -> components/json-viewer/JsonValue.ts -> components/json-viewer/JsonArray.ts`

## renderer-settings

- Total files: 101
- Internal dependency edges: 165
- Cycles detected: 0

### Top outgoing dependencies

- `settingsRouteComponents.ts`: 21
- `components/ModelProviderSettingsDetail.vue`: 11
- `components/MemorySettings.vue`: 10
- `components/KnowledgeBaseSettings.vue`: 8
- `App.vue`: 6
- `components/MemoryListView.vue`: 6
- `components/ModelProviderSettings.vue`: 6
- `components/CommonSettings.vue`: 5
- `components/DataSettings.vue`: 5
- `components/BedrockProviderSettingsDetail.vue`: 4
- `components/MemoryDiagnosticsPanel.vue`: 4
- `components/MemoryDirectivesPanel.vue`: 4
- `components/MemoryInlinePanel.vue`: 4
- `components/SettingsOverview.vue`: 4
- `components/MemoryConfigInlinePanel.vue`: 3

### Top incoming dependencies

- `services/settingsLeaveGuard.ts`: 26
- `components/control-center/SettingsPageShell.vue`: 15
- `lib/useMemoryInlineFeedback.ts`: 9
- `components/MemoryInlineFeedback.vue`: 8
- `components/memoryRedesignUtils.ts`: 5
- `components/ProviderCustomHeadersEditor.vue`: 3
- `components/control-center/SettingsSectionCard.vue`: 3
- `lib/useExternalKnowledgeConfigs.ts`: 3
- `components/ProviderDialogContainer.vue`: 2
- `components/ProviderModelManager.vue`: 2
- `components/ProviderRateLimitConfig.vue`: 2
- `components/ProviderSettingsShell.vue`: 2
- `lib/guidedOnboardingSettings.ts`: 2
- `lib/useKnowledgeConfigOperation.ts`: 2
- `lib/useMemoryNumberFormatters.ts`: 2

### Cycle samples

- None

## renderer-shared

- Total files: 15
- Internal dependency edges: 38
- Cycles detected: 0

### Top outgoing dependencies

- `notifications/index.ts`: 7
- `notifications/notificationManager.ts`: 7
- `notifications/notificationArbitration.ts`: 3
- `notifications/notificationEntry.ts`: 3
- `notifications/rendererNotificationPort.ts`: 3
- `notifications/rendererNotificationRuntime.ts`: 3
- `notifications/semanticNotificationController.ts`: 3
- `notifications/sonnerNotificationPresenter.ts`: 3
- `notifications/notificationPresenter.ts`: 2
- `notifications/ManagedNotificationToast.vue`: 1
- `notifications/notificationPolicy.ts`: 1
- `notifications/notificationRecord.ts`: 1
- `notifications/notificationRequest.ts`: 1
- `notifications/NotificationHost.vue`: 0
- `notifications/notificationTypes.ts`: 0

### Top incoming dependencies

- `notifications/notificationTypes.ts`: 10
- `notifications/notificationRecord.ts`: 6
- `notifications/notificationManager.ts`: 4
- `notifications/notificationPolicy.ts`: 4
- `notifications/notificationPresenter.ts`: 4
- `notifications/notificationRequest.ts`: 3
- `notifications/notificationEntry.ts`: 2
- `notifications/ManagedNotificationToast.vue`: 1
- `notifications/notificationArbitration.ts`: 1
- `notifications/rendererNotificationRuntime.ts`: 1
- `notifications/semanticNotificationController.ts`: 1
- `notifications/sonnerNotificationPresenter.ts`: 1
- `notifications/NotificationHost.vue`: 0
- `notifications/index.ts`: 0
- `notifications/rendererNotificationPort.ts`: 0

### Cycle samples

- None
