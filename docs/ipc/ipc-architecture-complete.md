# DeepChat IPC 架构完整指南

## 概述

DeepChat 已经实现了完整的多Tab IPC通信架构，支持精确的Tab上下文识别、事件路由和进程间通信。本文档提供架构现状、使用指南和最佳实践的完整描述。

## 🏗️ 架构现状

### 核心成就

EventBus 已成功实现了完整的多Tab精确通信机制，支持主进程和渲染进程之间的精确事件传递。基于 EventEmitter 构建，提供了强大的显式事件发送方法和Tab级别的精确路由功能。

### 已实现的核心功能 ✅

#### 1. Tab上下文识别机制

**WebContents ID 映射**
- **位置**: `src/main/presenter/tabPresenter.ts:32`
- **实现**: `webContentsToTabId: Map<number, number>`
- **功能**: 自动建立WebContents ID到Tab ID的映射关系

```typescript
// TabPresenter.ts:159 - Tab创建时自动建立映射
this.webContentsToTabId.set(view.webContents.id, tabId)

// TabPresenter.ts:465 - 根据WebContents ID获取Tab ID
getTabIdByWebContentsId(webContentsId: number): number | undefined {
  return this.webContentsToTabId.get(webContentsId)
}

// TabPresenter.ts:474 - 根据WebContents ID获取Window ID  
getWindowIdByWebContentsId(webContentsId: number): number | undefined {
  const tabId = this.getTabIdByWebContentsId(webContentsId)
  return tabId ? this.tabWindowMap.get(tabId) : undefined
}
```

#### 2. IPC调用处理

**主进程处理器增强**
- **位置**: `src/main/presenter/index.ts:197`
- **功能**: 自动识别IPC调用的来源Tab和Window

```typescript
ipcMain.handle('presenter:call', (event: IpcMainInvokeEvent, name: string, method: string, ...payloads: unknown[]) => {
  // 构建调用上下文 - 已实现
  const webContentsId = event.sender.id
  const tabId = presenter.tabPresenter.getTabIdByWebContentsId(webContentsId)
  const windowId = presenter.tabPresenter.getWindowIdByWebContentsId(webContentsId)

  const context: IPCCallContext = {
    tabId,
    windowId, 
    webContentsId,
    presenterName: name,
    methodName: method,
    timestamp: Date.now()
  }

  // 详细的日志记录 - 已实现
  if (import.meta.env.VITE_LOG_IPC_CALL === '1') {
    console.log(`[IPC Call] Tab:${context.tabId || 'unknown'} Window:${context.windowId || 'unknown'} -> ${context.presenterName}.${context.methodName}`)
  }
})
```

#### 3. EventBus精确路由

**完整的路由方法集**
- **位置**: `src/main/eventbus.ts`
- **功能**: 支持从基础通信到精确Tab路由的完整功能

```typescript
export class EventBus extends EventEmitter {
  // 基础通信方法
  sendToMain(eventName: string, ...args: unknown[]) // 仅主进程
  sendToWindow(eventName: string, windowId: number, ...args: unknown[]) // 特定窗口
  sendToRenderer(eventName: string, target: SendTarget, ...args: unknown[]) // 渲染进程
  send(eventName: string, target: SendTarget, ...args: unknown[]) // 双向通信

  // 精确路由方法 ✨ 已实现
  sendToTab(tabId: number, eventName: string, ...args: unknown[]) // 指定Tab
  sendToActiveTab(windowId: number, eventName: string, ...args: unknown[]) // 活跃Tab
  broadcastToTabs(tabIds: number[], eventName: string, ...args: unknown[]) // 多Tab广播
}
```

#### 4. 渲染进程集成

**WebContents ID获取**
- **位置**: `src/preload/index.ts:27`
- **实现**: 通过preload API暴露webContentsId

```typescript
// preload/index.ts - 已实现
getWebContentsId: () => {
  if (cachedWebContentsId !== undefined) {
    return cachedWebContentsId
  }
  cachedWebContentsId = ipcRenderer.sendSync('get-web-contents-id')
  return cachedWebContentsId
}
```

