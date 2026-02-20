# Phase 5 Tasks: Chat Input Integration (Final)

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## 1. Core Migration

- [x] Rename `src/renderer/src/components/chat-input/ChatInput.vue` -> `src/renderer/src/components/chat-input/InputBox.vue`
- [x] Keep full legacy interaction logic (send/files/mention/history/workdir/agent info)
- [x] Apply mock visual style to new `InputBox` container and footer
- [x] Limit new-thread toolbar to core controls, keep chat toolbar full-featured

## 2. Toolbar Components

- [x] Rename `src/renderer/src/components/chat-input/components/ChatInputToolbar.vue` -> `src/renderer/src/components/chat-input/components/InputToolbar.vue`
- [x] Keep `AgentInfoBadge.vue`
- [x] Keep `WorkdirToolbarItem.vue`
- [x] Keep `SendButton.vue` and align with mock send button visual

## 3. NewThread Integration

- [x] Update `src/renderer/src/components/NewThread.vue` to use real `InputBox` send pipeline
- [x] Keep hardcoded heading `Build and explore`
- [x] Keep `WorkdirSelector + StatusBar` real logic path

## 4. Remove mock Directory

- [x] Move `mock/StatusBar.vue` -> `src/renderer/src/components/StatusBar.vue`
- [x] Move `mock/WorkdirSelector.vue` -> `src/renderer/src/components/WorkdirSelector.vue`
- [x] Move preview pages to formal components:
  - [x] `src/renderer/src/components/ChatPreviewPage.vue`
  - [x] `src/renderer/src/components/ChatPreviewTopBar.vue`
  - [x] `src/renderer/src/components/ChatPreviewMessageList.vue`
  - [x] `src/renderer/src/components/WelcomePreviewPage.vue`
- [x] Remove `src/renderer/src/components/mock/` directory

## 5. References Update

- [x] Update `ChatView.vue` import to `chat-input/InputBox.vue`
- [x] Update `ChatTabView.vue` preview component imports to formal paths
- [x] Remove all runtime imports from `@/components/mock/...`

## 6. Validation

- [x] `pnpm run format`
- [x] `pnpm run lint`
- [x] `pnpm run build`

## Notes

- 本阶段完成后，输入交互主入口为 `InputBox.vue`。
- `mock` 目录已清理，组件路径已切换为正式路径。
