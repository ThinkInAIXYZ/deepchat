# 移除 Chat 模式实施计划

## 1. 当前实现基线

### 1.1 模式类型定义

```typescript
// src/renderer/src/components/chat-input/composables/useChatMode.ts:9
export type ChatMode = 'chat' | 'agent' | 'acp agent'
```

共享类型分布在：
- `src/shared/types/presenters/thread.presenter.d.ts:24`
- `src/shared/types/presenters/session.presenter.d.ts:24,51`
- `src/main/presenter/sessionPresenter/types.ts:14,42`

### 1.2 Chat 模式特点

1. **无 Agent 工具** - `toolPresenter/index.ts:100` 判断 `chatMode !== 'chat'` 才加载
2. **支持 Web 搜索** - `ChatInput.vue:583` 的 `canUseWebSearch` 仅 chat 模式可用
3. **简单 LLM 对话** - 无工具调用循环

### 1.3 Web 搜索架构

```
Main Process:
├── searchPresenter/
│   ├── index.ts          - ISearchPresenter 实现
│   ├── interface.ts      - 搜索接口定义
│   ├── managers/
│   │   └── searchManager.ts - 搜索逻辑
│   └── handlers/
│       ├── baseHandler.ts   - 基础处理器
│       └── searchHandler.ts - 搜索处理器

Renderer Process:
├── components/
│   ├── SearchStatusIndicator.vue
│   ├── SearchResultsDrawer.vue
│   └── message/MessageBlockSearch.vue
├── stores/
│   ├── searchAssistantStore.ts
│   ├── searchEngineStore.ts
│   └── reference.ts

Shared:
└── types/presenters/search.presenter.d.ts
```

### 1.4 涉及文件统计

| 类别 | 数量 |
|------|------|
| 待删除文件 | 11个 |
| 待修改文件 | ~25个 |
| 类型定义修改 | 7处 |
| i18n 文件 | 12个 |

## 2. 设计决策

### 2.1 类型简化

**决策**：`ChatMode` 类型从三元改为二元

```typescript
// Before
export type ChatMode = 'chat' | 'agent' | 'acp agent'

// After
export type ChatMode = 'agent' | 'acp agent'
```

**影响范围**：
- 7处类型定义
- 所有 `chatMode === 'chat'` 判断改为始终加载 agent 能力
- 默认值统一改为 `'agent'`

### 2.2 旧数据迁移策略

**决策**：静默升级，无通知

```typescript
// sessionResolver.ts
if (settings.chatMode === 'chat') {
  settings.chatMode = 'agent'
  // 不持久化到数据库（运行时升级即可）
  // 如果后续有 updateConversationSettings 调用会自动保存
}
```

**原则**：
1. 不破坏数据库结构
2. 不显示任何 toast/notification
3. 用户无感知

### 2.3 搜索功能移除策略

**决策**：完全删除，不保留任何代码

**删除清单**：
1. `searchPresenter/` 整个目录（5个文件）
2. 搜索相关组件（3个 Vue 文件）
3. 搜索相关 stores（3个文件）
4. 搜索类型定义（1个文件）

**配置清理**：
1. `enableSearch`、`forcedSearch`、`searchStrategy` 从 CONVERSATION_SETTINGS 移除
2. `searchPreviewEnabled`、`customSearchEngines` 从 configPresenter 移除
3. 搜索相关方法从 configPresenter 移除

### 2.4 工具加载简化

**决策**：移除 chat 模式判断，始终加载 Agent 工具

```typescript
// toolPresenter/index.ts - Before
if (chatMode !== 'chat') {
  // Load Agent tools
}

// After
// Always load Agent tools (no condition)
```

### 2.5 UI 简化

**决策**：
1. 模式选择器只显示 Agent / ACP Agent 两个选项
2. 移除 web 搜索按钮
3. 移除 `variant === 'chat'` 的特殊样式

## 3. 实施阶段

### Phase 1：删除搜索 Presenter（影响最小）

1. 删除 `src/main/presenter/searchPresenter/` 目录
2. 删除 `src/shared/types/presenters/search.presenter.d.ts`
3. 从 `src/main/presenter/index.ts` 移除 searchPresenter 注册
4. 从 `src/preload/index.ts` 移除 searchPresenter 暴露
5. 运行 typecheck 确认编译通过

### Phase 2：删除搜索组件和 Stores

1. 删除 `SearchStatusIndicator.vue`
2. 删除 `SearchResultsDrawer.vue`
3. 删除 `MessageBlockSearch.vue`
4. 删除 `searchAssistantStore.ts`
5. 删除 `searchEngineStore.ts`
6. 删除 `reference.ts`
7. 从 `MessageItemAssistant.vue` 移除 MessageBlockSearch 引用

