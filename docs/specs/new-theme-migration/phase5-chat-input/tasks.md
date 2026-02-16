# Phase 5 Tasks: ChatInput Integration

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## Style Checklist

在开始实现前，确保理解并遵循以下样式规范：

- [ ] 阅读 `src/renderer/src/components/mock/MockInputBox.vue` 源码
- [ ] 阅读 `src/renderer/src/components/mock/MockInputToolbar.vue` 源码
- [ ] 阅读 `src/renderer/src/components/mock/MockStatusBar.vue` 源码
- [ ] 理解 StatusBtn 样式 (h-6 px-2 gap-1 text-xs)
- [ ] 理解 Dropdown 样式 (与 NewThreadMock 保持一致)

---

## 1. ChatInputToolbar Component

- [ ] Create `src/renderer/src/components/ChatInput/ChatInputToolbar.vue`
  - [ ] Horizontal layout
  - [ ] Agent info badge
  - [ ] Workdir selector
  - [ ] Settings button
  - [ ] Send button
  - [ ] Dividers between sections

## 2. AgentInfoBadge Component

- [ ] Create `src/renderer/src/components/ChatInput/AgentInfoBadge.vue`
  - [ ] Agent icon display
  - [ ] Agent name display
  - [ ] Click handler for info popover
  - [ ] Info popover with agent details
  - [ ] "View Agent Settings" link

## 3. WorkdirToolbarItem Component

- [ ] Create `src/renderer/src/components/ChatInput/WorkdirToolbarItem.vue`
  - [ ] Current workdir display (truncated)
  - [ ] Modified indicator (if different from session default)
  - [ ] Click handler for dropdown
  - [ ] Dropdown with recent directories
  - [ ] Browse button
  - [ ] Reset to default button (if modified)

## 4. SendButton Component

- [ ] Create `src/renderer/src/components/ChatInput/SendButton.vue`
  - [ ] Send icon
  - [ ] Disabled state
  - [ ] Loading state
  - [ ] Click handler

## 5. ChatInput Integration

- [ ] Update `src/renderer/src/components/ChatInput.vue`
  - [ ] Add ChatInputToolbar below textarea
  - [ ] Wire up workdir binding
  - [ ] Wire up send handler

## 6. Workdir Override Logic

- [ ] Update `src/renderer/src/stores/chat.ts`
  - [ ] Add `workdirOverrides` Map
  - [ ] Add `getCurrentWorkdir(threadId)` getter
  - [ ] Add `setWorkdirOverride(threadId, workdir)` action
  - [ ] Clear override after send (optional)

## 7. Message Sending with Workdir

- [ ] Update message sending logic
  - [ ] Include workdir in message context
  - [ ] Pass to agent/tool execution

## 8. Recent Workdirs Display

- [ ] Load recent workdirs in WorkdirToolbarItem
- [ ] Update recent list when selecting new workdir

## 9. i18n

- [ ] Add ChatInput toolbar i18n keys

## 10. Testing

- [ ] Agent info badge displays correctly
- [ ] Agent info popover shows details
- [ ] Workdir shows session default
- [ ] Workdir selector shows recent directories
- [ ] Workdir browse opens native picker
- [ ] Workdir override is applied to message
- [ ] Reset button clears override
- [ ] Send button states work correctly

---

## Dependencies
- Phase 1 (AgentConfigPresenter)
- Phase 4 (NewThread - WorkdirSelector logic)

## Estimated Effort
- 2-3 days
