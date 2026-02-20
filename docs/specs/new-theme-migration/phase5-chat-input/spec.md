# Phase 5: Chat Input Integration (Final)

## Overview

本阶段目标是把旧 `ChatInput` 的完整交互能力迁移到新主题输入组件，并清理历史 `mock` 目录。

核心结果：
1. 输入组件统一为 `InputBox`（基于 mock 视觉）
2. 保留旧 `ChatInput` 的真实功能（发送、文件、mention、workdir、agent 信息等）
3. `mock` 目录移除，组件改为正式路径

## Visual Rules (Adopted)

### InputBox
```css
@apply w-full max-w-2xl rounded-xl border;
@apply bg-card/30 backdrop-blur-lg shadow-sm;
@apply overflow-hidden;
```

### InputToolbar
```css
@apply flex items-center justify-between px-3 py-2;
@apply border-t border-border/40;
```

### Buttons
```css
/* toolbar button */
@apply h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground;

/* send button */
@apply h-7 w-7 rounded-full;
```

## Final Architecture

### Main Input
- `src/renderer/src/components/chat-input/InputBox.vue`
  - 由旧 `ChatInput.vue` 迁移并重命名
  - 视觉改为 mock InputBox 风格
  - `chat` 模式保留完整交互
  - `newThread` 模式保留核心发送能力

### Toolbar Subcomponents
- `src/renderer/src/components/chat-input/components/InputToolbar.vue`
- `src/renderer/src/components/chat-input/components/AgentInfoBadge.vue`
- `src/renderer/src/components/chat-input/components/WorkdirToolbarItem.vue`
- `src/renderer/src/components/chat-input/components/SendButton.vue`

### NewThread Related
- `src/renderer/src/components/StatusBar.vue`
- `src/renderer/src/components/WorkdirSelector.vue`
- `src/renderer/src/components/NewThread.vue`（接入 `InputBox` 的真实发送链路）

## Behavior Rules

### chat variant
- 显示 Agent 信息、Workdir 菜单、文件上传、MCP/Skills、模型/配置等高级能力
- 保留 `send/cancel` 状态逻辑
- 保留 mention、slash mention、文件粘贴/拖拽、历史输入

### newThread variant
- 使用同一 `InputBox` 发送能力
- 页面下方继续使用 `StatusBar`（模型/effort/permission）
- Workdir 继续由 `WorkdirSelector` 管理

## State & Data Flow

- Workdir 管理：`useAgentWorkspace.ts` + `useAcpWorkdir.ts`
- NewThread 创建与发送：`useNewThread.ts` 的 `handleSubmit`
- 发送链路保持：`chatStore.sendMessage(content)`

## Path Cleanup

已移除 `src/renderer/src/components/mock/`，相关页面组件迁移为正式路径：
- `src/renderer/src/components/ChatPreviewPage.vue`
- `src/renderer/src/components/ChatPreviewTopBar.vue`
- `src/renderer/src/components/ChatPreviewMessageList.vue`
- `src/renderer/src/components/WelcomePreviewPage.vue`

## Validation

- [x] `pnpm run format`
- [x] `pnpm run lint`
- [x] `pnpm run build`
