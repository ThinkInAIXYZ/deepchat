# Agent 运行实施边界

> 状态：已实施，等待最终验收

本文只说明 Agent 信息、运行方式、实例、单次执行和清理规则。Session 的长期数据规则见
[Session 实施边界](./session.md)，App 的启动和退出顺序见
[App 启动与退出边界](./app.md)。

## 负责关系

| 内容 | 负责模块 | 说明 |
| --- | --- | --- |
| Agent 信息和可执行配置 | `AgentRepository` | 读取并检查 `DeepChat`、`ACP` Agent 信息 |
| 按 `agentId` 选择运行方式 | `AgentManager` | 只选择 `DeepChat` 或 `ACP`，不执行模型或 Tool |
| `DeepChat` instance | `DeepChatAgentRuntime` | 每个 Session 最多保存一个已载入的 instance |
| `ACP` instance 和进程连接 | `AcpAgentRuntime` | 每个 Session 最多保存一个已载入的 instance |
| 每次 Turn / Run | 对应的 Agent instance | 负责 send、cancel、执行状态和正在等待的 Interaction |
| transcript、Tape、pending input、settings | Session data | Agent 运行通过明确接口读写，不决定长期数据删除规则 |

`AgentManager` 是运行方式选择器，不是新的全局入口。调用方只能按需要使用它提供的
backend 或 Session handle，不能从它取得 Desktop、Remote、Scheduler、Provider、Tool 等模块。

## 运行方式选择

1. Session 长期保存 `agentId`。
2. `AgentRepository` 把 `agentId` 解析为 `DeepChatAgentDescriptor` 或 `AcpAgentDescriptor`。
3. `AgentManager` 根据 descriptor 选择对应 backend。
4. 一次操作选定 backend 后，只调用该 backend 的有类型 handle，不能在执行中改走另一套实现。
5. 更换 Session 的 Agent 时，先关闭旧 instance，再保存新的 `agentId`；不保留两个 backend
   同时运行。

## instance 载入和释放

普通 Session 列表、历史记录和 Desktop binding 查询不能载入 instance。以下操作可以载入：

- send、resume、steer 等执行操作；
- 需要完整运行状态的 restore；
- `ACP` mode、config、command、workdir 等明确针对 backend 的操作；
- 创建 Session 后第一次初始化对应的运行设置。

每个 Session 在一种 backend 内最多有一个已载入的 instance。相同身份的重复载入返回现有
instance；身份不同必须报错，不能静默替换。

释放 instance 只删除内存状态、正在使用的进程和临时连接，不删除 Session、transcript、Tape
或 settings。之后再次执行时可以从长期数据重新载入。

## Turn、Run 和 Interaction

- Session 接收一次 send 或 resume 后，由当前 Agent instance 创建本次 Run。
- Run 负责 abort signal、Provider 多轮调用、Tool 执行和本轮状态。
- permission、question、draft review 等 Interaction 属于当前 Run。
- cancel 只结束当前 Run，不删除 Session，也不自动释放 instance。
- Run 完成、取消或失败后，必须结束或作废它拥有的 Interaction。
- pending input 是 Session data；只有当前 instance 可以领取并执行，领取失败时按现有规则恢复，
  不能复制到另一条队列。
- `DeepChat` 和 `ACP` runtime 都在创建时直接接收 Session 的 pending input 接口；不能通过另一种
  backend 转交，也不能在接口缺失时继续运行。

## 两种 backend 的清理

| 操作 | `DeepChat` | `ACP` | 长期 Session 数据 |
| --- | --- | --- | --- |
| `cancel` | 取消当前 Run | 取消当前 prompt | 保留 |
| `close` / `evict` | 关闭 instance，移出运行表 | 关闭 instance 和对应连接，移出运行表 | 保留 |
| `cleanupSession` | 取消执行并清理该 instance 的内存状态 | 关闭 instance、连接和 ACP 保存的运行记录 | 由 Session 删除流程继续处理 |
| App `shutdown` | 停止全部已载入 instance | 停止全部 instance 和 ACP 子进程 | 保留 |

删除 Session 时，Session 模块先阻止新的操作，再要求 `AgentManager` 清理两种 backend。两边都
要清理，是为了删除过去更换 Agent 后可能留下的运行资源，不表示允许两种 backend 同时执行。
运行资源清理完成后，Session 模块再删除自己负责的长期数据。

App 退出时只安排顺序：先停止新任务，再让两个 runtime 停止自己的资源。App 不直接遍历
instance，也不重复执行 backend 内部的清理。

## 删除旧 `Presenter` 目录

旧 `AgentRuntimePresenter` 实际上主要是 `DeepChat` 的运行实现，同时夹带了 `ACP` 为复用
prompt、Tool 和消息展示所需的连接代码。实施时按以下边界拆开：

1. `DeepChat` 的 context、Turn、Tool、compaction、Tape 和消息处理移入
   `src/main/agent/deepchat/`。
2. `ACP` 复用 `DeepChat` 能力的连接代码移入 `src/main/agent/acp/compatibility/`。
3. Session data 使用的 Tape 纯函数移入 `src/main/session/data/`，避免 Session 反向依赖
   `DeepChat` 运行内部文件。
4. App composition 直接创建这些实体，并把明确依赖传入。
5. 所有调用方切换后直接删除 `src/main/presenter/agentRuntimePresenter/` 和
   `AgentRuntimePresenter` 名称。

迁移不保留旧路径转发文件，不建立新旧双入口，也不改变现有执行算法。需要保留的可选行为
必须是产品上确实可以不存在的观察者；Provider、Tool、permission、Session data 等运行必需
能力必须在构造时明确提供，不能运行到一半才通过兜底查找。

## 依赖限制

- Agent 运行代码不能导入 Desktop、Remote、Scheduler、route 分发或 App composition。
- Session 可以调用 `AgentManager` 的公开操作，但不能导入具体 instance 的内部文件。
- `DeepChat` 和 `ACP` 可以复用明确的纯函数或窄接口，不能互相读取对方的 instance 表。
- 结果和状态通过有类型 callback 或 event 发给接收方；通知不能作为隐藏的业务命令。
- 不新增汇总 Provider、Tool、Skill、Memory、Knowledge 和 Workspace 的总管理器。

## 本阶段完成条件

- Agent 信息和 backend 选择只有一个明确入口。
- 每个 Session 在对应 runtime 内最多有一个 instance。
- `DeepChat` 和 `ACP` 的 close、cleanup 和 shutdown 路径都有针对性测试。
- `src/main/presenter/agentRuntimePresenter/` 已删除，仓库中没有旧路径 import。
- Agent 运行目录没有 Desktop、Remote、Scheduler、route 或 App import。
- 现有调用顺序、结果和错误含义不变。
