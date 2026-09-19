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

#### 维护者发布流程

- 保持 `dev` 为集成分支，`main` 为稳定镜像分支。
- 从 `dev` 上已有的待发布提交切出短生命周期 `release/<version>` 分支。
- 提交 `release/<version> -> main` PR 仅用于评审和 CI，请不要用 GitHub merge 按钮合并。
- macOS 和 Linux 维护者可使用 `pnpm run release:ff -- release/<version> --tag v<version>` 落地发布。
- Windows 维护者不要使用 `pnpm run release:ff`，请改走手动发布流程。
- `main` fast-forward 完成后，再在同一提交上创建 release tag。
- 完整流程、手动兜底方式与约束请见 [docs/release-flow.md](./docs/release-flow.md)。

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

5. 从仓库根目录启动开发服务器：
```bash
pnpm run dev
# 在 packages/desktop 内：
pnpm run dev
```

根目录命令负责转发到 Desktop 应用或执行仓库级检查。从仓库根目录使用
`pnpm run <script>`；在 `packages/desktop` 内直接工作时，直接使用该包的
`pnpm run <script>`。仓库级检查应从仓库根目录运行。

## 项目结构

- `packages/desktop/src/main/`：Electron 主进程。Presenter、typed route handler、运行时编排与持久化 owner 都在这里（window/tab/thread/config/llmProvider/mcp/knowledge/sync/浮窗/deeplink/OAuth 等）。
- `packages/desktop/src/preload/`：开启 `contextIsolation` 的桥接层，对渲染进程暴露 typed `window.deepchat` API，以及极小的 legacy compatibility surface。
- `packages/desktop/src/renderer/`：Vue 3 + Pinia 应用。业务/UI 代码在 `packages/desktop/src/renderer/src`（components、stores、views、lib、i18n），Shell UI 在 `packages/desktop/src/renderer/shell/`。
- `packages/desktop/src/renderer/api/`：renderer-main 边界层。typed `*Client`、event subscription、命名 runtime wrapper 都应放在这里；`packages/desktop/src/renderer/api/legacy/` 仅作为 quarantine compatibility 目录。
- `packages/shared/`：从 Desktop 提升的可移植共享 contract 与 value module。
- `packages/desktop/src/shared/`：未提升为可移植包导出的 Desktop 专属 contract 与 UI helper。
- `packages/agent-kernel/`：可移植 Agent kernel，包边界保持不变。
- `packages/cli/`：CLI 包及其面向客户端的构建边界。
- `packages/desktop/runtime/`：打包时的运行时种子（uv；开发环境还可有本地 Node 树）。正式包通过「设置 → 工具链」解析 Node，不再随包装 Node。
- `packages/desktop/scripts/`、`packages/desktop/resources/`：Desktop 构建、打包与资产管线。
- `packages/desktop/build/`：Desktop 打包输入与生成的构建输出；按需修改其中的源打包输入，但不要手动修改生成文件。
- `packages/desktop/out/`、`packages/desktop/dist/`：生成的 Desktop 构建输出，请勿直接修改。
- `scripts/`、`docs/` 与根配置：仓库级工具、文档与 workspace policy。
- `packages/desktop/test/`：main/renderer 的 Vitest 测试与 Playwright 端到端测试。

## 架构概览

### 设计原则

下面的架构图中，路径均相对于 `packages/desktop`。

- **Single-track renderer-main 边界**：新的 renderer 业务代码应通过 typed route contract、typed event contract、`packages/desktop/src/renderer/api/*Client` 与明确命名的 runtime wrapper 接入 main，不要把 presenter naming 当作公开 API。
- **Presenter 留在 main 内部**：Presenter 仍承载大量主进程能力，但在 active path 上它们应被 routes、events、wrapper 隔离起来；`packages/desktop/src/renderer/api/legacy/**` 只作为 quarantine compatibility code 存在。
- **多窗口 + 多 Tab Shell**：WindowPresenter 与 TabPresenter 管理真正的 Electron 窗口/BrowserView，可分离/移动；EventBus 负责跨进程广播。
- **清晰数据边界**：聊天数据在 SQLite（`app_db/chat.db`），设置在 Electron Store，知识库在 DuckDB，备份由 SyncPresenter 负责；渲染进程不直接读写文件系统。
- **工具优先运行时**：LLMProviderPresenter 统一流式处理、限流、实例管理（云/本地/ACP Agent）；MCPPresenter 启动 MCP 服务器、Router 市场和内置工具，使用解析后的 Node/uv 工具链（托管、系统、自定义，或仍随包的 uv 种子）。
- **安全与韧性**：开启 `contextIsolation`；renderer 侧 OS/文件/网络访问必须经 typed bridge 或 quarantine wrapper；备份/导入校验输入；限流保护避免 Provider 过载。

