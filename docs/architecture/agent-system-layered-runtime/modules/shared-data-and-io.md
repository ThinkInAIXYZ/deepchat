# Shared Data / IO 边界

> 状态：目标合同，不是 current API reference。ASLR-010..013、ASLR-021 与 ASLR-070..073 已接入 typed
> catalog/repository、app-session shell 和 shared projection ports；ASLR-060..061 已把 Memory prompt/
> ingestion ports 接入 DeepChat lifecycle。共享的是物理数据与投影能力，不是两个 runtime 的领域实现。

## 1. 模块目的

这个模块给 `AgentManager`、DeepChat backend 和 ACP backend 提供最少的共享基础设施：

- app session identity 与 metadata；
- typed agent catalog persistence；
- transcript/message projection；
- renderer/event output；
- session path、workspace 和 process 等真正跨 backend 的 platform ports。

核心约束是：shared table 不等于 shared domain repository，shared output 不等于 shared execution
loop。

## 2. BEFORE

当前 `AgentRepository` 同时读写 DeepChat config、ACP manual/registry/install state，返回的 `Agent`
类型也同时容纳两边字段。上层通知语义因此被混在一起。

另一方面，`src/main/lib/agentRuntime` 的名字暗示它是一套 agent runtime，实际包含：

- background process / shell environment / encoding / process tree / spawn guard / RTK；
- filesystem search；
- question tool；
- session paths；
- system environment prompt builder。

这些代码没有共同 lifecycle，只是历史上都被 agent 调用。

## 3. AFTER 的边界

```text
shared/
├─ catalog persistence codecs
├─ app-session service
├─ adapters over existing message/Tape projection writers
├─ output/event sink ports
└─ platform ports
   ├─ process/command runtime
   ├─ workspace/search
   └─ session storage paths
```

`shared/` 只能依赖 shared types、数据库基础层和 platform primitives。它不能 import DeepChat
`LoopEngine`、ACP client 或 Presenter root。

## 4. Typed repositories

保持当前 `agents` 物理表和 migration 不变，在它上面提供两个 typed view：

```ts
interface DeepChatAgentRepository {
  get(id: string): Promise<DeepChatAgentRecord | null>
  list(): Promise<DeepChatAgentRecord[]>
  create(input: CreateDeepChatAgent): Promise<DeepChatAgentRecord>
  update(id: string, patch: DeepChatAgentPatch): Promise<DeepChatAgentRecord>
  delete(id: string): Promise<void>
}

interface AcpAgentRepository {
  get(id: string): Promise<AcpManualAgentRecord | AcpRegistryAgentRecord | null>
  list(): Promise<Array<AcpManualAgentRecord | AcpRegistryAgentRecord>>
  upsertManual(input: UpsertManualAcpAgent): Promise<AcpManualAgentRecord>
  updateInstallState(id: string, state: AcpInstallState): Promise<void>
  deleteManual(id: string): Promise<void>
}
```

每个 repository 有自己的 codec，但读策略分两层：

- catalog/legacy DTO read 保持当前宽容行为：单行 JSON parse failure 使用当前 null/default/filter 规则，
  不能让整次 `listAgents()` 失败；
- executable descriptor read 验证 kind/source 和 required capability。无法运行的 row 返回 typed
  `AgentUnavailable`，不能猜成另一 kind，也不能伪造 manual command 或 registry launch spec；
- write path 对新数据保持严格验证。

DeepChat malformed config 继续按当前 default-merge 语义解析；manual ACP 缺 command、invalid
source/kind、registry install-state parse failure 和 source/id collision 各自由 Phase 0 fixture 固定当前
catalog visibility、runtime availability 与 winner/filter 结果。旧 mixed `Agent` 只由 route compatibility
mapper 产生。

## 5. App session identity

`new_sessions` 继续保存应用层 session metadata。内部使用带语义的标识，避免把本地 session id、ACP
remote session id 和 provider request id 混成一个 `string`：