**渲染进程调用**
- **位置**: `src/renderer/src/composables/usePresenter.ts:61`
- **实现**: 自动注入WebContents ID到IPC调用

```typescript
// 自动注入WebContents ID
const webContentsId = getWebContentsId()

// IPC调用日志包含WebContents ID
if (import.meta.env.VITE_LOG_IPC_CALL === '1') {
  console.log(`[Renderer IPC] WebContents:${webContentsId || 'unknown'} -> ${presenterName}.${functionName as string}`)
}
```

## 🎯 使用指南与最佳实践

### 精确路由方法（推荐优先使用）

#### `sendToTab(tabId, eventName, ...args)` ✨
**用途**: 向指定Tab发送事件  
**场景**: Tab特定的操作结果、状态更新

```typescript
// 示例：消息编辑完成，只通知相关Tab
async editMessage(tabId: number, messageId: string, newContent: string) {
  await this.updateMessageInDatabase(messageId, newContent)
  
  // 只通知当前Tab更新UI
  eventBus.sendToTab(tabId, 'conversation:message-edited', {
    messageId,
    content: newContent,
    timestamp: Date.now()
  })
}
```

#### `sendToActiveTab(windowId, eventName, ...args)` ✨
**用途**: 向窗口的活跃Tab发送事件  
**场景**: 快捷键操作、窗口级操作

```typescript
// 示例：快捷键创建新对话
handleCreateNewConversation(windowId: number) {
  const conversationId = this.createNewConversation()
  
  // 只通知当前活跃的Tab
  eventBus.sendToActiveTab(windowId, 'conversation:new-created', {
    conversationId,
    switchTo: true
  })
}
```

#### `broadcastToTabs(tabIds, eventName, ...args)` ✨
**用途**: 向多个指定Tab广播事件  
**场景**: 批量操作、相关Tab的协调更新

```typescript
// 示例：删除线程，通知所有相关Tab
async deleteThread(threadId: string) {
  await this.deleteThreadFromDatabase(threadId)
  
  // 获取所有显示此线程的Tab
  const relatedTabIds = this.getTabsByThreadId(threadId)
  
  // 只通知相关Tab更新
  eventBus.broadcastToTabs(relatedTabIds, 'thread:deleted', {
    threadId,
    redirectTo: 'home'
  })
}
```

### 选择合适的方法

#### 决策流程图
```
事件需要发送给谁？
├── 特定Tab ────────────→ sendToTab(tabId, ...)
├── 当前活跃Tab ────────→ sendToActiveTab(windowId, ...)  
├── 多个相关Tab ───────→ broadcastToTabs(tabIds, ...)
├── 特定窗口 ─────────→ sendToWindow(windowId, ...)
├── 仅主进程 ─────────→ sendToMain(...)
├── 全局配置/状态 ────→ send(..., ALL_WINDOWS, ...)
└── 纯UI更新 ────────→ sendToRenderer(..., ALL_WINDOWS, ...)
```

#### 事件作用域分类

**🎯 Tab级别事件（优先使用精确路由）**
```typescript
// ✅ 推荐：精确路由
eventBus.sendToTab(tabId, 'conversation:message-updated', messageData)
eventBus.sendToTab(tabId, 'stream:completed', streamData)
eventBus.sendToTab(tabId, 'error:display', errorInfo)

// ❌ 避免：不必要的广播
// eventBus.sendToRenderer('notification:show', SendTarget.ALL_WINDOWS, message)
```

**🪟 窗口级别事件**
```typescript
// 快捷键操作：影响当前活跃Tab
eventBus.sendToActiveTab(windowId, 'shortcut:new-conversation')
eventBus.sendToActiveTab(windowId, 'shortcut:go-settings')

// 窗口状态：影响整个窗口
eventBus.sendToWindow('window:focus-changed', windowId, isFocused)
```

**🌍 全局事件（合理使用广播）**
```typescript
// ✅ 适合广播：真正的全局配置
eventBus.send('config:theme-changed', SendTarget.ALL_WINDOWS, theme)
eventBus.send('config:language-changed', SendTarget.ALL_WINDOWS, language)
eventBus.send('system:update-available', SendTarget.ALL_WINDOWS, updateInfo)

// 主进程内部事件
eventBus.sendToMain('window:created', windowId)
eventBus.sendToMain('app:will-quit')
```

