# main 进程架构整理：实施计划

> 状态：实施中
> 当前阶段：App 启动与退出
> 书写规则：说明使用直白中文；代码标识、文件路径和命令保持原文。
> 实施依据：[Session 实施边界](./session.md) 和 [App 启动与退出边界](./app.md) 已确认；每批按删除优先规则执行。

## 怎么推进

这是保持现有行为的架构迁移，不是重写。目标架构和当前实现要分开记录，避免现有目录、
依赖和临时兼容代码在没有讨论的情况下变成长期设计。

我们逐个模块讨论。每个模块都要先回答以下问题：

1. 现在有哪些行为，哪些地方在调用它；
2. 有哪些长期数据、内存状态、计算结果和外部资源；
3. 每份状态何时创建、如何变化、何时结束；
4. 每份状态和每项资源由谁负责；
5. 哪些模块可以调用它，它可以依赖哪些模块；
6. 哪些现有行为必须保持；
7. 对外最少需要哪些操作和查询；
8. 怎样分批迁移，旧代码满足什么条件后删除；
9. 用什么测试和自动检查保证结果。

只有已经确认的结论才写入 [spec.md](./spec.md) 的“已确定的结论”表。新发现的待确认问题先记录，
解决前不实施对应部分。

## 工作规则

- 先看完整产品流程和生命周期，再决定 class、interface 或目录。
- 除非明确作出新决定，否则保持现有行为。
- 一个职责完整的模块可以有多个内部文件，不要为了拆分而增加多个公开 coordinator。
- 模块内部优先直接使用具体依赖。只有真正跨模块，或实现确实需要替换时，才增加 port。
- 不写临时兼容入口。每批实施时先删除旧实现和旧引用，再根据编译错误补齐唯一的新路径。
- 职责和依赖方向没有确认前，不搬文件。
- 不靠“先检查方法是否存在再调用”、全局 getter、事后 setter 注入或 `as unknown as` 绕过
  创建顺序问题。
- 移动处理逻辑时，先保持现有 route 和 event 不变。
- 目标边界落地后再增加依赖检查；检查目标架构，不冻结当前错误结构。
- 不用可选注入、方法存在检查、双读、双写、旧路径优先或运行时 fallback 托底。
- 每一批改动都必须能单独测试和检查。需要撤销时回退整个 commit，不在代码中保留旧方案。
- 只有代码实际改变后，才更新描述当前实现的文档。

## 需要查清的现状

设计时至少要覆盖：

- 产品定位、主界面和 settings 界面；
- 当前启动和退出顺序；
- Desktop 的 window、tab 和 renderer 生命周期；
- Session 的 create、restore、activate、send 和 delete 流程；
- `DeepChat` 和 `ACP` 的运行实例由谁创建与清理；
- Provider、Tool、MCP、Skill、Plugin、Memory、Knowledge、Workspace、Remote 和 Cron 的配合方式；
- Scheduler、file watcher 和 command execution 使用的后台 utility process；
- 当前依赖图和循环依赖报告。

当前拓扑只用于帮助迁移，现有节点不自动成为未来模块。

## 讨论和实施顺序

### 阶段 0：确定总方向

记录并确认：

- 产品实际运行方式；
- 生命周期；
- 目标依赖方向；
- 各模块负责什么；
- 启动和退出方向；
- 不做什么，以及防止方案漂移的规则。

这个阶段只建立本目录，不修改生产代码。

### 阶段 1：Session

所有交互和后台任务最终都会使用 Session，所以先确定 Session，再改 App 启动入口。

需要产出：

- Session 用词及其准确含义；
- Session 各份状态的负责模块；
- 生命周期和状态变化图；
- Desktop、Remote、Scheduler 等调用方清单；
- 最小操作与查询 API；
- Session 与 Agent 运行模块的关系；
- Desktop 的 renderer 绑定放在哪里；
- transcript、Tape 和 status 由谁负责；
- 必须保持的行为清单；
- 分批迁移和删除旧代码的条件；
- 每一批需要的测试和依赖检查。

### 阶段 2：App 启动与退出

Session 的依赖确定后：

- 定义 App 启动入口最后返回哪些最少对象；
- 把通用启动 hook 改为已确认的固定启动步骤；
- 定义停止接收新任务和退出的顺序；
- 定义 database import/reset/sync 期间由 App 控制的维护状态和恢复顺序；
- 定义启动失败后的清理；
- 删除全局访问路径；
- 写明删除 `Presenter` 和 `LifecycleManager` 的条件。

