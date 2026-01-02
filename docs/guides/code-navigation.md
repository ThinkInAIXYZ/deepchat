# 代码导航指南

本文档帮助开发者快速定位代码，按功能、按组件查找代码位置。

## 🗺️ 整体代码地图

```
deepchat/
├── src/
│   ├── main/presenter/           ← 核心业务逻辑（从这里开始搜索）
│   ├── renderer/src/            ← Vue UI 组件
│   ├── preload/                 ← IPC 接口
│   └── shared/                  ← 共享类型定义
```

## 🔍 按功能查找代码

### 消息发送相关

| 功能 | 文件位置 | 关键类/方法 |
|------|---------|-----------|
| 发送消息入口 | `src/main/presenter/agentPresenter/index.ts:139-176` | `sendMessage()` |
| 创建用户消息 | `src/main/presenter/sessionPresenter/managers/messageManager.ts` | `sendMessage()` |
| 创建助手消息 | `src/main/presenter/agentPresenter/streaming/streamGenerationHandler.ts:574-612` | `generateAIResponse()` |
| 准备上下文 | `src/main/presenter/agentPresenter/streaming/streamGenerationHandler.ts:352-474` | `prepareConversationContext()` |
| 构建提示词 | `src/main/presenter/agentPresenter/message/messageBuilder.ts` | `preparePromptContent()` |

### Agent Loop 相关

| 功能 | 文件位置 | 关键类/方法 |
|------|---------|-----------|
| Agent Loop 主循环 | `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts:145-668` | `startStreamCompletion()` |
| 循环编排器 | `src/main/presenter/agentPresenter/loop/loopOrchestrator.ts` | `LoopOrchestrator.consume()` |
| 工具调用处理 | `src/main/presenter/agentPresenter/loop/toolCallProcessor.ts:1-445` | `process()` |
| 工具调用 UI 管理 | `src/main/presenter/agentPresenter/loop/toolCallHandler.ts` | `handleToolCallEvent()` |

### 流式响应相关

| 功能 | 文件位置 | 关键类/方法 |
|------|---------|-----------|
| 流生成协调 | `src/main/presenter/agentPresenter/streaming/streamGenerationHandler.ts:54-645` | `startStreamCompletion()` |
| LLM 事件处理 | `src/main/presenter/agentPresenter/streaming/llmEventHandler.ts` | `handleResponse()` |
| 内容缓冲 | `src/main/presenter/agentPresenter/streaming/contentBufferHandler.ts` | `accumulate()` |

### 工具调用相关

| 功能 | 文件位置 | 关键类/方法 |
|------|---------|-----------|
| 统一工具路由 | `src/main/presenter/toolPresenter/index.ts:49-160` | `getAllToolDefinitions()`, `callTool()` |
| 工具名称映射 | `src/main/presenter/toolPresenter/toolMapper.ts` | `ToolMapper` |
| MCP 集成 | `src/main/presenter/mcpPresenter/index.ts` | `McpPresenter` |
| Agent 文件系统 | `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts:1-960` | 工具实现 |
| Agent 工具管理 | `src/main/presenter/agentPresenter/acp/agentToolManager.ts:1-577` | `AgentToolManager` |

### 会话管理相关

| 功能 | 文件位置 | 关键类/方法 |
|------|---------|-----------|
| SessionPresenter | `src/main/presenter/sessionPresenter/index.ts:1-900` | 主入口 |
| 会话上下文 | `src/main/presenter/sessionPresenter/session/sessionManager.ts:1-245` | `SessionManager` |
| 消息管理 | `src/main/presenter/sessionPresenter/managers/messageManager.ts` | `MessageManager` |
| 会话管理 | `src/main/presenter/sessionPresenter/managers/conversationManager.ts` | `ConversationManager` |

### 权限相关

| 功能 | 文件位置 | 关键类/方法 |
|------|---------|-----------|
| 权限协调 | `src/main/presenter/agentPresenter/permission/permissionHandler.ts` | `handlePermissionResponse()` |
| MCP 权限 | `src/main/presenter/mcpPresenter/toolManager.ts` | `checkToolPermission()` |
| 命令权限 | `src/main/presenter/permission/commandPermissionService.ts` | `CommandPermissionService` |

### 搜索相关

| 功能 | 文件位置 | 关键类/方法 |
|------|---------|-----------|
| SearchPresenter | `src/main/presenter/searchPresenter/index.ts` | 主入口 |
| SearchManager | `src/main/presenter/searchPresenter/managers/searchManager.ts` | 搜索管理 |

