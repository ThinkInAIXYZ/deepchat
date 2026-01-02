# 通用 Workspace 和 Agent 能力重构实施总结

## 概述

本次重构围绕“统一工具路由 + 通用 Workspace 视图 + Mode 化能力开关”推进：工具调用统一经 ToolPresenter/ToolMapper 管控，Agent 工具拆为 Yo Browser + Agent FileSystem（仅 agent 模式启用），ACP agent 仍走 ACP provider 内置工具流；Workspace UI 对 agent/acp agent 通用，路径选择与会话设置同步，并补齐安全边界与文件刷新机制。

## 架构概览

```mermaid
graph TB
    subgraph "Agent Loop"
        AL[AgentLoopHandler]
        TCP[ToolCallProcessor]
    end

    subgraph "统一工具路由"
        TP[ToolPresenter]
        TM[ToolMapper]
    end

    subgraph "工具源"
        MCP[MCP Tools]
        AGENT[Agent Tools (agent mode)]
    end

    subgraph "Agent 工具"
        YO[Yo Browser]
        FS[Agent FileSystem]
    end

    subgraph "Workspace"
        WS[WorkspaceView]
        FILES[Files Section]
        PLAN[Plan Section]
        TERM_UI[Terminal Section]
        BROWSER_UI[Browser Tabs Section]
    end

    AL --> TCP
    TCP --> TP
    TP --> TM
    TM --> MCP
    TM --> AGENT
    AGENT --> YO
    AGENT --> FS
    WS --> FILES
    WS --> PLAN
    WS --> TERM_UI
    WS --> BROWSER_UI
```

> Browser Tabs 仅在 agent 模式展示；acp agent 模式仍使用 ACP workdir 与 ACP provider 工具流。

## 已完成的工作

### 1. 统一工具路由架构 ✅

**实现文件**：
- `src/main/presenter/toolPresenter/index.ts`
- `src/main/presenter/toolPresenter/toolMapper.ts`

**功能**：
- `ToolPresenter` 统一汇总 MCP + Agent 工具，输出 MCP 规范 `MCPToolDefinition`
- `ToolMapper` 维护工具名 → 来源映射，冲突时优先 MCP
- 工具调用统一经 `ToolPresenter.callTool()`，参数解析失败时尝试 `jsonrepair`

### 2. Agent 工具管理 ✅

**实现文件**：
- `src/main/presenter/agentPresenter/acp/agentToolManager.ts`

**功能**：
- Agent 工具包含 Yo Browser + Agent FileSystem
- **仅在 `agent` 模式下注入**（`acp agent` 不注入 Agent 工具）
- Yo Browser 工具根据 `supportsVision` 动态注入
- 缺省工作目录生成于 `temp/deepchat-agent/workspaces`

### 3. Agent 文件系统能力 ✅

**实现文件**：
- `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts`

**功能**：
- 内置文件工具：`read_file`, `write_file`, `list_directory`, `create_directory`, `move_files`,
  `edit_text`, `glob_search`, `grep_search`, `text_replace`, `directory_tree`, `get_file_info`
- 强制路径白名单 + `realpath` 校验，阻断越界与 symlink 绕过
- 正则工具使用 `validateRegexPattern` 防 ReDoS；`text_replace`/`edit_text` 支持 diff
- 工具以 `agent-filesystem` server 标识返回

### 4. Chat Mode Switch 配置 ✅

**实现文件**：
- `src/renderer/src/components/chat-input/composables/useChatMode.ts`
- `src/renderer/src/components/chat-input/ChatInput.vue`

**功能**：
- `chatMode` 存储在 `input_chatMode`
- 无 ACP agents 时隐藏 `acp agent`，并自动回退到 `chat`
- `isAgentMode` 用于统一控制 UI 与工具注入

### 5. Workspace 组件通用化 ✅