### 阶段 3：Desktop

需要确定：

- `BrowserWindow`、`WebContents`、tab、settings、floating、tray 和 browser overlay 由谁负责；
- renderer 如何绑定 Session；
- close、hide、deactivate、detach 和 destroy 分别做什么；
- 如何向 renderer 发送界面需要的 Session 状态并在 renderer 销毁时清理；
- multi-window 和 multi-tab 行为如何保持。

### 阶段 4：Agent 运行

保留现有正确做法，同时明确：

- Agent 信息和 backend 选择；
- `DeepChat` 与 `ACP` 运行实例由谁负责；
- 每个活跃 Session 何时载入一个实例；
- 每次 Turn 的 Run 状态；
- close、evict、cleanup、delete 和 App 退出时分别怎样处理；
- Agent 运行代码不能依赖 Desktop、Remote、Scheduler 或 App 启动入口。

这一阶段主要删除意外形成的 `Presenter` 适配，不重写执行算法。

### 阶段 5：Agent 执行所需能力

分别讨论：

- Provider 和 model catalog / runtime；
- Tool 列表、执行和 permission；
- MCP server 生命周期；
- Skill 文件、发现、同步和 Session 选择；
- Plugin package 生命周期和能力登记；
- Memory 数据、运行状态和后台写入；
- Knowledge 索引和检索；
- Workspace、文件和 watcher。

这些模块保持同级，不新增一个总管理器。

### 阶段 6：外部入口和结果接收方

需要确定：

- Remote channel 以及 endpoint 与 Session 的绑定；
- Scheduler 如何查找到期任务、创建 detached run 并发送结果；
- deeplink 如何发起操作；
- Hook 和其他模块怎样接收结果通知；
- 哪些调用是直接操作，哪些只是 event 通知。

所有入口只依赖 Session 的公开 API，不能直接依赖 Agent 实例或通用 `Presenter`。

### 阶段 7：Platform、Config、数据存储和通信

各业务模块职责稳定后：

- Config 只保留底层 settings/secret 能力，具体配置由对应模块负责；
- SQLite 只保留 connection、transaction 和 migration，具体数据访问由对应模块负责；
- route handler 放到或注册到负责该行为的模块，同时保持有类型的通信约定；
- 把伪装成 event 的业务命令改成直接调用；
- 每批职责迁移时同步移动对应文件，不把实体目录调整集中留到最后；
- 最后重新生成依赖基线，并更新描述当前代码的文档。

## `EventBus` 处理计划

当前分类已经写入 [spec.md](./spec.md)。实施时按以下顺序处理：

1. 对每个 event 再检查一次发送方和接收方，防止实现期间调用关系已经变化。
2. 先删除没有发送方、没有接收方以及与 typed event 重复的 main `EventBus` 调用。
3. 把 Shortcut、Tray、退出状态、更新状态和设置后必须执行的操作改成直接调用，并保持原有
   `await`、错误处理和先后顺序。
4. `FIRST_CONTENT_LOADED`、`MCP_EVENTS.INITIALIZED` 和 startup proxy ready event 已改成直接
   调用；继续把 `RENDERER_TAB_READY` 改成明确的 ready 状态或可等待步骤。
5. MCP、Provider、window 和 lifecycle 等“状态已经变化”的 event，先按目标负责模块重新检查：
   跨模块且确有观察者的通知保留；只在同一个模块内部使用的改成普通函数调用。
6. 在 Session 阶段决定关闭 tab/window 后是否继续 Turn、保留 Agent runtime 或释放 runtime，
   再处理 `TAB_EVENTS.CLOSED` 和 `WINDOW_EVENTS.WINDOW_CLOSED`。
7. 所有调用迁移后，如果不再有真正的跨模块 main 通知，直接删除全局 `EventBus`；不为了形式
   保留空壳。

发给 renderer 的 `publishDeepchatEvent()` 不在这次 main 内部 `EventBus` 清理范围内，现有 typed
event 名称和数据保持不变。

## Session 详细设计步骤

本节的结果已经汇总到 [Session 实施边界](./session.md)。后续发现现有代码与该边界冲突时，先更新
决策和任务，再修改生产代码。

### 1. 列出现有行为和调用方

逐一跟踪所有 Session 入口：

- main renderer 的 create、restore、activate、deactivate、send、steer、queue、retry、fork、
  transfer、compact、close 和 delete；
