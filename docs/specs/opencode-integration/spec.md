# OpenCode ACP Agent 集成规格文档

> DeepChat 集成 OpenCode 作为 ACP Agent 的技术规格
>
> 版本: 1.0
> 状态: 规划中
> 最后更新: 2026-01-15

## 1. 概述

### 1.1 什么是 OpenCode

OpenCode 是一个开源的 AI 编码代理（AI Coding Agent），具有以下特点：

- **开源架构**：完全开源，MIT 许可证
- **提供商无关**：支持 Claude、OpenAI、Google、本地模型等多种 LLM 提供商
- **原生 ACP 支持**：内置 Agent Client Protocol 实现
- **功能完整**：支持文件操作、终端命令、MCP 服务器、自定义工具等
- **跨平台**：支持 Windows、macOS、Linux

### 1.2 集成目标

将 OpenCode 作为内置 ACP Agent 集成到 DeepChat，使用户能够：

1. **便捷使用**：在 DeepChat 中直接选择 OpenCode 作为对话模型
2. **统一体验**：与其他 ACP Agents（Kimi CLI、Claude Code）保持一致的使用体验
3. **完整功能**：支持 OpenCode 的所有核心功能（文件读写、终端执行、MCP 集成等）
4. **灵活配置**：支持工作目录配置、环境变量设置等

### 1.3 设计原则

- **最小侵入**：复用现有的 ACP 架构，无需大规模重构
- **开箱即用**：作为内置 Agent，用户安装 OpenCode 后即可使用
- **向后兼容**：不影响现有的 ACP Agent 功能
- **可扩展性**：为未来添加更多 ACP Agents 提供参考

## 2. OpenCode ACP 实现分析

### 2.1 OpenCode 的 ACP 支持

根据官方文档（opencode.ai/docs/acp），OpenCode 通过以下方式支持 ACP：

#### 启动命令
```bash
opencode acp [options]
```

#### 支持的选项
- `--cwd <path>`: 指定工作目录
- `--port <number>`: 监听端口（可选，用于网络模式）
- `--hostname <string>`: 主机名（可选，用于网络模式）

#### 通信协议
- **协议类型**: JSON-RPC 2.0
- **传输方式**: stdin/stdout (newline-delimited JSON)
- **消息格式**: nd-JSON (每行一个 JSON 对象)

### 2.2 OpenCode 支持的 ACP 能力

根据官方文档，OpenCode 在 ACP 模式下支持以下能力：

| 能力类别 | 具体功能 | 说明 |
|---------|---------|------|
| **文件系统** | 读取文件 (`readTextFile`) | 支持 |
| | 写入文件 (`writeTextFile`) | 支持 |
| **终端操作** | 创建终端 (`createTerminal`) | 支持 |
| | 获取输出 (`terminalOutput`) | 支持 |
| | 等待退出 (`waitForTerminalExit`) | 支持 |
| | 终止命令 (`killTerminal`) | 支持 |
| | 释放终端 (`releaseTerminal`) | 支持 |
| **会话管理** | 初始化 (`initialize`) | 支持 |
| | 创建会话 (`newSession`) | 支持 |
| | 加载会话 (`loadSession`) | 支持（如果 Agent 支持） |
| | 提示处理 (`prompt`) | 支持 |
| | 取消操作 (`cancel`) | 支持 |
| **权限系统** | 请求权限 (`requestPermission`) | 支持 |
| **扩展功能** | MCP 服务器集成 | 支持（使用 OpenCode 配置） |
| | 自定义工具 | 支持 |
| | 项目规则 (AGENTS.md) | 支持 |

### 2.3 OpenCode 的特殊特性

#### 与终端模式的功能对等
OpenCode 在 ACP 模式下保持与终端模式的完整功能对等，包括：
- 内置工具（文件操作、终端命令）
- 自定义工具和斜杠命令
- MCP 服务器（从 OpenCode 配置读取）
- 项目特定规则（AGENTS.md）
- 自定义格式化器和 linter
- Agent 和权限系统

