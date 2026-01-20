# Settings & Preferences Plan

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 设计摘要
- Settings 负责配置与偏好持久化入口。
- 业务域只读取配置结果，不直接依赖设置 UI。

## 代码现状分析（收敛点）
- 设置组件数量多且分散，入口层级复杂。
- 部分配置逻辑与业务域紧耦合。

## 结构与边界
- **Preferences**：主题、字体、语言、快捷键。
- **Provider Settings**：模型与供应商配置入口。

## 事件与数据流
- 设置变更 -> 配置持久化 -> 相关域刷新。

## 迁移策略
- 先统一配置读写接口，再整理设置 UI 结构。

## 架构变更步骤与涉及文件范围

### 1) 配置读写接口收敛
目标：统一配置访问入口。
影响范围：
```txt
src/renderer/src/stores/uiSettingsStore.ts
src/renderer/src/stores/shortcutKey.ts
```

### 2) Settings UI 结构收敛
目标：设置页按域分组，减少重复。
影响范围：
```txt
src/renderer/settings/
```

## 测试策略
- 配置变更与持久化一致性测试。
