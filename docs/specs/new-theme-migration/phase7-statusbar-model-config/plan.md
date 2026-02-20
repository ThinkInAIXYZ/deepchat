# Phase 7 Plan: StatusBar ChatConfig Overlay Recovery (Slice A)

## Status

- ✅ Completed

## Goal

仅完成一个可交付目标：在 `newThread` 的 `StatusBar` 恢复 `ChatConfig` 浮层入口，让核心模型参数可调，并明确在该入口不编辑 `systemPrompt`。

## Architecture Decisions

### AD-1: 只在 StatusBar 增加入口，不改提交流程

- 本切片不改 `useNewThread.ts` 的会话创建逻辑
- 先恢复 UI + 状态同步能力，保证“可配置”

### AD-2: 复用 ChatConfig 组件，新增轻量显示开关

- 不复制一份新配置组件
- 在 `ChatConfig.vue` 增加 `showSystemPrompt` 开关（默认 `true`）
- `StatusBar` 调用时设为 `false`

### AD-3: 绑定现有配置状态

- `StatusBar` 通过 composable 暴露的 config refs 绑定 `ChatConfig`
- 保持与 `chatStore.chatConfig` 的同步行为

## Implementation Plan

### Stage 0: Baseline

- 核对当前 `StatusBar.vue` / `useNewThreadStatusBar.ts` / `ChatConfig.vue` 状态

### Stage 1: ChatConfig 组件开关

- 在 `src/renderer/src/components/ChatConfig.vue` 增加 `showSystemPrompt?: boolean`
- 模板中 `systemPrompt` 区域改为受 `showSystemPrompt` 控制

### Stage 2: StatusBar 恢复配置浮层

- 在 `src/renderer/src/components/StatusBar.vue` 增加配置按钮（齿轮）
- 通过 popover/scrollable popover 渲染 `ChatConfig`
- 绑定以下字段：
  - `temperature`
  - `contextLength`
  - `maxTokens`
  - `thinkingBudget`
  - `reasoningEffort`
  - `verbosity`
  - `contextLengthLimit`
  - `maxTokensLimit`
  - `providerId/modelId/modelType`
- `showSystemPrompt` 传 `false`
- ACP 分支隐藏配置按钮

### Stage 3: StatusBar Composable 绑定补齐

- 在 `src/renderer/src/composables/useNewThreadStatusBar.ts` 暴露上述配置 refs
- 保持现有模型/effort/permissions 交互可用

### Stage 4: Validation

- `pnpm run format`
- `pnpm run lint`

## File-Level Impact

- `src/renderer/src/components/StatusBar.vue`
- `src/renderer/src/composables/useNewThreadStatusBar.ts`
- `src/renderer/src/components/ChatConfig.vue`

## Test Strategy

### Manual

1. `newThread` -> `StatusBar` 可见配置按钮（非 ACP）
2. 打开浮层后可调整温度、context length、max tokens 等
3. 关闭后再打开值保持
4. ACP agent 下无配置按钮
5. `systemPrompt` 输入区不可见

## Definition of Done

1. StatusBar 成功恢复 `ChatConfig` 浮层入口
2. 核心参数可调且状态同步正常
3. `systemPrompt` 在该入口不编辑
4. `pnpm run format && pnpm run lint` 通过