## 📝 事件命名规范

### 分类与命名约定

采用 `领域:动作` 的命名格式：

#### 1. 配置相关事件
```typescript
'config:provider-changed'    // 提供者配置变更
'config:system-changed'      // 系统配置变更  
'config:language-changed'    // 语言配置变更
'config:theme-changed'       // 主题配置变更
```

#### 2. 会话相关事件
```typescript
'conversation:created'       // 会话创建
'conversation:activated'     // 会话激活
'conversation:message-edited'// 消息编辑
'conversation:cleared'       // 会话清理
```

#### 3. 流处理相关事件
```typescript
'stream:data'               // 流数据
'stream:completed'          // 流完成
'stream:error'              // 流错误
```

#### 4. 系统相关事件
```typescript
'system:theme-updated'       // 系统主题更新
'system:update-available'    // 系统更新可用
'window:created'            // 窗口创建
'window:focused'            // 窗口聚焦
```

#### 5. MCP相关事件
```typescript
'mcp:server-started'        // MCP服务器启动
'mcp:server-stopped'        // MCP服务器停止
'mcp:tool-result'           // MCP工具执行结果
'mcp:config-changed'        // MCP配置变更
```

#### 6. 同步相关事件
```typescript
'sync:backup-started'       // 备份开始
'sync:backup-completed'     // 备份完成
'sync:import-completed'     // 导入完成
'sync:error'                // 同步错误
```

## 🚀 代码优化示例

### 场景1: 流事件处理优化

```typescript
// ❌ 当前可能的实现（过度广播）
class StreamEventHandler {
  handleStreamComplete(data: StreamData) {
    // 广播到所有窗口，但只有1个Tab需要
    eventBus.sendToRenderer('stream:completed', SendTarget.ALL_WINDOWS, data)
  }
}

// ✅ 优化后的实现
class StreamEventHandler {
  handleStreamComplete(tabId: number, data: StreamData) {
    // 只通知发起流的Tab
    eventBus.sendToTab(tabId, 'stream:completed', data)
    
    // 如果需要，可以通知主进程记录
    eventBus.sendToMain('stream:completed-logged', { tabId, ...data })
  }
}
```

### 场景2: 配置更新优化

```typescript
// ❌ 过度广播
updateProviderConfig(providerId: string, config: ProviderConfig) {
  this.saveConfig(providerId, config)
  
  // 不必要的广播
  eventBus.send('config:provider-changed', SendTarget.ALL_WINDOWS, { providerId, config })
}

// ✅ 精确通知
updateProviderConfig(tabId: number, providerId: string, config: ProviderConfig) {
  this.saveConfig(providerId, config)
  
  // 通知主进程更新内存中的配置
  eventBus.sendToMain('config:provider-updated', { providerId, config })
  
  // 只通知操作的Tab配置已更新
  eventBus.sendToTab(tabId, 'config:provider-update-success', { providerId })
  
  // 如果其他Tab也在使用此provider，才通知它们
  const affectedTabs = this.getTabsUsingProvider(providerId)
  if (affectedTabs.length > 0) {
    eventBus.broadcastToTabs(affectedTabs, 'config:provider-config-changed', { providerId, config })
  }
}
```

### 场景3: 错误处理优化

```typescript
// ❌ 广播错误到所有Tab
handleError(error: Error) {
  eventBus.sendToRenderer('error:occurred', SendTarget.ALL_WINDOWS, error)
}

// ✅ 精确错误通知
handleError(tabId: number, error: Error, context: ErrorContext) {
  // 主进程记录错误
  eventBus.sendToMain('error:logged', { tabId, error, context })
  
  // 只向出错的Tab显示错误
  eventBus.sendToTab(tabId, 'error:display', {
    message: error.message,
    type: context.type,
    recoverable: context.canRetry
  })
}
```

## 🛠️ 性能优化技巧

### 1. 减少不必要的事件传播

