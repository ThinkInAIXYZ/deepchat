# DeepChat 文档索引

本文档反映 `2026-03-23` 完成的 legacy `AgentPresenter` retirement 之后的代码结构。

当前聊天主链路已经收敛为：

```text
Renderer
  -> preload IPC
  -> agentSessionPresenter
  -> agentRuntimePresenter
  -> llmProviderPresenter / toolPresenter / mcpPresenter
  -> sqlitePresenter
```

`SessionPresenter` 和旧 `conversations/messages` 数据域仍然保留，但只承担兼容、导出和历史数据访问职责，不再是活跃聊天 runtime 入口。

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
| [architecture/baselines/dependency-report.md](./architecture/baselines/dependency-report.md) | 当前依赖与耦合基线 |
| [architecture/baselines/test-failure-groups.md](./architecture/baselines/test-failure-groups.md) | 当前测试失败分组基线 |

## 本次清理落库

| 位置 | 内容 |
| --- | --- |
| [docs/specs/legacy-agentpresenter-retirement/spec.md](./specs/legacy-agentpresenter-retirement/spec.md) | 本次 retirement 的目标、范围、兼容边界 |
| [docs/specs/legacy-agentpresenter-retirement/plan.md](./specs/legacy-agentpresenter-retirement/plan.md) | 迁移/归档/验证计划 |
| [docs/specs/legacy-agentpresenter-retirement/tasks.md](./specs/legacy-agentpresenter-retirement/tasks.md) | 已执行清单 |
| [docs/specs/architecture-simplification/spec.md](./specs/architecture-simplification/spec.md) | 整体减负治理规格 |
| [docs/specs/architecture-simplification/plan.md](./specs/architecture-simplification/plan.md) | 分层/基线/guard 计划 |
| [docs/specs/architecture-simplification/tasks.md](./specs/architecture-simplification/tasks.md) | 首期实施清单 |
| [docs/specs/agent-cleanup/spec.md](./specs/agent-cleanup/spec.md) | cleanup 主规格，已更新到 retirement 完成态 |

## 活跃架构地图

```text
docs/
├── README.md
├── ARCHITECTURE.md
├── FLOWS.md
├── architecture/
│   ├── agent-system.md
│   ├── baselines/
│   ├── session-management.md
│   ├── tool-system.md
│   ├── event-system.md
│   └── mcp-integration.md
├── guides/
│   ├── getting-started.md
│   ├── code-navigation.md
│   └── debugging.md
├── specs/
│   ├── agent-cleanup/
│   ├── architecture-simplification/
│   └── legacy-agentpresenter-retirement/
└── archives/
    ├── legacy-agentpresenter-architecture.md
    ├── legacy-agentpresenter-flows.md
    ├── thread-presenter-migration-plan.md
    └── workspace-agent-refactoring-summary.md
```

## 历史文档

以下文档只用于追溯 legacy runtime，不再描述当前实现：

| 文档 | 说明 |
| --- | --- |
| [archives/legacy-agentpresenter-architecture.md](./archives/legacy-agentpresenter-architecture.md) | 旧 `AgentPresenter` 架构快照 |
| [archives/legacy-agentpresenter-flows.md](./archives/legacy-agentpresenter-flows.md) | 旧 `startStreamCompletion` / permission / loop 流程 |
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
