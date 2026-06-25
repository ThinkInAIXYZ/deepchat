# DeepChat 文档索引

本文档反映 `2026-06-25` 的当前代码结构。历史 SDD 已清理为“活跃目标保留三件套、
已落地目标只保留 durable spec”的模型：`plan.md` / `tasks.md` 只服务当前执行，已完成目标
只在 `spec.md` 保留仍有维护价值的契约和回归语义。

当前 renderer-main 默认路径是 typed client / typed event：

```text
Renderer
  -> renderer/api clients
  -> window.deepchat
  -> shared/contracts/routes + shared/contracts/events
  -> src/main/routes dispatcher
  -> route services / presenter-backed ports
  -> agentSessionPresenter / agentRuntimePresenter / toolPresenter / llmProviderPresenter
```

`useLegacyPresenter()`、`presenter:call`、`remoteControlPresenter:call` 和
`src/renderer/api/legacy/**` 已经退休。业务模块的新能力应从 `renderer/api/*Client` 和
shared contracts 进入；少数仍需要 raw IPC 的能力只能封装在明确 allowlist 的 preload/API 边界内。

## 当前必读

| 文档 | 用途 |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 当前主架构、能力 owner、typed boundary 规则 |
| [FLOWS.md](./FLOWS.md) | 当前消息、工具、ACP、导入、定时任务、远程控制流程 |
| [architecture/agent-system.md](./architecture/agent-system.md) | `agentSessionPresenter` / `agentRuntimePresenter` 细节 |
| [architecture/tool-system.md](./architecture/tool-system.md) | `ToolPresenter`、agent tools、ACP helper 分层 |
| [architecture/session-management.md](./architecture/session-management.md) | 新会话管理、分页恢复、legacy 数据平面边界 |
| [architecture/event-system.md](./architecture/event-system.md) | EventBus 与 typed events 的当前分工 |
| [guides/code-navigation.md](./guides/code-navigation.md) | 当前代码导航入口 |
| [guides/getting-started.md](./guides/getting-started.md) | 新开发者快速上手 |
| [guides/plugin-packaging.md](./guides/plugin-packaging.md) | `.dcplugin` 打包、内置分发和 release 规则 |
| [spec-driven-dev.md](./spec-driven-dev.md) | SDD 目录规则、保留期限与清理规则 |

## 仍有运行时用途的基线

| 文档 | 用途 |
| --- | --- |
| [architecture/baselines/main-kernel-bridge-register.json](./architecture/baselines/main-kernel-bridge-register.json) | `architecture-guard` 读取的 legacy bridge 机器登记表 |

其它 dependency、scoreboard、test failure、zero-inbound 报表属于按需生成的审计快照。当前代码
需要重新审计时，运行 `pnpm run architecture:baseline` 生成临时报表并按需提交。

## 当前代码地图

```text
docs/
├── README.md
├── ARCHITECTURE.md
├── FLOWS.md
├── architecture/
│   ├── agent-system.md
│   ├── event-system.md
│   ├── session-management.md
│   ├── tool-system.md
│   └── baselines/
├── features/
│   └── <active-feature-goal-or-retained-contract-spec>/
├── issues/
│   └── <active-issue-goal-or-retained-regression-spec>/
├── guides/
│   ├── getting-started.md
│   ├── code-navigation.md
│   └── plugin-packaging.md
└── spec-driven-dev.md
```

## SDD 保留规则

- `docs/features/**`、`docs/issues/**`、`docs/architecture/**` 下的 active goal folder 保留
  `spec.md`、`plan.md`、`tasks.md`。
- 已实现能力只保留仍有维护价值的 `spec.md`；删除对应 `plan.md` / `tasks.md`。
- 已实现能力的当前维护事实也要并入 `README.md`、`ARCHITECTURE.md`、`FLOWS.md` 或对应 guide。
- bug 修复类 issue SDD 超过两周即清理；按当前日期 `2026-06-25`，本次清理 cutoff 为
  `2026-06-11` 之前。
- 过期、未开工、只描述旧实现或旧分支的 SDD 直接删除。

## 阅读建议

1. 先读 [ARCHITECTURE.md](./ARCHITECTURE.md) 建立当前主链路心智模型。
2. 再读 [FLOWS.md](./FLOWS.md) 看发送消息、工具调用、导入和远程控制时序。
3. 深入实现时，按模块进入：
   - 聊天执行链路：[architecture/agent-system.md](./architecture/agent-system.md)
   - 工具与权限：[architecture/tool-system.md](./architecture/tool-system.md)
   - 会话与兼容边界：[architecture/session-management.md](./architecture/session-management.md)
4. 如果需要理解已退休设计，优先用 `git log` / `git show` 追历史提交，不再依赖仓库内长期归档文档。
