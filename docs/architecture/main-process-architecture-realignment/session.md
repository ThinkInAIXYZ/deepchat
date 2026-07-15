# Session 实施边界

> 状态：已确认，实施中
> 范围：main 进程中的 Session 长期数据、操作、查询和运行关系
> 约束：保持现有 route、event、数据库和用户行为；每批先删除旧路径，再补齐唯一的新路径。

## 一句话定义

Session 是可以跨 App 重启保留的任务记录。它不是 window、tab、Remote channel、Cron run、
已载入的 Agent 实例，也不是一次 Turn。

Desktop、Remote、Scheduler、deeplink 和 subagent 都使用同一套 Session 操作。入口可以保存
自己的绑定，但不能各自实现一套 Session 生命周期。

## 当前依据

本方案按下面这些当前实现确定，不从旧目录名反推职责：

- `new_sessions` 保存 Session 身份和长期字段；
- `deepchat_sessions` 保存 DeepChat Session 的 model、permission、generation settings、summary
  和 Memory cursor；
- structured message、Tape、pending input 和 search/trace 表保存可恢复的 Session 数据；
- `acp_sessions` 保存 ACP remote session 和恢复所需数据；
- `AppSessionService`、`src/main/session/` 中的 Session 操作、`AgentManager`、DeepChat backend 和
  ACP backend 已经承担当前主要调用链；
- Desktop、Remote、Cron 和 subagent 已经通过窄 port 调用上述能力；
- 第一批删除前，`SessionPresenter` 只剩旧 conversations/messages、旧 thread 广播和关闭事件兼容路径，
  不在当前 Agent Session create/send 主链路中；这些运行路径现已删除。

## 状态和唯一负责模块

| 状态或资源 | 是否保存 | 存在多久 | 唯一负责模块 |
| --- | --- | --- | --- |
| `id`、`agentId`、`title`、`projectDir`、`isPinned`、`isDraft`、`sessionKind`、`parentSessionId`、`subagentEnabled`、`subagentMeta`、`createdAt`、`updatedAt`、`metadata` | 是 | 到明确 delete | Session |
| active Skills、disabled Agent tools | 是 | 与 Session 相同 | Session；Skill/Tool 负责解释和执行 |
| provider/model、permission、generation settings | 是 | 与 Session 相同 | Session 保存最终选择；Agent 默认值只在 create、draft 或明确 reset 时读取 |
| transcript | 是 | 与 Session 相同 | Session data 中独立的 transcript 文件；Agent runtime 通过窄写入接口追加事实 |
| Tape、summary、search result、trace | 是 | 与 Session 相同 | Session data 中各自独立的文件；不塞回 Session identity store |
| pending input | 是 | 被消费、删除或 Session delete | Session Turn；Agent runtime 负责 claim 和执行 |
| renderer binding | 否 | 与对应 `WebContents` 相同 | Desktop |
| Remote endpoint binding | 按现有 Remote 规则保存 | 到解绑或 Session delete | Remote |
| Cron job/run/delivery 状态 | 是 | 与 Cron 记录相同 | Scheduler |
| `DeepChat` / `ACP` instance | 否 | hydrate 到 evict、delete 或 App stop | Agent 运行 |
| active Run、abort、Tool 调用 | 否 | 一次 Turn | 对应 Agent instance |
| permission/question/draft review 等 Interaction | 否 | 当前 Run 响应、取消或失效 | 当前 Run / Agent instance |
| ACP child process 和 remote session handle | 部分保存恢复信息 | runtime close、delete 或 App stop | ACP runtime |
| Session status | 否，是计算结果 | 查询时 | 已载入时读 Agent instance；未载入时为 `idle` |

这里的“独立文件”表示职责和代码边界，不要求新增 class、interface 或数据库表。

## 用词

- `SessionRecord`：长期保存的 Session 身份和字段，不包含 window 或 runtime object。
- `SessionRuntime`：某个 Session 当前载入的 Agent instance；目标代码统一使用 Agent instance，
  不再把它当成另一份 Session。
