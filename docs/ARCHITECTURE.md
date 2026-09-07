# DeepChat 当前架构概览

本文档描述 `2026-07-16` 的 main 进程实际结构。旧的全局 `Presenter`、
`LifecycleManager`、全局 `EventBus` 和业务模块查找入口已经删除。

## 总体结构

```mermaid
flowchart TD
    Renderer["Renderer"] --> Preload["Preload bridge"]
    Preload --> Contracts["shared typed routes / events"]
    Contracts --> RouteMaps["各模块 route map"]
    RouteMaps --> Modules["负责该行为的模块"]

    App["App composition"] --> Platform["Platform / Settings / Data"]
    App --> Capabilities["Provider / Tool / MCP / Skill / Plugin / Memory / Knowledge / Workspace"]
    App --> Agent["Agent: DeepChat / ACP"]
    App --> Session["Session"]
    App --> Entries["Desktop / Remote / Scheduler / Deeplink"]

    Entries --> Session
    Session --> Agent
    Agent --> Capabilities
    Capabilities --> Platform
```

`src/main/app/composition.ts` 是唯一的组合入口。它创建模块、传入明确依赖、注册 route、
排定启动与停止顺序，但不导出模块列表，也不提供按名称查找模块的方法。

依赖方向是：

```text
App composition
  -> Desktop / Remote / Scheduler / Deeplink
  -> Session
  -> Agent runtime
  -> Provider / Tool / MCP / Skill / Plugin / Memory / Knowledge / Workspace
  -> Platform / Settings / Data
```

下层模块不能反向读取 App、Desktop、Remote 或 Scheduler。需要通知 renderer 时，App 在创建模块时
传入有类型的发送函数。

## 生命周期

### App

`src/main/appMain.ts` 负责 Electron 进程入口、single-instance、deeplink 缓存和退出请求。
`src/main/app/mainProcess.ts` 负责数据库解锁、连接、迁移和启动失败清理。
`src/main/app/composition.ts` 负责创建、连接、启动和停止业务模块。

`startMainProcess()` 只返回 `MainProcessControl`。它只能聚焦主窗口、处理 deeplink、清理权限、
确认退出、查询主窗口和停止 main 进程，不能读取业务模块。

### Session

`src/main/session/` 负责可长期保存的 Session 规则：

- `lifecycle.ts`：创建、草稿、关闭和基础生命周期；
- `turn.ts`：发送、排队、停止和交互回复；
- `assignment.ts`：Agent、model、project、fork 和 subagent 结果处理；
- `query.ts`：不会偷偷载入 Agent 的查询；
- `deletion.ts`：删除顺序和两类 backend 清理；
- `data/`：transcript、Tape、pending input、settings、search 和 trace。

窗口与 Session 的绑定不在 Session 数据中，由 `DesktopSessionBinding` 负责。窗口关闭不会默认删除
Session，也不会默认停止仍由其他入口使用的任务。

### Agent

`AgentManager` 根据 `AgentDescriptor.kind` 选择两套独立实现：

- `DeepChat`：`DeepChatAgentRuntime`、`DeepChatAgentInstance` 和 `DeepChatLoopEngine`；
- `ACP`：`AcpAgentRuntime`、`AcpAgentInstance` 和 ACP protocol runtime。

一个已载入的 Session 只有一个对应 instance。每次 Turn 使用独立 Run 保存取消信号、provider round、
request sequence 和临时输出状态。Session 拥有长期数据，Agent runtime 只通过窄接口读写这些数据。

## 模块职责

| 模块 | 位置 | 负责内容 |
| --- | --- | --- |
| App | `src/main/app/` | 进程启动、退出、维护状态、组合依赖 |
| Desktop | `src/main/desktop/` | window、tab、tray、shortcut、floating、browser、renderer binding |
| Session | `src/main/session/` | Session 生命周期、Turn、查询、长期数据和删除规则 |
| Agent | `src/main/agent/` | Agent catalog、backend 选择、DeepChat/ACP instance 和执行 |
| Provider | `src/main/provider/` | Provider/model 配置、实例、请求和认证 |
| Tool | `src/main/tool/` | Tool catalog、执行、权限和本地 Agent tools |
| MCP | `src/main/mcp/` | MCP 配置、server/client 生命周期和 MCP 调用 |
| Skill | `src/main/skill/` | Skill 文件、扫描、同步、选择和贡献 |
| Plugin | `src/main/plugin/` | Plugin package、安装状态和能力登记 |
| Memory | `src/main/memory/` | 长期记忆、检索、写入、索引和后台维护 |
| Knowledge | `src/main/knowledge/` | 内置知识库、切片、索引和检索 |
| Workspace / File | `src/main/workspace/`、`src/main/file/` | Workspace 授权、文件树、搜索、转换和临时文件 |
| Remote | `src/main/remote/` | channel runtime、endpoint binding、远程命令和结果发送 |
| Scheduler | `src/main/scheduler/` | Cron job、run、delivery 和 detached Session |
| Settings | `src/main/settings/`、各模块 `settings.ts` | 底层设置存储和各模块自己的配置解释 |
| Data | `src/main/data/`、各模块 `data/` | SQLite 连接、schema，以及各模块自己的 table 访问 |

Desktop 内仍有 `WindowPresenter`、`TabPresenter` 等历史类名。它们只是 Desktop 模块内部的具体实现，
不是全局入口，也不能被业务模块用来查找其他能力。

Desktop 的平台合同：

- app-scoped 命令使用 application menu accelerator；`globalShortcut` 只用于真正的全局窗口显示/隐藏；
- primary app chrome 和列表行使用桌面 cursor 语义，内容 hyperlink 保留 link affordance；
- chat search、message jump 和 app chrome 默认使用 immediate/native scroll，不启用全局 smooth scroll；
- macOS window material 按 main/settings/window state 设置，Windows/Linux 保持各自平台选项；
- 修改 shortcut settings 后重新注册 menu accelerator，不创建第二套 renderer shortcut owner。

## 数据边界

`MainDatabase` 只负责连接、事务、schema、诊断、修复、备份和 reopen。业务 table 由各模块自己的
database 对象取得。长期运行对象不能缓存一次打开数据库时创建的旧 table；数据库维护完成后，
它们通过稳定的 database owner 读取当前连接。

通用 `SettingsStore` 和 `SecretStore` 只提供底层存储。Provider、MCP、Agent、Desktop、Sync、
Knowledge、Hook、Skill、Project 和 Upgrade 分别解释自己的配置，不通过一个通用 Config 业务入口。

## 通信边界

- Renderer 调用使用 `src/shared/contracts/` 中的 typed route。
- 各模块在自己的 `routes.ts` 创建 route map；App 统一注册并拒绝重名。
- 发给 renderer 的通知使用 typed event envelope。
- main 内部业务操作使用直接调用，不通过全局 event bus。
- route 只做通信适配；event 只表示已经发生的事实。

## 验证

模块行为由 typecheck、lint 和对应的 unit/integration tests 验证。Agent legacy boundary 仍由
`scripts/agent-cleanup-guard.mjs` 做窄范围检查；其余依赖方向在模块测试和 code review 中维护，不再运行
全仓库启发式扫描器。

详细合同见 [Agent 系统](./architecture/agent-system.md)、
[Session 管理](./architecture/session-management.md)、[Tool 系统](./architecture/tool-system.md)、
[Memory 系统](./architecture/memory-system.md)、[Tape 系统](./architecture/tape-system.md) 和
[事件系统](./architecture/event-system.md)。已完成的 main-process realignment 实施记录由 Git 历史保存。
