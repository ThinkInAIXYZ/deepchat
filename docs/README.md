# DeepChat 文档索引

本文档提供 DeepChat 项目的文档导航，帮助开发者快速找到所需信息。

## 📚 文档结构

```
docs/
├── README.md                    # 本文档（文档索引）
├── ARCHITECTURE.md              # 整体架构概览
├── FLOWS.md                     # 核心流程时序图
│
├── architecture/                # 详细架构文档
│   ├── session-management.md    # 会话管理详解
│   ├── agent-system.md          # Agent 系统详解
│   ├── tool-system.md           # 工具系统详解
│   ├── event-system.md          # 事件系统详解
│   └── mcp-integration.md       # MCP 集成详解
│
├── guides/                      # 开发者指南
│   ├── getting-started.md       # 快速入门
│   ├── code-navigation.md       # 代码导航指南
│   └── debugging.md             # 调试技巧
│
└── archives/                    # 归档文档
    ├── thread-presenter-migration.md
    └── workspace-refactoring.md
```

## 🚀 快速开始

### 新开发者路线图

1. **了解整体架构** → 阅读 [ARCHITECTURE.md](./ARCHITECTURE.md)
2. **理解核心流程** → 阅读 [FLOWS.md](./FLOWS.md) 中的前 3 个流程
3. **选择感兴趣的模块** → 阅读对应的 architecture 文档
4. **开始开发** → 参考 guides/ 中的实用指南

### 按任务查找文档

