# Dependency Baseline

Generated on 2026-11-10.

## main

- Total files: 897
- Internal dependency edges: 2902
- Cycles detected: 11

### Top outgoing dependencies

- `app/composition.ts`: 219
- `data/schemaCatalog.ts`: 55
- `session/data/database.ts`: 33
- `agent/acp/compatibility/dependencies.ts`: 29
- `memory/index.ts`: 25
- `agent/dim/createDimAgent.ts`: 24
- `mcp/index.ts`: 23
- `provider/index.ts`: 22
- `tape/application/sessionTape.ts`: 22
- `tool/index.ts`: 21
- `app/mainProcess.ts`: 20
- `cli/index.ts`: 20
- `provider/settings.ts`: 20
- `mcp/inMemoryServers/builder.ts`: 17
- `provider/managers/providerInstanceManager.ts`: 17

### Top incoming dependencies

- `data/baseTable.ts`: 54
- `routes/routeRegistry.ts`: 45
- `provider/settings.ts`: 40
- `session/data/database.ts`: 40
- `remote/types.ts`: 39
- `tape/domain/entry.ts`: 37
- `config/settingsStore.ts`: 34
- `agent/shared/agentSessionIds.ts`: 32
- `agent/settings.ts`: 31
- `tape/ports/capabilities.ts`: 29
- `memory/ports.ts`: 27
- `tape/domain/canonicalJson.ts`: 26
- `memory/types.ts`: 25
- `memory/domain/types.ts`: 24
- `session/data/tables/dimSessionBindings.ts`: 23

### Cycle samples

- `session/data/tables/dimSessionBindings.ts -> session/data/tables/dimSessionScopes.ts -> session/data/tables/dimSessionBindings.ts`
- `session/data/messageContent.ts -> session/data/tables/deepchatAssistantBlocks.ts -> session/data/messageContent.ts`
- `memory/types.ts -> memory/injection.ts -> memory/core/injectionPort.ts -> memory/types.ts`
- `memory/core/injectionPort.ts -> memory/core/directiveContribution.ts -> memory/core/injectionPort.ts`
- `agent/acp/runtime/index.ts -> agent/acp/runtime/acpCompatibilityPromptBuilder.ts -> agent/acp/instance/ports.ts -> agent/acp/runtime/index.ts`
- `agent/acp/client/index.ts -> agent/acp/client/acpRuntimeOwner.ts -> agent/acp/client/index.ts`
- `provider/settings.ts -> provider/modelConfig.ts -> provider/providerRegistry.ts -> provider/aiSdk/providerFactory.ts -> provider/settings.ts`
- `memory/runtimeContracts.ts -> memory/session/memoryPromptContributor.ts -> memory/runtimeContracts.ts`
- `desktop/browser/YoBrowserPresenter.ts -> desktop/browser/YoBrowserToolHandler.ts -> desktop/browser/YoBrowserPresenter.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/agentMemoryTools.ts -> tool/agentTools/agentToolManager.ts`
- `skill/sync/toolScanner.ts -> skill/sync/security.ts -> skill/sync/toolScanner.ts`

## renderer-main

- Total files: 370
- Internal dependency edges: 715
- Cycles detected: 2

### Top outgoing dependencies

- `features/chat-page/ChatPage.vue`: 53
- `apps/chat-main/ChatMainApp.vue`: 33
- `pages/NewThreadPage.vue`: 27
- `i18n/index.ts`: 24
- `components/chat/ChatStatusBar.vue`: 23
- `components/message/MessageItemAssistant.vue`: 20
- `components/WindowSideBar.vue`: 17
- `apps/chat-main/ChatTabView.vue`: 16
- `components/chat/ChatInputBox.vue`: 15
- `components/tape-inspector/TapeInspectorPanel.vue`: 11
- `features/chat-page/composables/useComposerSubmit.ts`: 10
- `features/chat-session/store.ts`: 10
- `components/ChatConfig.vue`: 9
- `components/message/MessageBlockToolCall.vue`: 9
- `components/message/MessageItemUser.vue`: 9

### Top incoming dependencies

- `features/chat-page/model/displayMessage.ts`: 34
- `stores/ui/session.ts`: 27
- `stores/theme.ts`: 16
- `features/chat-session/store.ts`: 14
- `stores/ui/agent.ts`: 14
- `stores/modelStore.ts`: 13
- `stores/providerStore.ts`: 13
- `stores/ui/sidepanel.ts`: 13
- `stores/uiSettingsStore.ts`: 12
- `stores/mcp.ts`: 9
- `stores/ui/message.ts`: 9
- `lib/onboardingResume.ts`: 8
- `stores/ui/draft.ts`: 8
- `stores/ui/project.ts`: 8
- `components/tape-inspector/model.ts`: 7

### Cycle samples

- `components/json-viewer/JsonValue.ts -> components/json-viewer/JsonObject.ts -> components/json-viewer/JsonValue.ts`
- `components/json-viewer/JsonArray.ts -> components/json-viewer/JsonValue.ts -> components/json-viewer/JsonArray.ts`

## renderer-settings

- Total files: 112
- Internal dependency edges: 189
- Cycles detected: 0

### Top outgoing dependencies

- `settingsRouteComponents.ts`: 21
- `components/ModelProviderSettingsDetail.vue`: 12
- `components/MemorySettings.vue`: 10
- `components/KnowledgeBaseSettings.vue`: 7
- `components/MemoryListView.vue`: 7
- `components/ModelProviderSettings.vue`: 7
- `App.vue`: 6
- `components/CronJobsSettings.vue`: 6
- `components/DataSettings.vue`: 6
- `components/MemoryInlinePanel.vue`: 6
- `components/BedrockProviderSettingsDetail.vue`: 5
- `components/CommonSettings.vue`: 5
- `components/MemoryDiagnosticsPanel.vue`: 4
- `components/MemoryDirectivesPanel.vue`: 4
- `components/ProviderApiConfig.vue`: 4

### Top incoming dependencies

- `services/settingsLeaveGuard.ts`: 29
- `components/control-center/SettingsPageShell.vue`: 15
- `lib/useMemoryInlineFeedback.ts`: 9
- `components/MemoryInlineFeedback.vue`: 8
- `components/memoryRedesignUtils.ts`: 6
- `components/providerOnboardingReadiness.ts`: 4
- `components/ProviderCustomHeadersEditor.vue`: 3
- `components/control-center/SettingsSectionCard.vue`: 3
- `components/cronJobs/cronJobDelivery.ts`: 3
- `components/cronJobs/useCronJobFormat.ts`: 3
- `lib/useExternalKnowledgeConfigs.ts`: 3
- `components/MemoryImpactReview.vue`: 2
- `components/ProviderDialogContainer.vue`: 2
- `components/ProviderModelManager.vue`: 2
- `components/ProviderRateLimitConfig.vue`: 2

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
