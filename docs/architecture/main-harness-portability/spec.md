# Main 的宿主边界与可移植 Harness

**验收目标**：Electron 和一个普通 Node 验证宿主通过同一个生产入口构造内建 Agent。两者使用同一套 Turn、Run、暂停、取消和恢复逻辑。主应用继续拥有桌面能力、真实凭据、用户数据库和现有 IPC。先在当前仓库和进程内建立这个边界；独立发包、常驻服务、CLI 切换、Rust 化与数据库迁移均需另案决定。

[分步实施计划](./plan.md) · [Renderer 边界](../renderer-window-isolation/spec.md) · [Session 合同](../session-management.md) · [已有 Harness 合同](../deepchat-agent-harness-boundaries/spec.md)

## 运行边界

```text
Desktop routes / CLI / Remote / Scheduler -> Session commands and queries -> AgentManager
                                                                              |-> Direct ACP
                                                                              +-> built-in Harness
                                                                                     |
                                                              Turn / Run / queue / interactions
                                                                                     |
                                                              execution / persistence / output ports

Electron composition -> built-in Harness + Direct ACP + desktop adapters
Node verification host -> same built-in Harness + scripted provider / safe tool / temporary storage

Provider / Tool / permission adapters    -> execution ports     <- Harness
Session / Tape / pending-input adapters  -> persistence ports   <- Harness
Host projection adapter                 -> output contract     <- Harness
Host projection adapter -> client projection / typed events / internal updates / Desktop / Sync
```

下半图的端口由执行逻辑按所需操作定义，宿主适配器实现它们。运行时调用已注入的实现。区分三个时点：工具授权和输入认领必须等到结果，消息与 Tape 提交必须在事务内完成，提交后的显示刷新可以交给宿主。把这三类操作放进同一个异步事件总线会改变语义。

### 职责和允许的依赖

| 模块 | 唯一职责或拥有的状态 | 允许依赖 |
| --- | --- | --- |
| App composition、平台与数据启动 | 选择 backend 与适配器、打开/迁移数据库、排定启动、重开与停止 | Electron、配置与密钥、数据库连接、宿主服务和各模块公开入口；业务规则归下列所有者 |
| Desktop route、Preload | 检查发送者及窗口范围，验证输入输出，绑定窗口和 Session，分发客户端事件 | typed routes/events、Desktop、Session 用例；原生句柄止于宿主 |
| CLI、Remote、Scheduler | 各自的身份、授权、绑定、定时或结果投递 | 经过授权的 Session 命令/查询和宿主投影；窗口关闭不能终止其仍持有的工作 |
| Session 应用层与 AgentManager | 持久会话身份、创建/删除/分派、草稿提升、查询；按 descriptor 选 backend | Session 的存储与工作目录合同、backend 操作、投影；查询保持原有无副作用语义 |
| 内建 Harness、Turn、Run、PendingInputPump | 一个已载入实例的运行态，回合推进、取消、交互归属、队列认领/释放及重启 hold | 中立类型和消费方需要的运行、持久化、输出端口；公开入口及其传递依赖可在 Node 装载 |
| Direct ACP 与 ACP-as-Provider | 前者管理协议进程、连接与 ACP 会话；后者给内建循环提供模型能力 | ACP 宿主、协议/进程能力及共享的 prompt/历史/投影操作；Direct ACP 自己组装实例依赖 |
| SessionData、Transcript、Tape、PendingInputs | 持久输入顺序、消息事实和投影、journal、查询及恢复操作 | 当前数据库连接、原事务边界、Tape domain/ports；宿主负责获取重开后的连接 |
| Provider | 解析模型能力、来源和实际请求参数；流式执行与凭据生命周期 | Provider 配置与 catalog、密钥存储、上游 SDK/网络；将本轮模型事实传给执行者 |
| Tool 与 Permission/Approval | Tool 按本轮可见目录和执行身份路由调用；授权方独占授权决定、撤销和交互绑定 | Tool 可调用 MCP、内建工具与权限操作；授权方可读可信调用者/会话范围及宿主策略。模型提供的参数不能提升权限 |
| MCP | 管理 server 配置、客户端连接、协议调用及取消 | 自有配置、凭据、协议 SDK、进程/网络；通过 Tool 提供的调用范围执行，无需访问活跃 Run 或窗口 |
| Skill | 管理技能包、绑定、选择和本轮可见内容 | 文件/配置、Agent 绑定与 Session 选择操作；执行端只取已解析的技能或发出受控操作 |
| Memory、Knowledge | Memory 拥有记忆检索、摄入和维护；Knowledge 拥有知识库切片、索引和查询 | 各自数据与检索实现、获准的模型操作；Memory 通过显式输入使用会话证据及游标，维护方负责 fence |
| Plugin、Hook | Plugin 管理扩展包和能力注册；Hook 按已接受的通知运行订阅 | Plugin 对接 Skill/MCP 注册和受限宿主能力；Hook 使用自身设置、会话摘要与执行器；贡献结果受当轮预算和作用域限制 |
| Project、Workspace、File、OCR、Toolchains | 管理工作目录/文件访问、附件转换和运行环境 | 宿主授权范围、文件系统、受控原生助手与配置；向核心提供工作目录、已准备附件或命令执行能力 |
| CLI 工具授权与审计 | 颁发和撤销指定 Run、指定操作的 grant，记录因果关系 | 可信传输身份、授权策略和 journal 操作；核心只获准备/撤销本轮受限操作所需的能力 |
| 宿主投影、Desktop、Sync | 转换运行事实、裁剪客户端数据与定向通知；Desktop 刷新窗口，Sync 独占活跃集合及应用门禁 | 输出合同、内部更新、既有客户端 schema、Session 的未消费查询和删除门禁；不能推进或结算 Run |

