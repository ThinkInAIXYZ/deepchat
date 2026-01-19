# Chat Store 重构设计文档

## 📋 概述

本文档概述了 `src/renderer/src/stores/chat.ts` 的重构计划。该文件已增长到 2098 行，存在严重的职责混乱问题，难以维护和扩展。

**状态**: 设计阶段
**创建时间**: 2026-01-19
**目标**: Q1 2026

---

## 🔍 当前问题分析

### 1. 单文件过大（2098 行）
- 难以导航和理解
- 难以定位特定功能
- 容易产生合并冲突
- IDE 性能下降

### 2. 职责混乱

Store 混合了多种职责：
- 会话/对话管理
- 消息 CRUD 和缓存
- 流式事件处理
- 变体消息管理
- 聊天配置
- 导出功能
- Deeplink 处理
- 音频播放
- IPC 事件协调

### 3. 状态管理问题

#### 重复状态
```typescript
// 同一概念的多个数据源
generatingThreadIds: Set<string>           // 会话是否正在生成？
threadsWorkingStatus: Map<string, Status>  // 会话工作状态
// 这两个追踪同一件事，但方式不同

// 变体选择存储在两个地方
chatConfig.value.selectedVariantsMap      // 在配置中
selectedVariantsMap.value                 // 单独的 ref
```

#### 复杂的消息缓存
```typescript
// 外部缓存 (messageRuntimeCache.ts)
getCachedMessage(id)
cacheMessage(message)

// 内部缓存
generatingMessagesCache: Map<string, { message, threadId }>

// ID 数组
messageIds: string[]

// 版本号用于响应式更新
messageCacheVersion: number
```

这造成了同步问题，难以理解消息状态。

### 4. 事件处理器复杂度

**流式事件处理器**（869-1334 行）：
- `handleStreamResponse`: 313 行，深度嵌套的条件判断
- `handleStreamEnd`: 68 行
- `handleStreamError`: 80 行
- 混合关注点：解析、缓存、UI 更新、通知

**IPC 事件监听器**（1784-1875 行）：
- 设置代码散落在文件底部
- 难以看清处理了哪些事件
- 事件处理器调用 store 方法，形成循环依赖

### 5. 数据流不清晰

```
IPC 事件 → handleStreamResponse → 更新缓存 → 版本号+1 → UI 响应
                ↓
         播放音频、发送通知、更新变体
```

流程难以追踪，因为：
- 到处都是副作用
- 需要更新多个缓存
- 变体逻辑与主消息逻辑交织

### 6. 测试困难
- 无法独立测试各个部分
- Mock 设置复杂（需要整个 store）
- 副作用使单元测试困难

---

## 🎯 解决方案：Composable 架构

将单体 store 拆分为专注的 composables，遵循 Vue 3 最佳实践。

### 为什么选择 Composables 而不是多个 Stores？

1. **更好的组合性**: Composables 可以自然地相互调用
2. **更易测试**: 每个 composable 可以独立测试
3. **依赖关系更清晰**: 只导入需要的部分
4. **更好的 Tree-Shaking**: 未使用的 composables 不会被打包
5. **符合 Vue 3 习惯**: 与 Vue 3 Composition API 模式一致

---

## 🏗️ 新架构

```
src/renderer/src/
├── stores/
│   └── chat.ts                          # 主协调器（~300 行）
│
├── composables/
│   ├── chat/
│   │   ├── useThreadManagement.ts       # 会话 CRUD、激活、分支
│   │   ├── useMessageCache.ts           # 统一消息缓存
│   │   ├── useMessageStreaming.ts       # 流式事件处理器
│   │   ├── useVariantManagement.ts      # 变体选择逻辑
│   │   ├── useChatConfig.ts             # 配置状态和持久化
│   │   ├── useThreadExport.ts           # 导出功能
│   │   ├── useDeeplink.ts               # Deeplink 处理
│   │   ├── useChatAudio.ts              # 音效
│   │   └── useChatEvents.ts             # IPC 事件协调
│   │
│   └── shared/
│       └── usePresenterCache.ts         # 共享的 presenter 缓存模式
│
└── lib/
    └── messageCache/
        ├── index.ts                     # 统一缓存实现
        ├── types.ts                     # 缓存类型
        └── utils.ts                     # 缓存工具
```

