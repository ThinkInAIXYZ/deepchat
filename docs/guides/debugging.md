# 调试技巧

本文档提供各种调试技巧，帮助开发者快速定位和解决问题。

注意：

- 当前 renderer-main 主边界优先调试 `renderer/api/*Client`、`window.deepchat` 和 typed contracts
- 文中出现的 `window.api` 示例主要用于 legacy compatibility 场景，不应被视为新代码默认模式

## 🎯 主进程调试

### VSCode 调试配置

在 `.vscode/launch.json` 中添加：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Main Process",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron",
      "runtimeArgs": ["."],
      "cwd": "${workspaceFolder}",
      "skipFiles": ["<node_internals>/**"],
      "console": "integratedTerminal"
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["run", "test", "--run"],
      "cwd": "${workspaceFolder}",
      "console": "integratedTerminal"
    }
  ]
}
```

### 使用 Chrome DevTools

启动时自动打开 DevTools：

```typescript
// src/main/index.ts
app.whenReady().then(() => {
  mainWindow.webContents.openDevTools()
})
```

### 命令行调试

```bash
# 使用 inspect 参数启动
pnpm run dev:inspect

# 然后在 Chrome 中打开
chrome://inspect
```

## 🖥️ 渲染进程调试

### Chrome DevTools

**快捷键**：
- Windows/Linux: `Ctrl+Shift+I`
- macOS: `Cmd+Option+I`

### Vue DevTools

1. 安装扩展：[Vue.js devtools](https://devtools.vuejs.org/)
2. 在开发者模式的 Electron 中使用

### React DevTools（如适用）

如果有 React 组件，可以安装 React DevTools。

## 📝 日志系统

### 使用 logger

```typescript
import { logger } from '@/shared/logger'

// 不同级别
logger.debug('调试信息')
logger.info('普通信息')
logger.warn('警告信息')
logger.error('错误信息')

// 带数据
logger.info('用户消息', { id: '123', content: 'hello' })
```

### console.log 替代

```typescript
// 添加标识方便搜索
console.log('[AgentPresenter] sendMessage called', { agentId, content })

// 带时间戳
console.log(`[${new Date().toISOString()}] Starting Agent Loop`)

// 分组日志
console.group('Tool Execution')
console.log('Tool 1 started')
console.log('Tool 1 completed')
console.groupEnd()
```

### 条件日志

```typescript
// 使用环境变量控制
if (import.meta.env.VITE_DEBUG === '1') {
  console.log('[DEBUG] 详细日志')
}

// 使用 helper 函数
const DEBUG = process.env.NODE_ENV === 'development'
if (DEBUG) {
  console.log('[DEBUG] 上下文:', context)
}
```

## 🔍 事件调试

### 监听所有事件

```typescript
import { eventBus } from '@/eventbus'
import * as EVENTS from '@/events'

// 监听 STREAM_EVENTS
Object.values(EVENTS.STREAM_EVENTS).forEach(eventName => {
  eventBus.on(eventName, (...args) => {
    console.log(`[EventBus] ${eventName}:`, ...args)
  })
})

// 监听 CONVERSATION_EVENTS
Object.values(EVENTS.CONVERSATION_EVENTS).forEach(eventName => {
  eventBus.on(eventName, (...args) => {
    console.log(`[EventBus] ${eventName}:`, ...args)
  })
})
```

### 追踪特定事件

```typescript
// 追踪工具调用事件
eventBus.on(STREAM_EVENTS.RESPONSE, (data) => {
  if (data.tool_call) {
    console.log('[Tool Call]', {
      type: data.tool_call,
      name: data.tool_call_name,
      id: data.tool_call_id
    })
  }
})
```

## 🧪 单元测试调试

### VSCode 中测试

使用调试配置（见上方）启动测试调试。

### 命令行测试

```bash
# 监听模式（文件变化自动重新运行）
pnpm test:watch

# 单独运行某个测试文件
pnpm test -- ChatInput.test

# 显示详细输出
pnpm test -- --reporter=verbose

# 只运行匹配的测试
pnpm test -- --grep "sendMessage"
```

### 测试中添加 debug 语句

```typescript
test('sendMessage should create message', async () => {
  const result = await agentPresenter.sendMessage(...)
  console.log('[TEST] Result:', result)
  expect(result).toBeDefined()
})
```

## 🐛 常见问题调试

### 1. 消息发送后无响应

**排查步骤**：

```typescript
// 1. 检查消息是否创建
const message = await messageManager.getMessage(messageId)
console.log('Message created:', message)

// 2. 检查 Session 状态
const session = await sessionManager.getSession(conversationId)
console.log('Session status:', session.status)

// 3. 检查工具定义
const tools = await toolPresenter.getAllToolDefinitions(...)
console.log('Tools count:', tools.length)