#### 当前限制
根据官方文档，以下功能在 ACP 模式下暂不支持：
- `/undo` 命令
- `/redo` 命令

## 3. 集成方案设计

### 3.1 集成方式选择

DeepChat 的 ACP 架构支持两种 Agent 类型：

1. **内置 Agent (Builtin Agent)**
   - 预定义的知名 Agent
   - 支持多个配置 Profile
   - 在 `AcpConfHelper` 中硬编码
   - 示例：Kimi CLI、Claude Code、Codex

2. **自定义 Agent (Custom Agent)**
   - 用户手动添加的 Agent
   - 单一配置
   - 存储在用户配置中

**选择：将 OpenCode 作为内置 Agent 集成**

理由：
- OpenCode 是官方支持的 ACP Agent，在 agentclientprotocol.com 列表中
- 作为内置 Agent 可以提供更好的开箱即用体验
- 支持多 Profile 配置（例如不同的环境变量、参数配置）
- 与现有的 Kimi CLI、Claude Code 保持一致

### 3.2 架构集成点

OpenCode 集成将复用现有的 ACP 架构，主要涉及以下组件：

```
┌─────────────────────────────────────────────────────────────────┐
│                    ConfigPresenter                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              AcpConfHelper                               │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  BUILTIN_ORDER: [                                  │  │   │
│  │  │    'kimi-cli',                                     │  │   │
│  │  │    'claude-code-acp',                              │  │   │
│  │  │    'codex-acp',                                    │  │   │
│  │  │    'opencode'  ← 新增                              │  │   │
│  │  │  ]                                                 │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  BUILTIN_TEMPLATES: {                              │  │   │
│  │  │    'opencode': {                                   │  │   │
│  │  │      name: 'OpenCode',                             │  │   │
│  │  │      defaultProfile: () => ({                      │  │   │
│  │  │        name: 'Default',                            │  │   │
│  │  │        command: 'opencode',                        │  │   │
│  │  │        args: ['acp'],                              │  │   │
│  │  │        env: {}                                     │  │   │
│  │  │      })                                            │  │   │
│  │  │    }                                               │  │   │
│  │  │  }                                                 │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AcpProvider                                  │
│  - fetchProviderModels() → 包含 OpenCode                        │
│  - coreStream() → 处理 OpenCode 的消息流                         │
│  - 其他方法无需修改，自动支持 OpenCode                            │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                 AcpProcessManager                               │
│  - 启动 OpenCode 子进程: opencode acp --cwd {workdir}           │
│  - 通过 stdin/stdout 进行 nd-JSON 通信                           │
│  - 无需修改，已支持通用的 ACP 协议                                │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 需要修改的文件

| 文件路径 | 修改内容 | 优先级 |
|---------|---------|--------|
| `src/shared/presenter/config.ts` | 添加 `'opencode'` 到 `AcpBuiltinAgentId` 类型 | 必需 |
| `src/main/presenter/configPresenter/acpConfHelper.ts` | 添加 OpenCode 到 `BUILTIN_ORDER` 和 `BUILTIN_TEMPLATES` | 必需 |
| `src/main/presenter/configPresenter/acpInitHelper.ts` | 添加 OpenCode 到 `BUILTIN_INIT_COMMANDS` | 必需 |
| `src/renderer/src/locales/*/acp.json` | 添加 OpenCode 相关的 i18n 翻译（如果需要） | 可选 |
| `docs/specs/opencode-integration/spec.md` | 本文档 | 文档 |

## 4. 技术实现细节

### 4.1 类型定义修改

**文件**: `src/shared/presenter/config.ts`

```typescript
// 添加 'opencode' 到 AcpBuiltinAgentId 类型
export type AcpBuiltinAgentId =
  | 'kimi-cli'
  | 'claude-code-acp'
  | 'codex-acp'
  | 'opencode'  // 新增
```

### 4.2 配置助手修改

**文件**: `src/main/presenter/configPresenter/acpConfHelper.ts`

#### 修改 1: 更新 BUILTIN_ORDER

```typescript
const BUILTIN_ORDER: AcpBuiltinAgentId[] = [
  'kimi-cli',
  'claude-code-acp',
  'codex-acp',
  'opencode'  // 新增
]
```

#### 修改 2: 添加 BUILTIN_TEMPLATES

```typescript
const BUILTIN_TEMPLATES: Record<AcpBuiltinAgentId, BuiltinTemplate> = {
  // ... 现有的 templates
  'opencode': {
    name: 'OpenCode',
    defaultProfile: () => ({
      name: DEFAULT_PROFILE_NAME,
      command: 'opencode',
      args: ['acp'],
      env: {}
    })
  }
}
```

### 4.3 命令行参数说明

OpenCode 的 ACP 模式支持以下参数：

| 参数 | 类型 | 说明 | 默认值 | 是否必需 |
|------|------|------|--------|---------|
| `--cwd` | string | 工作目录路径 | 当前目录 | 否 |
| `--port` | number | 监听端口（网络模式） | - | 否 |
| `--hostname` | string | 主机名（网络模式） | - | 否 |

**DeepChat 的使用方式**：
- DeepChat 使用 stdio 模式（不使用 `--port` 和 `--hostname`）
- 工作目录通过 `AcpSessionPersistence` 管理，自动传递给子进程
- 命令格式：`opencode acp` （工作目录通过进程的 cwd 设置）

### 4.4 环境变量配置

OpenCode 可能需要以下环境变量（根据用户配置）：

| 环境变量 | 说明 | 示例 |
|---------|------|------|
| `OPENCODE_API_KEY` | OpenCode API 密钥（如果需要） | `sk-xxx` |
| `ANTHROPIC_API_KEY` | Claude API 密钥 | `sk-ant-xxx` |
| `OPENAI_API_KEY` | OpenAI API 密钥 | `sk-xxx` |
| `PATH` | 确保 opencode 可执行文件在 PATH 中 | - |

**注意**：这些环境变量由用户在 OpenCode 自身的配置中管理，DeepChat 不需要特殊处理。

### 4.5 初始化命令配置

**文件**: `src/main/presenter/configPresenter/acpInitHelper.ts`

需要添加 OpenCode 的初始化命令配置：

```typescript
const BUILTIN_INIT_COMMANDS: Record<AcpBuiltinAgentId, InitCommandConfig> = {
  'kimi-cli': {
    commands: ['uv tool install --python 3.13 kimi-cli', 'kimi'],
    description: 'Initialize Kimi CLI'
  },
  'claude-code-acp': {
    commands: [
      'npm i -g @zed-industries/claude-code-acp',
      'npm install -g @anthropic-ai/claude-code',
      'claude'
    ],
    description: 'Initialize Claude Code'
  },
  'codex-acp': {
    commands: ['npm i -g @zed-industries/codex-acp', 'npm install -g @openai/codex', 'codex'],
    description: 'Initialize Codex'
  },
  'opencode': {  // 新增
    commands: ['npm i -g opencode-ai', 'opencode --version'],
    description: 'Initialize OpenCode'
  }
}
```

**说明**：
- `commands` 数组包含多个命令，用 `&&` 或 `;` 连接执行
- 第一个命令通常是安装命令
- 后续命令用于验证安装（如 `--version`）

### 4.6 外部依赖检测（可选）

OpenCode 不需要特殊的外部依赖（如 Git Bash），但如果将来需要，可以在 `EXTERNAL_DEPENDENCIES` 中添加：

```typescript
const EXTERNAL_DEPENDENCIES: ExternalDependency[] = [
  // ... 现有依赖
  // OpenCode 目前不需要特殊依赖，此处仅作示例
  // {
  //   name: 'Node.js',
  //   description: 'Node.js runtime for OpenCode',
  //   platform: ['win32', 'darwin', 'linux'],
  //   checkCommand: 'node --version',
  //   installCommands: {
  //     winget: 'winget install OpenJS.NodeJS',
  //     chocolatey: 'choco install nodejs',
  //     scoop: 'scoop install nodejs'
  //   },
  //   downloadUrl: 'https://nodejs.org',
  //   requiredFor: ['opencode']
  // }
]
```

### 4.7 工作目录管理

OpenCode 需要在有效的项目目录中运行。DeepChat 的工作目录管理流程：

1. **初始化**：用户创建新对话时，选择或输入工作目录
2. **持久化**：`AcpSessionPersistence` 保存 `(conversationId, agentId) -> workdir` 映射
3. **进程启动**：`AcpProcessManager` 启动子进程时设置 `cwd`
4. **会话恢复**：重新打开对话时，自动恢复之前的工作目录

**OpenCode 特殊考虑**：
- OpenCode 会读取工作目录中的 `AGENTS.md` 文件（项目规则）
- OpenCode 会读取用户的 OpenCode 配置（`~/.opencode/config.json`）
- 工作目录切换会导致会话重置（符合预期行为）

### 4.8 安装和依赖检测流程

DeepChat 提供了完整的 ACP Agent 安装和依赖检测机制：

#### 安装流程

```
用户点击"初始化" → 打开终端对话框 → 执行安装命令 → 显示实时输出 → 完成/失败
```

**详细步骤**：

1. **用户触发**：在 ACP 设置页面，点击 Agent 旁边的"初始化"按钮
2. **依赖检查**：`AcpInitHelper.checkRequiredDependencies()` 检查外部依赖
3. **显示依赖对话框**（如果缺少依赖）：
   - 列出缺少的依赖
   - 显示安装命令（winget/chocolatey/scoop）
   - 提供下载链接
   - 用户可以复制命令手动安装
4. **启动交互式终端**（依赖满足后）：
   - 使用 `node-pty` 创建 PTY 进程
   - 在 xterm.js 终端中显示输出
   - 自动执行初始化命令
   - 用户可以看到实时输出和错误
5. **完成**：
   - 成功：显示绿色状态，Agent 可用
   - 失败：显示红色状态，显示错误信息

#### 技术实现

**后端（Main Process）**：
- `AcpInitHelper.initializeBuiltinAgent()`: 初始化内置 Agent
- `AcpInitHelper.checkExternalDependency()`: 检查外部依赖
- `AcpInitHelper.startInteractiveSession()`: 启动交互式终端会话
- 使用 `node-pty` 创建 PTY 进程
- 通过 IPC 发送输出到渲染进程

**前端（Renderer Process）**：
- `AcpTerminalDialog.vue`: 终端对话框组件
  - 使用 xterm.js 显示终端输出
  - 监听 `acp-init:start`, `acp-init:output`, `acp-init:exit` 事件
  - 监听 `external-deps-required` 事件
- `AcpDependencyDialog.vue`: 依赖对话框组件
  - 显示缺少的依赖列表
  - 提供安装命令和下载链接
  - 支持一键复制命令

#### IPC 事件

| 事件名 | 方向 | 数据 | 说明 |
|--------|------|------|------|
| `acp-init:start` | Main → Renderer | `{ command: string }` | 终端启动 |
| `acp-init:output` | Main → Renderer | `{ type: 'stdout', data: string }` | 终端输出 |
| `acp-init:exit` | Main → Renderer | `{ code: number, signal: string }` | 进程退出 |
| `acp-init:error` | Main → Renderer | `{ message: string }` | 错误信息 |
| `external-deps-required` | Main → Renderer | `{ agentId: string, missingDeps: ExternalDependency[] }` | 缺少依赖 |
| `acp-terminal:input` | Renderer → Main | `string` | 用户输入 |
| `acp-terminal:kill` | Renderer → Main | - | 终止进程 |

## 5. 用户体验设计

### 5.1 启用流程

1. **安装 OpenCode**
   ```bash
   # 用户需要先安装 OpenCode
   npm install -g opencode
   # 或
   brew install opencode
   ```

2. **在 DeepChat 中启用**
   - 打开设置 → ACP Agents
   - 找到 "OpenCode" 并启用
   - （可选）配置 Profile（环境变量、参数等）

3. **创建对话**
   - 新建对话
   - 选择 "OpenCode" 作为模型
   - 设置工作目录（必需）
   - 开始对话

### 5.2 工作目录配置 UI

DeepChat 已有的 ACP 工作目录配置 UI 将自动支持 OpenCode：

```
┌─────────────────────────────────────────────────┐
│  OpenCode - Default                             │
│                                                 │
│  工作目录: /Users/username/my-project  [浏览]   │
│                                                 │
│  [确认] [取消]                                   │
└─────────────────────────────────────────────────┘
```

**工作目录验证**：
- 检查路径是否存在
- 检查是否有读写权限
- （可选）检查是否为 Git 仓库

### 5.3 对话体验

用户与 OpenCode 的对话体验与其他 ACP Agents 一致：

```
用户: 帮我在这个项目中添加一个新的 API 端点

OpenCode: 我会帮你添加 API 端点。首先让我查看项目结构...
[权限请求] OpenCode 请求读取文件: src/routes/api.ts
[允许] [拒绝] [总是允许]

OpenCode: 我发现你使用的是 Express 框架。我将添加一个新的路由...
[权限请求] OpenCode 请求写入文件: src/routes/api.ts
[允许] [拒绝] [总是允许]

OpenCode: ✓ 已添加新的 API 端点 /api/users
```

### 5.4 错误处理

| 错误场景 | 错误信息 | 用户操作 |
|---------|---------|---------|
| OpenCode 未安装 | "OpenCode 未找到，请先安装 OpenCode" | 显示安装指南 |
| 工作目录无效 | "工作目录不存在或无权限访问" | 重新选择目录 |
| 进程启动失败 | "OpenCode 启动失败: [错误详情]" | 检查日志，重试 |
| 通信超时 | "OpenCode 响应超时" | 重启进程 |
| 协议错误 | "ACP 协议错误: [错误详情]" | 报告问题 |

## 6. 测试计划

### 6.1 单元测试

**测试文件**: `test/main/presenter/configPresenter/acpConfHelper.test.ts`

```typescript
describe('AcpConfHelper - OpenCode', () => {
  it('should include opencode in builtin agents', () => {
    const helper = new AcpConfHelper()
    const builtins = helper.getBuiltins()
    const opencode = builtins.find(agent => agent.id === 'opencode')
    expect(opencode).toBeDefined()
    expect(opencode?.name).toBe('OpenCode')
  })

  it('should create default opencode profile', () => {
    const helper = new AcpConfHelper()
    const builtins = helper.getBuiltins()
    const opencode = builtins.find(agent => agent.id === 'opencode')
    expect(opencode?.profiles).toHaveLength(1)
    expect(opencode?.profiles[0].command).toBe('opencode')
    expect(opencode?.profiles[0].args).toEqual(['acp'])
  })
})
```

### 6.2 集成测试

**测试场景**：

1. **基本对话流程**
   - 启用 OpenCode
   - 创建新对话
   - 发送简单提示
   - 验证响应

2. **文件操作**
   - 请求读取文件
   - 验证权限请求
   - 允许权限
   - 验证文件内容返回

3. **终端操作**
   - 请求执行命令
   - 验证权限请求
   - 允许权限
   - 验证命令输出

4. **工作目录切换**
   - 切换工作目录
   - 验证会话重置
   - 验证新目录生效

### 6.3 手动测试清单

- [ ] 安装 OpenCode
- [ ] 在 DeepChat 中启用 OpenCode
- [ ] 创建新对话，选择 OpenCode
- [ ] 设置有效的工作目录
- [ ] 发送简单提示，验证响应
- [ ] 测试文件读取权限请求
- [ ] 测试文件写入权限请求
- [ ] 测试终端命令执行
- [ ] 测试工作目录切换
- [ ] 测试会话恢复
- [ ] 测试错误处理（OpenCode 未安装、无效目录等）
- [ ] 测试多个 OpenCode 对话并发

## 7. 实施计划

### 7.1 开发阶段

#### 阶段 1: 代码修改（预计 30 分钟）

**任务清单**：
- [ ] 修改 `src/shared/presenter/config.ts`，添加 `'opencode'` 类型
- [ ] 修改 `src/main/presenter/configPresenter/acpConfHelper.ts`
  - [ ] 添加 `'opencode'` 到 `BUILTIN_ORDER`
  - [ ] 添加 OpenCode 模板到 `BUILTIN_TEMPLATES`
- [ ] 运行类型检查：`pnpm run typecheck`
- [ ] 运行代码格式化：`pnpm run format`
- [ ] 运行 lint：`pnpm run lint`

#### 阶段 2: 测试验证（预计 1-2 小时）

**任务清单**：
- [ ] 安装 OpenCode：`npm install -g opencode`
- [ ] 启动 DeepChat 开发环境：`pnpm run dev`
- [ ] 在设置中启用 OpenCode
- [ ] 创建测试项目目录
- [ ] 执行手动测试清单（见 6.3）
- [ ] 记录测试结果和问题

#### 阶段 3: 文档更新（预计 30 分钟）

**任务清单**：
- [ ] 更新 README.md（如果需要）
- [ ] 更新用户文档（如果有）
- [ ] 添加 OpenCode 安装指南
- [ ] 更新 CHANGELOG.md

#### 阶段 4: 代码审查和合并（预计 30 分钟）

**任务清单**：
- [ ] 创建 Pull Request
- [ ] 代码审查
- [ ] 修复审查意见
- [ ] 合并到 dev 分支

### 7.2 时间估算

| 阶段 | 预计时间 | 依赖 |
|------|---------|------|
| 代码修改 | 30 分钟 | - |
| 测试验证 | 1-2 小时 | 代码修改完成 |
| 文档更新 | 30 分钟 | 测试验证完成 |
| 代码审查和合并 | 30 分钟 | 文档更新完成 |
| **总计** | **3-4 小时** | - |

### 7.3 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| OpenCode 版本不兼容 | 低 | 中 | 在文档中明确最低版本要求 |
| ACP 协议差异 | 低 | 高 | 充分测试，参考官方文档 |
| 工作目录权限问题 | 中 | 中 | 添加详细的错误提示 |
| 性能问题 | 低 | 中 | 使用现有的进程管理和缓存机制 |
| 用户配置冲突 | 低 | 低 | OpenCode 使用独立配置 |

## 8. 兼容性和限制

### 8.1 OpenCode 版本要求

- **最低版本**: v1.1.0（支持 `acp` 命令）
- **推荐版本**: 最新稳定版
- **验证方式**: `opencode --version`

### 8.2 平台支持

| 平台 | 支持状态 | 安装方式 |
|------|---------|---------|
| macOS | ✅ 完全支持 | `brew install opencode` 或 `npm install -g opencode` |
| Windows | ✅ 完全支持 | `npm install -g opencode` |
| Linux | ✅ 完全支持 | `npm install -g opencode` |

### 8.3 已知限制

1. **OpenCode 自身限制**
   - `/undo` 和 `/redo` 命令在 ACP 模式下不可用
   - 需要用户预先配置 OpenCode 的 LLM 提供商

2. **DeepChat 集成限制**
   - 工作目录必须是有效的文件系统路径
   - 不支持远程文件系统（如 SSH、FTP）
   - 首次启动可能较慢（OpenCode 初始化）

3. **功能限制**
   - OpenCode 的 MCP 服务器配置独立于 DeepChat 的 MCP 配置
   - OpenCode 的自定义工具需要在 OpenCode 配置中定义

### 8.4 与其他 ACP Agents 的对比

| 特性 | Kimi CLI | Claude Code | Codex | OpenCode |
|------|----------|----------------|-----------|----------|
| 开源 | ❌ | ❌ | ❌ | ✅ |
| 多提供商支持 | ❌ | ❌ | ❌ | ✅ |
| MCP 集成 | ✅ | ✅ | ✅ | ✅ |
| 自定义工具 | ❌ | ❌ | ❌ | ✅ |
| 项目规则 (AGENTS.md) | ❌ | ❌ | ❌ | ✅ |
| 终端操作 | ✅ | ✅ | ✅ | ✅ |
| 文件操作 | ✅ | ✅ | ✅ | ✅ |

## 9. 参考资料

### 9.1 官方文档

- **OpenCode 官网**: https://opencode.ai
- **OpenCode GitHub**: https://github.com/sst/opencode
- **OpenCode ACP 文档**: https://opencode.ai/docs/acp
- **OpenCode CLI 文档**: https://opencode.ai/docs/cli
- **Zed ACP Agent 页面**: https://zed.dev/acp/agent/opencode

### 9.2 ACP 协议

- **ACP 官网**: https://agentclientprotocol.com
- **ACP 协议规范**: https://agentclientprotocol.com/protocol/overview
- **ACP Agents 列表**: https://agentclientprotocol.com/overview/agents
- **ACP SDK (TypeScript)**: https://www.npmjs.com/package/@agentclientprotocol/sdk

### 9.3 DeepChat 相关文档

- **ACP 集成架构规范**: `docs/specs/acp-integration/spec.md`
- **ACP 模式默认值规范**: `docs/specs/acp-mode-defaults/spec.md`
- **项目开发指南**: `CLAUDE.md`

### 9.4 相关代码文件

| 文件路径 | 说明 |
|---------|------|
| `src/main/presenter/llmProviderPresenter/providers/acpProvider.ts` | ACP Provider 实现 |
| `src/main/presenter/agentPresenter/acp/acpProcessManager.ts` | ACP 进程管理 |
| `src/main/presenter/agentPresenter/acp/acpSessionManager.ts` | ACP 会话管理 |
| `src/main/presenter/configPresenter/acpConfHelper.ts` | ACP 配置助手 |
| `src/shared/presenter/config.ts` | 类型定义 |

## 10. 附录

### 10.1 OpenCode 安装指南

#### macOS
```bash
# 使用 Homebrew
brew install opencode

# 或使用 npm
npm install -g opencode
```

#### Windows
```bash
# 使用 npm
npm install -g opencode

# 注意：需要先安装 Node.js (>= 20.19.0)
```

#### Linux
```bash
# 使用 npm
npm install -g opencode

# 或从源码构建
git clone https://github.com/sst/opencode.git
cd opencode
npm install
npm run build
npm link
```

### 10.2 OpenCode 配置示例

OpenCode 的配置文件位于 `~/.opencode/config.json`：

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-xxx"
    },
    "openai": {
      "apiKey": "sk-xxx"
    }
  },
  "defaultProvider": "anthropic",
  "defaultModel": "claude-sonnet-4"
}
```

### 10.3 故障排查

#### 问题 1: OpenCode 未找到

**症状**: DeepChat 提示 "OpenCode 未找到"

**解决方案**:
1. 确认 OpenCode 已安装：`opencode --version`
2. 确认 OpenCode 在 PATH 中：`which opencode` (macOS/Linux) 或 `where opencode` (Windows)
3. 重启 DeepChat

#### 问题 2: ACP 模式启动失败

**症状**: 进程启动失败，日志显示 "Unknown command: acp"

**解决方案**:
1. 更新 OpenCode 到最新版本：`npm update -g opencode`
2. 确认版本 >= 1.1.0：`opencode --version`

#### 问题 3: 工作目录权限错误

**症状**: OpenCode 无法读写文件

**解决方案**:
1. 检查工作目录权限：`ls -la /path/to/workdir`
2. 确保 DeepChat 有访问权限
3. 尝试使用其他目录

---

**文档版本**: 1.0
**最后更新**: 2026-01-15
**作者**: DeepChat Team
**状态**: 规划中 → 待实施
