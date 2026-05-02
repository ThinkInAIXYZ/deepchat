# DeepChat 文档索引

本文档反映 `2026-04-20` 完成 main kernel refactor phase5 自动化收口后的代码结构。

当前仓库的后续治理重点不是再发起一次新的 `main kernel` 全量重写，而是把 renderer-main 边界继续收成
single-track。换句话说，typed client / typed event 现在已经是默认方向，`useLegacyPresenter()`、
`window.electron`、`window.api` 只应被视为兼容路径，而不是新功能入口。
唯一允许的 quarantine 目录固定为 `src/renderer/api/legacy/**`，原先位于
`src/renderer/api/legacy/presenters.ts` 的 shim 已在 `P5` 退役，剩余 legacy transport
只允许从 quarantine adapter 引用。

当前 migrated 聊天热路径已经收敛为：

```text
Renderer
  -> renderer/api (SettingsClient / SessionClient / ChatClient / ProviderClient)
  -> window.deepchat
  -> shared/contracts/routes + shared/contracts/events
  -> main route runtime (settings handler / SessionService / ChatService / ProviderService)
  -> presenter-backed hot path ports
  -> agentSessionPresenter / configPresenter / llmProviderPresenter / windowPresenter
  -> agentRuntimePresenter / toolPresenter / mcpPresenter / sqlitePresenter
```

`SessionPresenter` 和旧 `conversations/messages` 数据域仍然保留，但只承担兼容、导出和历史数据访问职责，不再是 migrated chat/session hot path 的主入口。`phase5` 的结论也已经固定：当前不继续发起一次性全量 `main kernel` rewrite，后续只在明确 hot path 需要时继续做增量 typed-boundary migration。

## 当前必读

| 文档 | 用途 |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 当前主架构总览 |
| [FLOWS.md](./FLOWS.md) | 当前消息、工具、ACP、导入流程 |
| [architecture/agent-system.md](./architecture/agent-system.md) | `agentSessionPresenter` / `agentRuntimePresenter` 细节 |
| [architecture/tool-system.md](./architecture/tool-system.md) | `ToolPresenter`、agent tools、ACP helper 分层 |
| [architecture/session-management.md](./architecture/session-management.md) | 新会话管理与 legacy 数据平面边界 |
| [guides/code-navigation.md](./guides/code-navigation.md) | 当前代码导航入口 |
| [guides/getting-started.md](./guides/getting-started.md) | 新开发者快速上手 |
| [guides/plugin-packaging.md](./guides/plugin-packaging.md) | `.dcplugin` 打包、内置分发和 release 规则 |
| [spec-driven-dev.md](./spec-driven-dev.md) | SDD 目录规则与变更前置流程 |
| [architecture/baselines/dependency-report.md](./architecture/baselines/dependency-report.md) | 当前依赖与耦合基线 |
| [architecture/baselines/main-kernel-boundary-baseline.md](./architecture/baselines/main-kernel-boundary-baseline.md) | main kernel refactor 当前阶段的边界指标与 hot path 快照 |
| [architecture/baselines/main-kernel-bridge-register.md](./architecture/baselines/main-kernel-bridge-register.md) | main kernel refactor 的临时 bridge 登记表 |
| [architecture/baselines/main-kernel-migration-scoreboard.md](./architecture/baselines/main-kernel-migration-scoreboard.md) | main kernel refactor 的轻量 migration scoreboard |
| [architecture/renderer-main-single-track/spec.md](./architecture/renderer-main-single-track/spec.md) | `phase5` 之后 renderer-main 单轨化目标与验收标准 |
| [architecture/renderer-main-single-track/plan.md](./architecture/renderer-main-single-track/plan.md) | 单轨化阶段计划、family 优先级与 merge gate |
| [architecture/renderer-main-single-track/tasks.md](./architecture/renderer-main-single-track/tasks.md) | 单轨化执行清单 |
| [architecture/baselines/test-failure-groups.md](./architecture/baselines/test-failure-groups.md) | 当前测试失败分组基线 |

## 本次清理落库

