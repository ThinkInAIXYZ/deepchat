# Sync & Upgrade Plan

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 设计摘要
- 同步与升级提供状态展示与触发入口。
- 副作用通过适配层处理，UI 只展示状态。

## 代码现状分析（收敛点）
- 同步/升级状态分散在多个 store。
- UI 组件与副作用耦合。

## 结构与边界
- **Sync State**：同步状态、冲突信息。
- **Upgrade State**：更新检查与提示。

## 事件与数据流
- 同步事件 -> 状态更新 -> UI 展示。
- 升级检查 -> 提示弹窗展示。

## 迁移策略
- 先统一状态入口，再收敛 UI 触发点。

## 架构变更步骤与涉及文件范围

### 1) Sync/Upgrade 状态收敛
目标：状态集中管理与订阅。
影响范围：
```txt
src/renderer/src/stores/sync.ts
src/renderer/src/stores/upgrade.ts
```

### 2) 触发与提示入口统一
目标：升级提示与同步入口集中。
影响范围：
```txt
src/renderer/src/components/ui/UpdateDialog.vue
src/renderer/settings/components/skills/SyncStatusSection.vue
```

## 测试策略
- 状态变更与提示显示测试。
