# 移除 Chat 模式规格

## 概述

移除 DeepChat 中的 "chat" 模式，仅保留 "agent" 和 "acp agent" 两种模式。同时完全移除 Web 搜索功能（该功能仅在 chat 模式下可用）。旧的 chat 模式对话将静默升级为 agent 模式。

## 背景与动机

1. Agent 模式已成熟完善，内置工具调用能力已成为核心特性
2. Chat 模式功能有限（无工具调用），与 Agent 模式形成冗余
3. Web 搜索功能仅 Chat 模式可用，用户实际使用率低
4. 简化模式选择，降低用户决策成本

## 用户故事

### US-1：模式选择简化

作为 DeepChat 用户，我希望不再需要在 chat 和 agent 模式之间选择，直接使用功能更强大的 agent 模式。

### US-2：旧对话无缝迁移

作为已有 chat 模式对话的用户，我希望打开旧对话时无需任何操作，系统能自动将其升级为 agent 模式并继续正常使用。

### US-3：一致的 Agent 体验

作为 DeepChat 用户，我希望所有对话都具备完整的工具调用能力，无需关心"这个对话是否支持某个功能"。

## 验收标准

### A. 类型定义

- [ ] `ChatMode` 类型改为 `'agent' | 'acp agent'`
- [ ] 所有涉及 `chatMode` 的类型定义更新
- [ ] 默认值从 `'chat'` 改为 `'agent'`

### B. 模式选择 UI

- [ ] 模式选择器仅显示 "Agent" 和 "ACP Agent" 两个选项
- [ ] 移除 `MODE_ICONS` 中的 chat 图标
- [ ] `useChatMode.ts` 的 `modes` 数组不再包含 chat 选项

### C. Web 搜索功能移除

- [ ] 删除 `src/main/presenter/searchPresenter/` 整个目录
- [ ] 删除 `src/renderer/src/components/SearchStatusIndicator.vue`
- [ ] 删除 `src/renderer/src/components/SearchResultsDrawer.vue`
- [ ] 删除 `src/renderer/src/components/message/MessageBlockSearch.vue`
- [ ] 删除 `src/renderer/src/stores/searchAssistantStore.ts`
- [ ] 删除 `src/renderer/src/stores/searchEngineStore.ts`
- [ ] 删除 `src/renderer/src/stores/reference.ts`
- [ ] 删除 `src/shared/types/presenters/search.presenter.d.ts`
- [ ] `ChatInput.vue` 移除 web 搜索按钮和相关逻辑
- [ ] `MessageBlockQuestionRequest.vue` 移除搜索相关代码

### D. 配置清理

- [ ] `CONVERSATION_SETTINGS` 移除 `enableSearch`、`forcedSearch`、`searchStrategy`
- [ ] `chat.ts` store 移除搜索相关配置
- [ ] `modelStore.ts` 移除 `enableSearch` 属性
- [ ] `configPresenter` 移除 `searchPreviewEnabled`、`customSearchEngines` 等配置

### E. 工具加载逻辑

- [ ] `toolPresenter/index.ts` 移除 `chatMode !== 'chat'` 判断
- [ ] Agent 工具始终加载（无需模式判断）

### F. 旧数据迁移

- [ ] `sessionResolver.ts` 检测 `chatMode === 'chat'` 时静默升级为 `'agent'`
- [ ] 升级过程无任何用户通知或中断

### G. Presenter 注册清理

- [ ] `src/main/presenter/index.ts` 移除 searchPresenter 注册
- [ ] `src/preload/index.ts` 移除 searchPresenter 暴露
- [ ] `src/shared/types/presenters/index.d.ts` 移除 ISearchPresenter 引用

### H. 国际化

- [ ] 所有语言文件移除 `mode.chat` 翻译
- [ ] 所有语言文件移除 `features.webSearch` 翻译
- [ ] 所有语言文件移除 `search` 块

### I. 消息组件

- [ ] `MessageItemAssistant.vue` 移除 `MessageBlockSearch` 组件引用

## 非目标

1. **不修改数据库 schema** - `chatMode` 字段保留，仅运行时逻辑改变
2. **不保留任何 chat 模式兼容代码** - 彻底移除，不做 fallback
3. **不保留搜索功能给 agent 模式使用** - 完全移除
4. **不修改 MCP 相关工具** - 仅移除 DeepChat 内置搜索

## 约束

1. **数据迁移必须静默** - 不显示任何 toast 或通知
2. **向后兼容** - 旧对话数据不丢失，仅升级模式标记
3. **测试覆盖** - 关键路径必须有测试验证
4. **代码格式** - 必须通过 `format`、`lint`、`typecheck`

## 待删除文件清单

### Main 进程

```
src/main/presenter/searchPresenter/
├── index.ts
├── interface.ts
├── managers/searchManager.ts
└── handlers/
    ├── baseHandler.ts
    └── searchHandler.ts
```

### Renderer 进程

```
src/renderer/src/components/SearchStatusIndicator.vue
src/renderer/src/components/SearchResultsDrawer.vue
src/renderer/src/components/message/MessageBlockSearch.vue
src/renderer/src/stores/searchAssistantStore.ts
src/renderer/src/stores/searchEngineStore.ts
src/renderer/src/stores/reference.ts
```

### Shared

```
src/shared/types/presenters/search.presenter.d.ts
```

## 待修改文件清单

### 类型定义 (7处)

| 文件 | 修改内容 |
|------|----------|
| `src/shared/types/presenters/thread.presenter.d.ts:24` | `chatMode?: 'agent' \| 'acp agent'` |
| `src/shared/types/presenters/session.presenter.d.ts:24,51` | 同上 |
| `src/shared/types/presenters/tool.presenter.d.ts:19` | 同上 |
| `src/shared/types/presenters/legacy.presenters.d.ts:1091` | 同上 |
| `src/main/presenter/sessionPresenter/types.ts:14,42` | 同上 |
| `src/renderer/src/components/chat-input/composables/useChatMode.ts:9` | 同上 |
| `src/renderer/src/components/chat-input/composables/useWorkspaceMention.ts:9` | 同上 |

### 核心逻辑

| 文件 | 修改内容 |
|------|----------|
| `useChatMode.ts` | 移除 chat 模式选项，默认改为 agent |
| `sessionResolver.ts` | 添加旧数据升级逻辑 |
| `sessionManager.ts` | fallback 默认值改为 agent |
| `toolPresenter/index.ts` | 移除 chat 模式判断 |
| `chat.ts` store | 移除搜索配置 |
| `modelStore.ts` | 移除 enableSearch |
| `configPresenter/index.ts` | 移除搜索配置和方法 |

### UI 组件

| 文件 | 修改内容 |
|------|----------|
| `ChatInput.vue` | 移除 web 搜索按钮、canUseWebSearch |
| `MessageBlockQuestionRequest.vue` | 移除搜索相关代码 |
| `MessageItemAssistant.vue` | 移除 MessageBlockSearch 引用 |

### i18n (12个文件)

- `src/renderer/src/i18n/*/chat.json` - 移除 mode.chat、features.webSearch、search 块

## 开放问题

无。所有问题已澄清：

- **搜索功能处理**：完全移除
- **旧数据升级通知**：静默升级