### 配置相关

| 功能 | 文件位置 | 关键类/方法 |
|------|---------|-----------|
| ConfigPresenter | `src/main/presenter/configPresenter/index.ts` | 主入口 |
| 用户设置 | `src/main/presenter/configPresenter/userSettings.ts` | 用户设置 |
| 模型配置 | `src/main/presenter/configPresenter/modelConfig.ts` | 模型配置 |

### UI 相关（渲染进程）

| 功能 | 文件位置 | 组件 |
|------|---------|------|
| 聊天输入 | `src/renderer/src/components/chat-input/ChatInput.vue` | ChatInput |
| 聊天消息 | `src/renderer/src/components/chat/ChatView.vue` | ChatView |
| 消息列表 | `src/renderer/src/components/chat/MessageList.vue` | MessageList |
| 工具调用块 | `src/renderer/src/components/chat/ToolCallMessage.vue` | ToolCallMessage |
| 会话列表 | `src/renderer/src/components/thread/ThreadList.vue` | ThreadList |
| 设置页面 | `src/renderer/src/settings/SettingsView.vue` | SettingsView |

## 🗂️ 按组件查找代码

### Presenter 层

所有 Presenter 都在 `src/main/presenter/` 下：

```
presenter/
├── agentPresenter/         # Agent 编排器
│   ├── loop/               # Agent Loop
│   │   ├── agentLoopHandler.ts
│   │   ├── loopOrchestrator.ts
│   │   ├── toolCallProcessor.ts
│   │   └── errorClassification.ts
│   ├── streaming/          # 流处理
│   │   ├── streamGenerationHandler.ts
│   │   ├── llmEventHandler.ts
│   │   └── contentBufferHandler.ts
│   ├── session/            # 会话上下文
│   │   ├── sessionManager.ts
│   │   └── sessionContext.ts
│   ├── message/            # 消息处理
│   │   ├── messageBuilder.ts
│   │   └── messageFormatter.ts
│   ├── permission/         # 权限
│   │   └── permissionHandler.ts
│   └── ...
│
├── sessionPresenter/       # 会话管理
│   ├── managers/           # 管理器
│   │   ├── messageManager.ts
│   │   └── conversationManager.ts
│   └── ...
│
├── toolPresenter/          # 工具路由
│   ├── toolMapper.ts
│   └── ...
│
├── mcpPresenter/           # MCP 集成
│   ├── serverManager.ts
│   ├── toolManager.ts
│   └── ...
│
├── llmProviderPresenter/   # LLM 提供商
│   ├── providers/          # 各提供商实现
│   └── ...
│
├── configPresenter/        # 配置
├── windowPresenter/        # 窗口
├── tabPresenter/           # 标签
└── ...
```

### 渲染进程组件

```
renderer/src/
├── components/             # 可复用组件
│   ├── chat/               # 聊天相关
│   ├── chat-input/         # 输入框
│   ├── thread/             # 会话列表
│   ├── settings/           # 设置页面
│   └── ...
│
├── views/                  # 页面
│   ├── ChatView.vue        # 聊天页面
│   ├── SettingsView.vue    # 设置页面
│   └── ...
│
├── stores/                 # Pinia Store
│   ├── chat.ts             # 聊天状态
│   ├── thread.ts           # 会话状态
│   ├── settings.ts         # 设置状态
│   └── ...
│
├── i18n/                   # 国际化
│   ├── zh-CN/
│   ├── en-US/
│   └── ...
│
└── lib/                    # 工具库
```

### 共享类型

```
shared/
├── presenter.d.ts          # Presenter 接口
├── chat.d.ts               # 聊天消息类型
└── types/                  # 共享类型
    ├── core/
    │   ├── session.d.ts    # 会话类型
    │   ├── llm.d.ts        # LLM 类型
    │   └── ...
```

## 🔎 搜索技巧

### IDE 搜索

**VSCode 全局搜索**（Ctrl+Shift+F）：
- 搜索文件名：输入 `*.ts` 或 `*.vue`
- 搜索类名：输入 `class AgentPresenter`
- 搜索方法：输入 `async sendMessage`
- 搜索事件：输入 `STREAM_EVENTS.RESPONSE`

**跳转到定义**（F12）：
- 点击类名查看定义
- 点击方法跳转到实现

### 命令行搜索

```bash
# 搜索包含特定内容的文件
grep -r "sendMessage" src/main/presenter/

# 搜索文件名
find src/main -name "*Handler.ts"

# 搜索 TypeScript 文件
find src -name "*.ts"
```

