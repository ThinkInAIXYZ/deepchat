# DeepChat 贡献指南

我们非常欢迎您的贡献！我们希望让参与 DeepChat 项目变得简单透明。您可以通过以下方式参与：

- 报告 Bug
- 讨论当前代码状态
- 提交修复
- 提出新功能
- 成为项目维护者

## 开发流程

我们使用 GitHub 来托管代码、跟踪问题和功能请求，以及接受 Pull Request。

### 项目组内部贡献者

#### Bug 修复和小型功能改进

- 直接在 `dev` 分支上进行开发
- 提交到 `dev` 分支的代码必须确保：
  - 功能基本正常
  - 无编译错误
  - 至少能够 `pnpm run dev` 正常启动

#### 大型功能新增或重构

- 创建新的功能分支，命名格式为 `feature/featurename`
- 开发完成后将功能分支合并到 `dev` 分支

### 外部贡献者

1. Fork 本仓库到您的个人账号
2. 从 `dev` 分支创建您的开发分支
3. 在您的 Fork 仓库中进行开发
4. 完成后向原仓库的 `dev` 分支提交 Pull Request
5. 在 PR 描述中说明修复的 Issue（如适用）

## 本地开发环境设置

1. 克隆仓库：

   ```bash
   git clone https://github.com/ThinkInAIXYZ/deepchat.git
   cd deepchat
   ```

