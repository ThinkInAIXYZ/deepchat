## Claude CLI 交互终端 Agent（xterm + node-pty）设计说明

本设计在现有 Agent 体系上新增一个基于 xterm 的“命令行 Agent”，启动后直接进入 Claude Code 交互会话（命令 `claude`），并将终端中的用户输入与程序输出记录到现有 chat 会话的数据结构中，便于回顾与检索。

### 目标

- 在渲染层提供交互式命令行（xterm）视图，自动启动 Claude Code。
- 支持配置工作目录（working directory）与可选参数（extraArgs）。
- 终端的输入/输出双向桥接：
  - 渲染层捕获输入，主进程写入 PTY；
  - 主进程监听 PTY 输出，通过 EventBus 广播到渲染层，同时写入 chat 持久化结构。
- 保持与现有 IPC/Presenter/EventBus 框架一致，遵循安全隔离与最小耦合。

### 架构总览

- Renderer（Vue 3）：
  - `TerminalAgentView.vue`：xterm 容器与输入监听，调用 `terminalPresenter` 的 `startSession`/`write`/`stop`。
  - `AgentTabView.vue`：当 `agentType === 'claude-cli'` 时渲染终端 Agent。
  - 通过 `usePresenter`（上下文隔离）调用主进程接口；通过 `EventBus` 订阅 `terminal:output` 等事件渲染输出。

- Main（Electron 主进程）：
  - `TerminalPresenter`：使用 `node-pty` 启动 PTY 会话（`claude`），维护会话 Map；向渲染层广播输出，同时将输入/输出写入 chat：
    - 输入：每次用户回车或显式调用 `write` 时，写入一条 `role: 'user'` 消息。
    - 输出：缓冲并按行/块写入 `role: 'assistant'` 消息。
  - `AgentFlowPresenter`：新增 `claude-cli` 类型的 Provider（`ClaudeCliProvider`），用于 Agent 可用性检测（`check()` 执行 `claude -h`）。

- 数据持久化（与既有 chat 对齐）：
  - 复用 `ThreadPresenter`/`SQLitePresenter` 的 messages 表结构；将命令行输入/输出作为独立消息保存（`user`/`assistant`）。
  - 会话创建：`TerminalAgentView` 首次启动时通过 `threadPresenter.createConversation(...)` 创建一个 `providerId: 'agent:claude-cli'`、`modelId: 'claude-cli'` 的会话，并将会话 ID 传入 `TerminalPresenter.startSession`。

### 事件与 IPC 设计

- 新增事件（main → renderer）：
  - `terminal:output`：{ sessionId, data } — PTY 输出块
  - `terminal:exit`：{ sessionId, code, signal }

- Renderer → Main（通过 `usePresenter('terminalPresenter')`）：
  - `startSession(conversationId, options)`：返回 `sessionId`
  - `write(sessionId, data)`：写入 PTY；按需持久化输入
  - `resize(sessionId, cols, rows)`：调整终端尺寸
  - `stop(sessionId)`：结束会话

### xterm 集成要点（参考 xterm 文档）

- 使用 `@xterm/xterm` 创建 Terminal 实例，设置 `fontFamily`、`fontSize`、`cursorBlink` 等；
- 使用 `fit`/自适应（后续可引入 `xterm-addon-fit`）；
- 捕获 `onData`/`onKey`，在回车或粘贴时调用 `write(sessionId, data)`；
- 监听 `terminal:output` 事件，调用 `terminal.write(data)` 渲染到 UI。

文档参考：

- xterm: [xterm.js 文档](https://xtermjs.org/docs/)
- Claude Code: [Claude Code Quickstart](https://docs.anthropic.com/en/docs/claude-code/quickstart)

### Agent 配置项（`AgentSettings.vue` 扩展）

- `type: 'claude-cli'`
- `config`:
  - `workingDir: string`（工作目录，必填）
  - `extraArgs?: string`（额外命令行参数，可选），例如：`-p "analyze the project"` 或 `--some-flag`

### 数据落盘策略

- `startSession` 时写入一条 system 消息（“Session started in <cwd>”）。
- 每次用户输入（回车）写入一条 `user` 消息。
- PTY 输出以块流式累积，按时间片或换行阈值写入 `assistant` 消息，避免消息过碎；退出时再写入一条 `system` 消息（退出码）。

### 后续可选优化

- 引入 `xterm-addon-fit` 与 `xterm-addon-web-links` 提升体验。
- 提供“导出会话为 Markdown/HTML”的能力（复用 `ThreadPresenter.exportConversation`）。
- 在 Agent 视图中增加“打开对应会话”入口，跳转到 Chat 视图查看完整记录。

### 代码组织

- Main
  - `src/main/presenter/terminalPresenter/index.ts`
  - `src/main/presenter/agentFlowPresenter/providers/claudeCliProvider.ts`

- Renderer
  - `src/renderer/src/components/agent/TerminalAgentView.vue`
  - `src/renderer/src/views/AgentTabView.vue`（条件渲染）
  - 设置扩展：`AgentSettings.vue`、`AgentSelectorDialog.vue`

### 安全与最佳实践

- 按项目规则继续启用上下文隔离；所有进程间通信经 `usePresenter` 与 EventBus；
- 不暴露直接 Node 能力到渲染层；
- 终端输入写入前可增加白名单或确认（后续可选）。