```ts
type AppSessionId = string & { readonly __brand: 'AppSessionId' }
type AcpRemoteSessionId = string & { readonly __brand: 'AcpRemoteSessionId' }
type GenerationId = string & { readonly __brand: 'GenerationId' }
```

这些 brand 只用于编译期，不改变数据库或 wire representation。

薄 `AppSessionService`/data port 复用当前 `new_sessions` owner，负责 title、project、pin、draft、window
binding、agent identity 和 session 清理的应用层事务。`session_kind` 仍只表示 `regular | subagent`；
backend kind 每次由 `agent_id -> AgentDescriptor` 解析。backend 不能复制一套 session table owner。

### ASLR-072 shared data ports

production switch 没有把 shared data methods 塞进 `AgentManager`。`AgentSessionPresenter` 与 direct ACP
backend 通过四个独立 facet 访问现有 owner：

```ts
interface AgentSharedDataPorts {
  sessionState: AgentSessionStatePort
  transcript: AgentTranscriptReadPort
  transcriptMutation: AgentTranscriptMutationPort
  tape: AgentTapePort
}
```

- `AgentSessionStatePort` 保留 init/destroy、full/lightweight state、permission、generation settings 和
  project-dir persistence；
- `AgentTranscriptReadPort` 服务 title/history/export/message lookup；
- `AgentTranscriptMutationPort` 服务 clear/edit/delete/fork/retry preparation，retry preparation 继续执行原
  summary 与 Memory invalidation，再把合法 input 交给当前 backend；
- `AgentTapePort` 服务 query/handoff/replay 与 subagent merge/discard。

当前这些 port 由 `AgentRuntimePresenter` 作为过渡 adapter 实现，但 direct ACP 的网络 prompt、pending、
permission、generation 和 ACP control 不通过该 presenter 执行。后续 ownership slice 可以替换 adapter，
无需修改 `AgentManager` 或 public route。Memory 的 data/state owner、schema 与触发规则在 `ASLR-072`
没有移动。

## 6. Transcript 与 output ports

本目标不发明第四套 `TranscriptEvent` / message union。共享的是对当前 writer 的窄 adapter，类型直接
复用现有 `MessageStartResult`、`LLMCoreStreamEvent`、message/block DTO、Tape fact input 与 typed
renderer events：

```text
DeepChat LoopEngine
  -> adapter over current MessageStore/TapeService/tapeFacts/event publisher

ACP protocol event
  -> current ACP event/content mapping (`LLMCoreStreamEvent` where already used)
  -> AcpCompatibilityProjectionAdapter
  -> the same current structured message/Tape/event writers

ACP prompt request
  -> AcpRequestTracePort
  -> existing trace persistence/context (not a transcript type)
```

`AcpCompatibilityProjectionAdapter` 明确复现当前外层 runtime 的：Tape bootstrap、user/assistant message
create、stream block update、tool/message fact、ViewManifest attempt、terminal status/event 和 refresh
顺序。这样 restart/history/search/export 继续读取同一 structured projection。`acp_sessions`/`acp_turns`
仍是 remote binding/turn metadata，不是 transcript 内容库。

exact TypeScript port shape 在 Phase 0 从当前 writer call sites 裁剪；没有第二个真实调用需求的方法不
进入接口。旧 renderer payload 继续由现有 typed boundary 生成。

## 7. 事务与一致性

- agent catalog write 和对应 catalog revision/notification 在一个明确 application operation 中完成；
- app session delete/clear 继续调用 backend-specific cleanup，再完成 shared metadata 清理；delete cleanup
  不要求 catalog descriptor 仍可执行，direct ACP durable metadata 通过独立 data port 删除；
- DeepChat Tape/message/trace 的事务边界保持现状，由 DeepChat data ports 管理；
- ACP session/turn metadata 持久化保持 ACP owner；direct ACP 的 transcript 仍写当前 structured
  message/Tape projection；
