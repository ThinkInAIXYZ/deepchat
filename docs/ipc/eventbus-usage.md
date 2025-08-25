# EventBus 使用指南与最佳实践

## 概述

EventBus 提供了主进程和渲染进程之间精确的事件通信机制，支持从基础广播到精确Tab路由的完整功能。本指南将帮助你充分利用已有的强大IPC架构。

## 核心理念

- **精确路由优先**：尽可能使用精确路由而非广播
- **明确事件作用域**：根据影响范围选择合适的发送方法  
- **类型安全**：完整的 TypeScript 支持
- **性能优化**：减少不必要的事件传播

## 可用方法详解

### 🎯 精确路由方法（推荐优先使用）

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

### 📡 基础通信方法

#### `sendToMain(eventName, ...args)`
**用途**: 仅发送到主进程
**场景**: 窗口管理、内部状态记录

```typescript
// 窗口管理、标签页操作等主进程内部事件
eventBus.sendToMain('window:created', windowId)
eventBus.sendToMain('shortcut:create-new-tab', windowId)
```

#### `sendToWindow(eventName, windowId, ...args)`
**用途**: 发送到特定窗口
**场景**: 窗口特定操作

```typescript
// 发送到指定窗口的渲染进程
eventBus.sendToWindow('window:focus-changed', windowId, isFocused)
```

#### `sendToRenderer(eventName, target, ...args)`
**用途**: 发送到渲染进程
**场景**: 真正的全局UI更新

```typescript
// ✅ 适合广播的场景：全局配置变更
eventBus.sendToRenderer('config:theme-changed', SendTarget.ALL_WINDOWS, theme)
eventBus.sendToRenderer('config:language-changed', SendTarget.ALL_WINDOWS, language)

// ❌ 避免：Tab特定操作使用广播
// eventBus.sendToRenderer('notification:show', SendTarget.ALL_WINDOWS, message)
```

#### `send(eventName, target, ...args)`
**用途**: 同时发送到主进程和渲染进程
**场景**: 需要主进程和渲染进程同时响应的事件

```typescript
// 配置变更需要主进程和渲染进程都知道
eventBus.send('config:provider-changed', SendTarget.ALL_WINDOWS, providers)
eventBus.send('sync:backup-completed', SendTarget.ALL_WINDOWS, timestamp)
```

## 🎯 选择合适的方法

### 决策流程图
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

### 事件作用域分类

#### 🎯 Tab级别事件（优先使用精确路由）
```typescript
// ✅ 推荐：精确路由
eventBus.sendToTab(tabId, 'conversation:message-updated', messageData)
eventBus.sendToTab(tabId, 'stream:completed', streamData)
eventBus.sendToTab(tabId, 'error:display', errorInfo)

// ❌ 避免：不必要的广播
// eventBus.sendToRenderer('notification:show', SendTarget.ALL_WINDOWS, message)
```

#### 🪟 窗口级别事件
```typescript
// 快捷键操作：影响当前活跃Tab
eventBus.sendToActiveTab(windowId, 'shortcut:new-conversation')
eventBus.sendToActiveTab(windowId, 'shortcut:go-settings')

// 窗口状态：影响整个窗口
eventBus.sendToWindow('window:focus-changed', windowId, isFocused)
```

#### 🌍 全局事件（合理使用广播）
```typescript
// ✅ 适合广播：真正的全局配置
eventBus.send('config:theme-changed', SendTarget.ALL_WINDOWS, theme)
eventBus.send('config:language-changed', SendTarget.ALL_WINDOWS, language)
eventBus.send('system:update-available', SendTarget.ALL_WINDOWS, updateInfo)

// 主进程内部事件
eventBus.sendToMain('window:created', windowId)
eventBus.sendToMain('app:will-quit')
```

## SendTarget 选项

```typescript
enum SendTarget {
  ALL_WINDOWS = 'all_windows',    // 广播到所有窗口（默认，推荐）
  DEFAULT_TAB = 'default_tab'     // 发送到默认标签页（特殊场景）
}
```

## 初始化和配置