- multi-window 和 tab 生命周期；
- Remote 的 create、use、open、stop、model、agent 和 pending 流程；
- Cron 创建 detached Session、判断完成、取消和发送结果；
- subagent 的 create、merge 和 discard；
- Tool、MCP、floating UI、Hook、export、history、search、translation 和 usage 查询；
- 启动恢复和 App restart；
- `DeepChat` 与 `ACP` 运行实例清理；
- data import/reset/sync。

清单里要区分正在使用的正式路径和只为旧版本兼容保留的路径。

### 2. 统一 Session 用词

必须给下面这些词写出准确含义：

- `SessionRecord`
- `SessionRuntime`
- `SessionBinding`
- `SessionStatus`
- `Draft`
- `Regular Session`
- `Detached Session`
- `Remote-bound Session`
- `Subagent Session`
- `Active`
- `Hydrated`
- `Generating`
- `Paused`
- `Closed`
- `Evicted`
- `Archived`
- `Deleted`

如果两个词实际上没有表示不同状态，就删掉一个，不为名词强行增加代码结构。

### 3. 按存在时间列出状态

至少完成下表。`TBD` 必须在方案通过前补齐。

| 状态 | 当前由谁负责 | 是否保存 | 应存在多久 | 目标负责模块 | 谁会读取或修改 |
| --- | --- | --- | --- | --- | --- |
| Session identity/title/Agent/workdir | TBD | 长期保存 | 跨 App restart | TBD | TBD |
| renderer binding | TBD | 不保存 | 与 `WebContents` 相同 | Desktop | TBD |
| generation settings | TBD | 保存或计算 | 与 Session 相同 | TBD | TBD |
| runtime status | TBD | 不保存或计算 | 与 Agent instance / Run 相同 | TBD | TBD |
| pending inputs | TBD | 保存或不保存 | 与 Session / Run 相同 | TBD | TBD |
| paused interactions | TBD | 保存或不保存 | 与 Run / instance 相同 | TBD | TBD |
| transcript | TBD | 长期保存 | 与 Session 相同 | TBD | TBD |
| Tape | TBD | 长期保存 | 与 Session 相同 | TBD | TBD |
| active Skills/tools | TBD | 保存或计算 | 与 Session 相同 | TBD | TBD |
| ACP remote session/process | TBD | 外部资源和长期元数据 | 与 Agent instance 相同 | Agent 运行模块 | TBD |

每一行没有唯一负责模块前，不确认目标 API。

### 4. 明确各状态怎样变化

至少覆盖：

~~~text
create -> draft/ready -> activate? -> send -> generating
                                  -> paused -> resume
                                  -> cancel -> ready
                                  -> terminal -> ready

renderer bind <-> renderer unbind
runtime hydrate <-> runtime evict
Session retain/archive/delete
~~~

要明确哪些状态互不依赖。例如 renderer 是否正在显示、Agent 实例是否已经载入、Session 是否
长期存在，不能合并成一个 `active` boolean。

### 5. 定义 Session 的最小公开 API

需要判断调用方真正需要什么，而不是先决定 interface。候选内容包括：

- create、fork、archive 和 delete；
- send、steer、queue、cancel 和 respond；
- Agent/settings 调整；
- Session、transcript 和 Tape 查询；
- Desktop binding，预计留在 Desktop，不属于长期 Session 数据。

最终可以使用少量函数或内部文件，但不能成为新的全局模块查找入口，也不能暴露 Provider、
Tool、Memory、database table 或 window object。

### 6. 定义与 Agent 运行模块的关系

必须说明：

- Session 何时读取 Agent 信息；
- 何时打开 backend handle；
- 哪些查询允许载入 Agent 实例；
- 初始化失败后如何清理；
- cancel 和 pending interaction 由谁负责；
- close、evict 和 delete 的区别；
- `DeepChat` 与 `ACP` 哪些行为相同，哪些有意不同；
- App restart 后如何恢复。

### 7. 分别写清各入口流程

对 Desktop、Remote、Scheduler 和 subagent，分别记录：

- 从哪里发起操作；
- 如何查找或创建 Session；
- 谁负责绑定关系；
- 如何允许 Agent 开始执行；
- 状态和结果怎样送回；
- 入口消失后清理什么；
- Session 或 Agent 不可用时怎样处理。

不同入口必须共用同一套 Session 基本规则。

### 8. 固定必须保持的行为

移动职责前完成下表，并为关键行为找到已有测试或补充测试。