| 任务 | 推荐文档 |
|------|---------|
| 了解项目结构 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 理解消息发送流程 | [FLOWS.md - 发送消息流程](./FLOWS.md#1-发送消息完整流程) |
| 理解工具调用机制 | [FLOWS.md - 工具调用流程](./FLOWS.md#3-工具调用流程) + [tool-system.md](./architecture/tool-system.md) |
| 理解 Agent Loop | [FLOWS.md - Agent Loop 流程](./FLOWS.md#2-agent-loop-详细流程) + [agent-system.md](./architecture/agent-system.md) |
| 添加新工具 | [tool-system.md](./architecture/tool-system.md) + [agent-system.md](./architecture/agent-system.md) |
| 处理权限请求 | [FLOWS.md - 权限请求流程](./FLOWS.md#4-权限请求与响应流程) + [agent-system.md](./architecture/agent-system.md#-permissionhandler---权限协调) |
| 会话管理功能 | [session-management.md](./architecture/session-management.md) |
| 事件系统使用 | [event-system.md](./architecture/event-system.md) |
| MCP 集成 | [mcp-integration.md](./architecture/mcp-integration.md) |
| 快速定位代码 | [code-navigation.md](./guides/code-navigation.md) |
| 调试技巧 | [debugging.md](./guides/debugging.md) |

## 📖 详细内容

### 核心架构文档

#### [ARCHITECTURE.md](./ARCHITECTURE.md)

整体架构概览，提供：
- 核心组件关系图
- 分层架构说明
- 关键数据流
- 核心文件位置速查表

**适合人群**：所有新开发者

#### [FLOWS.md](./FLOWS.md)

使用时序图详细描述核心流程：
1. **发送消息流程** - 完整的用户消息处理流程
2. **Agent Loop 流程** - Agent 主循环的详细执行逻辑
3. **工具调用流程** - 工具名称路由和执行
4. **权限请求流程** - 权限请求/批准/拒绝的完整流程
5. **会话生命周期** - 会话状态转换图
6. **继续生成流程** - 从断点恢复生成的流程

**适合人群**：需要理解系统运行时行为的开发者

### 深度架构文档

#### [session-management.md](./architecture/session-management.md)

会话管理详细解析：
- SessionPresenter 的所有方法
- SessionContext 的结构和生命周期
- ConversationManager 和 MessageManager 的职责
- Tab 绑定机制
- 会话分支和消息变体

**关键文件**：
- SessionPresenter: `src/main/presenter/sessionPresenter/index.ts:1-900`
- SessionManager: `src/main/presenter/sessionPresenter/session/sessionManager.ts:1-245`

#### [agent-system.md](./architecture/agent-system.md)

Agent 系统详细解析：
- AgentPresenter 主入口方法
- agentLoopHandler 主循环（670 行）
- streamGenerationHandler 流生成协调（645 行）
- loopOrchestrator 和 toolCallProcessor
- llmEventHandler 和 permissionHandler
- messageBuilder 和 contentBufferHandler

**关键文件**：
- AgentPresenter: `src/main/presenter/agentPresenter/index.ts:1-472`
- agentLoopHandler: `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts:145-668`
- streamGenerationHandler: `src/main/presenter/agentPresenter/streaming/streamGenerationHandler.ts:54-645`

#### [tool-system.md](./architecture/tool-system.md)

工具系统详细解析：
- ToolPresenter 统一工具路由
- ToolMapper 名称映射机制
- McpPresenter MCP 集成
- Agent 工具（文件系统 + Browser）
- 权限系统和配置
- 工具调用事件流

**关键文件**：
- ToolPresenter: `src/main/presenter/toolPresenter/index.ts:1-161`
- McpPresenter: `src/main/presenter/mcpPresenter/index.ts`
- AgentToolManager: `src/main/presenter/agentPresenter/acp/agentToolManager.ts:1-577`
- AgentFileSystemHandler: `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts:1-960`

#### [event-system.md](./architecture/event-system.md)

事件系统详细解析：
- EventBus 的 6 种通信模式
- 事件常量分类和用途
- 关键事件流向示例
- 在渲染进程监听事件

**关键文件**：
- EventBus: `src/main/eventbus.ts:1-152`
- events.ts: `src/main/events.ts:1-263`

#### [mcp-integration.md](./architecture/mcp-integration.md)

MCP (Model Context Protocol) 集成详解：
- MCP 服务器管理
- MCP 工具定义和调用
- 权限系统
- Session 恢复机制
- 配置管理

**关键文件**：
- McpPresenter: `src/main/presenter/mcpPresenter/index.ts`
- ServerManager: `src/main/presenter/mcpPresenter/serverManager.ts`
- ToolManager: `src/main/presenter/mcpPresenter/toolManager.ts`

### 开发者指南

#### [getting-started.md](./guides/getting-started.md)

快速入门指南：
- 开发环境设置
- 项目目录结构
- 开发工作流
- 首次提交指南
- 常用命令

#### [code-navigation.md](./guides/code-navigation.md)

代码导航指南：
- 按功能查找代码
- Presenter 之间的关系
- 渲染进程代码结构
- 类型定义位置
- 调试技巧

#### [debugging.md](./guides/debugging.md)

调试技巧：
- 日志系统使用
- 主进程调试
- 渲染进程调试
- 常见问题排查

## 📂 目录结构速查

```
src/
├── main/                           # 主进程代码
│   ├── presenter/                  # Presenter 层（核心业务逻辑）
│   │   ├── agentPresenter/         # Agent 编排器
│   │   ├── sessionPresenter/       # 会话管理
│   │   ├── toolPresenter/          # 工具路由
│   │   ├── mcpPresenter/           # MCP 集成
│   │   ├── llmProviderPresenter/   # LLM 提供商
│   │   ├── configPresenter/        # 配置管理
│   │   ├── windowPresenter/        # 窗口管理
│   │   ├── tabPresenter/           # 标签管理
│   │   └── ...                     # 其他 Presenter
│   ├── eventbus.ts                 # 事件总线
│   ├── events.ts                   # 事件常量
│   └── index.ts                    # 主入口
│
├── renderer/                       # 渲染进程代码
│   ├── src/                        # Vue 应用
│   │   ├── components/             # Vue 组件
│   │   ├── stores/                 # Pinia Store
│   │   ├── views/                  # 页面
│   │   ├── i18n/                   # 国际化
│   │   └── lib/                    # 工具库
│   └── floating/                   # 浮动按钮
│
├── preload/                        # Preload 脚本
│   └── index.ts
│
└── shared/                         # 共享代码
    ├── chat.d.ts                   # 聊天相关类型
    ├── presenter.d.ts              # Presenter 接口
    └── types/                      # 共享类型
```

## 🎯 按功能查找代码

### 发送消息相关
- 入口：`src/main/presenter/agentPresenter/index.ts:139-176`
- 流生成启动：`src/main/presenter/agentPresenter/streaming/streamGenerationHandler.ts:54-179`
- Agent Loop：`src/main/presenter/agentPresenter/loop/agentLoopHandler.ts:145-668`

### 工具调用相关
- 工具路由：`src/main/presenter/toolPresenter/index.ts:49-160`
- MCP 工具：`src/main/presenter/mcpPresenter/index.ts`
- Agent 文件系统：`src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts:1-960`
- 工具执行：`src/main/presenter/agentPresenter/loop/toolCallProcessor.ts:1-445`

### 会话管理相关
- SessionPresenter：`src/main/presenter/sessionPresenter/index.ts:1-900`
- 会话上下文：`src/main/presenter/sessionPresenter/session/sessionManager.ts:1-245`
- 消息管理：`src/main/presenter/sessionPresenter/managers/messageManager.ts`
- 会话管理：`src/main/presenter/sessionPresenter/managers/conversationManager.ts`

### 权限相关
- 权限协调：`src/main/presenter/agentPresenter/permission/permissionHandler.ts`
- MCP 权限：`src/main/presenter/mcpPresenter/toolManager.ts`
- 命令权限：`src/main/presenter/permission/commandPermissionService.ts`

### 搜索功能
- SearchPresenter：`src/main/presenter/searchPresenter/index.ts`
- SearchManager：`src/main/presenter/searchPresenter/managers/searchManager.ts`

### Workspace
- WorkspacePresenter：`src/main/presenter/workspacePresenter/index.ts`
- WorkspaceStore（渲染进程）：`src/renderer/src/stores/workspace.ts`

## 🔍 类型定义位置

| 类型 | 文件位置 |
|------|---------|
| Presenter 接口 | `src/shared/presenter.d.ts` |
| 聊天消息类型 | `src/shared/chat.d.ts` |
| 会话相关 | `src/shared/chat.d.ts` + `src/shared/types/core/session.d.ts` |
| MCP 类型 | `src/main/presenter/mcpPresenter/mcpTypes.ts` |
| ACP 类型 | `src/main/presenter/agentPresenter/acp/types.ts` |
| LLM 相关 | `src/shared/types/core/llm.d.ts` |

## 📝 历史文档

归档目录 `archives/` 中包含：
- **thread-presenter-migration.md** - ThreadPresenter 到 SessionPresenter 的迁移方案
- **workspace-refactoring.md** - Workspace 和 Agent 能力重构总结

这些文档是历史记录，不反应当前架构，仅供参考。

## 🤝 贡献指南

### 更新文档

当修改代码架构时：
1. 更新相应的 architecture 文档
2. 更新核心文件位置（行数可能会变化）
3. 更新 ARCHITECTURE.md 中的文件位置表
4. 更新关键流程图（如适用）

### 文档规范

- 使用中文编写
- 每个文档控制在 400-600 行
- 标明关键文件位置（路径 + 行数）
- 使用 Mermaid 图表（必要时）
- 重点关注"是什么"和"在哪"，具体逻辑让读者看代码

## 📞 获取帮助

- 查看 [开发者指南](./guides/) 中的实用文档
- 参考代码注释
- 查看源代码本身

---

**提示**：本文档是文档的入口点，建议从这里开始阅读，然后根据需要深入特定模块。