**实现文件**：
- `src/main/presenter/workspacePresenter/index.ts`
- `src/renderer/src/stores/workspace.ts`
- `src/renderer/src/components/workspace/WorkspaceView.vue`
- `src/renderer/src/components/workspace/WorkspaceFiles.vue`
- `src/renderer/src/components/workspace/WorkspaceFileNode.vue`
- `src/renderer/src/components/workspace/WorkspacePlan.vue`
- `src/renderer/src/components/workspace/WorkspaceTerminal.vue`
- `src/renderer/src/components/workspace/WorkspaceBrowserTabs.vue`
- `src/renderer/src/components/ChatView.vue`

**功能**：
- Workspace UI 对 agent/acp agent 统一开放，Files/Plan/Terminal 共用
- agent 模式额外展示 Browser Tabs（Yo Browser）
- Store 根据 `chatMode` 选择 `workspacePresenter` 或 `acpWorkspacePresenter`
- 文件树按需展开（lazy loading），支持打开文件/定位路径/插入路径

### 6. Workspace 路径选择（统一化）✅

**实现文件**：
- `src/renderer/src/components/chat-input/composables/useAgentWorkspace.ts`

**功能**：
- `agent` 模式通过 `devicePresenter.selectDirectory` 选择目录
- `acp agent` 模式走 ACP workdir（`useAcpWorkdir`）
- 路径与会话设置同步（会话未创建时暂存并补写）

### 7. 模型选择逻辑更新 ✅

**实现文件**：
- `src/renderer/src/components/ModelChooser.vue`
- `src/renderer/src/components/ModelSelect.vue`

**功能**：
- `acp agent` 模式仅展示 ACP provider
- 其他模式隐藏 ACP provider

### 8. Agent Loop / 提示词与工具执行 ✅

**实现文件**：
- `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts`
- `src/main/presenter/agentPresenter/loop/toolCallProcessor.ts`
- `src/main/presenter/threadPresenter/utils/promptBuilder.ts`
- `src/main/presenter/threadPresenter/handlers/streamGenerationHandler.ts`

**功能**：
- `agent` 模式自动补全默认工作区并落库
- system prompt 在 `agent` 模式追加当前工作目录
- Yo Browser context 仅在 `agent` 模式下注入
- ACP provider 的 tool call 由 provider 侧执行，流中直接返回结果

### 9. Workspace 文件刷新机制 ✅

**实现文件**：
- `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts`
- `src/renderer/src/stores/workspace.ts`

**功能**：
- `agent-filesystem` 调用完成时触发 `WORKSPACE_EVENTS.FILES_CHANGED`
- Workspace Store 对文件刷新做防抖合并
- ACP provider 在流结束后触发刷新

### 10. 类型定义与 i18n ✅

**实现文件**：
- `src/shared/types/presenters/tool.presenter.d.ts`
- `src/shared/types/presenters/workspace.d.ts`
- `src/renderer/src/i18n/*/chat.json`
- `src/renderer/src/i18n/*/toolCall.json`

**功能**：
- ToolPresenter、Workspace、ChatMode 相关类型补齐
- 新增模式/Workspace/工具调用相关文案

## 关键文件

- `src/main/presenter/toolPresenter/index.ts`：统一工具定义与路由
- `src/main/presenter/agentPresenter/acp/agentToolManager.ts`：Agent 工具装配
- `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts`：文件系统工具实现
- `src/main/presenter/workspacePresenter/index.ts`：通用 Workspace Presenter
- `src/renderer/src/stores/workspace.ts`：Workspace 状态与事件同步
- `src/renderer/src/components/workspace/WorkspaceView.vue`：Workspace 入口 UI
- `src/renderer/src/components/chat-input/composables/useChatMode.ts`：Mode 管理
- `src/renderer/src/components/chat-input/composables/useAgentWorkspace.ts`：Workspace 路径选择

## 遗留/兼容

