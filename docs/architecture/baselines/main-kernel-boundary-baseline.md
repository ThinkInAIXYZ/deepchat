# Main Kernel Boundary Baseline

Generated on 2026-04-20.
Current phase: P5.

## Metric Snapshot

| Metric | Value |
| --- | --- |
| `renderer.usePresenter.count` | 86 |
| `renderer.business.usePresenter.count` | 86 |
| `renderer.quarantine.usePresenter.count` | 0 |
| `renderer.windowElectron.count` | 95 |
| `renderer.business.windowElectron.count` | 95 |
| `renderer.quarantine.windowElectron.count` | 0 |
| `renderer.windowApi.count` | 33 |
| `renderer.business.windowApi.count` | 33 |
| `renderer.quarantine.windowApi.count` | 0 |
| `hotpath.presenterEdge.count` | 10 |
| `runtime.rawTimer.count` | 123 |
| `migrated.rawChannel.count` | 5 |
| `bridge.active.count` | 0 |
| `bridge.expired.count` | 0 |

## Renderer Single-Track Split

- Business layer: `src/renderer/src/**`
- Quarantine layer: `src/renderer/api/legacy/**`

| Legacy surface | Business layer | Quarantine layer | Total |
| --- | --- | --- | --- |
| `usePresenter()` | 86 | 0 | 86 |
| `window.electron` | 95 | 0 | 95 |
| `window.api` | 33 | 0 | 33 |

## Phase Gates

| Phase | Gate indicator | Current signal | Status |
| --- | --- | --- | --- |
| `P0` | Fixed quarantine path `src/renderer/api/legacy/**` exists and baseline emits business/quarantine split metrics | `src/renderer/api/legacy/**` exists; split metrics emitted | ready |
| `P1` | Business layer direct `usePresenter` / `window.electron` / `window.api` counts must reach `0` | usePresenter=86, window.electron=95, window.api=33 | pending |
| `P2` | Business layer `configPresenter` and `llmproviderPresenter` hits must reach `0` | configPresenter=26, llmproviderPresenter=4 | pending |
| `P3` | Business layer window/device/workspace/project/file/browser/tab presenter hits must reach `0` | window=9, device=8, workspace=5, project=2, file=2, browser=2, tab=2 | pending |
| `P4` | Business layer session residual / skill / mcp / sync / upgrade / dialog / tool presenter hits must reach `0` | agentSession=13, skill=4, mcp=2, sync=1, upgrade=1, dialog=1, tool=1 | pending |
| `P5` | Business layer direct legacy access must be `0`, and quarantine source files must be empty or satisfy the exit standard | businessLegacy=86/95/33, quarantineSourceFiles=0 | pending |

## Hot Path Direct Dependencies

- Direct edge count: 10

- `src/main/presenter/agentRuntimePresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/agentSessionPresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/index.ts -> src/main/presenter/agentRuntimePresenter/index.ts`
- `src/main/presenter/index.ts -> src/main/presenter/agentSessionPresenter/index.ts`
- `src/main/presenter/index.ts -> src/main/presenter/llmProviderPresenter/index.ts`
- `src/main/presenter/index.ts -> src/main/presenter/sessionPresenter/index.ts`
- `src/main/presenter/llmProviderPresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/sessionPresenter/index.ts -> src/main/eventbus.ts`
- `src/main/presenter/sessionPresenter/index.ts -> src/main/presenter/index.ts`

## Renderer usePresenter

- Total count: 86

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

- Total count: 95

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
- `src/renderer/src/stores/upgrade.ts`: 4

## Renderer window.api

- Total count: 33

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