---

## 📦 Composable 详细设计

### 1. `useThreadManagement.ts` (~200 行)

**职责**：
- 会话 CRUD 操作
- 会话激活/停用
- 会话分支
- 子会话创建
- 会话列表管理

**状态**：
```typescript
const activeThreadId = ref<string | null>(null)
const threads = ref<GroupedThreads[]>([])
const childThreadsByMessageId = ref<Map<string, CONVERSATION[]>>(new Map())
```

**核心方法**：
```typescript
createThread(title, settings)
setActiveThread(threadId)
clearActiveThread()
forkThread(messageId, forkTag)
createChildThreadFromSelection(payload)
openThreadInNewTab(threadId, options)
renameThread(threadId, title)
toggleThreadPinned(threadId, isPinned)
```

---

### 2. `useMessageCache.ts` (~250 行)

**职责**：
- 统一消息缓存（替换双缓存系统）
- 消息预取
- 缓存失效
- DOM 信息追踪

**统一缓存设计**：
```typescript
interface MessageCacheEntry {
  message: Message
  threadId: string
  isGenerating: boolean
  domInfo?: { top: number; height: number }
}

const messageCache = new Map<string, MessageCacheEntry>()
const messageCacheVersion = ref(0)
```

**核心方法**：
```typescript
// 缓存操作
getCachedMessage(messageId): Message | null
cacheMessage(message, threadId, isGenerating)
deleteCachedMessage(messageId)
clearCacheForThread(threadId)

// 消息加载
getMessageIds(threadId): string[]
loadMessages(threadId): Promise<Message[]>
prefetchMessagesForRange(startIndex, endIndex)
ensureMessagesLoadedByIds(messageIds)

// DOM 追踪
recordMessageDomInfo(entries)
getMessageDomInfo(messageId)
```

**优势**：
- 单一数据源
- 更简单的缓存失效
- 更易调试
- 更好的性能（无重复存储）

---

### 3. `useMessageStreaming.ts` (~300 行)

**职责**：
- 处理来自主进程的流式事件
- 在流式传输期间更新消息内容
- 管理流式状态

**状态**：
```typescript
const generatingThreadIds = ref<Set<string>>(new Set())
const threadsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())
```

**核心方法**：
```typescript
handleStreamResponse(msg)
handleStreamEnd(msg)
handleStreamError(msg)
updateThreadWorkingStatus(threadId, status)
getThreadWorkingStatus(threadId)
```

**重构后的流处理器**：
```typescript
// 将 313 行的 handleStreamResponse 拆分为更小的函数
handleStreamResponse(msg) {
  if (msg.stream_kind === 'init') {
    return handleStreamInit(msg)
  }

  const message = getStreamingMessage(msg.eventId)
  if (!message) return

  if (msg.tool_call) {
    handleToolCallUpdate(message, msg)
  } else if (msg.content) {
    handleContentUpdate(message, msg)
  } else if (msg.reasoning_content) {
    handleReasoningUpdate(message, msg)
  } else if (msg.image_data) {
    handleImageUpdate(message, msg)
  } else if (msg.rate_limit) {
    handleRateLimitUpdate(message, msg)
  }

  if (msg.totalUsage) {
    updateMessageUsage(message, msg.totalUsage)
  }

  cacheStreamingMessage(message)
}

// 每个处理器 20-50 行，更易理解
function handleToolCallUpdate(message, msg) { ... }
function handleContentUpdate(message, msg) { ... }
```

---

### 4. `useVariantManagement.ts` (~150 行)

**职责**：
- 变体选择和持久化
- 变体消息解析
- 使用变体重试/重新生成

**状态**：
```typescript
const selectedVariantsMap = ref<Record<string, string>>({})
```

**核心方法**：
```typescript
updateSelectedVariant(mainMessageId, variantId)
clearSelectedVariantForMessage(mainMessageId)
resolveVariantMessage(message, selectedVariants)
retryMessage(messageId)
regenerateFromUserMessage(userMessageId)
```

**简化逻辑**：
```typescript
// 当前：变体逻辑散落在多个函数中
// 新：集中的变体管理

const variantAwareMessages = computed(() => {
  return messageIds.value
    .map(id => getCachedMessage(id))
    .filter(Boolean)
    .map(msg => resolveVariantMessage(msg, selectedVariantsMap.value))
})
```

