# Shell & Windowing Plan

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 设计摘要
- Shell 管理多入口装配与窗口状态。
- UI 只通过适配层触发窗口操作。

## 代码现状分析（收敛点）
- 窗口状态分散在多个入口与 store。
- 多入口初始化存在重复。

## 结构与边界
- **Window State**：窗口大小、置顶、最小化状态。
- **Shell Bootstrap**：入口装配与共享初始化。

## 事件与数据流
- 窗口事件 -> store 更新 -> UI 响应。

## 迁移策略
- 先收敛窗口状态 store，再统一入口 bootstrap。

## 架构变更步骤与涉及文件范围

### 1) Window 状态收敛
目标：窗口状态单一来源。
影响范围：
```txt
src/renderer/src/stores/windowStore.ts
src/renderer/shell/components/
```

### 2) 入口装配统一
目标：多入口共享初始化逻辑。
影响范围：
```txt
src/renderer/shell/
src/renderer/src/App.vue
```

## 测试策略
- 窗口状态变更与 UI 更新测试。
