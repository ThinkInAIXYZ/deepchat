# Renderer Store & Composables Classification

**Status**: Draft  
**Created**: 2026-01-20  
**Owner**: Eric

## 说明
- 分类依据：`docs/specs/renderer-store-composables-rules/spec.md` 的职责与依赖规则。
- 目的：提供 file -> category 的可追踪清单，作为迁移与审计入口。
- 约定：标注 “需调整” 的条目表示当前实现与规则不一致。

## Store 清单
- `src/renderer/src/stores/agentModelStore.ts`
- `src/renderer/src/stores/artifact.ts`
- `src/renderer/src/stores/chat.ts`（体量过大，优先拆分）
- `src/renderer/src/stores/dialog.ts`
- `src/renderer/src/stores/floatingButton.ts`
- `src/renderer/src/stores/language.ts`
- `src/renderer/src/stores/layoutStore.ts`
- `src/renderer/src/stores/mcp.ts`（体量过大，优先拆分）
- `src/renderer/src/stores/mcpSampling.ts`
- `src/renderer/src/stores/modelCheck.ts`
- `src/renderer/src/stores/modelConfigStore.ts`
- `src/renderer/src/stores/modelStore.ts`（体量过大，优先拆分）
- `src/renderer/src/stores/ollamaStore.ts`
- `src/renderer/src/stores/prompts.ts`
- `src/renderer/src/stores/providerStore.ts`
- `src/renderer/src/stores/reference.ts`
- `src/renderer/src/stores/searchAssistantStore.ts`
- `src/renderer/src/stores/searchEngineStore.ts`
- `src/renderer/src/stores/sidebarStore.ts`
- `src/renderer/src/stores/shortcutKey.ts`
- `src/renderer/src/stores/skillsStore.ts`
- `src/renderer/src/stores/sound.ts`
- `src/renderer/src/stores/sync.ts`
- `src/renderer/src/stores/systemPromptStore.ts`
- `src/renderer/src/stores/theme.ts`
- `src/renderer/src/stores/traceDialog.ts`
- `src/renderer/src/stores/uiSettingsStore.ts`
- `src/renderer/src/stores/upgrade.ts`
- `src/renderer/src/stores/windowStore.ts`
- `src/renderer/src/stores/workspace.ts`
- `src/renderer/src/stores/yoBrowser.ts`

## Composables 清单
### Adapter Composable
- `src/renderer/src/composables/acp/useAcpEventsAdapter.ts`
- `src/renderer/src/composables/chat/useAcpRuntimeAdapter.ts`
- `src/renderer/src/composables/chat/useChatAdapter.ts`
- `src/renderer/src/composables/chat/useChatEvents.ts`
- `src/renderer/src/composables/chat/useConversationCore.ts`
- `src/renderer/src/composables/chat/useExecutionAdapter.ts`
- `src/renderer/src/composables/chat/useExportAdapter.ts`
- `src/renderer/src/composables/chat/useMessageStreaming.ts`
- `src/renderer/src/composables/config/useConfigEventsAdapter.ts`
- `src/renderer/src/composables/config/useSettingsConfigAdapter.ts`
- `src/renderer/src/composables/dialog/useDialogAdapter.ts`
- `src/renderer/src/composables/file/useFileAdapter.ts`
- `src/renderer/src/composables/floating-button/useFloatingButtonAdapter.ts`
- `src/renderer/src/composables/mcp/useMcpEventsAdapter.ts`
- `src/renderer/src/composables/mcp/useMcpAdapter.ts`
- `src/renderer/src/composables/mcp/useMcpToolingAdapter.ts`
- `src/renderer/src/composables/message/useMessageCapture.ts`
- `src/renderer/src/composables/notifications/useNotificationAdapter.ts`
- `src/renderer/src/composables/rate-limit/useRateLimitAdapter.ts`
- `src/renderer/src/composables/model/useModelAdapter.ts`
- `src/renderer/src/composables/model/useModelConfigAdapter.ts`
- `src/renderer/src/composables/model/useAgentModelAdapter.ts`
- `src/renderer/src/composables/mcp/useMcpSamplingAdapter.ts`
- `src/renderer/src/composables/ollama/useOllamaAdapter.ts`
- `src/renderer/src/composables/provider/useProviderAdapter.ts`
- `src/renderer/src/composables/search/useSearchAssistantAdapter.ts`
- `src/renderer/src/composables/search/useSearchEngineAdapter.ts`
- `src/renderer/src/composables/sidebar/useSidebarAdapter.ts`
- `src/renderer/src/composables/settings/useLanguageAdapter.ts`
- `src/renderer/src/composables/settings/useShortcutAdapter.ts`
- `src/renderer/src/composables/settings/useSoundAdapter.ts`
- `src/renderer/src/composables/settings/useSystemPromptAdapter.ts`
- `src/renderer/src/composables/settings/useThemeAdapter.ts`
- `src/renderer/src/composables/skills/useSkillsAdapter.ts`
- `src/renderer/src/composables/sync/useSyncAdapter.ts`
- `src/renderer/src/composables/upgrade/useUpgradeAdapter.ts`
- `src/renderer/src/composables/useIpcMutation.ts`
- `src/renderer/src/composables/useIpcQuery.ts`
- `src/renderer/src/composables/useModelCapabilities.ts`（需调整命名）
- `src/renderer/src/composables/usePageCapture.ts`
- `src/renderer/src/composables/usePresenter.ts`
- `src/renderer/src/composables/window/useWindowAdapter.ts`
- `src/renderer/src/composables/workspace/useWorkspaceAdapter.ts`
- `src/renderer/src/composables/yo-browser/useYoBrowserAdapter.ts`

