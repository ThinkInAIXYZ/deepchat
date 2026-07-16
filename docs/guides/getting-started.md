# 快速入门

## 环境

- Node.js `>=24.14.1 <25`
- pnpm `>=10.11`
- Git

```bash
pnpm install
pnpm run hooks:install
pnpm run installRuntime
pnpm run dev
```

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
| DeepChat loop | `src/main/agent/deepchat/loop/`、`runtime/` |
| Direct ACP | `src/main/agent/acp/instance/`、`runtime/` |
| Provider/auth/model | `src/main/provider/` |
| Agent tools | `src/main/tool/agentTools/` |
| MCP | `src/main/mcp/` |
| Memory | `src/main/memory/`、`src/main/agent/deepchat/memory/` |
| import/export | `src/main/app/startupMigrations/`、`src/main/exporter/` |
| Renderer chat UI | `src/renderer/src/pages/ChatPage.vue`、`components/message/` |

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
