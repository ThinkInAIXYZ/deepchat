# Dependency Baseline

Generated on 2026-07-29.

## main

- Total files: 716
- Internal dependency edges: 2310
- Cycles detected: 10

### Top outgoing dependencies

- `app/composition.ts`: 149
- `agent/deepchat/runtime/deepChatLoopRunner.ts`: 43
- `agent/deepchat/runtime/turnCoordinator.ts`: 42
- `data/schemaCatalog.ts`: 42
- `agent/deepchat/harness/createDeepChatAgentHarness.ts`: 33
- `tool/agentTools/agentToolManager.ts`: 27
- `agent/deepchat/harness/runtimeServices.ts`: 26
- `memory/index.ts`: 23
- `session/data/database.ts`: 23
- `agent/deepchat/runtime/compactionRuntimeCoordinator.ts`: 22
- `agent/deepchat/runtime/interactionCoordinator.ts`: 20
- `app/mainProcess.ts`: 18
- `mcp/inMemoryServers/builder.ts`: 18
- `agent/acp/compatibility/dependencies.ts`: 17
- `provider/index.ts`: 16

### Top incoming dependencies

- `provider/settings.ts`: 46
- `agent/shared/agentSessionIds.ts`: 45
- `data/baseTable.ts`: 41
- `remote/types.ts`: 39
- `config/settingsStore.ts`: 35
- `agent/settings.ts`: 33
- `agent/deepchat/runtime/types.ts`: 26
- `memory/types.ts`: 24
- `routes/routeRegistry.ts`: 24
- `agent/deepchat/instance/deepChatAgentRuntime.ts`: 22
- `memory/ports.ts`: 22
- `remote/binding/store.ts`: 22
- `memory/domain/types.ts`: 21
- `session/data/transcript.ts`: 21
- `tape/domain/entry.ts`: 21

### Cycle samples

- `memory/types.ts -> memory/injection.ts -> memory/core/injectionPort.ts -> memory/types.ts`
- `memory/core/injectionPort.ts -> memory/core/directiveContribution.ts -> memory/core/injectionPort.ts`
- `agent/acp/runtime/index.ts -> agent/acp/runtime/acpCompatibilityPromptBuilder.ts -> agent/acp/instance/ports.ts -> agent/acp/runtime/index.ts`
- `agent/acp/client/acpRuntimeOwner.ts -> agent/acp/client/index.ts -> agent/acp/client/acpRuntimeOwner.ts`
- `desktop/browser/YoBrowserPresenter.ts -> desktop/browser/YoBrowserToolHandler.ts -> desktop/browser/YoBrowserPresenter.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/subagentOrchestratorTool.ts -> tool/agentTools/agentToolManager.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/agentTapeTools.ts -> tool/agentTools/agentToolManager.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/agentMemoryTools.ts -> tool/agentTools/agentToolManager.ts`
- `tool/agentTools/agentToolManager.ts -> tool/agentTools/cronJobTool.ts -> tool/agentTools/agentToolManager.ts`
- `skill/sync/toolScanner.ts -> skill/sync/security.ts -> skill/sync/toolScanner.ts`

## renderer-main

- Total files: 309
- Internal dependency edges: 555
- Cycles detected: 2

### Top outgoing dependencies

- `features/chat-page/ChatPage.vue`: 42
- `apps/chat-main/ChatMainApp.vue`: 28
- `i18n/index.ts`: 21
- `components/chat/ChatStatusBar.vue`: 19
- `components/message/MessageItemAssistant.vue`: 18
- `pages/NewThreadPage.vue`: 18
- `apps/chat-main/ChatTabView.vue`: 15
- `components/ChatConfig.vue`: 9
- `components/WindowSideBar.vue`: 9
- `components/chat/ChatInputBox.vue`: 9
- `stores/ui/session.ts`: 9
- `components/settings/ModelConfigDialog.vue`: 8
- `components/sidepanel/WorkspacePanel.vue`: 8
- `components/sidepanel/viewer/WorkspacePreviewPane.vue`: 8
- `features/chat-page/composables/useComposerSubmit.ts`: 8

### Top incoming dependencies