```typescript
// ❌ 性能浪费：100个Tab都收到事件，但只有1个需要
function notifyAllTabs(data: any) {
  eventBus.sendToRenderer('data:updated', SendTarget.ALL_WINDOWS, data)
}

// ✅ 精确通知：只通知相关Tab
function notifyRelevantTabs(dataId: string, data: any) {
  const relevantTabs = this.getTabsDisplayingData(dataId)
  eventBus.broadcastToTabs(relevantTabs, 'data:updated', data)
}
```

### 2. 批量操作优化

```typescript
// ❌ 多次调用
function updateMultipleTabs(updates: Array<{tabId: number, data: any}>) {
  updates.forEach(update => {
    eventBus.sendToTab(update.tabId, 'data:updated', update.data)
  })
}

// ✅ 批量通知
function updateMultipleTabs(updates: Array<{tabId: number, data: any}>) {
  const tabIds = updates.map(u => u.tabId)
  const batchData = updates.reduce((acc, u) => {
    acc[u.tabId] = u.data
    return acc
  }, {} as Record<number, any>)
  
  eventBus.broadcastToTabs(tabIds, 'data:batch-updated', batchData)
}
```

## 🔧 调试与监控

### 启用IPC日志

```bash
# 在开发环境中启用详细的IPC调用日志
VITE_LOG_IPC_CALL=1 pnpm run dev
```

这将显示：
- `[IPC Call] Tab:123 Window:456 -> presenterName.methodName`
- `[Renderer IPC] WebContents:789 -> presenterName.methodName`
- `[EventBus] Sending eventName to Tab:123`

### 检查事件路由

```typescript
// 在EventBus中添加调试日志
sendToTab(tabId: number, eventName: string, ...args: unknown[]) {
  if (import.meta.env.DEV) {
    console.log(`[EventBus] Sending ${eventName} to Tab:${tabId}`)
  }
  // 实际发送逻辑...
}

// 检查 WindowPresenter 状态
if (!eventBus.windowPresenter) {
  console.warn('WindowPresenter not set, renderer events will not work')
}
```

### 迁移现有代码

```bash
# 搜索可能过度广播的地方
grep -r "SendTarget.ALL_WINDOWS" src/
grep -r "sendToRenderer" src/

# 分析：这个事件真的需要所有窗口都知道吗？
# 替换：从广播改为精确路由
```

## 📊 当前状态总结

### ✅ 已完全实现的功能

1. **Tab上下文识别**: 100%完成，主进程能准确识别每个IPC调用的来源Tab
2. **精确事件路由**: 100%完成，EventBus支持向指定Tab发送事件
3. **增强错误处理**: 100%完成，所有错误日志包含Tab上下文信息
4. **性能优化**: 使用Map结构，O(1)时间复杂度的映射查找
5. **向后兼容**: 100%兼容，现有API接口完全保持不变

### ⚠️ 待优化的方面

1. **使用率低**: 很多代码仍使用`SendTarget.ALL_WINDOWS`广播，未充分利用精确路由
2. **监控不足**: 缺乏IPC性能监控和异常告警
3. **文档滞后**: 之前的文档没有准确反映当前架构状态

### 🎯 实际需要的改进

1. **推广使用**: 在代码中更多使用精确路由方法
2. **性能监控**: 添加IPC调用统计和性能监控
3. **开发体验**: 提供更好的调试工具

## 🎉 结论

DeepChat的IPC架构已经非常成熟和完善，核心的多Tab通信问题已经完全解决。架构具有以下特点：

- **功能完整**: 从基础通信到精确路由的完整功能集
- **性能优秀**: 使用高效的数据结构和算法
- **开发友好**: 提供详细的调试信息和错误处理
- **扩展性强**: 支持复杂的多Tab、多窗口场景

**主要需要的是使用优化而非架构改进**：

1. **文档更新**: 准确反映当前架构状态 ✅ 已完成
2. **使用优化**: 推广精确路由方法的使用
3. **监控完善**: 添加性能监控和调试工具

**不需要大规模重构**，当前架构已经足够支撑复杂的多Tab场景。重点应该放在充分利用现有功能上。