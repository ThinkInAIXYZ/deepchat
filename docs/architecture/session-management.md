# Session 管理

Session 是可长期保存的产品对象；window、renderer、Remote endpoint、Agent instance 和单次 Run
都比它短命。

## 当前所有权

| 能力 | Owner |
| --- | --- |
| create、draft、close | `src/main/session/lifecycle.ts` |
| send、queue、stop、interaction response | `src/main/session/turn.ts` |
| Agent/model/project/transfer/subagent assignment | `src/main/session/assignment.ts` |
| list、restore、status、projection query | `src/main/session/query.ts` |
| full delete transaction | `src/main/session/deletion.ts` |
| transcript | `src/main/session/data/transcript.ts` |
| Tape / ViewManifest | `src/main/session/data/tape*.ts` |
| generation settings / Memory cursor | `src/main/session/data/settings.ts` |
| pending input | `src/main/session/data/pendingInputs.ts` |
| renderer binding | `src/main/desktop/sessionBinding.ts` |
| backend selection | `src/main/agent/manager/agentManager.ts` |

各入口只接收自己需要的 Session port。不存在聚合全部能力的 Session facade，也不允许 window
binding 进入持久化 Session 数据。

## 创建与发送

```mermaid
sequenceDiagram
    participant E as Desktop / Remote / Scheduler
    participant S as SessionLifecycle / SessionTurn
    participant D as Session data
    participant M as AgentManager
    participant B as DeepChat or ACP backend

    E->>S: create / send canonical input
    S->>D: persist Session and user input
    S->>M: resolveSessionHandle(sessionId)
    M-->>S: typed backend handle
    S->>B: initialize / send / cancel
    B->>D: persist projection and Tape
    B-->>E: typed state events
```

route 只做 schema 和 transport adapter。所有入口在进入 `SessionTurn` 前必须得到同一种 canonical
send input；Remote、Scheduler 和 renderer 不得各自维护不同的默认值或 permission 语义。

## 恢复与查询

- `sessions.restore` 返回最近一页，`sessions.listMessagesPage` 使用 keyset pagination 拉取旧历史。
- 普通 list/history/binding query 不 hydrate Agent instance。
- Session status 不持久化：已载入时来自 backend snapshot，未载入为 `idle`。
- structured transcript 是当前 read model；legacy conversations/messages 仅用于一次性 import 和明确的
  export conversion。
- history search 优先使用 search document / FTS path，失败时回退受控 SQL search；坐标和 scroll
  归 renderer viewport owner，不写回 Session。

## Binding

`DesktopSessionBinding` 维护 `webContentsId -> sessionId`：

- activate 读取 projection 并绑定 renderer；
- deactivate、tab close 或 window destroy 只删除 Desktop binding；
- 关闭最后一个 window 不默认 cancel Turn、clear permission、evict runtime 或 delete Session；
- Remote 和 Scheduler 有自己的 binding/run identity，不能复用 Desktop 状态。

## Close、delete 和 transfer

`handle.close()` 停止并驱逐所选 backend runtime，但保留 app-session shell。Full delete 的顺序是：

```text
cleanup both backend caches without hydration
  -> remove ACP durable binding
  -> remove transcript / Tape / pending / settings
  -> clear permission and active Skill state
  -> delete app-session row
```

因此 missing、disabled 或 malformed agent row 不会阻止旧 Session 被删除。

Transfer 先验证 target descriptor 和 kind-specific setting，再提交 assignment，最后关闭旧 runtime。
失败不得留下半迁移 Session。删除 Agent 时使用相同的 descriptor-independent cleanup，不直接删除用户
Session 数据，除非用户执行明确的 Session 删除操作。

## Project 和目录

Session 只保存 `projectDir`。目录生命周期、默认目录、archive/remove/reorder 和文件是否存在由
`src/main/project/` 负责；Workspace 负责访问授权与文件能力。移除目录不会删除真实文件，相关 Session
按产品合同转为 no-project 或保留 ACP resume 所需 workdir。

## 防回归

- Agent 或 Session 不得依赖 Desktop、Remote、Scheduler、Routes 或 App。
- query 不得偷偷 launch ACP process 或 hydrate DeepChat instance。
- app-session row 必须在所有 owned data 清理完成后最后删除。
- `new_sessions.subagent_enabled` 只作为旧数据库兼容列，不能重新成为授权来源。
- 当前入口从 `src/main/session/routes.ts`、`sessionService.ts`、`chatService.ts` 追踪；不要恢复
  `SessionPresenter` 或 `AgentSessionPresenter`。