- `features/chat-page/model/displayMessage.ts`: 26
- `stores/ui/session.ts`: 23
- `stores/ui/agent.ts`: 15
- `stores/theme.ts`: 14
- `stores/artifact.ts`: 13
- `stores/providerStore.ts`: 13
- `stores/modelStore.ts`: 12
- `stores/uiSettingsStore.ts`: 12
- `stores/ui/sidepanel.ts`: 11
- `stores/ui/message.ts`: 9
- `stores/mcp.ts`: 8
- `components/icons/ModelIcon.vue`: 6
- `lib/onboardingResume.ts`: 6
- `stores/language.ts`: 6
- `composables/chat/chatScrollState.ts`: 5

### Cycle samples

- `components/json-viewer/JsonValue.ts -> components/json-viewer/JsonObject.ts -> components/json-viewer/JsonValue.ts`
- `components/json-viewer/JsonArray.ts -> components/json-viewer/JsonValue.ts -> components/json-viewer/JsonArray.ts`

## renderer-settings

- Total files: 109
- Internal dependency edges: 177
- Cycles detected: 0

### Top outgoing dependencies

- `settingsRouteComponents.ts`: 21
- `components/MemorySettings.vue`: 10
- `components/ModelProviderSettingsDetail.vue`: 10
- `components/skills/SkillsSettings.vue`: 10
- `components/KnowledgeBaseSettings.vue`: 8
- `components/MemoryListView.vue`: 6
- `App.vue`: 5
- `components/CommonSettings.vue`: 5
- `components/DataSettings.vue`: 5
- `components/ModelProviderSettings.vue`: 5
- `components/BedrockProviderSettingsDetail.vue`: 4
- `components/MemoryDirectivesPanel.vue`: 4
- `components/MemoryInlinePanel.vue`: 4
- `components/PromptSetting.vue`: 4
- `components/SettingsOverview.vue`: 4

### Top incoming dependencies

- `services/settingsLeaveGuard.ts`: 33
- `components/control-center/SettingsPageShell.vue`: 15
- `lib/useMemoryInlineFeedback.ts`: 9
- `components/MemoryInlineFeedback.vue`: 8
- `components/memoryRedesignUtils.ts`: 5
- `lib/guidedOnboardingSettings.ts`: 3
- `lib/useExternalKnowledgeConfigs.ts`: 3
- `components/ProviderDialogContainer.vue`: 2
- `components/ProviderModelManager.vue`: 2
- `components/ProviderRateLimitConfig.vue`: 2
- `components/ProviderSettingsShell.vue`: 2
- `components/common/SettingToggleRow.vue`: 2
- `components/control-center/SettingsSectionCard.vue`: 2
- `components/skills/SkillDetailDialog.vue`: 2
- `components/skills/toolIcon.ts`: 2

### Cycle samples

- None

## renderer-shared

- Total files: 19
- Internal dependency edges: 50
- Cycles detected: 0

### Top outgoing dependencies

- `notifications/index.ts`: 10
- `notifications/notificationManager.ts`: 7
- `notifications/rendererNotificationRuntime.ts`: 5
- `notifications/surfaceFeedbackController.ts`: 5
- `notifications/notificationArbitration.ts`: 3
- `notifications/notificationEntry.ts`: 3
- `notifications/rendererNotificationPort.ts`: 3
- `notifications/semanticNotificationController.ts`: 3
- `notifications/sonnerNotificationPresenter.ts`: 3
- `notifications/notificationPresenter.ts`: 2
- `notifications/InlineOperationFeedback.vue`: 1
- `notifications/ManagedNotificationToast.vue`: 1
- `notifications/notificationPolicy.ts`: 1
- `notifications/notificationRecord.ts`: 1
- `notifications/notificationRequest.ts`: 1

### Top incoming dependencies

- `notifications/notificationTypes.ts`: 11
- `notifications/notificationRecord.ts`: 6
- `notifications/notificationManager.ts`: 5
- `notifications/notificationPolicy.ts`: 5
- `notifications/notificationPresenter.ts`: 4
- `notifications/notificationRequest.ts`: 4
- `notifications/surfaceFeedbackController.ts`: 4
- `notifications/surfaceVisibility.ts`: 3
- `notifications/notificationEntry.ts`: 2
- `notifications/ManagedNotificationToast.vue`: 1
- `notifications/notificationArbitration.ts`: 1
- `notifications/rendererNotificationRuntime.ts`: 1
- `notifications/semanticNotificationController.ts`: 1
- `notifications/sonnerNotificationPresenter.ts`: 1
- `notifications/useSurfaceFeedback.ts`: 1

### Cycle samples

- None
