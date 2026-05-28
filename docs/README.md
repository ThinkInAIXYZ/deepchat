# DeepChat 文档索引

本文档反映 `2026-05-28` 的当前代码结构。历史 SDD 已清理为“活跃目标才保留”的模型：
已经落地的实现只在当前项目文档中保留维护信息，不再保留一次性 `spec/plan/tasks`
过程文档。

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

`useLegacyPresenter()`、`window.electron`、`window.api` 只允许作为兼容路径留在
`src/renderer/api/legacy/**` quarantine 中。业务模块的新能力应从 `renderer/api/*Client`
和 shared contracts 进入。

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
| [architecture/baselines/dependency-report.md](./architecture/baselines/dependency-report.md) | 当前依赖与耦合基线 |
| [architecture/baselines/main-kernel-boundary-baseline.md](./architecture/baselines/main-kernel-boundary-baseline.md) | renderer-main 边界指标与 hot path 快照 |
| [architecture/baselines/main-kernel-bridge-register.md](./architecture/baselines/main-kernel-bridge-register.md) | legacy bridge 登记表 |
| [architecture/baselines/main-kernel-migration-scoreboard.md](./architecture/baselines/main-kernel-migration-scoreboard.md) | typed-boundary migration scoreboard |
| [architecture/baselines/test-failure-groups.md](./architecture/baselines/test-failure-groups.md) | 测试失败分组基线 |

这些基线由 `scripts/generate-architecture-baseline.mjs` 生成，`scripts/architecture-guard.mjs`
会读取其中的 JSON 文件。它们不是历史 SDD，不应随 completed feature 文档一起删除。

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
│   └── <active-feature-goal>/
├── issues/
│   └── <recent-active-issue-goal>/
├── guides/
│   ├── getting-started.md
│   ├── code-navigation.md
│   ├── debugging.md
│   └── plugin-packaging.md
└── spec-driven-dev.md
```

## SDD 保留规则

- `docs/features/**`、`docs/issues/**`、`docs/architecture/**` 下的 goal folder 只表示活跃目标。
- 已实现能力要把当前维护事实并入 `README.md`、`ARCHITECTURE.md`、`FLOWS.md` 或对应 guide，
  然后删除旧 SDD 文件夹。
- bug 修复类 issue SDD 超过两周即清理；按当前日期 `2026-05-28`，本次清理 cutoff 为
  `2026-05-14` 之前。
- 过期、未开工、只描述旧实现或旧分支的 SDD 直接删除。

## 阅读建议

1. 先读 [ARCHITECTURE.md](./ARCHITECTURE.md) 建立当前主链路心智模型。
2. 再读 [FLOWS.md](./FLOWS.md) 看发送消息、工具调用、导入和远程控制时序。
3. 深入实现时，按模块进入：
   - 聊天执行链路：[architecture/agent-system.md](./architecture/agent-system.md)
   - 工具与权限：[architecture/tool-system.md](./architecture/tool-system.md)
   - 会话与兼容边界：[architecture/session-management.md](./architecture/session-management.md)
4. 如果需要理解已退休设计，优先用 `git log` / `git show` 追历史提交，不再依赖仓库内长期归档文档。