| 位置 | 内容 |
| --- | --- |
| [docs/archives/specs-migration-2026-05-02.md](./archives/specs-migration-2026-05-02.md) | 旧 SDD 目录拆分到 features / issues / architecture / archives 的迁移记录 |
| [docs/archives/legacy-agentpresenter-retirement/spec.md](./archives/legacy-agentpresenter-retirement/spec.md) | 本次 retirement 的目标、范围、兼容边界 |
| [docs/archives/legacy-agentpresenter-retirement/plan.md](./archives/legacy-agentpresenter-retirement/plan.md) | 迁移/归档/验证计划 |
| [docs/archives/legacy-agentpresenter-retirement/tasks.md](./archives/legacy-agentpresenter-retirement/tasks.md) | 已执行清单 |
| [docs/archives/legacy-llm-provider-runtime-retirement/spec.md](./archives/legacy-llm-provider-runtime-retirement/spec.md) | legacy provider runtime retirement 规格 |
| [docs/archives/legacy-llm-provider-runtime-retirement/plan.md](./archives/legacy-llm-provider-runtime-retirement/plan.md) | provider runtime 收口与依赖清理计划 |
| [docs/archives/legacy-llm-provider-runtime-retirement/tasks.md](./archives/legacy-llm-provider-runtime-retirement/tasks.md) | provider runtime 退役执行清单 |
| [docs/archives/provider-layer-simplification/spec.md](./archives/provider-layer-simplification/spec.md) | provider layer 第二轮内部收口规格 |
| [docs/archives/provider-layer-simplification/plan.md](./archives/provider-layer-simplification/plan.md) | registry + generic provider 合并计划 |
| [docs/archives/provider-layer-simplification/tasks.md](./archives/provider-layer-simplification/tasks.md) | provider layer 第二轮执行清单 |
| [docs/archives/ai-sdk-runtime/spec.md](./archives/ai-sdk-runtime/spec.md) | AI SDK runtime 规格，现已更新为 retired 状态 |
| [docs/architecture/architecture-simplification/spec.md](./architecture/architecture-simplification/spec.md) | 整体减负治理规格 |
| [docs/architecture/architecture-simplification/plan.md](./architecture/architecture-simplification/plan.md) | 分层/基线/guard 计划 |
| [docs/architecture/architecture-simplification/tasks.md](./architecture/architecture-simplification/tasks.md) | 首期实施清单 |
| [docs/archives/agent-cleanup/spec.md](./archives/agent-cleanup/spec.md) | cleanup 主规格，已更新到 retirement 完成态 |

## 主内核边界稳定化计划记录

以下文档记录的是本轮已经完成的边界稳定化计划、验收证据和后续治理结论。

重点不再是一次性交付完整 `Clean Main Kernel`，而是优先解决 renderer-main 边界、hot path
减耦、lifecycle owner 和可测试性问题。当前这些文档既描述实施路径，也记录 `phase5` 收口后的最终状态：

| 位置 | 内容 |
| --- | --- |
| [docs/architecture/main-kernel-refactor/spec.md](./architecture/main-kernel-refactor/spec.md) | 收敛后方案的目标、范围、非目标与成功标准 |
| [docs/architecture/main-kernel-refactor/plan.md](./architecture/main-kernel-refactor/plan.md) | 以边界稳定和热路径减耦为主的阶段计划 |
| [docs/architecture/main-kernel-refactor/tasks.md](./architecture/main-kernel-refactor/tasks.md) | 项目级任务清单与阶段状态 |
| [docs/architecture/main-kernel-refactor/acceptance.md](./architecture/main-kernel-refactor/acceptance.md) | 阶段验收口径与本轮最终收口标准 |
| [docs/architecture/main-kernel-refactor/test-plan.md](./architecture/main-kernel-refactor/test-plan.md) | 围绕 migrated path 的测试分层与 smoke matrix |
| [docs/architecture/main-kernel-refactor/migration-governance.md](./architecture/main-kernel-refactor/migration-governance.md) | 防止双轨失控的实施纪律、bridge 规则与 scoreboard |
| [docs/architecture/main-kernel-refactor/build-vs-buy.md](./architecture/main-kernel-refactor/build-vs-buy.md) | 本轮哪些能力引库、哪些能力保持本地实现 |
| [docs/architecture/main-kernel-refactor/ports-and-scheduler.md](./architecture/main-kernel-refactor/ports-and-scheduler.md) | 最小必要 port 集合与 `Scheduler` 的定位 |
| [docs/architecture/main-kernel-refactor/route-schema-catalog.md](./architecture/main-kernel-refactor/route-schema-catalog.md) | migrated path 的 route registry、schema 和 typed event 目录 |
| [docs/architecture/main-kernel-refactor/eventbus-migration.md](./architecture/main-kernel-refactor/eventbus-migration.md) | 本轮对 typed UI event 和 legacy EventBus 的收敛策略 |

