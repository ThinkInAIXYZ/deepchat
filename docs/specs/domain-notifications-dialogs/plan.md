# Notifications & Dialogs Plan

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 设计摘要
- 通知与弹窗提供统一触发入口。
- 各业务域只调用通知服务，不管理 UI 细节。

## 代码现状分析（收敛点）
- 全局通知逻辑分散在 App 与多个组件。
- 弹窗组件缺少统一编排。

## 结构与边界
- **Notification Service**：系统通知与应用内提示入口。
- **Dialog Registry**：弹窗管理与统一显示策略。

## 事件与数据流
- 错误事件 -> 通知服务 -> UI 渲染。
- 弹窗触发 -> Dialog Registry -> 对话框显示。

## 迁移策略
- 先集中通知入口，再统一对话框管理。

## 架构变更步骤与涉及文件范围

### 1) 通知入口集中化
目标：通知触发统一入口。
影响范围：
```txt
src/renderer/src/App.vue
src/renderer/src/composables/chat/useMessageStreaming.ts
src/renderer/src/stores/uiSettingsStore.ts
```

### 2) 弹窗组件收敛
目标：统一对话框触发与渲染层。
影响范围：
```txt
src/renderer/src/components/ui/MessageDialog.vue
src/renderer/src/components/ui/UpdateDialog.vue
src/renderer/src/components/trace/TraceDialog.vue
```

## 测试策略
- 通知触发与弹窗显示测试。