```
Electron main: src/main/
  Presenters, routes, runtime owners, persistence
  |
  | Typed routes/events + limited legacy IPC
  v
Preload: src/preload/ (window.deepchat + compatibility whitelist)
  |
  v
Renderer boundary: src/renderer/api/*Client + runtime wrappers
  Quarantine: src/renderer/api/legacy/**
  |
  v
Renderer business: src/renderer/src/**
  Shell UI, chat, ACP workspace, MCP console, settings

Main-owned runtime add-ons:
  MCP/toolchains, Ollama, ACP processes, DuckDB, sync and backup
```

### 模块与特性要点

- **LLM 管线**：`LLMProviderPresenter` 负责 Provider 编排、限流守卫、实例管理、模型发现、ModelScope 同步、自定义模型导入、Ollama 生命周期、Embedding、Agent Loop（工具调用、流式状态），ACP Agent 会话持久化在 `AcpSessionPersistence`。
- **MCP 栈**：`McpPresenter` 搭配 ServerManager/ToolManager/McpRouterManager 启停服务，选择 npm registry，自动拉起默认/内置服务器，并在 UI 中呈现 Tools/Prompts/Resources，支持 StreamableHTTP/SSE/Stdio 传输及调试窗口。
- **ACP（Agent Client Protocol）**：ACP Provider 启动 Agent 进程，将通知映射为聊天区块，并驱动 **ACP Workspace**（计划面板增量更新、终端输出、受控文件树，需先 `registerWorkdir`）。PlanStateManager 去重计划项并保留最近完成记录。
- **知识与搜索**：内置知识库采用 DuckDB + 文本切分 + MCP 配置；搜索助手自动择模，支持 API 搜索和模拟浏览搜索引擎，亦可用自定义模板。
- **Shell & 体验**：多窗口/多 Tab 导航、悬浮聊天窗、deeplink 启动、同步/备份/恢复（SQLite+配置清单打包 zip）、通知、升级通道、隐私开关。

## 最佳实践

- **renderer 业务层优先使用 typed client 与 runtime wrapper**：在 `packages/desktop/src/renderer/src/**` 中，优先走 `packages/desktop/src/renderer/api/*Client`、typed event helper 与命名 wrapper；不要直接 import `@api/legacy/presenters`，也不要新增 presenter-name-based transport。
- **渲染层勿直接用 Node API**：所有 OS/网络/文件操作都应经 `window.deepchat`、typed client 或命名 wrapper；注意使用 `tabId`/`windowId` 保障多窗口安全。
- **全量 i18n**：用户可见文案放在 `packages/desktop/src/renderer/src/i18n`，避免组件内硬编码。
- **状态与 UI**：倾向 Pinia store 与组合式工具，保持组件尽量无状态并兼容 tab 分离；修改聊天流时留意 artifacts、variants、流式状态。
- **LLM/MCP/ACP 变更**：尊重限流；切换 Provider 前清理活跃流；migrated path 优先补 typed event，不要再新增 raw IPC 或 presenter reflection。MCP 相关改动应通过 main-owned config/runtime 层持久化，并呈现 server start/stop 事件。ACP 访问文件前调用 `registerWorkdir`，会话结束需清理计划/工作区状态。
- **数据与持久化**：会话/设置/Provider/备份相关修改应通过 main-owned client 或 compatibility adapter 落地；不要从渲染进程直接写 `appData` 或其他本地存储。
- **质量门槛**：提交前运行 `pnpm run format`、`pnpm run lint`、`pnpm run typecheck` 及相关 `pnpm test*`。新增文案后跑 `pnpm run i18n` 校验 key。

## 代码风格

- TypeScript + Vue 3 Composition API + Pinia；样式使用 Tailwind + shadcn/ui。
- Oxfmt：单引号、无分号、宽度 100；提交前请执行 `pnpm run format`。
- OxLint 用于代码检查（`pnpm run lint`）；类型检查 `pnpm run typecheck`（node + web 双目标）。
- 测试使用 Vitest（`packages/desktop/test/main`、`packages/desktop/test/renderer`），命名 `*.test.ts` / `*.spec.ts`。
- 命名约定：组件/类型 PascalCase，变量/函数 camelCase，常量 SCREAMING_SNAKE_CASE。

## Pull Request 流程

1. 保持 PR 聚焦，描述改动内容及关联 Issue。
2. UI 变更请附截图/GIF，并注明涉及的文档更新（README/CONTRIBUTING/docs）。
3. 本地确认 format + lint + typecheck + 相关测试，如未执行请在 PR 备注。
4. 目标分支为 `dev`；外部贡献者请先 Fork，再向 `dev` 提 PR。
5. 至少需一位维护者批准后合并。
6. 指向 `main` 的 PR 仅保留给 `release/<version>` 分支做评审与 CI，实际发布请按 [docs/release-flow.md](./docs/release-flow.md) 中的 `ff-only` 流程执行。

## 有问题？

如果您有任何关于贡献的问题，请使用 "question" 标签创建一个 issue。

## 许可证

通过贡献代码，您同意您的贡献将遵循本项目的开源许可证。