---

### 5. `useChatConfig.ts` (~150 行)

**职责**：
- 聊天配置状态
- 配置持久化
- ACP 工作目录偏好
- Agent 工作空间偏好

**状态**：
```typescript
const chatConfig = ref<CONVERSATION_SETTINGS>({ ... })
```

**核心方法**：
```typescript
loadChatConfig()
saveChatConfig()
updateChatConfig(newConfig)
setAcpWorkdirPreference(agentId, workdir)
setAgentWorkspacePreference(workspacePath)
```

---

### 6. `useThreadExport.ts` (~100 行)

**职责**：
- 导出会话到各种格式
- Nowledge-mem 集成

**核心方法**：
```typescript
exportThread(threadId, format)
submitToNowledgeMem(threadId)
testNowledgeMemConnection()
updateNowledgeMemConfig(config)
getNowledgeMemConfig()
```

---

### 7. `useDeeplink.ts` (~80 行)

**职责**：
- 处理 deeplink 事件
- 管理 deeplink 缓存
- 上下文提及管理

**状态**：
```typescript
const deeplinkCache = ref<DeeplinkData | null>(null)
const pendingContextMentions = ref<Map<string, PendingContextMention>>(new Map())
const pendingScrollTargetByConversation = ref<Map<string, PendingScrollTarget>>(new Map())
```

**核心方法**：
```typescript
handleDeeplinkStart(data)
clearDeeplinkCache()
setPendingContextMention(threadId, content, label)
consumeContextMention(threadId)
queueScrollTarget(conversationId, target)
consumePendingScrollMessage(conversationId)
```

---

### 8. `useChatAudio.ts` (~80 行)

**职责**：
- 音效播放
- 音频初始化

**核心方法**：
```typescript
initAudio()
playTypewriterSound()
playToolcallSound()
```

---

### 9. `useChatEvents.ts` (~200 行)

**职责**：
- IPC 事件监听器设置
- 事件路由到适当的 composables
- 事件清理

**核心方法**：
```typescript
setupChatEventListeners()
cleanupChatEventListeners()
```

**集中的事件处理**：
```typescript
export function useChatEvents() {
  const threadMgmt = useThreadManagement()
  const streaming = useMessageStreaming()
  const config = useChatConfig()

  function setupChatEventListeners() {
    // 会话事件
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.LIST_UPDATED, (_, data) => {
      threadMgmt.handleThreadListUpdate(data)
    })

    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.ACTIVATED, (_, msg) => {
      threadMgmt.handleThreadActivated(msg)
    })

    // 流式事件
    window.electron.ipcRenderer.on(STREAM_EVENTS.RESPONSE, (_, msg) => {
      streaming.handleStreamResponse(msg)
    })

    // ... 其他事件
  }

  function cleanupChatEventListeners() {
    window.electron.ipcRenderer.removeAllListeners(CONVERSATION_EVENTS.LIST_UPDATED)
    // ... 清理所有监听器
  }

  return { setupChatEventListeners, cleanupChatEventListeners }
}
```

---

### 10. 主 Store `chat.ts` (~300 行)

**职责**：
- 协调 composables
- 为组件提供统一 API
- 在迁移期间保持向后兼容

**结构**：
```typescript
export const useChatStore = defineStore('chat', () => {
  // 初始化 composables
  const threadMgmt = useThreadManagement()
  const messageCache = useMessageCache()
  const streaming = useMessageStreaming()
  const variants = useVariantManagement()
  const config = useChatConfig()
  const exports = useThreadExport()
  const deeplink = useDeeplink()
  const audio = useChatAudio()
  const events = useChatEvents()

  // 挂载时设置
  onMounted(() => {
    audio.initAudio()
    events.setupChatEventListeners()
  })

  // 暴露统一 API
  return {
    // 会话管理
    ...threadMgmt,

    // 消息管理
    ...messageCache,

    // 流式
    ...streaming,

    // 变体
    ...variants,

    // 配置
    ...config,

    // 导出
    ...exports,

    // Deeplink
    ...deeplink,

    // 组合多个 composables 的计算属性
    messageItems: computed(() => {
      const ids = messageCache.getMessageIds()
      return ids.map(id => ({
        id,
        message: variants.resolveVariantMessage(
          messageCache.getCachedMessage(id),
          variants.selectedVariantsMap.value
        )
      }))
    })
  }
})
```

