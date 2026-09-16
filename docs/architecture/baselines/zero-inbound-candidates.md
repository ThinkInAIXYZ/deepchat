# Zero Inbound Candidates

Generated on 2026-09-16.

These files have no in-repo importers inside their scope and need manual classification before deletion.

## main

- Candidate count: 85

- `agent/deepchat/contracts/memoryCursorStore.ts`
- `agent/deepchat/contracts/sessionAgentRow.ts`
- `agent/deepchat/contracts/transcriptStore.ts`
- `agent/deepchat/contracts/visionTarget.ts`
- `agent/deepchat/harness/pendingInputWakeupBinding.ts`
- `agent/deepchat/loop/contextCoordinator.ts`
- `agent/deepchat/loop/deepChatLoopEngine.ts`
- `agent/deepchat/loop/inputPreparationCoordinator.ts`
- `agent/deepchat/loop/loopRun.ts`
- `agent/deepchat/loop/notificationObserver.ts`
- `agent/deepchat/loop/providerProjectionIdentity.ts`
- `agent/deepchat/loop/providerRetryPolicy.ts`
- `agent/deepchat/memory/memoryExtractionChunks.ts`
- `agent/deepchat/memory/memoryPromptContributor.ts`
- `agent/deepchat/resources/promptAssembly.ts`
- `agent/deepchat/resources/systemEnvPromptBuilder.ts`
- `agent/deepchat/runtime/abortErrors.ts`
- `agent/deepchat/runtime/compactionRuntimeCoordinator.ts`
- `agent/deepchat/runtime/compactionService.ts`
- `agent/deepchat/runtime/contextBudgetPolicy.ts`
- `agent/deepchat/runtime/contextContributions.ts`
- `agent/deepchat/runtime/contextOccupancyCoordinator.ts`
- `agent/deepchat/runtime/contextWindowError.ts`
- `agent/deepchat/runtime/deferredExecutionContract.ts`
- `agent/deepchat/runtime/deferredToolExecutor.ts`
- `agent/deepchat/runtime/deferredToolSurface.ts`
- `agent/deepchat/runtime/imageGenerationBlocks.ts`
- `agent/deepchat/runtime/interactionParkingRegistry.ts`
- `agent/deepchat/runtime/interactionProjection.ts`
- `agent/deepchat/runtime/messageProjectionService.ts`
- `agent/deepchat/runtime/noProgressToolLoopGuard.ts`
- `agent/deepchat/runtime/pendingInputAdmissionCoordinator.ts`
- `agent/deepchat/runtime/pendingInputContracts.ts`
- `agent/deepchat/runtime/pendingInputPump.ts`
- `agent/deepchat/runtime/pluginContext.ts`
- `agent/deepchat/runtime/preStreamWatchdog.ts`
- `agent/deepchat/runtime/programmaticExecParent.ts`
- `agent/deepchat/runtime/promptAssemblyService.ts`
- `agent/deepchat/runtime/providerInputCapabilities.ts`
- `agent/deepchat/runtime/providerModelRuntimeFacts.ts`
- `agent/deepchat/runtime/providerPermissionCoordinator.ts`
- `agent/deepchat/runtime/providerPermissionResolution.ts`
- `agent/deepchat/runtime/providerReplaySegments.ts`
- `agent/deepchat/runtime/runLifecycleCoordinator.ts`
- `agent/deepchat/runtime/runTerminalProjectionError.ts`
- `agent/deepchat/runtime/runtimeErrorLogging.ts`
- `agent/deepchat/runtime/runtimeMetadata.ts`
- `agent/deepchat/runtime/sessionIdentityService.ts`
- `agent/deepchat/runtime/sessionLifecycleCoordinator.ts`
- `agent/deepchat/runtime/sessionSettingsCoordinator.ts`
- `agent/deepchat/runtime/sessionStateResolver.ts`
- `agent/deepchat/runtime/sessionStatusPublisher.ts`
- `agent/deepchat/runtime/skillContextMaterializer.ts`
- `agent/deepchat/runtime/streamRequestId.ts`
- `agent/deepchat/runtime/tapeViewAssembler.ts`
- `agent/deepchat/runtime/tapeViewPolicy.ts`
- `agent/deepchat/runtime/taskContractCapability.ts`
- `agent/deepchat/runtime/toolAdapters.ts`
- `agent/deepchat/runtime/toolExecutionPolicy.ts`
- `agent/deepchat/runtime/toolOutputGuard.ts`
- `agent/deepchat/runtime/toolPermissionReviewer.ts`
- `agent/deepchat/runtime/toolRuntimeBindings.ts`
- `agent/deepchat/runtime/toolSurfaceCanaryPricing.ts`
- `agent/deepchat/runtime/toolSurfaceSelection.ts`
- `agent/deepchat/runtime/transcriptMutationCoordinator.ts`
- `agent/deepchat/runtime/turnResumeContract.ts`
- `agent/shared/agentCatalogEventSink.ts`
- `backgroundExecUtilityHostEntry.ts`
- `codeModeUtilityHostEntry.ts`
- `config/aes.ts`
- `desktop/browser/BrowserContextBuilder.ts`
- `env.d.ts`
- `fileWatcherUtilityHostEntry.ts`
- `lib/system.ts`
- `lib/terminalHelper.ts`
- `lightOcrHelperEntry.ts`
- `mcp/agentMcpFilter.ts`
- `memory/core/asyncDeadline.ts`
- `memory/core/contributionBudget.ts`
- `memory/core/directiveContribution.ts`
- `provider/oauthHelper.ts`
- `schedulerUtilityHostEntry.ts`
- `session/data/tables/attachments.ts`
- `tape/domain/skillIdentity.ts`
- `tape/domain/workspacePath.ts`

