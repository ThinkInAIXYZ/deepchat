# Agent System Layered Runtime — 总体设计

> 状态：implementation complete；`ASLR-000..092` 已完成，最终全量验证与受控 baseline
> regeneration 记录见 [migration-and-validation.md](./migration-and-validation.md#aslr-092-final-close-out-record)。
> 迁移前基线：`dev@1a57d15b99a6`（2026-07-11）
> 本文是已实现架构的决策入口。`spec.md` 定义验收合同，`migration-and-validation.md`
> 保留兼容与验证证据，`modules/` 描述各模块的本地合同。

## 结论

迁移前的问题不是“Presenter 文件太长”这么简单，而是三种不同层次被压进了同一组类型和
singleton。以下问题描述是迁移前的历史快照：

1. agent catalog / session application control plane；
2. 某个具体 agent session 的运行时实例；
3. DeepChat 自己拥有的 LLM/tool loop。

迁移前，ACP 又被包装成 LLM provider，穿过 DeepChat loop 后再进入 ACP 自己的外部 loop。这个双层执行
模型让统一抽象看似成立，实际只能靠 optional method、`providerId === 'acp'` 和 fallback 分支维持。

本次迁移目标不是把 ACP 与 DeepChat 变成两个毫无关系的孤岛，也不是创建一个万能 hook/plugin
框架。已实现目标是：

- 顶层只共享 catalog、app session shell、transcript/event projection 与资源选择引用；
- ACP 与 DeepChat 使用两个明确的 session backend；
- DeepChat 每个 session 对应一个 `DeepChatAgentInstance`；
- DeepChat 专属 `LoopEngine` 负责固定、typed、可 await 的生命周期；
- MCP、skills、memory 等继续由原模块拥有，通过窄 adapter 参与 loop；
- 现有 Tape 继续作为 append-only semantic ledger，不另建第二套 Tape，也不把 raw token stream
  伪装成可重放事实。

当前实施边界：`AgentManager` 已按 strict `AgentDescriptor.kind` 路由 typed DeepChat backend 与 direct ACP
backend；fake registry、unified optional implementation、reflection legacy backend 和 agent handle
legacy/direct runtime-kind 分支均已退休。DeepChat 使用 lazy `DeepChatAgentRuntime`、per-session
`DeepChatAgentInstance`、per-turn `LoopRun` 与 fixed awaited `DeepChatLoopEngine` lifecycle；`kind=acp` 使用
`AcpAgentRuntime`/`AcpAgentInstance` 和 external protocol loop。`kind=deepchat + providerId=acp` 仍明确走
DeepChat loop + `AcpProvider` compatibility。

Memory runtime orchestration 已收敛到唯一 `MemoryRuntimeCoordinator`，通过 awaited
`MemoryPromptContributor` 与 background `MemoryIngestionObserver` 接入；Tape tool facts 已迁到 stable
per-fact `TapeRecorder` path，causal observation 只读联结现有 Tape/message/trace。`AgentSessionPresenter`
只保留 core session lifecycle/turn/assignment/shared projection façade；typed routes 直接组合 history、
translation、export、usage、RTK 与 catalog owner，startup hooks 直接调用 migration/maintenance owner。
`AgentRuntimePresenter` 保留 DeepChat state/delegate 与 adapter wiring；两者不再构成 generic agent runtime。
current docs、architecture guards 与 baseline generator
已在 `ASLR-091` 收敛；`ASLR-092` 已完成 canonical baseline write、全量
main/renderer/Memory/native/build/E2E gates 与最终契约 diff。

## 文档地图

| 文档 | 单一职责 |
| --- | --- |
| [spec.md](./spec.md) | 目标、约束、决策、验收标准 |
| [migration-and-validation.md](./migration-and-validation.md) | 兼容矩阵、回滚边界、测试门禁 |
| [modules/agent-manager.md](./modules/agent-manager.md) | 顶层 control plane 与 kind router |
| [modules/shared-data-and-io.md](./modules/shared-data-and-io.md) | shared table、typed repository、transcript/output ports |
| [modules/acp-runtime.md](./modules/acp-runtime.md) | 独立 ACP process/session/protocol backend |
| [modules/deepchat-agent-instance.md](./modules/deepchat-agent-instance.md) | per-session 实例与状态所有权 |
| [modules/loop-engine-and-lifecycle.md](./modules/loop-engine-and-lifecycle.md) | DeepChat round loop、typed stages、await/pause |
| [modules/tape-and-observability.md](./modules/tape-and-observability.md) | Tape facts、manifest、trace、projection |
| [modules/prompt-context-and-compaction.md](./modules/prompt-context-and-compaction.md) | prompt 顺序、Tape view、budget、compaction |
| [modules/tools-skills-and-mcp.md](./modules/tools-skills-and-mcp.md) | tool/resource resolution 与独立 owner |
| [modules/permission-and-interactions.md](./modules/permission-and-interactions.md) | ordered tool interactions、ACP permission、pause/fresh resume |
| [modules/memory-integration.md](./modules/memory-integration.md) | Memory 的两个 loop seam 与不可回归合同 |

## BEFORE：迁移前历史快照

### 迁移前规模与职责

| 位置 | 迁移前规模 | 迁移前职责 |
| --- | ---: | --- |
| `agentSessionPresenter/index.ts` | 4210 行 / 158 methods | route facade、session CRUD、DeepChat/ACP dispatch、draft/subagent/transfer、title、import、search、export、dashboard |
| `agentRuntimePresenter/index.ts` | 7636 行 / 229 methods / 41 readonly fields | 所有 session 的内存态、turn orchestration、prompt、provider、Tape、compaction、memory、permission、tool、events |
| `agentRuntimePresenter/process.ts` | 626 行 | 真正的 provider round + tool loop |
| `agentRuntimePresenter/dispatch.ts` | 1873 行 | tool execution、permission、pause、normalization、persistence、renderer projection |
| `agentRuntimePresenter/tapeService.ts` | 1838 行 | Tape bootstrap/effective view/search/manifest/replay/fork |
| `llmProviderPresenter/providers/acpProvider.ts` | 2035 行 | ACP process/session/prompt/permission/event 到 LLM provider 的兼容包装 |
| `agentRepository/index.ts` | 597 行 | DeepChat config 与 ACP manual/registry/install state 的混合 repository |

更早的 presenter-split 提案只把问题定义成 façade service extraction，没有覆盖随后进入 runtime 的
Memory、projection、agent-scoped extensions 和 ACP 分离，因此已由本设计取代；历史内容通过 Git
记录查询，不再作为仓库内并行架构入口。

### 迁移前调用关系

```text
Renderer / typed routes
        │
        ▼
AgentSessionPresenter (4210 lines)
        │
        ├─ AgentRegistry
        │    └─ production only registers "deepchat"
        │
        └─ resolves BOTH deepchat/acp to one AgentRuntimePresenter
                         │
                         ├─ all sessions stored in session-keyed Maps
                         ├─ prompt/context/compaction/memory/tools/permission
                         ├─ processStream + dispatch
                         └─ provider.coreStream
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
             normal LLM provider         AcpProvider
                                                │
                                                ▼
                                      external ACP process loop
```

迁移前的 `AgentRegistry` 不是实际 manager：生产只注册一个 `deepchat` implementation，遇到任意已知
`deepchat` 或 `acp` agent id 都返回这个 implementation。UI catalog 反而来自
`ConfigPresenter -> AgentRepository`。

### 迁移前 DeepChat initial turn 顺序

下列迁移前顺序是迁移期间必须保持的兼容合同：

```text
accept input / claim pending item
  -> status=generating + register pre-stream AbortController
  -> resolve session skills, final ToolPresenter tool set, extension policy and base prompt
  -> ensure Tape ready and snapshot pre-turn history
  -> prepare optional compaction intent
  -> if intent:
       create compaction projection
       -> append user message fact
       -> apply compaction
       -> trigger the then-current compaction-to-Memory path only after a normal initial-path return
     else:
       append user message fact
  -> emit user refresh and dispatch UserPromptSubmit notification (fire-and-forget)
  -> append summary/reconstruction/memory sections
  -> assemble Tape effective view and context
  -> create mutable assistant placeholder
  -> consume the claimed pending item / emit initial assistant refresh when required
  -> enter runStreamForMessage and register the active generation
  -> for each outer provider round
       -> increment providerRoundCount and enforce max
       -> for each provider attempt in that round (strict retry may add one)
            refresh prompt/tools when required
            -> context preflight / pressure recovery
            -> increment requestSeq
            -> synchronously attempt request ViewManifest (failure logs and remains fail-open)
            -> rate-limit gate
            -> provider.coreStream + accumulate blocks + throttled echo
            -> on strict overflow retry, repeat the attempt without incrementing providerRoundCount
       -> execute/intercept/normalize/persist each tool call under the current policy
       -> collect ordered interactions and execution state from pre-check, question,
          post-call permission or skill draft
       -> continue next provider round
  -> finalize assistant fact and terminal events
  -> drain pending input when allowed
  -> schedule non-blocking Memory extraction when the then-current rules admit it
```

### 迁移前根因

1. `IAgentImplementation` 是 optional capability soup，而不是两个对等 runtime 的公共合同。
2. `Agent` 同时携带 `type`、`agentType?`、DeepChat-only `config` 与 ACP-only `installState`。
3. 一个 singleton 用几十个 `Map<sessionId, ...>` 模拟实例所有权。
4. `processMessage`、`runStreamForMessage`、`processStream`、`dispatch` 分别持有一段 lifecycle。
5. `AgentRepository` 的物理表复用扩散成了 domain repository 与通知语义也复用；DeepChat CRUD
   甚至调用 `notifyAcpAgentsChanged()`。
6. `src/main/lib/agentRuntime` 实际包含 process/shell/search/path/question 等不同 owner 的工具，
   名称让它看起来像第二套 agent runtime。
7. 迁移前 hooks notification 是 `queueMicrotask` fire-and-forget observer，不是可以 await 的 loop
   lifecycle。

## AFTER：已实现的当前架构

```text
typed routes / remote / cron
              │
              ▼
      AgentManager (control plane)
      ├─ AgentCatalog
      │   ├─ DeepChatAgentRepository ─┐
      │   └─ AcpAgentRepository      ├─ shared agents table + typed codecs
      ├─ AppSessionService ──────────┴─ new_sessions / transcript projection
      └─ explicit switch(agent.kind)
          │
          ├─ kind=deepchat
          │    ▼
          │  DeepChatAgentRuntime
          │    └─ DeepChatAgentInstance(sessionId)
          │         ├─ identity + effective session config
          │         ├─ generation/pending/interaction state
          │         └─ DeepChat LoopEngine
          │              ├─ fixed typed lifecycle
          │              ├─ resource contributors/adapters
          │              ├─ ProviderPort / ToolPort
          │              ├─ TapeRecorder / OutputSink
          │              └─ per-turn LoopRun state
          │
          └─ kind=acp
               ▼
             AcpAgentRuntime
               └─ AcpAgentInstance(sessionId)
                    ├─ process / remote session / workdir
                    ├─ ACP protocol prompt + permission
                    ├─ ACP MCP delivery adapter
                    └─ existing message/Tape/event compatibility adapter

Independent owners (not children of AgentManager):
  McpPresenter | SkillPresenter | MemoryPresenter | PluginPresenter | LLMProviderPresenter
        └─ expose narrow ports/adapters to the relevant backend

Session boundary owners (composed by typed routes and lifecycle hooks):
  SessionHistorySearch | SessionTranslation | AgentSessionExportService | UsageStatsService
  LegacyChatImportService | session-data migrations | available-agent catalog | RTK runtime service
```

DeepChat backend 内的 provider selection 独立于 agent kind：

```text
DeepChat LoopEngine -> generic ProviderPort
                         ├─ ordinary LLM provider
                         └─ AcpAsLlmProviderAdapter (compatibility; providerId=acp)
```

### 完成后会发生什么变化

| 关注点 | BEFORE | AFTER |
| --- | --- | --- |
| agent dispatch | fake registry 按 id 解析，两个 kind 都回到同一 runtime | `AgentDescriptor.kind` 显式 `switch` 到两个 agent-session backend；provider selection 仍是 DeepChat session 内的正交维度 |
| shared types | optional 字段袋与 mega-interface | discriminated descriptor/backend；kind-specific required capabilities |
| session runtime | singleton + session-keyed maps | 一个 active/hydrated session 一个 `DeepChatAgentInstance` 或 `AcpAgentInstance` |
| DeepChat loop | 跨 4 个大文件的隐式顺序 | 一个 DeepChat-only `LoopEngine`，固定 typed stages |
| async lifecycle | ad hoc callbacks；外部 hooks 不可 await | 内部 lifecycle 可 await；只有 typed tool interaction outcome 可产生 persistent pause；外部通知仍 non-blocking |
| ACP | ACP agent 与 DeepChat agent 选择 ACP provider 都经过外层 DeepChat loop | `kind=acp` 使用独立 backend；`kind=deepchat + providerId=acp` 保留兼容 provider adapter |
| MCP/skills | Presenter 调用散落在 runtime | 原 Presenter 继续拥有资源，DeepChat/ACP 各用不同 delivery adapter |
| permission | DeepChat tool permission 与 ACP protocol permission 在同一 runtime 汇合 | 共用 UI decision/output port，但两个 backend 各自拥有 continuation |
| Tape | message/tool facts、anchors、manifest、trace 分散调用 | 同一现有 Tape，由 `TapeRecorder` 明确写入顺序与 provenance |
| Memory | orchestration 约 600 行嵌在 runtime | 保持 `MemoryPresenter` 不动；一个 awaited prompt contributor + 一个 background ingestion observer |
| `lib/agentRuntime` | 无明确 owner 的混合目录 | 文件迁到 process runtime、tool、workspace 或 DeepChat prompt 等真实 owner |
| public API/data | route/event/schema/table 已上线 | 在本重构中保持兼容；旧 DTO 只存在于 boundary adapter |

### 不会发生什么变化

- 不改变 renderer route name、input/output schema、typed event name 或 payload。
- 不改变 `agents`、`new_sessions`、`deepchat_*`、`acp_sessions`、`acp_turns` 的 schema。
- 不把 Tape 改成 raw token/event log，也不增加第二个 Tape store。
- 不改变 prompt section 顺序、tool collision policy、permission policy、tool 并发条件或
  tool-output fitting。
- 不改变 ACP regular session 与 ACP-backed subagent 当前已被测试锁定的差异。
- 不改变旧数据/API 允许的 `kind=deepchat + providerId=acp` 组合；它仍是 DeepChat session，并继续走
  DeepChat loop 与 ACP provider compatibility adapter。
- ACP direct backend 继续写现有 structured message/search/export projection 与当前 Tape facts；
  `acp_turns` 仍只保存 ACP turn metadata，不能替代 transcript；现有 request trace 在
  `connection.prompt` 前以相同 correlation/redaction/fail-open 语义写入。
- 不修复在审计中发现的现存行为不对称；若要修，另开行为变更目标。
- 不改写 Memory service/schema/projection/retrieval/maintenance。
- 不把 MCP、skills、memory 的全局数据 owner 搬进 `AgentManager`。
- 不引入 DI container、generic event bus、priority-based plugin pipeline 或新依赖。

## 目标目录模型

这是 ownership 模型，不要求一次提交创建全部文件；每个实施 slice 只创建当前需要的实体。

```text
src/main/agent/
├── manager/                   # control plane and kind routing
├── shared/                    # app-session/transcript/output ports and boundary codecs
├── acp/                       # ACP catalog/process/session/protocol/persistence/mapping
└── deepchat/
    ├── instance/              # per-session DeepChat state/lifecycle
    ├── loop/                  # provider round + tool loop state machine
    ├── resources/             # explicit adapters/contributors
    ├── memory/                # runtime coordinator + prompt/ingestion ports; MemoryPresenter stays owner
    └── pending/               # durable pending input coordination

src/main/presenter/
├── agentSessionPresenter/     # retained route/application/shared-projection façade
└── agentRuntimePresenter/     # retained DeepChat state/delegate + message/Tape/resource adapters
```

最终路径名可以在每个机械 move PR 中按仓库约定微调，但以下依赖方向不可改变：

```text
manager -> shared contracts -> concrete backend
deepchat instance -> loop -> narrow ports
acp instance -> ACP protocol modules -> narrow shared IO ports
resource adapter -> independent presenter/service owner

forbidden:
loop -> presenter root singleton
loop -> Electron window/routes
kind=acp backend -> DeepChat LoopEngine
MemoryPresenter -> DeepChat runtime implementation
MCP/SkillPresenter -> AgentManager state
```

## 最薄共同合同

内部 canonical descriptor 使用 `kind`，不再传播 `type + agentType?` 双字段：

```ts
type AgentDescriptor = DeepChatAgentDescriptor | AcpAgentDescriptor

interface AgentDescriptorBase {
  id: string
  kind: 'deepchat' | 'acp'
  name: string
  enabled: boolean
}

type AgentSessionBackend =
  | { kind: 'deepchat'; session: DeepChatAgentInstance }
  | { kind: 'acp'; session: AcpAgentInstance }
```

`kind` 只决定 agent-session backend，不限制 DeepChat 的 provider。ACP descriptor 内再用
`source: 'manual' | 'registry'` 区分 required launch fields，不能假设每个 ACP agent 都有 registry 或
install state。

`AgentManager` 默认显式 `switch (kind)`。只有双方真实共享的操作才有共同入口：
`open`、`send`、`cancel`、`close`、`snapshot`。其余能力必须 kind-specific，不得重新变成 optional
method：

- DeepChat：Tape、compaction、pending/steer、generation settings、local tools、skills、memory。
- ACP：remote session、workdir、mode/config options、commands、process、protocol permission。

## DeepChat lifecycle

生命周期是固定 pipeline，不是开放式插件排序器：

```text
prepareTurn
  -> prepareInput
  -> assembleRequest
  -> startProviderRun
  -> enterProviderRound (increments/checks providerRoundCount)
       -> beforeProviderRequest (increments requestSeq per attempt)
       -> consumeProviderRound
  -> executeToolBatch (0..n)
  -> afterRoundPersisted
  -> settleTurn
```

允许 await 的 seam：

| Seam | 类型 | 能否持久 pause | 主要参与者 |
| --- | --- | --- | --- |
| `assembleBasePrompt` | ordered awaited contribution | 否 | base/runtime/env/skills/tooling/permission；发生在 compaction intent 之前 |
| `prepareInput` | awaited coordinator | 否，只等待/取消 | Tape/history、compaction intent、user fact、apply compaction |
| `contributeContextPrompt` | ordered awaited contribution | 否 | summary/reconstruction/memory；发生在 compaction 之后 |
| `beforeProviderRequest` | awaited gate/transform | 否，只等待/取消 | budget/recovery/manifest/rate limit |
| `executeToolBatch` | awaited operation + typed outcome | 是，只有合法 tool interaction origin 可返回 ordered pause outcome | pre-check permission、question、post-call permission、skill draft |
| `afterRoundPersisted` | awaited commit callback | 否 | Tape/output state |
| `afterTurnSettled` | commit callback + observers | 只有内部 commit awaited | pending drain、Memory ingestion、notifications |
| `afterCompactionApplyReturned` | normal-return callback | 否 | only initial/context-pressure current Memory ingestion trigger；throw/no-intent 以及 resume/manual 不调用 |

`pause` 会结束当前 provider run；用户逐项处理 ordered interactions，中间项不会创建 run，只有最后一项
解决后才按现状从持久 projection/context 创建一个新的 resume run，不是恢复旧 call stack。raw
`onProviderEvent` 不开放为 await hook。它是流式 hot path，继续使用纯 accumulator 与节流 echo。

外部 `HooksNotificationsService` 继续是 fire-and-forget observer。让用户 shell command 阻塞 agent
loop 会改变现有性能、超时和取消语义，因此明确禁止。

ASLR-057 已把这条边界落实为 typed notification observer。loop 只交付 detached snapshot，且不 await
observer Promise/thenable；同步异常、异步拒绝与悬挂均不改变 terminal outcome。auto-grant、review、
streaming permission、skill activation/cache 是独立 control collaborators，interleaved-reasoning trace
属于 internal diagnostics。现有 hook payload、调用顺序、agentId fallback、route/config、`queueMicrotask`
与 command timeout 不变。

## Tape 语义

目标可观测链由现有 Tape、trace 与 message terminal projection 共同组成，不逐 token 记日志：

```text
user message fact
  -> context/view manifest
  -> assistant/tool call/tool result facts
  -> compaction/handoff/memory audit anchors
  -> current terminal message status + optional current runtime status
```

`ASLR-080` 已在现有 replay reader 上增加 pure-read causal observation slice：request 通过
`sessionId/messageId/requestSeq` 精确联结 ViewManifest 与 trace，assistant/tool output 只能声明
`message_only` correlation。renderer terminal event history 当前没有持久化事实，read model 明确返回
`eventHistory=not_persisted`，不能从 pending/terminal message 反推历史事件；runtime status 也只接受调用方
从已 hydrate instance 非物化 peek 得到的当前值，否则为 unavailable。

`ASLR-081` 已用 injected storage seams 与可用时的 native SQLite tables 固化 non-interference：所有 read
模式前后的 Tape order/ViewManifest、message/trace、effective view、replay hash、Memory ingestion
projection/cursor 与完整 user schema 相同，现有 table/projection/cursor write seams 为零调用；AST guard
禁止 reader 引入 Memory runtime value import/call。cooldown 不属于 `DeepChatTapeService`；ASLR-059 已将其
迁移到唯一 `MemoryRuntimeCoordinator` 并用 public coordinator contract 覆盖。该证明没有填补历史
renderer event 缺口；
`eventHistory=not_persisted` 仍是 read model 的真实边界。

- `deepchat_tape_entries.entry_id` 继续提供 per-session monotonic order。
- mutable streaming block 继续保存在 message projection；final/replacement/retraction 进入 Tape。
- request body/headers 继续只在 trace storage；现有 messageId/requestSeq correlation 保持，不向 Tape
  新增 trace reference payload。
- 本目标不新增 interaction/terminal Tape entry；若现有 facts + projection 无法满足新的审计需求，另立
  data/behavior SDD，不能在结构重构中顺手改变 effective view。
- `memory/*` 与 `persona/*` anchors 继续是 non-reconstruction。
- session clear/delete 仍可按当前合同删除 Tape；“append-only”描述的是存续 session 内的修改模型，
  不是永久不可删除。
- live replay 不能重放外部 provider/tool side effect；本目标只保证 audit/replay slice 可解释。
- old session 即使没有 Tape/ViewManifest 也只返回 partial/unavailable read model，不触发 bootstrap/backfill。

## 状态所有权

| 状态 | 目标 owner |
| --- | --- |
| agent identity、kind、display summary | `AgentCatalog` |
| app session title/project/pin/draft/window binding | shared `AppSessionService` / `new_sessions` |
| DeepChat effective config、status、pending inputs、ordered interactions | `DeepChatAgentInstance` |
| pre-stream cancellation before active generation registration | `DeepChatAgentInstance` preparation state |
| active run、abort signal、per-attempt requestSeq、outer providerRoundCount、round messages、overflow retry flags | per-turn `LoopRun` |
| ACP process handle、remote session id、mode/config/commands | `AcpAgentInstance` / ACP runtime |
| message projection、Tape facts、trace | narrow adapters over existing stores/types |
| MCP server definitions/runtime | `McpPresenter` |
| skill catalog/content/runtime | `SkillPresenter` |
| memory rows/vector/maintenance | `MemoryPresenter` |
| Memory extraction chains/epochs/retry cooldown/injection-access dedupe | DeepChat `MemoryRuntimeCoordinator` adapter（现有 runtime orchestration 的唯一新 owner） |
| session history search / translation / current export | typed session route owners / `AgentSessionExportService` |
| usage backfill and dashboard | `UsageStatsService` |
| legacy default import and session-data startup migrations | `LegacyChatImportService` / stateless startup migration functions |
| available-agent filtering / RTK health | available-agent catalog policy / RTK runtime service |

## 实施原则

1. Strangler migration：旧 façade 始终可调用，内部逐步 delegation；每个 slice 可单独回滚。
2. 先 characterization，再移动 ownership；发现 bug 时单独修复，不夹在 refactor commit。
3. 先拆 control plane 与 instance，再抽 loop/ACP/Tape adapter；Memory 最后接线。
4. ACP catalog/control plane 可以早拆，ACP direct execution 必须晚拆并有 parity tests。
5. 共享物理表不等于共享 domain repository；本目标不做 DB rename。
6. 任何 prompt、request、event 或 Tape order 差异都视为 blocking regression，除非另有批准的行为 spec。

## 完成标准

当且仅当下列条件同时满足，目标才算完成：

- fake `AgentRegistry` 与 `IAgentImplementation` optional mega-interface 已删除。
- internal agent descriptor 只用 discriminated `kind`；legacy DTO alias 只在 route adapter。
- `kind=acp` session 不再进入 DeepChat `LoopEngine`；DeepChat agent 选择 ACP provider 的兼容路径仍可
  通过 generic `ProviderPort` 进入 ACP provider adapter。
- DeepChat session state 由实例持有，LoopEngine 不保存跨 session mutable maps。
- LoopEngine 不 import presenter root、Electron window/routes 或 concrete SQLite presenter。
- prompt/tool/permission/compaction/memory 调用顺序与基线一致。
- Tape/trace/ViewManifest/replay 与 Memory 全部不可回归合同通过。
- renderer routes/events 和持久化 schema 无未批准 diff。
- `src/main/lib/agentRuntime` 被清空/删除，文件归属真实 owner。
- 当前 architecture docs 与 guard 已更新，旧 split proposal 不再显示为并行实施计划。

## 关联现有合同

本设计不复制以下事实，实施时直接以它们为维护合同：

- [Agent System current state](../agent-system.md)
- [DeepChat vs ACP current comparison](../deepchat-vs-acp-agents/spec.md)
- [Tape baseline](../deepchat-tape-baseline/spec.md)
- [Tape view assembler](../deepchat-tape-view-assembler/spec.md)
- [Tape view policy](../deepchat-tape-view-policy/spec.md)
- [Tape replay contract](../deepchat-tape-replay-contract/spec.md)
- [Agent-scoped extensions](../agent-scoped-extensions/spec.md)
- [Agent Memory architecture](../agent-memory-system/spec.md)