---

## 🗑️ 可删除/简化的部分

### 1. **重复的状态追踪** ⚠️ 高优先级

**问题**：
```typescript
// 行 91-96: 两个追踪同一件事的状态
const threadsWorkingStatus = ref<Map<string, WorkingStatus>>(new Map())
const generatingThreadIds = ref<Set<string>>(new Set())
```

**建议**：
- **删除** `generatingThreadIds`
- **保留** `threadsWorkingStatus`，因为它提供了更多信息（working/error/completed）
- 用 `threadsWorkingStatus.has(threadId)` 替换所有 `generatingThreadIds.has(threadId)` 检查

**影响**：减少 ~50 行代码，消除同步问题

---

### 2. **双缓存系统** ⚠️ 高优先级

**问题**：
```typescript
// 外部缓存（messageRuntimeCache.ts）
getCachedMessage(id)
cacheMessage(message)

// 内部缓存（行 94-96）
const generatingMessagesCache = ref<Map<string, { message, threadId }>>(new Map())
```

**建议**：
- **统一为单一缓存**，在 `useMessageCache.ts` 中
- 添加 `isGenerating` 标志到缓存条目
- 删除 `messageRuntimeCache.ts` 或将其作为底层实现

**影响**：减少 ~100 行代码，简化缓存逻辑

---

### 3. **未使用的导出功能** 🔍 需确认

**问题**：
```typescript
// 行 1893-2002: Nowledge-mem 集成
submitToNowledgeMem()
testNowledgeMemConnection()
updateNowledgeMemConfig()
getNowledgeMemConfig()
```

**建议**：
- **检查使用情况**：搜索这些方法的调用
- 如果未使用或很少使用，考虑：
  - 移到单独的插件/扩展系统
  - 或完全删除

**影响**：可能减少 ~150 行代码

---

### 4. **过度的 Getter 函数** 🔧 中优先级

**问题**：
```typescript
// 行 136-201: 许多简单的 getter 函数
const getTabId = () => window.api.getWebContentsId()
const getActiveThreadId = () => activeThreadId.value
const getMessageIds = () => messageIds.value
const getLoadedMessages = () => { ... }
const getThreadsWorkingStatus = () => threadsWorkingStatus.value
const getGeneratingMessagesCache = () => generatingMessagesCache.value
```

**建议**：
- **删除简单的 getter**，直接访问 ref
- **保留复杂的 getter**（如 `getLoadedMessages`）
- 在 Vue 3 中，直接访问 `.value` 是惯用做法

**影响**：减少 ~30 行代码，提高可读性

---

### 5. **注释掉的通知代码** ✂️ 立即删除

**问题**：
```typescript
// 行 1203-1226: 大段注释掉的通知代码
// const isFocused = await windowP.isMainWindowFocused(windowP.mainWindow?.id)
// if (!isFocused) {
//   ...
// }
```

**建议**：
- **立即删除**注释掉的代码
- 如果将来需要，可以从 git 历史中恢复

**影响**：减少 ~25 行代码

---

### 6. **showProviderSelector 方法** 🤔 需重新考虑

**问题**：
```typescript
// 行 1999-2002: 使用 DOM 事件进行组件通信
const showProviderSelector = () => {
  window.dispatchEvent(new CustomEvent('show-provider-selector'))
}
```

**建议**：
- **重新考虑设计**：使用 Pinia store 状态而不是 DOM 事件
- 或者移到 UI 组件层

**影响**：减少 ~5 行代码，改进架构

---

### 7. **handleMeetingInstruction** 🔍 需确认

**问题**：
```typescript
// 行 1762-1782: 会议指令处理
const handleMeetingInstruction = async (data: { prompt: string }) => {
  // ...
}
```

**建议**：
- **检查使用频率**
- 如果是实验性功能或很少使用，考虑移到单独的模块

**影响**：可能减少 ~20 行代码

---

### 8. **enrichMessageWithExtra** 🔧 可优化

**问题**：
```typescript
// 行 490-527: 复杂的消息增强逻辑
const enrichMessageWithExtra = async (message: Message): Promise<Message> => {
  // 递归处理变体...
}
```

