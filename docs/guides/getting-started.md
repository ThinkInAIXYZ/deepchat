# 快速入门指南

本文档基于 retirement 后的当前结构，适合第一次进入 DeepChat 主聊天链路的开发者。

## 前置要求

- Node.js `>= 20.19`
- pnpm `>= 10.11`
- Git
- 一个支持 TypeScript / Vue 的编辑器

## 启动项目

```bash
pnpm install
pnpm run installRuntime
pnpm run dev
```

常用命令：

```bash
pnpm run dev
pnpm run dev:inspect
pnpm run start
pnpm run build
pnpm run typecheck
pnpm run format
pnpm run i18n
pnpm run lint
pnpm test
```

## 先建立正确心智模型

当前聊天主链路不是 legacy `AgentPresenter`，而是：

```text
Renderer
  -> agentSessionPresenter
  -> agentRuntimePresenter
  -> toolPresenter / llmProviderPresenter
```

如果你在历史文档或旧提交里看到 `AgentPresenter`、`startStreamCompletion`、`agentLoopHandler`，
那已经是 archive 内容。

## 项目目录速览

```text
src/
├── main/
│   ├── presenter/
│   │   ├── agentSessionPresenter/        # 当前会话入口
│   │   ├── agentRuntimePresenter/   # 当前聊天 runtime
│   │   ├── toolPresenter/            # 工具路由
│   │   │   └── agentTools/           # 本地 agent tools
│   │   ├── llmProviderPresenter/     # provider 管理
│   │   │   └── acp/                  # ACP helper
│   │   ├── mcpPresenter/             # MCP tools/runtime
│   │   ├── sessionPresenter/         # legacy 数据兼容层
│   │   └── ...
│   ├── lib/agentRuntime/             # 共享 runtime helper
│   ├── eventbus.ts
│   └── events.ts
├── renderer/src/                     # Vue app
├── preload/                          # IPC bridge
├── shared/                           # shared types
└── test/                             # Vitest
```

## 进入代码的推荐顺序

1. `src/main/presenter/index.ts`
2. `src/main/presenter/agentSessionPresenter/index.ts`
3. `src/main/presenter/agentRuntimePresenter/index.ts`
4. `src/main/presenter/toolPresenter/index.ts`
5. `src/main/presenter/llmProviderPresenter/index.ts`

## 常见开发任务

### 调整聊天发送链路

优先看：

- `src/main/presenter/agentSessionPresenter/index.ts`
- `src/main/presenter/agentRuntimePresenter/process.ts`
- `src/main/presenter/agentRuntimePresenter/dispatch.ts`

### 添加或修改 agent tool

当前活跃目录：

1. `src/main/presenter/toolPresenter/agentTools/agentToolManager.ts`
2. 对应 handler：
   - `agentFileSystemHandler.ts`
   - `agentBashHandler.ts`
   - `chatSettingsTools.ts`
3. 如涉及权限，检查 `src/main/presenter/permission/`

### 调整 ACP 相关行为

优先看：

- `src/main/presenter/llmProviderPresenter/index.ts`
- `src/main/presenter/llmProviderPresenter/providers/acpProvider.ts`
- `src/main/presenter/llmProviderPresenter/acp/`

### 处理 legacy import / 导出

优先看：

- `src/main/presenter/agentSessionPresenter/legacyImportService.ts`
- `src/main/presenter/sessionPresenter/index.ts`
- `src/main/presenter/exporter/formats/`

## 提交流程

做完改动后至少执行：

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```

如改到了主进程聊天链路，补跑相关 Vitest 套件，并执行：

```bash
node scripts/agent-cleanup-guard.mjs
```

## 历史资料

要对照旧实现时，请看：

- `docs/archives/legacy-agentpresenter-architecture.md`
- `docs/archives/legacy-agentpresenter-flows.md`
- `docs/archives/thread-presenter-migration-plan.md`
