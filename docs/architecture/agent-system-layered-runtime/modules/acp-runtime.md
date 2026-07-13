# ACP 独立 Runtime

> 状态：目标合同，不是 current API reference。ASLR-030..034 已收拢 ACP catalog、launch、client、
> process、session、protocol 与 persistence owner；ASLR-070..073 已接入 typed direct runtime，并让
> production router 只对 `kind=acp` 选择该路径。DeepChat 选择 ACP provider 的兼容路径仍保留。
> 下文 interface、adapter 和迁移步骤是边界合同；只有实施进度明确列出的 slice 才代表当前代码。

## 1. 模块目的

ACP domain 管理 catalog/registry/install/launch/alias/debug、process/client、remote session、protocol
prompt、permission continuation、MCP 配置交付和 ACP turn metadata。`kind=acp` 共享 app session 与
现有 message/Tape/event projection，但不共享 DeepChat 的 provider/tool round loop。

必须区分两个当前合法路径：

```text
kind=acp                         -> direct AcpAgentInstance
kind=deepchat + providerId=acp   -> DeepChat LoopEngine -> AcpAsLlmProviderAdapter
```

第二条在本目标内保留，因为 main route/config 和旧数据没有禁止该组合。

## 2. BEFORE

当前 ACP 请求路径是：

```text
AgentSessionPresenter
  -> AgentRuntimePresenter
  -> DeepChat request preparation / provider round
  -> AcpProvider.coreStream()
  -> ACP client/session prompt
  -> external ACP agent loop
```

`AcpProvider` 需要把 ACP protocol event 翻译成 LLM stream event，让外层 DeepChat runtime 看起来在
调用普通 provider。传入的 DeepChat `_tools` 并不是 ACP 工具注入来源；ACP 实际通过自己的 session
configuration/MCP 协议使用工具。

这造成两个问题：

- 外层 DeepChat loop 与内层 ACP loop 的责任重叠；
- ACP 专属 process/session/mode/command/permission 状态被迫穿过 provider abstraction。

## 3. AFTER 的所有权

```text
ACP domain
├─ catalog/install/launch/alias/migration/debug boundaries
├─ provider-model refresh compatibility adapter
├─ AcpRuntimeOwner
│  └─ shared client/process/session runtime + AcpSessionController
└─ AcpAgentRuntime
   ├─ AcpAgentInstance cache/lifecycle
   ├─ AcpCompatibilityPromptBuilder
   ├─ AcpPermissionBridge
   ├─ AcpRequestTracePort -> existing provider trace persistence
   └─ AcpCompatibilityProjectionAdapter -> current message/Tape/event writers

AcpAgentInstance
├─ appSessionId
├─ agentDescriptor
├─ workdir
├─ process/client handle
├─ remoteSessionId
├─ mode/config options/commands
└─ active prompt + cancellation state
```

`AcpAgentRuntime` 是 keyed instance factory/cache 与 direct lifecycle；`AcpRuntimeOwner` 是 composition
级 client/session/process lifetime owner。协议运行状态由 `AcpAgentInstance` 持有。实例不 import
DeepChat Tape、compaction、Memory 或 `LoopEngine`；composition adapter 只通过窄 port 复用现有
prompt resource 与 transcript writers。

“一个 ACP domain owner”不表示一个 God class。`AcpCatalogConfigAdapter`、
registry/install/launch-spec、alias、debug route、provider model catalog/enable refresh 和 lifecycle
helper 分别保留窄 sub-owner，但不能继续散落成互不知情的第二实现。

Phase 3 收拢后的过渡所有权如下；后续 direct backend 只能替换 adapter 背后的实现，不能重新把这些
职责搬回 generic presenter：

| Concern | Transitional owner |
| --- | --- |
| ACP catalog、registry cache/icon、catalog migration | `src/main/agent/acp/catalog/` |
| install、launch spec、interactive setup terminal | `src/main/agent/acp/launch/` |
| agent-id alias compatibility | `src/shared/utils/acpAgentAlias.ts` |
| legacy config-store bridge | `ConfigPresenter/AcpCatalogConfigAdapter` boundary adapter |
| process、remote session、persistence、protocol mapping | `src/main/agent/acp/runtime/` + `client/` |
| debug actions、provider model refresh | `AcpProvider` compatibility adapter, delegated by `LLMProviderPresenter` |
| startup migration、shutdown cleanup | narrow `LifecyclePresenter` hooks delegating to ACP owners/adapters |