### 按类型定义搜索

**查找接口定义**：
```
1. 查找 IAgentPresenter: shared/presenter.d.ts
2. 查找 ISessionPresenter: shared/presenter.d.ts
3. 查找 IMCPPresenter: shared/presenter.d.ts
```

**查找消息类型**：
```
1. 查找 Message: shared/chat.d.ts
2. 查找 AssistantMessage: shared/chat.d.ts
3. 查找 UserMessage: shared/chat.d.ts
```

## 📊 文件复杂度参考

| 文件 | 行数 | 复杂度 | 说明 |
|------|------|--------|------|
| `sessionPresenter/index.ts` | 900 | 高 | 会话管理主入口 |
| `agentPresenter/index.ts` | 472 | 中 | Agent 编排入口 |
| `agentLoopHandler.ts` | 670 | 高 | Agent Loop 核心循环 |
| `streamGenerationHandler.ts` | 645 | 高 | 流生成协调 |
| `AgentFileSystemHandler.ts` | 960 | 高 | 文件系统工具 |
| `AgentToolManager.ts` | 577 | 中 | Agent 工具管理 |
| `ToolPresenter/index.ts` | 161 | 低 | 工具路由主入口 |
| `McpPresenter/index.ts` | ~500 | 中 | MCP 集成 |

## 🎯 快速定位常用功能

### 我想...找到 sendMessage 的完整流程

1. 入口：`agentPresenter/index.ts:139-176`
2. 消息创建：`sessionPresenter/managers/messageManager.ts`
3. Loop 启动：`sessionPresenter/session/sessionManager.ts:140-150`
4. 流生成启动：`agentPresenter/streaming/streamGenerationHandler.ts:54-179`
5. Agent Loop：`agentPresenter/loop/agentLoopHandler.ts:145-668`

### 我想...理解工具调用

1. 工具路由：`toolPresenter/index.ts:104-160`
2. 工具名称映射：`toolPresenter/toolMapper.ts`
3. MCP 工具：`mcpPresenter/index.ts`
4. Agent 工具：`agentPresenter/acp/agentToolManager.ts:1-577`
5. 工具执行：`agentPresenter/loop/toolCallProcessor.ts:1-445`

### 我想...理解会话管理

1. 主入口：`sessionPresenter/index.ts:1-900`
2. 会话上下文：`sessionPresenter/session/sessionManager.ts:1-245`
3. 消息管理：`sessionPresenter/managers/messageManager.ts`
4. 会话管理：`sessionPresenter/managers/conversationManager.ts`

### 我想...找到某个事件的发送位置

1. 查看事件常量：`src/main/events.ts`
2. 搜索事件名：`grep -r "EVENT_NAME" src/main/presenter/`
3. 查看发送代码：
```bash
# 示例：查找 STREAM_EVENTS.RESPONSE
grep -r "STREAM_EVENTS.RESPONSE" src/main/presenter/
```

### 我想...找到某个 Vue 组件

```bash
# 示例：查找 ChatInput
find src/renderer/src -name "*ChatInput*"

# 结果：src/renderer/src/components/chat-input/ChatInput.vue
```

### 我想...理解类型定义

1. Presenter 接口：`src/shared/presenter.d.ts`
2. 聊天消息类型：`src/shared/chat.d.ts`
3. 会话类型：`src/shared/types/core/session.d.ts`
4. MCP 类型：`src/main/presenter/mcpPresenter/mcpTypes.ts`

## 🔧 常用查找命令

```bash
# 查找 "sendMessage" 的所有定义
grep -rn "sendMessage" src/main/presenter --include="*.ts"

# 查找 "callTool" 的所有调用
grep -rn "callTool" src/main/presenter --include="*.ts"

# 查找事件发送
grep -rn "eventBus.send" src/main/presenter --include="*.ts"

# 查找 Presenter 实例化
grep -rn "new.*Presenter" src/main/presenter/index.ts

# 查找所有 .ts 文件
find src/main/presenter -name "*.ts"

# 查找所有 .vue 文件
find src/renderer/src -name "*.vue"

# 查找测试文件
find test -name "*.test.ts"
```

## 📖 进一步阅读

- [整体架构概览](../ARCHITECTURE.md)
- [核心流程](../FLOWS.md)
- [调试技巧](./debugging.md)

---

**提示**：理解代码结构后，建议阅读源代码本身，注释很详细。