// 4. 检查 EventBus 事件
eventBus.on(STREAM_EVENTS.RESPONSE, (data) => {
  console.log('Response event:', data)
})
eventBus.on(STREAM_EVENTS.ERROR, (data) => {
  console.log('Error event:', data)
})
```

**可能原因**：
- Session 未启动
- LLM Provider 配置错误
- 网络问题
- 工具定义为空

### 2. 工具调用失败

**排查步骤**：

```typescript
// 1. 检查工具路由
const source = toolMapper.getToolSource(toolName)
console.log('Tool source:', source)

// 2. 直接测试工具调用
try {
  const result = await toolPresenter.callTool(request)
  console.log('Tool result:', result)
} catch (error) {
  console.error('Tool error:', error)
}

// 3. 检查权限
const { granted } = await mcpPresenter.checkToolPermission(serverName, toolName)
console.log('Permission granted:', granted)
```

**可能原因**：
- 工具名称错误
- 参数格式错误
- 权限被拒绝
- MCP 服务器未运行

### 3. IPC 调用超时

**排查步骤**：

```typescript
// 1. 添加超时处理
const timeout = setTimeout(() => {
  console.error('[IPC] Timeout waiting for response')
}, 5000)

const response = await window.api.someMethod()
clearTimeout(timeout)

// 2. 检查 Preload 暴露
console.log('[IPC] Available methods:', Object.keys(window.api))
```

### 4. 内存泄漏

**工具**：
- Chrome DevTools Memory Profiler
- VSCode Memory Inspector

**方法**：

```typescript
// 检查 Map/Set 大小
console.log('[Memory] generatingMessages size:', generatingMessages.size)
console.log('[Memory] sessions size:', sessions.size)

// 清理测试
window.addEventListener('unload', () => {
  console.log('[Cleanup] Clearing resources')
})
```

### 5. 性能问题

**工具**：
- Chrome DevTools Performance Profiler
- VSCode Performance Profiler

**方法**：

```typescript
// 添加性能标记
performance.mark('loop-start')
// ... 代码执行 ...
performance.mark('loop-end')

performance.measure('Agent Loop', 'loop-start', 'loop-end')
const measures = performance.getEntriesByName('Agent Loop')
console.log('[Performance]', measures)
```

## 🔧 开发工具推荐

### VSCode 扩展

- **TypeScript Vue Plugin** - TS + Vue 支持
- **ESLint** - 代码检查
- **Prettier** - 代码格式化
- **GitLens** - Git 增强
- **Inline Bookmarks** - 在代码中标记位置

### Chrome 扩展

- **Vue.js devtools** - Vue 组件调试
- **React Developer Tools** - React 调试（如使用）
- **Redux DevTools** - 状态调试

### 命令行工具

- **jq** - JSON 处理
- **ripgrep (rg)** - 快速代码搜索
- **fd** - 快速文件查找

## 🎓 调试技巧总结

### 快速定位问题

1. **查看日志** - 检查 console输出
2. **使用断点** - 在关键位置设置断点
3. **事件追踪** - 监听相关事件
4. **单步执行** - 使用 Debug 逐步执行

### 常用断点位置

```typescript
// 在关键流程中添加断点
// 1. 消息发送
agentPresenter.sendMessage(args)

// 2. Agent Loop 启动
sessionManager.startLoop(conversationId, messageId)

// 3. 工具调用
toolPresenter.callTool(request)

// 4. 权限检查
checkToolPermission(serverName, toolName)
```

### 日志最佳实践

```typescript
// 添加模块标识
console.log('[AgentPresenter] Action:', { agentId, action })

// 使用对象展开避免大量字符串拼接
console.log('[ToolExecution]', {
  toolName,
  args,
  duration: Date.now() - start,
  success: true
})

// 条件日志
if (DEBUG) {
  console.log('[DEBUG] Context:', JSON.stringify(context, null, 2))
}

// 日志分组
console.group('Agent Loop Iteration', iteration)
console.log('Messages:', messages.length)
console.log('Tools:', tools.length)
console.groupEnd()
```

## 🐞 生产环境调试

### 错误日志收集

```typescript
// 在生产环境中收集错误
window.addEventListener('error', (event) => {
  logger.error('Uncaught error:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno
  })
})
```

### 远程调试

```bash
# 启动时启用远程调试
ELECTRON_ENABLE_LOGGING=1 pnpm run dev

# 然后在 Chrome 中连接
# chrome://inspect
```

## 📚 进一步学习

- [Chrome DevTools 文档](https://developer.chrome.com/docs/devtools/)
- [Electron 调试文档](https://www.electronjs.org/docs/latest/tutorial/debugging-main-process)
- [VSCode 调试文档](https://code.visualstudio.com/docs/editor/debugging)

---

 happy debugging! 🎉