## 4. Session 生命周期

```text
open app session
  -> resolve typed ACP descriptor
       manual: required command/args/env
       registry: registry reference + nullable install overlay + resolved launch spec
  -> resolve and validate workdir
  -> create/reuse ACP client process
  -> load remote session when current metadata allows
       or create new ACP remote session
  -> apply MCP servers and protocol config
  -> publish initial mode/config/command capabilities

send prompt
  -> for regular sessions, build the current runtime/env/tool/skill/local-resource compatibility system prompt
     (ACP-backed subagent keeps its current bypass)
  -> create current user/assistant message and Tape projection through compatibility adapter
  -> attempt the current ViewManifest write (fail-open)
  -> pass rate admission and cancellation checks
  -> open/reuse the ACP remote session
  -> persist/mark ACP turn metadata start (`user_message_id` remains null)
  -> connection.prompt(remoteSessionId, prompt)
  -> map protocol events to existing stream/message/block types
  -> update current structured message/Tape/event projection
  -> bridge permission requests and await user decision
  -> persist turn terminal state
  -> update app session summary/status

cancel/close
  -> cancel active protocol prompt
  -> settle terminal projection
  -> release/reuse process according to current policy
```

load/resume/new 的判定、workdir、remote session id 复用和 process reuse 必须由现有 ACP tests/fixtures
锁定后原样迁移。

process exit 会立即驱逐 `AcpSessionManager` 的 live record 和 handlers，但保留 persisted remote
session id；下一次 public `getOrCreateSession` 仍按 resume -> load -> new 恢复，不能复用已退出 process 的
connection。request timeout 与 cancel/process exit 分开结算：timeout 取消 protocol request、turn/session
进入 error；caller/process abort 的 turn 为 cancelled、session 回到 idle。

## 5. Backend 合同

```ts
interface AcpAgentRuntime {
  getOrHydrate(input: AcpAgentRuntimeSessionInput): Promise<AcpAgentInstance>
  prepare(input: AcpAgentRuntimeSessionInput): Promise<AcpAgentInstance>
  send(
    input: AcpAgentRuntimeSessionInput,
    content: string | SendMessageInput
  ): Promise<MessageStartResult>
  closeByAgent(agentId: string): Promise<void>
  closeAll(): Promise<void>
}

interface AcpAgentInstance extends AcpAgentSessionHandle {
  readonly kind: 'acp'

  prepare(): Promise<void>
  updateWorkdir(workdir: string | null): Promise<string>
  setMode(modeId: string): Promise<void>
  setConfigOption(optionId: string, value: string | boolean): Promise<AcpConfigState | null>
  getModes(): { current: string; available: AcpMode[] } | null
  getConfigOptions(): AcpConfigState | null
  getCommands(): AcpSessionCommand[]
}
```

这些 ACP-only methods 是 required facet，不加入公共 `AgentSessionHandle` 变成 optional。
`ASLR-071` 已把 mode/config/command、workdir prepare、pending queue/steer、readiness/snapshot 和
regular/subagent production collaborators 接到 typed direct runtime；`ASLR-072` 已通过 discriminated
direct handle 将这些能力接到 app route。session-state、transcript mutation 和 Tape 仍是独立 shared
ports，不被塞回公共 handle 或 `AgentManager`。
当前 route 与 ACP SDK 没有独立 `executeCommand` 操作证据；available commands 仍是 prompt 输入提示，
因此本设计不发明该 facet。若协议/route 后续增加命令执行能力，另立合同。

### ASLR-071 composition 与生命周期

- `LLMProviderPresenter` 创建唯一 lazy `AcpRuntimeOwner`；direct runtime 与 `AcpProvider` adapter 共享同一
  `AcpClientRuntime`、session manager、process manager、persistence、prompt controller 和 content mapper；