## Renderer-Main 单轨化计划记录

以下文档描述的是 `phase5` 收口之后的新执行规则：不再接受 renderer 业务层双轨并存，而是继续把
`renderer/api + window.deepchat + shared contracts` 固化成唯一默认路径。
`src/renderer/api/legacy/**` 是唯一允许暂存 legacy transport 的 quarantine 路径。

| 位置 | 内容 |
| --- | --- |
| [docs/architecture/renderer-main-single-track/spec.md](./architecture/renderer-main-single-track/spec.md) | 为什么当前分支还不能在双轨状态下直接合并，以及 single-track 的验收标准 |
| [docs/architecture/renderer-main-single-track/plan.md](./architecture/renderer-main-single-track/plan.md) | 单轨化阶段划分、quarantine 模型、family 迁移顺序与最终 merge gate |
| [docs/architecture/renderer-main-single-track/tasks.md](./architecture/renderer-main-single-track/tasks.md) | 具体执行清单 |

## 活跃架构地图

```text
docs/
├── README.md
├── ARCHITECTURE.md
├── FLOWS.md
├── architecture/
│   ├── agent-system.md
│   ├── baselines/
│   ├── main-kernel-refactor/
│   ├── renderer-main-single-track/
│   ├── session-management.md
│   ├── tool-system.md
│   ├── event-system.md
│   └── mcp-integration.md
├── features/
│   └── <feature-goal>/
│       ├── spec.md
│       ├── plan.md
│       └── tasks.md
├── issues/
│   └── <issue-goal>/
│       ├── spec.md
│       ├── plan.md
│       └── tasks.md
├── guides/
│   ├── getting-started.md
│   ├── code-navigation.md
│   ├── plugin-packaging.md
│   └── debugging.md
└── archives/
    ├── specs-migration-2026-05-02.md
    ├── legacy-agentpresenter-architecture.md
    ├── legacy-agentpresenter-flows.md
    ├── legacy-llm-provider-runtime.md
    ├── thread-presenter-migration-plan.md
    └── workspace-agent-refactoring-summary.md
```

## 历史文档

以下文档只用于追溯 legacy runtime，不再描述当前实现：

| 文档 | 说明 |
| --- | --- |
| [archives/legacy-agentpresenter-architecture.md](./archives/legacy-agentpresenter-architecture.md) | 旧 `AgentPresenter` 架构快照 |
| [archives/legacy-agentpresenter-flows.md](./archives/legacy-agentpresenter-flows.md) | 旧 `startStreamCompletion` / permission / loop 流程 |
| [archives/legacy-llm-provider-runtime.md](./archives/legacy-llm-provider-runtime.md) | 旧 provider runtime 的历史归档与提交锚点 |
| [archives/thread-presenter-migration-plan.md](./archives/thread-presenter-migration-plan.md) | 历史迁移设计 |
| [archives/workspace-agent-refactoring-summary.md](./archives/workspace-agent-refactoring-summary.md) | 历史工作区改造总结 |

## 阅读建议

1. 先读 [ARCHITECTURE.md](./ARCHITECTURE.md) 建立当前主链路心智模型。
2. 再读 [FLOWS.md](./FLOWS.md) 看发送消息、工具调用和 ACP 会话的时序。
3. 深入实现时，按模块进入：
   - 聊天执行链路： [architecture/agent-system.md](./architecture/agent-system.md)
   - 工具与权限： [architecture/tool-system.md](./architecture/tool-system.md)
   - 会话与兼容边界： [architecture/session-management.md](./architecture/session-management.md)
4. 如果需要对照旧实现，再去看 `archives/` 历史文档，不要依赖已经移除的历史源码快照。
