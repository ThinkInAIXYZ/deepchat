# Navigation & Layout Plan

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 设计摘要
- 导航与布局提供全局 UI 骨架与入口切换。
- 业务状态不应耦合到布局层。

## 代码现状分析（收敛点）
- 侧边栏与布局组件散落，初始化逻辑重复。
- 多入口之间共享逻辑不充分。

## 结构与边界
- **Layout State**：侧边栏、导航栏与布局可见性。
- **Navigation Flow**：入口切换与路由行为。

## 事件与数据流
- 路由变化 -> 布局状态同步 -> UI 更新。

## 迁移策略
- 先收敛布局状态 store，再统一入口装配。

## 架构变更步骤与涉及文件范围

### 1) 布局状态收敛
目标：布局状态集中管理。
影响范围：
```txt
src/renderer/src/stores/sidebarStore.ts
src/renderer/src/components/SideBar.vue
src/renderer/src/components/VerticalSidebar.vue
```

### 2) 入口与布局统一
目标：主入口与布局组件初始化一致。
影响范围：
```txt
src/renderer/src/components/ChatLayout.vue
src/renderer/src/components/ChatAppBar.vue
src/renderer/src/views/ChatTabView.vue
```

## 测试策略
- 导航状态切换测试。