- `src/main/presenter/acpWorkspacePresenter/` 仍保留并在 `acp agent` 模式使用
- Renderer 的 ACP Workspace 旧组件已移除，统一使用通用 Workspace 组件

## 关键技术点

### 工具命名规范

- MCP 工具：保持原始命名
- Agent FileSystem 工具：不加前缀（`read_file` 等）
- Yo Browser：保留 `browser_` 前缀

### 工具路由机制

- ToolPresenter 统一输出 MCP 规范 `MCPToolDefinition`
- ToolMapper 维护工具名 → 来源映射，冲突时偏向 MCP
- Agent 工具参数解析失败时尝试 `jsonrepair`

### Agent 工具注入机制（基于 Mode）

- `chat`：仅 MCP 工具
- `agent`：MCP + Yo Browser + Agent FileSystem
- `acp agent`：MCP 工具；ACP provider 自执行工具调用

### 配置持久化

- `chatMode` 存储为 `input_chatMode`
- `agentWorkspacePath` 持久化到会话 `settings`
- `agent` 模式缺省路径自动写入会话设置

### Mode Switch 与 ACP Session Mode 的区别

- Chat Mode Switch：全局模式（chat/agent/acp agent）
- ACP Session Mode：ACP agent 内部会话模式，互不干扰

### 路径安全

- WorkspacePresenter：基于 `allowedWorkspaces` + `realpath` 限制访问
- AgentFileSystemHandler：路径白名单 + symlink 校验 + regex 安全验证

### 默认工作区路径

- `agent` 模式缺省使用 `temp/deepchat-agent/workspaces[/conversationId]`
- 路径会持久化到会话设置，供后续恢复

### 向后兼容

- ACP provider 与 ACP workspace 逻辑保留
- UI 统一收口到通用 Workspace 组件

## 如何测试

### Mode Switch

1. 进入 ChatInput，确认 `acp agent` 仅在配置 ACP agents 时出现
2. 切换模式，确认 UI 与模型列表同步更新

### Agent Workspace

1. 切换到 `agent` 模式，选择目录
2. 切换/重启应用后确认路径恢复
3. 切换到 `acp agent`，确认使用 ACP workdir

### 工具路由

1. `agent` 模式调用 `read_file` 等文件工具，确认走 Agent FileSystem
2. MCP 工具调用仍走 MCP Presenter
3. ACP provider 下 tool call 直接显示执行结果（不再本地执行）

### Workspace UI

1. `agent`/`acp agent` 模式下打开 Workspace
2. 文件树可展开并通过右键菜单打开/定位
3. Browser Tabs 仅在 `agent` 模式显示
4. 执行文件工具后文件树自动刷新

## 架构说明

### 数据流

```
ChatMode
  ↓
ChatInput (Mode Switch)
  ↓
AgentLoopHandler (resolve workspace & tools)
  ↓
ToolPresenter → ToolMapper → MCP/Agent tools
```

### Workspace 数据流

```
Workspace Path Select
  ↓
useAgentWorkspace / useAcpWorkdir
  ↓
WorkspacePresenter (register)
  ↓
WorkspaceStore
  ↓
WorkspaceView
```

### 工具调用流程

```
Agent Loop
  ↓
ToolCallProcessor
  ↓
ToolPresenter.callTool()
  ↓
MCP Presenter / AgentToolManager
  ↓
Tool response → Workspace refresh (agent-filesystem)
```

> ACP provider 的 tool call 由 provider 侧执行，流中直接返回结果。

## 注意事项

1. Agent 工具仅在 `agent` 模式生效，`acp agent` 走 ACP provider 工具流
2. Workspace 访问必须先注册允许路径
3. 正则相关工具调用需遵循安全限制（pattern 长度与验证）

## 未来扩展

1. Terminal 工具执行与 Workspace Terminal 的联动
2. 工具注入更细粒度控制（按需加载）
3. 工具去重策略可配置化
4. 多 Workspace 支持与模板化配置