## renderer-main

- Candidate count: 44

- `components/ChatConfig.vue`
- `components/ChatConfig/ConfigSwitchField.vue`
- `components/FileItem.vue`
- `components/ModelSelect.vue`
- `components/artifacts/ArtifactBlock.vue`
- `components/chat-input/SkillsPanel.vue`
- `components/chat-input/VoiceCallWidget.vue`
- `components/chat-input/composables/useAgentMcpData.ts`
- `components/chat-input/composables/useDragAndDrop.ts`
- `components/chat-input/composables/useInputHistory.ts`
- `components/chat-input/composables/useInputSettings.ts`
- `components/chat-input/composables/usePromptInputFiles.ts`
- `components/chat-input/composables/useRateLimitStatus.ts`
- `components/chat/composables/useVoiceInput.ts`
- `components/editor/mention/PromptParamsDialog.vue`
- `components/editor/mention/mention.ts`
- `components/editor/mention/slashMention.ts`
- `components/markdown/LinkNode.vue`
- `components/mcp-config/AgentMcpSelector.vue`
- `components/mcp-config/const.ts`
- `components/message/MessageActionButtons.vue`
- `components/message/MessageItemPlaceholder.vue`
- `components/message/ReferencePreview.vue`
- `components/settings/ModelConfigItem.vue`
- `composables/useArtifactCodeEditor.ts`
- `composables/useArtifactContext.ts`
- `composables/useArtifactExport.ts`
- `composables/useArtifactViewMode.ts`
- `composables/useSearchConfig.ts`
- `composables/useViewportSize.ts`
- `env.d.ts`
- `lib/cloudSyncForm.ts`
- `lib/float.cursor.ts`
- `lib/gemini.ts`
- `lib/sanitizeText.ts`
- `main.ts`
- `stores/floatingButton.ts`
- `stores/prompts.ts`
- `stores/providerDeeplinkImport.ts`
- `stores/shortcutKey.ts`
- `stores/sync.ts`
- `stores/systemPromptStore.ts`
- `types/vuedraggable.d.ts`
- `utils/maxOutputTokens.ts`

## renderer-settings

- Candidate count: 8

- `components/AcpProfileManagerDialog.vue`
- `components/common/DefaultModelSettingsSection.vue`
- `components/common/SettingToggleRow.vue`
- `components/prompt/PromptSettingsHeader.vue`
- `icons/MaximizeIcon.vue`
- `icons/MinimizeIcon.vue`
- `icons/RestoreIcon.vue`
- `main.ts`

## renderer-shared

- Candidate count: 2

- `notifications/NotificationHost.vue`
- `notifications/rendererNotificationPort.ts`