- provider disable/remove/rebuild 只清理 adapter-local permission continuation，不关闭 shared owner；
- rate admission 仍以一个 ACP provider state 保持全局 QPS/last-request order，只给 queued item 标记
  `provider` / `acp-direct` scope；compatibility adapter retirement 只 reject `provider` waiter，不删除 state
  或影响 direct waiter；
- agent refresh 顺序固定为 direct instance close -> remote session clear -> process release；global shutdown
  顺序固定为 lifecycle fence -> direct hydration/prepare/send drain + closeAll -> session clearAll -> process
  shutdown，且 root lifecycle 是唯一全局关闭点；fence 开始后 lazy client/instance materialization 一律拒绝；
  session-scoped initialization abort 会让共享同一 conversation 的 caller 一致失败，不等待挂起的
  getConnection/resume/load/new RPC；late SDK settlement 由 epoch fence 消费并清理，不得重新注册 handler、
  写 persistence 或发布 capability；process manager 的 fence 在 shutdown 入口同步生效，不等待未决
  spawn/warmup，late handle 只进行幂等、identity-safe disposal；旧 handle 的延迟 unbind 只清理旧进程，
  不得移除或终止已替换的 bound handle；
- `AcpSessionController` 统一 open/prepare/workdir、mode/config/commands、capability events 与
  session-info/usage metadata mapping，compatibility provider 不再保留第二份 mapper；process initialization
  在 session record publish 前 flush 的 update 按 remote session 和 restore attempt 隔离；失败的
  resume/load attempt 整组丢弃，只有成功 record 对应 attempt 的 update 在 record 可见后按原序
  map/persist/publish；
- direct runtime 使用现有 `PendingInputCoordinator`，没有第二份 queue/store；idle initial queue 可直接
  claim，active steer promotion 等待旧 turn terminal 后按 steer-first drain，prepare 中 steer 保持 queued；
- descriptor/config identity 变化时严格拒绝当前 open，不关闭、替换或复用旧 instance；malformed
  session id、kind、descriptor/config id/source、command 或 scope 同样在 hydration 前失败；并发 hydration
  按 app session single-flight，
  close/prepare-cleanup 即使 session clear 失败也 finally 驱逐 identity-matched cache；prepare-only process
  exit 同样只驱逐 live instance，保留 durable remote-session binding 供下一次 hydrate 恢复；
- regular prompt 保持当前 runtime/tool/skill/local-resource description，ACP-backed subagent 保持空 system/
  local-tool isolation；direct ACP 不新增 DeepChat callable tools、skills 或 Memory。

### ASLR-072 production route

- root composition 对 `kind=acp` 只创建 `DirectAcpSessionBackend`，不存在 legacy/direct 双发；
- 每次 direct operation 从 app session、canonical alias、strict executable descriptor 和当前 enabled ACP
  config 重建 input，id/source/command 不一致时返回 `AgentUnavailable`，不 fallback 到 DeepChat；
- app session 初始化仍写现有 shared state，网络 prompt、prepare、pending/steer、mode/config/commands、
  permission continuation、generation cancel 和 close 只由 direct ACP handle 驱动；
- lightweight session list 只读现有 state projection，不 materialize `AcpAgentInstance`；
- title 读取现有 structured transcript，并调用 `AcpProvider.summaryTitles`；primary direct turn 不因此再走
  compatibility provider；
- permission response 从持久化 assistant action block 取得 ACP request id，直接 resolve 当前 instance 的
  permission bridge；
- failed subagent initialization 只允许一次新 app-session-id retry，失败 id 的 runtime、shared state、
  pending binding 与 app session row 先清理；
- delete cleanup 不解析 descriptor/current launch config，也不 materialize owner/process。它关闭已存在的
  direct instance，或仅在 owner 已存在时清理 session-controller live binding，并始终通过 data port 删除
  `acp_sessions` durable remote binding；因此 missing/malformed/disabled catalog row 不会阻塞删除；