- transcript projection 失败不能假装 backend fact 已经不存在，恢复策略沿用当前实现；
- 不引入跨 SQLite owner 的分布式 transaction abstraction。

## 8. `lib/agentRuntime` 的机械归属（ASLR-032 已完成）

迁移只纠正 ownership，不改变逻辑：

| 原内容 | 当前 owner |
| --- | --- |
| `backgroundExec*`、`shellEnvHelper`、`shellOutputEncoding`、`processTree`、`spawnGuard`、`rtk` | `src/main/agent/shared/process/` |
| `fffSearchService` | `src/main/agent/shared/workspace/` |
| `questionTool` | `src/main/presenter/toolPresenter/agentTools/questionTool.ts` |
| `sessionPaths` | `src/main/agent/shared/storage/sessionPaths.ts` |
| `systemEnvPromptBuilder` | `src/main/agent/deepchat/resources/systemEnvPromptBuilder.ts` |

移动时在同一个机械 PR 内改完 imports/tests 并删除旧文件，不建立临时 compatibility 目录。机械 move
PR 不允许同时修改行为或公共类型。

## 9. 错误与安全

- row codec 错误带 agent id/kind 和安全的字段名，不记录 secret/config 全量；
- output sink 对 renderer 消失保持当前 fail-safe 语义；
- trace/request body 不进入通用 transcript；
- platform process port 不向 catalog/session 层暴露 raw child-process handle；
- workspace/path port 必须继续执行当前 path normalization 与 scope 检查；
- 删除 session 时遵循现有 Tape、message、Memory、ACP row 清理顺序，不由 shared 层猜测。

## 10. 迁移步骤

1. 冻结当前 table/schema/DTO/event 快照。
2. 冻结 malformed `config_json`/`state_json`、missing manual command、invalid source×kind 和 id collision
   的 catalog/runtime matrix。
3. 在原 repository 外增加两个 typed codec/view，不移动表；catalog tolerant read 与 executable strict
   read 分开。
4. 引入 `AppSessionService`，先由旧 Presenter 委托。
5. 对现有 message/Tape/event/trace writers 裁剪窄 ports，并为 direct ACP 建
   `AcpCompatibilityProjectionAdapter` / `AcpRequestTracePort` characterization tests；不新增 canonical
   event union。
6. 把两个 backend 改为依赖 ports，而不是互相或 Presenter root。（direct ACP shared-data slice 已由
   `ASLR-072` 完成；compatibility ACP session/permission/admin port separation 已由 `ASLR-073` 完成；
   DeepChat typed backend 与 legacy façade retirement 已由 `ASLR-090` 完成）
7. 逐项移动 `lib/agentRuntime` 文件，在同一 slice 更新 imports/tests 并删除旧路径。（已完成）
8. 所有 import 收敛后删除旧 mixed repository API 和旧目录。

## 11. 验证

- 对当前数据库 fixture 做 typed round-trip，字段与排序无 diff；
- malformed JSON、missing command、invalid source×kind、manual/registry id collision 不会让 catalog
  batch 失败，且 runtime available/unavailable 与当前行为一致；
- DeepChat/ACP catalog CRUD 与通知分别测试；
- legacy mixed DTO snapshot 完全一致；
- transcript/event golden fixture 在迁移前后逐项相等；
- ACP restart/history/search/export 继续从现有 structured projection 得到相同内容，`acp_turns` 不被
  误当成 transcript；
- session clear/delete/destroy 覆盖半完成 generation、active ACP process 和 Memory pending work；
- import graph guard 阻止 `shared -> deepchat`、`shared -> acp implementation`；
- secret、request body 和 tool raw payload 不因通用 projection 被额外持久化。

## 12. 明确不做

- 不合并 DeepChat 与 ACP 的事实表；
- 不重命名数据库表或 id；
- 不创建通用 ORM/repository framework；
- 不把所有 platform utility 塞进一个新的 `shared/utils`；
- 不更改 renderer transcript schema。
- 不创建新的 canonical transcript/message/event model。
