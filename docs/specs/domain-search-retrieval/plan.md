# Search & Retrieval Plan

**Status**: Draft
**Created**: 2026-01-19
**Owner**: Eric

## 设计摘要
- 搜索域负责引擎配置与结果展示。
- Conversation 仅消费结果，不参与检索过程。

## 代码现状分析（收敛点）
- 搜索配置与展示组件分散在多个文件。
- 检索配置与消息显示边界不清。

## 结构与边界
- **Engine Config**：搜索引擎选择与配置。
- **Search Results**：结果展示与引用入口。

## 事件与数据流
- 配置变更 -> 搜索能力刷新。
- 搜索结果进入消息块展示。

## 迁移策略
- 先统一配置与查询入口，再收敛展示组件。

## 架构变更步骤与涉及文件范围

### 1) 搜索配置统一入口
目标：搜索引擎配置集中与可复用。
影响范围：
```txt
src/renderer/src/composables/useSearchConfig.ts
src/renderer/src/stores/searchEngineStore.ts
src/renderer/src/stores/searchAssistantStore.ts
src/renderer/settings/components/common/SearchEngineSettingsSection.vue
```

### 2) 结果展示收敛
目标：消息块与抽屉展示保持一致。
影响范围：
```txt
src/renderer/src/components/message/MessageBlockSearch.vue
src/renderer/src/components/SearchResultsDrawer.vue
src/renderer/src/components/SearchStatusIndicator.vue
```

## 测试策略
- 搜索配置读写与展示一致性测试。