- ACP -> DeepChat 在 target validation、target context、app-session ownership update 和 state rebuild 成功后
  才关闭旧 direct runtime；ACP target 在任何 mutation 前拒绝；
- `kind=deepchat + providerId=acp` 的 workdir、commands/config、permission、clear 和 prompt/resource branches
  继续使用 compatibility provider；`ASLR-073` 已将前述 session operations 迁到显式
  `AcpAsLlmProviderSessionControlPort` / `AcpAsLlmProviderPermissionPort`，admin routes 使用独立
  `AcpProviderAdminPort`。generic `ILlmProviderPresenter` 只保留普通 provider 能力。

## 6. MCP 与 tools

ACP 通过 `AcpMcpDeliveryAdapter` 获取当前 agent/session 允许的 MCP server definitions，并转换为 ACP
protocol 所需配置。它不接收 DeepChat 的 `ToolDefinition[]`，也不调用 DeepChat local tool dispatcher。

```text
McpPresenter (owner)
  -> agent/session policy query
  -> AcpMcpDeliveryAdapter
  -> ACP session config / protocol
```

server selection、manual/auto config、disabled state 和当前 collision/identity 语义必须保持。若 ACP
agent 自身再决定工具调用，那属于外部 ACP loop。

ACP provider 仍忽略 `_tools` 数组，但当前 regular ACP path 已经由外层 DeepChat runtime 把
runtime/env/tool/skill/local-resource 描述放进首个 system message，`AcpMessageFormatter` 会把它发给
ACP。direct backend 必须用 `AcpCompatibilityPromptBuilder` 重现这份 prompt；DeepChat + ACP-provider
路径继续由 DeepChat prompt assembly 产生。ACP-backed subagent 的当前 bypass 必须保留。以后若要删除
这些兼容描述，另立行为 spec。

## 7. Permission 与输出映射

ACP permission request 的 continuation 由 `AcpPermissionBridge` 保存和恢复。它可以复用 renderer
现有 decision UI/output types，但不能被转成 DeepChat `tool_call` 后交给 DeepChat permission gate。

必须保留：

- request id 到 active ACP continuation 的一一映射；
- allow/deny/cancel/timeout 的当前协议响应；
- renderer 丢失、session close 与 process exit 时的清理；
- regular ACP session 与 ACP-backed subagent 当前不同的展示/完成语义；
- protocol event 到 message/turn/status 的顺序和去重。

## 8. Transcript / Tape compatibility projection

`acp_turns` 只有 turn id/status/stop reason 等 metadata，不能替代外层 runtime 当前写入的 user、
assistant、tool/block、Tape、search/export projection。direct backend 必须通过一个 adapter 复用现有
writer：

```text
start prompt
  -> ensure Tape/bootstrap under current rule
  -> create user fact/projection
  -> create mutable assistant projection
  -> attempt ViewManifest at the current point (fail-open)
  -> map/apply protocol events and refreshes
  -> finalize assistant/tool facts and terminal status once
```

adapter 不运行 DeepChat provider/tool loop，也不发明新 transcript union；它只复现当前持久化/输出
副作用。每种 protocol event 的 create/update/finalize 顺序由 golden fixture 锁定。

terminal projection 复用当前 ACP stop-reason mapper 和 DeepChat accumulator/settlement：prompt reject 先
写入 `ACP: ...` error event，空 `end_turn` 写现有 `common.error.noModelResponse`，再由同一 writer 一次性
落 final blocks、message status、Tape fact 和 completed/failed event，不能另开 direct-only error path。

direct backend 还必须调用 `AcpRequestTracePort`，它裁剪自当前 provider trace writer：

```text
ViewManifest attempt
  -> persist ACP turn start + current debug request event
  -> trace write attempt:
       endpoint=acp://session/prompt
       headers={}
       body={ sessionId: remoteSessionId, prompt }
  -> connection.prompt
```

trace 继续使用现有 message/request correlation、redaction/truncation 和 opt-in context。persist failure
只 warning、保持 fail-open，不能阻止 ACP prompt；不能把 raw trace body复制进 Tape。
旧 provider-private mock 通过主动 reject 证明 trace failure 的测试不是 production writer 合同；真实基线是
base trace emitter / direct trace adapter 捕获 persistence error 后 warning 并继续 prompt。

