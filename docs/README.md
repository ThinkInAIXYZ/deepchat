# DeepChat 文档索引

本文档反映 `2026-07-05` 的当前代码结构。SDD 已按目标类型拆分：feature 和
architecture 使用三件套，small bug 使用单个 issue `spec.md`。文档清理只在开发者明确触发
`deepchat-sdd-cleanup` 时执行。

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
| [spec-driven-dev.md](./spec-driven-dev.md) | SDD 目录规则、GitHub 同步与清理入口 |

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
│   └── <small-bug-issue-spec>/
├── guides/
│   ├── getting-started.md
│   ├── code-navigation.md
│   └── plugin-packaging.md
└── spec-driven-dev.md
```

## SDD 保留规则

- `docs/features/**` 和 `docs/architecture/**` 下的 active goal folder 保留 `spec.md`、
  `plan.md`、`tasks.md`。
- `docs/issues/**` 下的小 bug goal 只保留一个 `spec.md`，内容包含 issue 描述、定位、
  修复计划、任务清单、验证方式和 GitHub issue 链接（如有）。
- feature / architecture 的已实现能力只保留仍有维护价值的 `spec.md`；删除对应
  `plan.md` / `tasks.md`。
- 已实现能力的当前维护事实也要并入 `README.md`、`ARCHITECTURE.md`、`FLOWS.md` 或对应 guide。
- 已修复 issue，尤其是关联 GitHub issue 且已关闭的，可以在手动 SDD cleanup 时删除。
- 过期、未开工、只描述旧实现或旧分支的 SDD，在手动 SDD cleanup 时删除。

## 阅读建议

1. 先读 [ARCHITECTURE.md](./ARCHITECTURE.md) 建立当前主链路心智模型。
2. 再读 [FLOWS.md](./FLOWS.md) 看发送消息、工具调用、导入和远程控制时序。
3. 深入实现时，按模块进入：
   - 聊天执行链路：[architecture/agent-system.md](./architecture/agent-system.md)
   - 工具与权限：[architecture/tool-system.md](./architecture/tool-system.md)
   - 会话与兼容边界：[architecture/session-management.md](./architecture/session-management.md)
4. 如果需要理解已退休设计，优先用 `git log` / `git show` 追历史提交，不再依赖仓库内长期归档文档。