### App Composable
- `src/renderer/src/composables/chat/useChatConfig.ts`
- `src/renderer/src/composables/chat/useChatStoreService.ts`
- `src/renderer/src/composables/chat/useMessageCache.ts`
- `src/renderer/src/composables/chat/useThreadExport.ts`
- `src/renderer/src/composables/chat/useThreadManagement.ts`
- `src/renderer/src/composables/chat/useVariantManagement.ts`
- `src/renderer/src/composables/dialog/useDialogStoreService.ts`
- `src/renderer/src/composables/floating-button/useFloatingButtonStoreService.ts`
- `src/renderer/src/composables/mcp/mcpConfigSync.ts`
- `src/renderer/src/composables/mcp/useMcpStoreService.ts`
- `src/renderer/src/composables/model/modelCatalog.ts`
- `src/renderer/src/composables/model/useModelStoreService.ts`
- `src/renderer/src/composables/model/useModelConfigStoreService.ts`
- `src/renderer/src/composables/model/useAgentModelStoreService.ts`
- `src/renderer/src/composables/mcp/useMcpSamplingStoreService.ts`
- `src/renderer/src/composables/ollama/useOllamaStoreService.ts`
- `src/renderer/src/composables/provider/useProviderStoreService.ts`
- `src/renderer/src/composables/search/useSearchAssistantStoreService.ts`
- `src/renderer/src/composables/search/useSearchEngineStoreService.ts`
- `src/renderer/src/composables/sidebar/useSidebarStoreService.ts`
- `src/renderer/src/composables/skills/useSkillsStoreService.ts`
- `src/renderer/src/composables/provider/providerConfig.ts`
- `src/renderer/src/composables/settings/useLanguageStoreService.ts`
- `src/renderer/src/composables/settings/useShortcutKeyStoreService.ts`
- `src/renderer/src/composables/settings/useSoundStoreService.ts`
- `src/renderer/src/composables/settings/useSystemPromptStoreService.ts`
- `src/renderer/src/composables/settings/useThemeStoreService.ts`
- `src/renderer/src/composables/useConversationNavigation.ts`
- `src/renderer/src/composables/useDialogStoreLifecycle.ts`
- `src/renderer/src/composables/useFloatingButtonStoreLifecycle.ts`
- `src/renderer/src/composables/useMcpSamplingStoreLifecycle.ts`
- `src/renderer/src/composables/useOllamaStoreLifecycle.ts`
- `src/renderer/src/composables/useProviderStoreLifecycle.ts`
- `src/renderer/src/composables/useSearchEngineStoreLifecycle.ts`
- `src/renderer/src/composables/useSearchResultState.ts`（含 UI 状态，需拆分）
- `src/renderer/src/composables/useSyncStoreLifecycle.ts`
- `src/renderer/src/composables/sync/useSyncStoreService.ts`
- `src/renderer/src/composables/useUpgradeStoreLifecycle.ts`
- `src/renderer/src/composables/upgrade/useUpgradeStoreService.ts`
- `src/renderer/src/composables/useWindowStoreLifecycle.ts`
- `src/renderer/src/composables/window/useWindowStoreService.ts`
- `src/renderer/src/composables/useWorkspaceStoreLifecycle.ts`
- `src/renderer/src/composables/workspace/useWorkspaceStoreService.ts`
- `src/renderer/src/composables/useYoBrowserStoreLifecycle.ts`
- `src/renderer/src/composables/yo-browser/useYoBrowserStoreService.ts`

### UI Composable
- `src/renderer/src/composables/chat/useChatAudio.ts`
- `src/renderer/src/composables/chat/useDeeplink.ts`
- `src/renderer/src/composables/message/types.ts`
- `src/renderer/src/composables/message/useCleanDialog.ts`（调用 store action，需拆分）
- `src/renderer/src/composables/message/useMessageMinimap.ts`
- `src/renderer/src/composables/message/useMessageScroll.ts`
- `src/renderer/src/composables/useArtifactCodeEditor.ts`
- `src/renderer/src/composables/useArtifactContext.ts`
- `src/renderer/src/composables/useArtifactExport.ts`
- `src/renderer/src/composables/useArtifactViewMode.ts`
- `src/renderer/src/composables/useArtifacts.ts`
- `src/renderer/src/composables/useChatConfigFields.ts`
- `src/renderer/src/composables/useFontManager.ts`
- `src/renderer/src/composables/notifications/useNotificationToasts.ts`
- `src/renderer/src/composables/useModelTypeDetection.ts`
- `src/renderer/src/composables/useSearchConfig.ts`
- `src/renderer/src/composables/useThinkingBudget.ts`
- `src/renderer/src/composables/useViewportSize.ts`

## 需要调整与审计候选
- Adapter 命名不一致：`useModelCapabilities`。
- UI/App 边界混杂：`useSearchResultState`、`useCleanDialog`。
- Store 体量超阈值：`chat.ts`、`mcp.ts`、`modelStore.ts`。
