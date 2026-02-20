# Phase 7: StatusBar ChatConfig Overlay Recovery (Slice A)

## Overview

当前 `newThread` 页面在样式上有 `StatusBar`，但缺少原 `ChatConfig.vue` 的核心调参入口，导致：

1. 无法在发送前快捷调整温度、上下文长度、最大输出等核心参数
2. `StatusBar` 与真实配置状态割裂，调参能力退化

本切片只解决一个目标：**在 `StatusBar` 里恢复 ChatConfig 浮层入口**，先保证功能可用。

## Scope

### In Scope

- 在 `StatusBar` 增加独立配置按钮，打开 `ChatConfig` 浮层
- 浮层内恢复核心配置项（temperature/contextLength/maxTokens/thinkingBudget/reasoningEffort/verbosity）
- 配置项与 `chatStore.chatConfig` 同步
- `systemPrompt` 在该浮层中不提供编辑能力

### Out of Scope

- `ModelSelect`/provider icon 规则重构
- `Unknown Model` 初始化链路重构
- i18n 全量补齐
- `useNewThread.ts` 提交流程重构

## Functional Requirements

### FR-1 StatusBar 配置入口

- `newThread` 的 `StatusBar`（非 ACP）新增一个配置按钮
- 点击后打开 `ChatConfig` 浮层

### FR-2 ChatConfig 浮层字段范围

- 在该入口保留以下配置能力：
  - temperature
  - contextLength
  - maxTokens
  - thinkingBudget（模型支持时）
  - reasoningEffort（模型支持时）
  - verbosity（模型支持时）
- `systemPrompt` 在该入口不展示编辑区

### FR-3 配置绑定

- 浮层字段修改后必须回写到 `chatStore.chatConfig`
- 关闭浮层后状态保留，发送首条消息时按当前配置生效

### FR-4 ACP 分支保持简化

- `selectedAgent.type === 'acp'` 时不显示该配置按钮

## UX Rules

### Local / Template Agent

- 保留现有 model/effort/permissions 布局
- 右侧新增一个设置按钮（齿轮）
- 点击展开 `ChatConfig` 浮层

### ACP Agent

- 仅显示 agent 信息和 permissions
- 不显示模型配置浮层入口

## Acceptance Criteria

1. `StatusBar` 可打开 `ChatConfig` 浮层
2. 浮层可调整核心参数并写回 `chatStore.chatConfig`
3. `systemPrompt` 在该浮层不可编辑
4. ACP 场景下不显示该入口
5. `pnpm run format && pnpm run lint` 通过

## Risks & Mitigations

### Risk 1: 与 chat 输入框中的 ChatConfig 行为不一致

- Mitigation: 复用同一个 `ChatConfig.vue`，只通过 prop 控制 `systemPrompt` 显示

### Risk 2: 配置回写延迟导致首条消息未命中最新值

- Mitigation: 复用现有配置同步逻辑并在手动选择项上执行即时回写

## Rollback Plan

1. 回退 `StatusBar` 中新增配置按钮与浮层
2. 回退 `ChatConfig` 的 `systemPrompt` 显示控制 prop
