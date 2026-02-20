# Phase 5 Tasks: ChatInput Integration

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## Style Checklist

在开始实现前，确保理解并遵循以下样式规范：

- [x] 阅读 `src/renderer/src/components/mock/InputBox.vue` 源码
- [x] 阅读 `src/renderer/src/components/mock/InputToolbar.vue` 源码
- [x] 阅读 `src/renderer/src/components/mock/StatusBar.vue` 源码
- [x] 理解 StatusBtn 样式 (h-6 px-2 gap-1 text-xs)
- [x] 理解 Dropdown 样式 (与 NewThread 组件保持一致)

---

## 1. ChatInputToolbar Component

- [x] Create `src/renderer/src/components/chat-input/components/ChatInputToolbar.vue`
  - [x] Horizontal layout
  - [x] Left/Right slot split for incremental integration
  - [x] Keep existing chat-input tools/actions structure compatible

## 2. AgentInfoBadge Component

- [x] Create `src/renderer/src/components/chat-input/components/AgentInfoBadge.vue`
  - [x] Agent icon display
  - [x] Agent name display
  - [x] Click handler for info popover
  - [x] Info popover with agent details (agent/provider/model/command)
  - [x] "View Agent Settings" action

## 3. WorkdirToolbarItem Component

- [x] Create `src/renderer/src/components/chat-input/components/WorkdirToolbarItem.vue`
  - [x] Current workdir display (truncated)
  - [x] Modified indicator (if different from session default)
  - [x] Click handler for dropdown
  - [x] Dropdown with recent directories
  - [x] Browse button
  - [x] Reset to default button (if modified)

## 4. SendButton Component

- [x] Create `src/renderer/src/components/chat-input/components/SendButton.vue`
  - [x] Send icon
  - [x] Disabled state
  - [x] Streaming stop state
  - [x] Click handler

## 5. ChatInput Integration

- [x] Update `src/renderer/src/components/chat-input/ChatInput.vue`
  - [x] Use `ChatInputToolbar` below textarea
  - [x] Wire up `AgentInfoBadge`
  - [x] Wire up `WorkdirToolbarItem` with select/browse/reset
  - [x] Replace inline send/stop buttons with `SendButton`

## 6. Workdir State Handling

- [x] Update `src/renderer/src/components/chat-input/composables/useAgentWorkspace.ts`
  - [x] Add `recentWorkdirs` state
  - [x] Add `selectWorkspacePath(path)` action
  - [x] Add `resetWorkspace()` action
  - [x] Expose `sessionDefaultPath` for modified indicator
  - [x] Reuse injected `acpWorkdir` instance from `ChatInput.vue`

- [x] Update `src/renderer/src/components/chat-input/composables/useAcpWorkdir.ts`
  - [x] Add `setWorkdir(path | null)` action
  - [x] Add `resetWorkdir()` action
  - [x] Keep existing warmup/session sync behavior compatible

## 7. Message Sending with Workdir

- [x] Keep existing message send pipeline (`chatStore.sendMessage`) unchanged
- [x] Workdir changes flow through existing settings channels:
  - [x] Agent mode via `agentWorkspacePath`
  - [x] ACP mode via `acpWorkdirMap` / `setAcpWorkdir`

## 8. Recent Workdirs Display

- [x] Load recent workdirs in `useAgentWorkspace`
- [x] Update recent list after selecting/browsing workdir
- [x] Display recent list in `WorkdirToolbarItem`

## 9. i18n

- [x] Add ChatInput toolbar i18n keys
  - [x] `src/renderer/src/i18n/en-US/chat.json`
  - [x] `src/renderer/src/i18n/zh-CN/chat.json`

## 10. Testing

- [x] Agent info badge displays correctly
- [x] Agent info popover shows details
- [x] Workdir shows session default / modified state
- [x] Workdir selector shows recent directories
- [x] Workdir browse opens native picker
- [x] Reset button clears current selection
- [x] Send button states work correctly
- [x] `pnpm run format`
- [x] `pnpm run lint`

---

## Dependencies
- Phase 1 (AgentConfigPresenter)
- Phase 4 (NewThread - WorkdirSelector logic)

## Notes
- 该阶段基于现有 `src/renderer/src/components/chat-input/` 架构完成，未引入新的大规模输入链路重构。
