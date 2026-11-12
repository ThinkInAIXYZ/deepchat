# 快速入门

## 环境

- Node.js `>=24.22.1 <25`
- pnpm `>=10.34.5 <11`
- Git
- Rust 1.98.1（通过 rustup 安装；Windows 还需要 Visual Studio C++ Build Tools）

```bash
pnpm install
pnpm run hooks:install
pnpm run installRuntime
pnpm run dev
```

`pnpm dev`（以及 `dev:trace` / `dev:inspect` / `dev:linux`）会在启动 Electron 前执行
`prepare:dev`：首次下载并校验锁定的 Node、dim release 与插件依赖，使用 Rust 1.98.1 构建
DeepChat 薄原生宿主。已准备且源码未变化时只验证本地缓存，不访问网络或重新构建。
Native/插件源码或版本锁变化后会重新准备；首次运行需要网络和本机 Rust/C++ 构建工具链。
也可以单独运行 `pnpm run prepare:dev`。不要在应用运行期间刷新 runtime 文件。
正式安装包包含所需 runtime，用户无需安装 Rust 或在首次启动下载 dim。

## 当前心智模型

```text
Vue component / Pinia store
  -> src/renderer/api/*Client
  -> window.deepchat
  -> src/shared/contracts/routes + events
  -> module routes
  -> owning main module
```

main 进程只有一个 composition root：`src/main/app/composition.ts`。它创建模块、注入窄依赖、注册
route、排定 start/stop，但不向业务代码提供模块查找入口。

```text
src/main/
├── app/          # process composition and maintenance
├── desktop/      # window, tab, tray, shortcut, renderer binding
├── session/      # lifecycle, turn, assignment, query and durable data
├── agent/        # DeepChat and ACP backends
├── provider/     # provider config, auth, model and execution
├── tool/         # tool catalog, permission and built-in tools
├── mcp/          # MCP config, OAuth, client/server and tools
├── skill/        # Skill files, scan and sync
├── plugin/       # plugin package and contribution registration
├── memory/       # long-term Memory
├── knowledge/    # built-in knowledge base
├── workspace/    # workspace authorization and file tree/search
├── file/         # file adapters and conversion
├── remote/       # remote channels and endpoint binding
├── scheduler/    # Cron jobs, runs and delivery
├── sync/         # backup/import/cloud sync
└── routes/       # shared route registry mechanics only
```

`src/main/presenter/`、全局 `Presenter`、`LifecycleManager`、全局 `EventBus`、
`useLegacyPresenter()` 和 `src/renderer/api/legacy/**` 已删除。不要从旧提交里的这些名字推断当前入口。

## 推荐阅读顺序

1. `docs/ARCHITECTURE.md`
2. `docs/FLOWS.md`
3. `src/shared/contracts/routes.ts`
4. `src/shared/contracts/events.ts`
5. `src/preload/createBridge.ts`
6. `src/renderer/api/`
7. `src/main/app/composition.ts`
8. 对应模块的 `routes.ts` 和 owner

常见任务入口：

| 任务 | 入口 |
| --- | --- |
| 发送、停止、交互回复 | `src/main/session/turn.ts`、`src/main/session/chatService.ts` |
| Session create/restore/delete | `src/main/session/` |
| DeepChat loop | dim Rust owners；桌面接入 `src/main/agent/dim/` |
| Direct ACP | `src/main/agent/acp/instance/`、`runtime/` |
| Provider/auth/model | `src/main/provider/` |
| Agent tools | `src/main/tool/agentTools/` |
| MCP | `src/main/mcp/` |
| Memory | `src/main/memory/`、`src/main/agent/deepchat/memory/` |
| import/export | `src/main/app/startupMigrations/`、`src/main/exporter/` |
| Renderer chat UI | `src/renderer/src/features/chat-page/ChatPage.vue`、`components/message/` |

## 质量门

完成 feature 后运行：

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```

再按改动范围运行 Vitest。涉及 Agent legacy boundary 时补跑：

```bash
pnpm run lint:agent-cleanup
```

涉及 baseline 时使用 `pnpm run architecture:baseline`。除两个 machine-read JSON 外，生成的 Markdown
报表只用于当次审计。

历史设计和已删除 SDD 通过 `git log -- docs`、`git show <commit>:<path>` 查询。
