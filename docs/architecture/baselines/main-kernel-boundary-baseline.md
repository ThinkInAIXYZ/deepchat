# Main Kernel Boundary Baseline

Generated on 2026-04-19.
Current phase: P0.

## Metric Snapshot

| Metric | Value |
| --- | --- |
| `renderer.usePresenter.count` | 90 |
| `renderer.windowElectron.count` | 111 |
| `renderer.windowApi.count` | 34 |
| `hotpath.presenterEdge.count` | 11 |
| `runtime.rawTimer.count` | 123 |
| `migrated.rawChannel.count` | 5 |
| `bridge.active.count` | 0 |
| `bridge.expired.count` | 0 |

## Hot Path Direct Dependencies

- Direct edge count: 11

- `src/main/presenter/agentRuntimePresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/agentSessionPresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/agentSessionPresenter/index.ts -> src/main/presenter/agentRuntimePresenter/index.ts`
- `src/main/presenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/index.ts -> src/main/presenter/agentRuntimePresenter/index.ts`
- `src/main/presenter/index.ts -> src/main/presenter/agentSessionPresenter/index.ts`
- `src/main/presenter/index.ts -> src/main/presenter/llmProviderPresenter/index.ts`
- `src/main/presenter/index.ts -> src/main/presenter/sessionPresenter/index.ts`
- `src/main/presenter/llmProviderPresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/sessionPresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/sessionPresenter/index.ts -> src/main/presenter/index.ts`

## Renderer usePresenter

- Total count: 90

- `src/renderer/src/components/chat-input/McpIndicator.vue`: 3
- `src/renderer/src/components/chat/ChatStatusBar.vue`: 3
- `src/renderer/src/components/chat/composables/useChatInputMentions.ts`: 3
- `src/renderer/src/components/sidepanel/WorkspacePanel.vue`: 3
- `src/renderer/src/stores/sync.ts`: 3
- `src/renderer/src/stores/ui/session.ts`: 3
- `src/renderer/src/App.vue`: 2
- `src/renderer/src/components/AppBar.vue`: 2
- `src/renderer/src/components/markdown/useMarkdownLinkNavigation.ts`: 2
- `src/renderer/src/pages/NewThreadPage.vue`: 2
- `src/renderer/src/pages/WelcomePage.vue`: 2
- `src/renderer/src/stores/mcp.ts`: 2

## Renderer window.electron

- Total count: 111

- `src/renderer/src/stores/uiSettingsStore.ts`: 16
- `src/renderer/src/components/sidepanel/BrowserPanel.vue`: 12
- `src/renderer/src/stores/sync.ts`: 7
- `src/renderer/src/components/chat-input/composables/useRateLimitStatus.ts`: 6
- `src/renderer/src/components/chat-input/composables/useSkillsData.ts`: 6
- `src/renderer/src/components/chat-input/McpIndicator.vue`: 6
- `src/renderer/src/stores/mcp.ts`: 6
- `src/renderer/src/stores/mcpSampling.ts`: 6
- `src/renderer/src/stores/providerStore.ts`: 5
- `src/renderer/src/components/message/SelectedTextContextMenu.vue`: 4
- `src/renderer/src/stores/modelStore.ts`: 4
- `src/renderer/src/stores/theme.ts`: 4

## Renderer window.api

- Total count: 34

- `src/renderer/src/lib/windowContext.ts`: 5
- `src/renderer/src/components/message/MessageBlockToolCall.vue`: 4
- `src/renderer/src/components/AppBar.vue`: 3
- `src/renderer/src/composables/usePageCapture.ts`: 3
- `src/renderer/src/components/artifacts/CodeArtifact.vue`: 2
- `src/renderer/src/components/chat/composables/useChatInputFiles.ts`: 2
- `src/renderer/src/components/markdown/useMarkdownLinkNavigation.ts`: 2
- `src/renderer/src/components/message/MessageItemAssistant.vue`: 2
- `src/renderer/src/components/artifacts/ArtifactBlock.vue`: 1
- `src/renderer/src/components/chat-input/SkillsIndicator.vue`: 1
- `src/renderer/src/components/message/MessageItemUser.vue`: 1
- `src/renderer/src/components/sidepanel/BrowserPanel.vue`: 1

## Raw Timers

- Total count: 123

- `src/main/presenter/githubCopilotDeviceFlow.ts`: 6
- `src/main/presenter/browser/BrowserTab.ts`: 5
- `src/main/presenter/devicePresenter/index.ts`: 5
- `src/renderer/src/components/message/MessageToolbar.vue`: 4
- `src/renderer/src/composables/message/useMessageScroll.ts`: 4
- `src/main/lib/agentRuntime/backgroundExecSessionManager.ts`: 3
- `src/main/presenter/configPresenter/acpInitHelper.ts`: 3
- `src/main/presenter/skillPresenter/skillExecutionService.ts`: 3
- `src/main/presenter/tabPresenter.ts`: 3
- `src/main/presenter/upgradePresenter/index.ts`: 3
- `src/renderer/src/components/WindowSideBar.vue`: 3
- `src/renderer/src/stores/mcp.ts`: 3

## Migrated Path Raw Channel Literals

- Total count: 5

- `src/main/presenter/windowPresenter/index.ts`: 4
- `src/renderer/src/App.vue`: 1