**建议**：
- **简化逻辑**：将搜索结果附件处理移到单独的函数
- **考虑**：是否可以在主进程中完成此操作

**影响**：减少 ~20 行代码，提高可读性

---

### 9. **formatContextLabel** 🔧 可移动

**问题**：
```typescript
// 行 310-316: 工具函数在 store 中
const formatContextLabel = (value: string) => {
  // ...
}
```

**建议**：
- **移到** `lib/utils.ts` 或类似的工具文件
- Store 应该只包含状态和业务逻辑

**影响**：减少 ~10 行代码

---

### 10. **getMessageTextForContext** 🔧 可移动

**问题**：
```typescript
// 行 529-547: 另一个工具函数
const getMessageTextForContext = (message: Message | null): string => {
  // ...
}
```

**建议**：
- **移到** `lib/messageUtils.ts`
- 可以在多个地方重用

**影响**：减少 ~20 行代码

---

## 📊 删除/简化总结

| 项目 | 优先级 | 预计减少行数 | 复杂度 |
|------|--------|------------|--------|
| 重复状态追踪 | 高 | ~50 | 中 |
| 双缓存系统 | 高 | ~100 | 高 |
| 未使用的导出功能 | 需确认 | ~150 | 低 |
| 过度的 Getter | 中 | ~30 | 低 |
| 注释掉的代码 | 立即 | ~25 | 低 |
| showProviderSelector | 中 | ~5 | 低 |
| handleMeetingInstruction | 需确认 | ~20 | 低 |
| enrichMessageWithExtra | 中 | ~20 | 中 |
| formatContextLabel | 低 | ~10 | 低 |
| getMessageTextForContext | 低 | ~20 | 低 |

**总计潜在减少**：~430 行（不包括需确认的项目）

---

## 🔄 简化的迁移策略

### 阶段 0: 立即清理（1 天）
1. ✂️ 删除注释掉的代码
2. 🔧 移动工具函数到 `lib/`
3. 🗑️ 删除未使用的 getter

**预期减少**：~65 行

### 阶段 1: 状态简化（2-3 天）
1. 🔄 统一状态追踪（删除 `generatingThreadIds`）
2. 🔄 统一缓存系统

**预期减少**：~150 行

### 阶段 2: 提取简单 Composables（3-4 天）
1. 提取 `useChatAudio.ts`
2. 提取 `useThreadExport.ts`（确认后）
3. 提取 `useDeeplink.ts`

**预期减少**：~250 行（从主 store）

### 阶段 3: 提取核心 Composables（5-7 天）
1. 提取 `useChatConfig.ts`
2. 提取 `useThreadManagement.ts`
3. 提取 `useMessageCache.ts`

**预期减少**：~600 行（从主 store）

### 阶段 4: 提取事件处理（5-7 天）
1. 提取 `useMessageStreaming.ts`
2. 提取 `useVariantManagement.ts`
3. 提取 `useChatEvents.ts`

**预期减少**：~650 行（从主 store）

### 阶段 5: 最终整合（2-3 天）
1. 更新主 `chat.ts`
2. 测试和优化
3. 文档更新

---

## 📈 预期结果

### 重构前
- `chat.ts`: 2098 行
- 职责混乱
- 难以维护

### 重构后
- `chat.ts`: ~300 行（主协调器）
- 9 个专注的 composables，每个 80-300 行
- 清晰的职责分离
- 易于测试和维护

**总代码量**：~1800 行（减少 ~300 行）
**文件数量**：10 个（从 1 个）
**平均文件大小**：~180 行

---

## ✅ 下一步行动

1. **确认删除项**：
   - [ ] 确认 Nowledge-mem 功能是否使用
   - [ ] 确认 Meeting 功能是否使用
   - [ ] 检查所有 getter 的使用情况

2. **获得批准**：
   - [ ] 技术负责人审查
   - [ ] 团队讨论
   - [ ] 时间线批准

3. **开始实施**：
   - [ ] 从阶段 0 开始（立即清理）
   - [ ] 逐步推进到后续阶段

---

**文档版本**: 1.0
**最后更新**: 2026-01-19
**作者**: Claude Code
**审阅者**: 待定