## 9. 兼容迁移

直接删除 `AcpProvider` 风险过高，使用 adapter strangler：

1. 为 `AcpProvider` 输入、protocol event、transcript、permission、terminal status 建 golden fixtures。
2. 把 ACP client/process/session/persistence 代码收拢到新的 ACP owner，旧 provider 先委托它。
3. 引入尚不被 production `AgentManager` 选择的 typed `AcpAgentInstance` slice，以 causal fake、
   prompt/projection/trace/permission golden fixture 验证边界；旧 `AgentRuntimePresenter` 路径保持原状。
4. 收拢 Config/Provider/Lifecycle 中的 ACP registry/install/launch/alias/debug/model-refresh 边界。
5. 建 `AcpCompatibilityPromptBuilder`、`AcpCompatibilityProjectionAdapter` 和 `AcpRequestTracePort`，
   分别锁定 regular/subagent prompt差异、现有 message/Tape/event projection 和 trace-before-prompt
   parity。
6. 让 `AgentManager` 仅对 `kind=acp` session 直接调用 `AcpAgentRuntime`。（`ASLR-072` 已完成）
7. 从 generic provider contract 迁出 ACP-only session/permission/admin operations，并删除不可达的 legacy
   ACP backend glue。（`ASLR-073` 已完成）
8. 在 compatibility adapter 中继续生成旧 route/event DTO。
9. 从 DeepChat runtime 删除 ACP-agent-session state/permission branches，但保留 generic ProviderPort 到
   `AcpAsLlmProviderAdapter` 的 DeepChat + ACP-provider 路径。

任何阶段都不能同时改变 ACP protocol SDK 版本、process policy 或 UI schema。

## 10. 失败、取消与恢复

- install 不可用、spawn 失败、handshake 失败、load session 失败使用当前可观察错误映射；
- remote session load 的 fallback 只能沿用当前规则，不能无条件创建新 session 隐藏错误；
- process exit 先终止 active continuation，再写 terminal projection，避免 permission 永久 pending；
- cancel 必须区分用户取消、app shutdown 和 protocol failure，外部 payload 保持兼容；
- close 是幂等的，重复 process exit/event 不得产生双 terminal turn；
- ACP turn persistence 与 transcript output 的相对顺序由 golden fixture 锁定。
- projection adapter 的 partial failure 按当前 message/Tape recovery 处理，不能只写 `acp_turns` 后假装
  transcript 完整。

## 11. 验证矩阵

- manual、registry、installed、disabled、missing binary agent；
- manual required command/args/env 与 registry reference/nullable install overlay；
- new/load/resume remote session；
- workdir 正常、缺失、无权限和变化；
- mode/config option/command capability 更新；
- text、thought、tool/progress、plan、error、complete 等现有 protocol event；
- permission allow/deny/cancel/timeout/window close/process exit；
- cancel before prompt、during stream、during permission；
- regular session、ACP-backed subagent、transfer/import/restore；
- MCP zero/one/many servers 与 config update；
- renderer event、persisted ACP turns、app status 的迁移前后 snapshot parity；
- restart/history/search/export 与 structured message/Tape facts parity；
- `kind=deepchat + providerId=acp` regular compatibility prompt/resources 和 subagent bypass parity；
- provider catalog/enable refresh/debug route/trace/process refresh parity。

## 12. 明确不做

- 不把 ACP loop 重写成 DeepChat Tape loop；
- 不给 direct `kind=acp` backend 新增可调用的 DeepChat local tools、skills 或 Memory；但保留 regular
  ACP 与 DeepChat + ACP-provider 已有 system-prompt resource descriptions；
- 不合并 ACP remote session id 与 app session id；
- 不在本次重构改变 ACP SDK、安装方式或协议语义；
- 不因为拆分而修正已有 regular/subagent 行为差异。
- 不实现没有 route/SDK 证据的 ACP `executeCommand` facet。