### WindowPresenter 设置
```typescript
import { eventBus } from '@/main/eventbus'
import { WindowPresenter } from '@/main/windowPresenter'

// 在应用初始化时设置 WindowPresenter
const windowPresenter = new WindowPresenter()
eventBus.setWindowPresenter(windowPresenter)
```

## 最佳实践

### 1. 配置变更事件
```typescript
// 在配置更新时，通知所有标签页
setLanguage(language: string) {
  this.setSetting('language', language)
  eventBus.send('config:language-changed', SendTarget.ALL_WINDOWS, language)
}
```

### 2. 窗口管理事件
```typescript
// 窗口相关事件通常只需要主进程知道
onWindowCreated(windowId: number) {
  eventBus.sendToMain('window:created', windowId)
}
```

### 3. 用户交互事件
```typescript
// 快捷键等用户操作，可能需要发送到特定目标
onZoomIn() {
  // 缩放需要所有窗口响应
  eventBus.send('shortcut:zoom-in', SendTarget.ALL_WINDOWS)
}
```

### 4. 错误处理事件
```typescript
// 明确指定错误事件的发送目标
onStreamError(error: Error) {
  // 主进程记录错误
  eventBus.sendToMain('stream:error-logged', error)
  // 渲染进程显示错误
  eventBus.sendToRenderer('stream:error-display', SendTarget.ALL_WINDOWS, error)
}
```

## 🚀 实际代码优化示例

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

## 类型安全

EventBus 完全支持 TypeScript，提供完整的类型检查：

```typescript
// 明确的参数类型
eventBus.send('config:changed', SendTarget.ALL_WINDOWS, {
  key: 'language',
  value: 'zh-CN'
})

// 安全的枚举使用
eventBus.sendToRenderer('ui:update', SendTarget.DEFAULT_TAB, data)
```

## 注意事项

1. **WindowPresenter 依赖**：发送到渲染进程需要先设置 WindowPresenter
2. **显式发送**：所有跨进程通信都需要明确调用相应的方法
3. **事件命名规范**：建议使用 `模块:动作` 的命名格式
4. **参数类型**：确保传递的参数可以被序列化
5. **错误处理**：监听控制台警告，确保 WindowPresenter 正确设置
6. **性能考虑**：避免频繁发送大型对象到渲染进程

## 常见场景示例

### 配置系统
```typescript
class ConfigManager {
  updateLanguage(language: string) {
    this.saveConfig('language', language)
    // 明确通知所有窗口更新语言
    eventBus.send('config:language-changed', SendTarget.ALL_WINDOWS, language)
  }
}
```

### 通知系统
```typescript
class NotificationManager {
  showError(message: string) {
    // 仅向渲染进程发送通知显示事件
    eventBus.sendToRenderer('notification:show-error', SendTarget.ALL_WINDOWS, message)
  }
}
```

### 快捷键处理
```typescript
class ShortcutManager {
  handleGoSettings() {
    // 通知渲染进程跳转到设置页面
    eventBus.sendToRenderer('shortcut:go-settings', SendTarget.ALL_WINDOWS)
  }

  handleCleanHistory() {
    // 主进程清理历史，然后通知渲染进程更新UI
    this.cleanHistoryInMain()
    eventBus.sendToRenderer('shortcut:clean-chat-history', SendTarget.ALL_WINDOWS)
  }
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

## 🔧 调试技巧

### 1. 启用IPC日志

```bash
# 在开发环境中启用详细的IPC调用日志
VITE_LOG_IPC_CALL=1 pnpm run dev
```

这将显示：
- `[IPC Call] Tab:123 Window:456 -> presenterName.methodName`
- `[Renderer IPC] WebContents:789 -> presenterName.methodName`

### 2. 检查事件路由

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

### 3. 迁移现有代码

```bash
# 搜索可能过度广播的地方
grep -r "SendTarget.ALL_WINDOWS" src/
grep -r "sendToRenderer" src/

# 分析：这个事件真的需要所有窗口都知道吗？
# 替换：从广播改为精确路由
```