- `SessionBinding`：某个入口到 Session 的映射。Desktop、Remote、Scheduler 各自负责自己的映射。
- `SessionStatus`：`idle | generating | error` 的查询结果，不保存到 `new_sessions`。
- `Draft`：已经写入数据库、但还没有正式 Turn 的 Session。send、steer 或 queue 按当前规则把它
  变成普通 Session。
- `Regular Session`：`sessionKind === 'regular'`。
- `Subagent Session`：`sessionKind === 'subagent'`，同时保存 `parentSessionId` 和 `subagentMeta`。
- `Detached Session`：没有 Desktop binding 的普通 Session。它不是新的 `sessionKind`。
- `Remote-bound Session`：Remote 保存了 endpoint binding 的普通 Session。它不是新的
  `sessionKind`。
- `Forked Session`：由 fork 操作创建的 Session。复制内容的规则属于 fork 操作，不增加长期状态。
- `Active`：不再作为 Session 的单一状态。需要分别说 renderer 已绑定、runtime 已载入或 Run 正在执行。
- `Hydrated`：Agent instance 已载入。
- `Generating`：当前存在 active Run。
- `Paused`：当前 Run 正在等待 Interaction，不是长期 Session 状态。
- `Closed`：不作为 Session 公开状态。使用 unbind、cancel、evict、delete 表达真实操作。
- `Evicted`：Agent instance 已释放，Session 和长期数据仍存在。
- `Archived`：当前产品没有 Session archive 状态，本轮不新增。
- `Deleted`：Session 长期数据、子 Session 和运行资源已经按删除事务清理。

## 生命周期

~~~text
create -> draft 或 ready -> send / queue / steer -> generating
                                             -> paused -> respond
                                             -> cancel
                                             -> idle

Desktop bind <-> Desktop unbind
Agent hydrate <-> Agent evict
Session retain -> delete
~~~

这些变化互相独立：

- Desktop unbind 不会 delete Session，也不会默认 cancel Turn 或 evict Agent instance；
- 最后一个 tab/window 关闭时，Desktop 只删除 renderer binding；正在运行或等待 Interaction 的
  Session 继续存在，Remote、Scheduler 或以后重新打开的 Desktop 可以继续接收结果；
- delete 会先停止该 Session 的运行资源，再清理 child、transcript、Tape、pending input、permission、
  Skill 选择和 Session row；
- cancel 只结束当前 Turn；
- evict 只释放 Agent instance，不删除长期数据；
- App stop 可以按固定退出顺序 cancel 或等待 Run，然后让 Agent 运行模块释放 instance。

## 什么时候可以载入 Agent instance

下面的操作可以 hydrate：

- send、steer、queue 后立即执行、retry、respond；
- 需要 runtime 当前值的完整 restore；
- 修改当前 backend 的 model、permission、generation settings、ACP mode/config/command；
- compact、transfer 检查和其他明确需要 backend 的操作。

下面的查询不能 hydrate：

- `SessionRecord` get/list/page；
- lightweight list；
- title、pin、project、parent、metadata 查询；
- history search、普通 transcript page、export；
- Desktop、Remote 和 Scheduler binding 查询。

未载入 instance 时，Session status 返回 `idle`。如果 Agent 不可用，读取长期数据仍然可用；真正
需要执行或完整 runtime projection 的操作返回明确错误，不猜 backend，也不 fallback。

## runtime eviction 条件

普通运行期间只有同时满足下面条件才允许 evict：

1. 没有 active Run；
2. 没有等待中的 Interaction；
3. 没有已经 claim 但尚未完成的 pending input；
4. backend 的恢复信息已经保存；
5. runtime 拥有的后台写入、Tool process 和 ACP child process 已完成或已由 runtime 正确停止。

未 claim 的持久化 pending input 可以保留到下次 hydrate。App stop 和 Session delete 使用各自明确的
停止规则，不假装满足普通 eviction 条件。