`shared` 中的纯值类型可按需引用。`shared/logger` 会载入 Electron 工具，`shared/types/desktop` 描述窗口句柄。两者均属于公开核心依赖检查的反例。验收覆盖运行时 import 与公开类型；只把静态导入改成延迟加载不能满足边界。

## 合同与验收

1. **身份与授权。** 继续校验 IPC sender、CLI 调用身份、工具授权及 Run 归属。保留 instance、run、operation controller 和 message association 各自的校验。旧 Run 不能提交到替换后的实例；桌面能力缺席时无法执行相应操作。运行事实不携带宿主 token、原生对象或原始权限凭据。
2. **状态与显示。** 有效状态转换的可观察顺序仍为 `sessions.status.changed`、`sessions.updated`、内部 status 更新、UI 刷新。相同状态附带 usage 时只发内部更新。相同状态无新 usage 或过期实例均不产生输出。流保留 request/revision、原节流、块顺序和终态；所有客户端出口在传输前剔除 `providerReplayJson`。窗口通知失败不撤销已提交事实。
3. **持久化与恢复。** 终态消息先追加 Tape，再更新 transcript 及投影游标，同一事务成功或回滚。输入 claim、consume、release 及关联消息维持原子语义；重启不得自动执行历史 queue 或重放效果不确定的工具调用。journal 分类、pending/hold、compaction、剩余 pending message 的恢复次序保持。相同 profile 只有一个恢复/写入所有者。维护重开后读取新连接。
4. **可移植性。** 使用普通 Node 装载生产入口，禁止 Electron、Vue、具体 SQLite 驱动、桌面服务和桌面 IPC 合同进入核心的传递依赖；允许测试宿主单独加载其存储驱动。在空临时目录、无 Electron mock 的环境构造真实 Harness。脚本化模型第一轮要求一个受限工具，下一次模型请求必须收到实际工具结果，再发送第二条用户消息验证上下文连续。另验证权限等待与响应、取消、重开后恢复、提交失败回滚。
5. **兼容与范围。** Electron 通过同一入口执行内建 Agent；Direct ACP 与 ACP-as-Provider 各自可发送、取消和恢复原有状态。IPC、CLI 协议、用户数据格式和已有会话可读性是每个实施步骤的约束。生产灰度为零的 Tool Surface 仍有显式执行、诊断和历史记录，只在另有产品退役决定时处理。[灰度与历史合同](../tool-surface-virtualization/spec.md)

## 独立 Node 验收入口

```bash
pnpm run test:harness:node
```

[执行器](../../../scripts/verify-harness-node.mjs) 构建并审查生产 Harness 的静态和动态模块闭包，拒绝桌面服务、IPC 路由及具体存储实现进入核心；测试宿主另行加载真实 SQLite adapter。CJS 和 ESM 加载器分别先自检拒绝 Electron，再启动独立进程，完全避开 Vitest setup。PR Check 的必需 `test-main` job 在主进程套件后执行同一命令；失败会阻止 `pr-required` 通过。

[最小宿主](../../../test/node/deepChatHarness.ts) 使用受限文件读取工具、脚本化模型和一次性 SQLite 文件，校验两轮上下文、工具结果进入下一次模型请求、拒绝权限、重开后的授权恢复、取消、事务失败及异常退出后的队列 hold。事务失败保留已提交的 journal 终态，回滚失败的消息投影；重开不会伪造成功消息或自动重放工具。三个进程退出码依次为 `0`、预期异常退出 `73`、`0`，真实 SQLite 不可用时直接失败。