2. 安装必要的开发工具:

   - 安装 [Node.js](https://nodejs.org/) (推荐使用最新的 LTS 版本)

3. 根据您的操作系统进行额外设置:

   **Windows:**

   - 安装 Windows Build Tools:
     图形化安装:
     - 安装 [Visual Studio Community](https://visualstudio.microsoft.com/vs/community/)
     - 在安装时选择"使用 C++ 的桌面开发"工作负载
     - 确保选中"Windows 10/11 SDK"和"MSVC v143 生成工具"组件（推荐使用最新版本 Vistual Studio 2022)
   - 安装 Git for Windows

   **macOS:**

   - 安装 Xcode Command Line Tools:
     ```bash
     xcode-select --install
     ```
   - 推荐使用 Homebrew 包管理器:
     ```bash
     /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
     ```

   **Linux:**

   - 安装必要的构建依赖:
     ```bash
     # Ubuntu/Debian
     sudo apt-get install build-essential git
     # Fedora
     sudo dnf groupinstall "Development Tools"
     sudo dnf install git
     ```

4. 安装项目依赖：

   ```bash
   pnpm install
   pnpm run installRuntime
   ```

5. 启动开发服务器：
```bash
pnpm run dev
```

## 项目结构

- `src/main/`：Electron 主进程。Presenter 全部集中于此（window/tab/thread/config/llmProvider/mcp/knowledge/sync/浮窗/deeplink/OAuth 等）。
- `src/preload/`：开启 contextIsolation 的 IPC 桥，只暴露白名单 API 给渲染进程。
- `src/renderer/`：Vue 3 + Pinia 应用。业务代码在 `src/renderer/src`（components、stores、views、lib、i18n），Shell UI 在 `src/renderer/shell/`。
- `src/shared/`：主渲染共享的类型、工具和 presenter 契约。
- `runtime/`：随应用发布的 MCP/Agent 运行时（Node/uv）。
- `scripts/`、`resources/`：构建、打包与资产管线。
- `build/`、`out/`、`dist/`：构建产物（请勿直接修改）。
- `docs/`：设计文档与指南。
- `test/`：Vitest 测试（main/renderer）。

## 架构概览

### 设计原则

- **Presenter 模式**：系统能力集中在主进程 Presenter，通过 preload 的 `usePresenter` 类型化调用。
- **多窗口 + 多 Tab Shell**：WindowPresenter 与 TabPresenter 管理真正的 Electron 窗口/BrowserView，可分离/移动；EventBus 负责跨进程广播。
- **清晰数据边界**：聊天数据在 SQLite（`app_db/chat.db`），设置在 Electron Store，知识库在 DuckDB，备份由 SyncPresenter 负责；渲染进程不直接读写文件系统。
- **工具优先运行时**：LLMProviderPresenter 统一流式处理、限流、实例管理（云/本地/ACP Agent）；MCPPresenter 启动 MCP 服务器、Router 市场和内置工具，捆绑 Node 运行时。
- **安全与韧性**：开启 contextIsolation；文件访问经 Presenter 授权（如 ACP 需要 `registerWorkdir`）；备份/导入校验输入；限流保护避免 Provider 过载。

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron Main (TS)                       │
│  Presenters: window/tab/thread/config/llm/mcp/knowledge/    │
│  sync/oauth/deeplink/浮窗                                   │
│  存储: SQLite chat.db, ElectronStore, 备份                  │
└───────────────┬─────────────────────────────────────────────┘
                │ IPC (contextBridge + EventBus)
┌───────────────▼─────────────────────────────────────────────┐
│                    Preload (strict API)                     │
└───────────────┬─────────────────────────────────────────────┘
                │ Typed presenters via `usePresenter`
┌───────────────▼─────────────────────────────────────────────┐
│      Renderer (Vue 3 + Pinia + Tailwind + shadcn/ui)        │
│  Shell UI, 聊天流转, ACP 工作区, MCP 控制台, 设置           │
└───────────────┬─────────────────────────────────────────────┘
                │
┌───────────────▼─────────────────────────────────────────────┐
│ 运行时扩展: MCP Node 运行时, Ollama 控制, ACP Agent 进程,   │
│ DuckDB 知识库, 同步备份                                    │
└─────────────────────────────────────────────────────────────┘
```

### 模块与特性要点

- **LLM 管线**：`LLMProviderPresenter` 负责 Provider 编排、限流守卫、实例管理、模型发现、ModelScope 同步、自定义模型导入、Ollama 生命周期、Embedding、Agent Loop（工具调用、流式状态），ACP Agent 会话持久化在 `AcpSessionPersistence`。
- **MCP 栈**：`McpPresenter` 搭配 ServerManager/ToolManager/McpRouterManager 启停服务，选择 npm registry，自动拉起默认/内置服务器，并在 UI 中呈现 Tools/Prompts/Resources，支持 StreamableHTTP/SSE/Stdio 传输及调试窗口。
- **ACP（Agent Client Protocol）**：ACP Provider 启动 Agent 进程，将通知映射为聊天区块，并驱动 **ACP Workspace**（计划面板增量更新、终端输出、受控文件树，需先 `registerWorkdir`）。PlanStateManager 去重计划项并保留最近完成记录。
- **知识与搜索**：内置知识库采用 DuckDB + 文本切分 + MCP 配置；搜索助手自动择模，支持 API 搜索和模拟浏览搜索引擎，亦可用自定义模板。
- **Shell & 体验**：多窗口/多 Tab 导航、悬浮聊天窗、deeplink 启动、同步/备份/恢复（SQLite+配置清单打包 zip）、通知、升级通道、隐私开关。

## 最佳实践

- **渲染层勿直接用 Node API**：所有 OS/网络/文件操作经 preload Presenter；注意使用 `tabId`/`windowId` 保障多窗口安全。
- **全量 i18n**：用户可见文案放在 `src/renderer/src/i18n`，避免组件内硬编码。
- **状态与 UI**：倾向 Pinia store 与组合式工具，保持组件尽量无状态并兼容 tab 分离；修改聊天流时留意 artifacts、variants、流式状态。
- **LLM/MCP/ACP 变更**：尊重限流；切换 Provider 前清理活跃流；通过 eventBus 派发事件。MCP 相关改动要落盘到 `configPresenter`，并呈现 server start/stop 事件。ACP 访问文件前调用 `registerWorkdir`，会话结束需清理计划/工作区状态。
- **数据与持久化**：会话用 `sqlitePresenter`，设置/Provider 用 `configPresenter`，备份导入用 `syncPresenter`；不要从渲染进程直接写 `appData`。
- **质量门槛**：提交前运行 `pnpm run format`、`pnpm run lint`、`pnpm run typecheck` 及相关 `pnpm test*`。新增文案后跑 `pnpm run i18n` 校验 key。

## 代码风格

- TypeScript + Vue 3 Composition API + Pinia；样式使用 Tailwind + shadcn/ui。
- Prettier：单引号、无分号；提交前请执行 `pnpm run format`。
- OxLint 用于代码检查（`pnpm run lint`）；类型检查 `pnpm run typecheck`（node + web 双目标）。
- 测试使用 Vitest（`test/main`、`test/renderer`），命名 `*.test.ts` / `*.spec.ts`。
- 命名约定：组件/类型 PascalCase，变量/函数 camelCase，常量 SCREAMING_SNAKE_CASE。

## Pull Request 流程

1. 保持 PR 聚焦，描述改动内容及关联 Issue。
2. UI 变更请附截图/GIF，并注明涉及的文档更新（README/CONTRIBUTING/docs）。
3. 本地确认 format + lint + typecheck + 相关测试，如未执行请在 PR 备注。
4. 目标分支为 `dev`；外部贡献者请先 Fork，再向 `dev` 提 PR。
5. 至少需一位维护者批准后合并。

## 有问题？

如果您有任何关于贡献的问题，请使用 "question" 标签创建一个 issue。

## 许可证

通过贡献代码，您同意您的贡献将遵循本项目的开源许可证。