## 对外操作

Session 不提供一个重新导出所有能力的总对象。调用方按需要依赖下面的窄操作：

- Lifecycle：create、createDetached、createSubagent、ensureDraft、fork、delete；
- Turn：send、steer、queue、pending input 修改、retry、edit/delete message、cancel、respond、compact；
- Assignment：transfer、model、project、permission、generation settings、disabled tools、active Skills、
  subagent settings、ACP config/command；
- Query：get/list/lightweight list、transcript page、Tape、trace、search result、status、rename、pin；
- Notification：发布已经发生的 create/update/delete/status 事实。

Desktop 的 activate/deactivate/getActive 不属于 Session API。它们由 Desktop 的 binding 代码组合
Session Query 和通知。

## 不保留的 cache 和兼容边界

- 删除 `AppSessionService.windowBindings`；renderer binding 移到 Desktop；
- 删除旧 Session Query 中的 active-window 操作；
- 删除旧 Session Query 的 `sessionStatusSnapshots`。lightweight 查询直接读取已载入 runtime
  的非启动快照，未载入时返回 `idle`；
- 删除旧 `SessionPresenter`、`ConversationManager`、旧 tab binding 和 `Presenter` 上对应转发；
- 旧 conversations/messages 只允许由一次性 import 和明确的 legacy export reader 读取，不再作为
  运行时 Session；
- 不新增 `SessionManager`、`SessionApplicationServices` 或汇总四类操作的 facade。

## 入口如何共用生命周期

- Desktop：create 后建立 renderer binding；关闭只 unbind。
- Remote：create/use 只保存 endpoint binding；send/cancel/respond 调用相同 Turn 操作。
- Scheduler：每个 run 用 createDetached 创建新的普通 Session，在自己的表保存 job/run/delivery。
- deeplink：解析后直接调用 Lifecycle 或 Desktop 打开操作，不用 event 控制先后顺序。
- subagent：用 createSubagent 创建 child，执行仍走同一 Agent 运行模块，merge/discard 只处理 parent
  和 child 的 Tape 关系。

## 删除优先的实施批次

1. [已完成] 删除旧 `SessionPresenter` 运行路径、旧 thread 广播和 tab/window close compatibility；仅把仍被
   legacy export 使用的读取和格式化代码移到 exporter 下面。
2. [已完成] 删除 `AppSessionService` 的 window binding 和 Projection 的 activate/deactivate；
   `src/main/desktop/sessionBinding.ts` 直接拥有 binding，并保持 typed route 不变。
3. [已完成] 删除 Projection 的 status cache；lightweight 查询只读取已经载入的 Agent runtime，
   未载入或 Agent 不可用时返回 `idle`。
4. [已完成] 删除 `sessionApplication` 的 presenter 命名和公开 coordinator 层级。当前实现位于
   `src/main/session/`，由 `SessionLifecycle`、`SessionTurn`、`SessionAssignment`、`SessionQuery`
   和内部策略、删除事务分别负责；没有增加 facade。
5. 删除 `AgentRuntimePresenter` 的 shared data 兼容适配，把 transcript、Tape、settings 和 pending input
   接到 Session data，把 DeepChat/ACP 执行留在 Agent 运行模块。
6. 所有入口迁移后，删除 `Presenter` 上的 Session 属性和全局查找路径。

每批先搜索全部调用方，删除旧入口，再补齐唯一的新 owner。禁止 optional method、运行时 capability
probe、双写、双读和 fallback adapter。

## 每批验证

- 只运行受影响的 typecheck、architecture guard 和已有小范围 test；
- 不为搬文件复制测试；测试跟随 owner 移动；
- 只有现有测试无法固定关键调用顺序时才写临时 test，用完即删；
- 阶段结束再运行 main test；最终收口时才运行完整检查和必要 E2E；
- 每批一个 commit，不包含 `output/`，不 push，不创建 PR。