| 流程 | 当前行为 | 证明当前行为的资料或测试 | 允许改变什么 |
| --- | --- | --- | --- |
| renderer create/send | TBD | TBD | 只改变负责模块 |
| restart 后恢复 | TBD | TBD | 只改变负责模块 |
| window close/hide | TBD | TBD | 可理清清理规则，不改变用户体验 |
| Remote bind/continue | TBD | TBD | 只改变负责模块 |
| Cron detached run | TBD | TBD | 只改变负责模块 |
| subagent lifecycle | TBD | TBD | 只改变负责模块 |
| ACP resume/cleanup | TBD | TBD | 只改变负责模块 |
| delete tree | TBD | TBD | 只改变负责模块 |

### 9. 设计分批迁移方式

每一批实施都要：

1. 先用测试固定即将移动的现有行为；
2. 先删除这一组旧实现、旧属性和旧引用；
3. 用编译错误确认这组调用方的完整范围；
4. 创建或移动已确认的负责模块，只补齐唯一的新路径；
5. 迁移这组调用方，同时保持 route 约定；
6. 增加自动依赖检查；
7. 更新描述当前实现的文档；
8. 完成验证后提交这一批。

同一份状态不能同时有两个可写入口。

## Session 预计迁移顺序

在详细问题没有解决前，下面只是暂定顺序：

1. 把 Desktop renderer binding 从 Session 长期数据中分离；
2. 在不改变 renderer 通信约定的前提下，建立稳定的内部 Session 入口；
3. 让 Desktop 使用该入口；
4. 让 Remote 和 Scheduler 使用相同的 Session 规则；
5. 明确 Session 与 Agent 运行模块的调用；
6. 删除不再需要公开的 coordinator；
7. 删除 Session 调用方对全局 `Presenter` 的依赖；
8. 每批职责迁移和依赖清理完成后，在同一批改动中移动对应实体文件。

## 数据兼容和迁移

默认不改变持久化数据。职责可以移动，但现有 table、column、config key 和有类型的 route
约定保持不变。

如果 Session 设计确实要求修改 schema 或数据含义，计划必须补充：

- 向前 migration；
- 新旧代码混用或执行一半失败时的行为；
- backup 和 rollback；
- 对启动时间的影响；
- import/export/sync 兼容；
- 明确的验证方式。

## 测试办法

### 先固定现有行为

保留或补充能覆盖以下行为的高价值测试：

- Session create/draft/send/restore/delete；
- restart 后数据仍存在；
- multi-window binding 和 renderer destruction；
- `DeepChat` 与 `ACP` backend selection；
- active generation cancellation 和 paused interaction；
- Remote binding 和 continuation；
- Cron detached run；
- subagent create/merge/discard；
- permission 和 Skill state；
- title/status 发给界面的结果。

### 每批改动必须证明

- 对应入口只依赖已确认的 Session API；
- 长期数据只有一个写入方和负责模块；
- renderer 销毁不会删除 Session；
- delete 会清理两类 backend 和长期数据；
- 不需要全局 `Presenter` 查找；
- shutdown 重复调用也安全。

### 自动依赖检查

目标边界落地后，自动检查可以禁止：

- 导入已经停用的 `Presenter` 路径；
- Desktop 导入 Agent 运行内部文件；
- Session 导入 Electron window 或 Remote/Scheduler 协议代码；
- Agent 运行代码导入入口、route 或 App 启动代码；
- 新增替代 `Presenter` 的总入口；
- 对同一份状态重复创建负责对象。

### 每批质量检查

先运行与改动最相关的最小测试，再按影响范围运行：

- 相关 main test；
- renderer binding 或界面状态变化时运行 renderer test；
- 需要时运行 launch/chat/restart/settings/Remote/Cron E2E；
- `pnpm run format`；
- `pnpm run i18n`；
- `pnpm run lint`；
- `pnpm run typecheck`。

## 文档更新

- 设计和实施期间持续更新本目录。
- `docs/ARCHITECTURE.md` 与 `docs/FLOWS.md` 始终如实描述当前代码。
- 某批改动改变了已维护模块的约定时，更新对应旧 SDD。
- 先记录结论，再改代码。
- 每批可单独检查的改动落地后，勾选 [tasks.md](./tasks.md)。
- 不顺便清理无关 SDD。

## 撤销办法

每批是一个完整 commit。如果需要撤销，回退整个 commit。不为了撤销在生产代码中保留
旧实现、兼容层、双读、双写或 runtime fallback。非必要不改 schema；必须改 schema 时单独设计
数据 migration，不与职责搬迁混在同一批。