### Phase 3：修改类型定义

1. 更新 7 处 `ChatMode` 类型定义
2. 更新 `useChatMode.ts`：
   - 移除 chat 图标
   - 移除 modes 数组中的 chat 选项
   - 默认值改为 `'agent'`

### Phase 4：核心逻辑修改

1. `sessionResolver.ts` - 添加旧数据升级逻辑
2. `sessionManager.ts` - fallback 默认值改为 `'agent'`
3. `toolPresenter/index.ts` - 移除 chat 模式判断
4. `mcpPresenter/toolManager.ts` - fallback 默认值改为 `'agent'`

### Phase 5：清理搜索配置

1. `CONVERSATION_SETTINGS` 类型移除 `enableSearch`、`forcedSearch`、`searchStrategy`
2. `chat.ts` store 移除相关配置
3. `modelStore.ts` 移除 `enableSearch`
4. `configPresenter` 移除搜索配置和方法
5. `ChatInput.vue` 移除 web 搜索按钮和 `canUseWebSearch`
6. `MessageBlockQuestionRequest.vue` 移除搜索相关代码

### Phase 6：国际化清理

1. 所有 `chat.json` 文件移除 `mode.chat`
2. 所有 `chat.json` 文件移除 `features.webSearch`
3. 所有 `chat.json` 文件移除 `search` 块

### Phase 7：测试与验证

1. 更新相关测试用例
2. 删除搜索相关测试文件
3. 运行完整测试套件

## 4. 数据与配置影响

### 4.1 数据库

| 影响项 | 处理方式 |
|--------|----------|
| `conversations.settings.chatMode` | 保留字段，运行时升级 `'chat'` → `'agent'` |
| `conversations.settings.enableSearch` | 保留字段，运行时忽略 |
| `conversations.settings.forcedSearch` | 保留字段，运行时忽略 |
| `conversations.settings.searchStrategy` | 保留字段，运行时忽略 |

**结论**：无 schema 迁移，保持向后兼容

### 4.2 用户配置

| 配置项 | 处理方式 |
|--------|----------|
| `input_chatMode` | 运行时升级 `'chat'` → `'agent'` |
| `searchPreviewEnabled` | 删除（不再使用） |
| `customSearchEngines` | 删除（不再使用） |

### 4.3 破坏性变化

| 变化 | 影响范围 |
|------|----------|
| Chat 模式不可用 | 所有用户 |
| Web 搜索功能移除 | Chat 模式用户 |
| 搜索引擎配置丢失 | 配置过搜索引擎的用户 |

## 5. 测试策略

### 5.1 单元测试

1. **useChatMode**
   - 默认模式为 `'agent'`
   - modes 数组不包含 `'chat'`
   - 设置 `'chat'` 模式被忽略或转为 `'agent'`

2. **sessionResolver**
   - `chatMode === 'chat'` 时自动升级为 `'agent'`

3. **toolPresenter**
   - Agent 工具始终加载

### 5.2 集成测试

1. **旧对话打开**
   - chat 模式的对话可以正常打开
   - 自动升级为 agent 模式
   - 无错误或警告

2. **新对话创建**
   - 默认为 agent 模式
   - 工具可正常调用

### 5.3 删除的测试文件

```
test/main/presenter/searchPresenter/  (如果存在)
test/renderer/components/message/MessageBlockSearch.test.ts (如果存在)
```

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 旧对话打开失败 | 高 | 升级逻辑充分测试，添加 fallback |
| 残留搜索引用 | 中 | 全局搜索 `search`、`Search`、`enableSearch` 等 |
| i18n key 丢失 | 低 | 检查运行时是否有 missing key 警告 |
| 配置迁移失败 | 低 | 运行时升级，不依赖持久化 |

## 7. 质量门槛

```bash
# 代码格式
pnpm run format

# 代码检查
pnpm run lint

# 类型检查
pnpm run typecheck

# 测试
pnpm test
```

## 8. 实施检查清单

- [ ] Phase 1: 删除搜索 Presenter
- [ ] Phase 2: 删除搜索组件和 Stores
- [ ] Phase 3: 修改类型定义
- [ ] Phase 4: 核心逻辑修改
- [ ] Phase 5: 清理搜索配置
- [ ] Phase 6: 国际化清理
- [ ] Phase 7: 测试与验证
- [ ] 运行 `pnpm run format && pnpm run lint && pnpm run typecheck`
- [ ] 运行 `pnpm test`
