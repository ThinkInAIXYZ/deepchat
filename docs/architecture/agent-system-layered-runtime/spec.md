# Agent System Layered Runtime — Specification

> 状态：implementation complete；本文记录最终架构与已验证的兼容合同。
> 总览：[README.md](./README.md)；当前实现入口：[ARCHITECTURE.md](../../ARCHITECTURE.md) 与
> [FLOWS.md](../../FLOWS.md)。

## 1. User need

维护者需要用稳定、可观察、可暂停的心智模型理解和修改 agent runtime：顶层管理 agent 与
session，具体实例管理自己的 session state，DeepChat loop 只负责 turn/round/tool 状态机。

迁移前实现把 ACP 与 DeepChat 合并到同一 `IAgentImplementation`，但生产只有一个
`AgentRuntimePresenter` implementation；ACP 实际通过 `AcpProvider` 再进入外部 loop。这造成：

- 类型充满 optional fields/methods；
- session state 通过 singleton 上的几十个 map 维护；
- prompt、tool、permission、compaction、memory、Tape lifecycle 没有统一的执行顺序；
- ACP 与 DeepChat 的差异被 provider id 特判隐藏；
- 新功能持续进入两个大 presenter，Memory 等已有模块承担不必要的回归风险。

## 2. Goals

1. 建立一个薄的 `AgentManager` control plane，显式管理 agent kind、catalog、app session 与 backend
   dispatch。
2. 将 DeepChat 与 ACP 拆成两个 required、typed session backend；删除 fake unified runtime。
3. 为每个 hydrated DeepChat session 建立一个 `DeepChatAgentInstance`，明确 session state owner。
4. 建立 DeepChat-only `LoopEngine`，用固定 typed stages 组织 provider round、tool loop、pause/resume、
   cancellation 与 settlement。
5. 将 MCP、skills、prompt、permission、compaction、Tape、Memory 接为显式 collaborator/adapter，
   保留原模块 ownership。
6. 让内部 lifecycle seam 可以 `await`；只有明确的 tool interaction outcomes 可以产生持久 `pause`。
7. 保留现有 Tape、ViewManifest、trace、replay 与 Memory correctness/privacy/performance 合同。
8. 使用可逐步回滚的 delegation 迁移，不改变现有用户行为、wire contracts 或 storage schema。

## 3. Non-goals

- 不新增 agent kind、agent marketplace 或 runtime plugin API。
- 不设计 ACP 与 DeepChat 共用的 universal LoopEngine。
- 不把 MCP、skills、plugins、memory 的持久化和生命周期搬进 AgentManager。
- 不改变 provider、tool、permission、prompt、compaction、memory 的产品行为。
- 不把 Tape 改成逐 token raw log、永久不可删除存储或 live side-effect replay engine。
- 不清理/重命名数据库表，不迁移历史数据格式。
- 不改变 renderer UI、route/event payload 或 remote/cron feature behavior。
- 不在本目标修复审计中发现的行为不对称。
- 不引入 DI container、generic middleware framework、priority number ordering 或新依赖。

## 4. Constraints

### 4.1 Compatibility

- Existing typed routes/events are public app contracts and remain unchanged during migration.
- Existing SQLite tables and DuckDB Memory sidecars remain readable/writable without migration.
- `providerId='acp'` / `modelId=agentId` compatibility stays until every current consumer is moved.
- `kind='deepchat' + providerId='acp'` is a supported legacy/domain combination in current data and main
  routes. It remains a DeepChat session using the ACP-as-provider adapter; only `kind='acp'` selects the direct
  ACP session backend.
- ACP aliases, workdir validation, modes/config/commands, permission timeout and transfer restrictions stay
  unchanged.
- Legacy import, history search/export, remote control, cron and subagent call paths remain operational.

### 4.2 Architecture

- Dependency direction is `manager -> backend -> narrow ports`; no loop access to global presenter singleton.
- Common contracts contain only capabilities implemented by both backends.
- Kind-specific capabilities are required facets, never optional methods on a shared mega-interface.
- Shared physical storage may use one table, but codecs and domain repositories are kind-specific.
- Lifecycle stage order is defined in code and docs, not runtime-configured priority.

### 4.3 Safety

- Provider/tool side effects must not be retried merely to fit output or compare implementations.
- Streaming accumulator/echo remains non-blocking and is not exposed as awaited extension hook.
- Required persistence/settlement failures fail explicitly; documented optional contributors preserve their
  current fail-open behavior.
- Memory delete/shutdown fencing and provider permission settlement complete before dependent resources close.

## 5. Locked decisions

| ID | Decision |
| --- | --- |
| D1 | 保留薄 common control plane；删除 unified implementation abstraction。 |
| D2 | 内部使用 `AgentDescriptor` discriminated union 与 explicit `switch(kind)`。 |
| D3 | `agents` / app session physical tables 保留；拆 typed codecs/repositories，不拆表。 |
| D4 | 每个 hydrated DeepChat session 有一个 instance；每个 turn 使用独立 `LoopRun` state。 |
| D5 | `kind=acp` 拥有独立 process/session/protocol backend，不进入 DeepChat LoopEngine；DeepChat agent 选择 ACP provider 的兼容路径保留。 |
| D6 | Loop lifecycle 使用固定 typed stages；无 generic event bus/priority registry。 |
| D7 | MCP/skills 通过 resource adapters 贡献定义/prompt/执行引用，但原 Presenter 继续做 owner。 |
| D8 | Tool interaction 是 typed batch outcome，compaction 是 input/context coordinator，Memory coordinator 暴露 prompt contributor + ingestion observer；不强迫它们实现一个万能接口。 |
| D9 | Tape 是 semantic ledger；mutable stream 是 projection；trace 存 request payload；不建第二个 Tape，本目标不新增 interaction/terminal/trace-ref entry。 |
| D10 | MemoryPresenter 及其 schema/retrieval/projection/maintenance 在本目标冻结，Memory integration 最后迁移。 |
| D11 | 无 schema/wire migration；发现行为 bug 另立 spec。 |
| D12 | 本目标 supersede `agent-runtime-presenter-split` proposal。 |

## 6. Functional requirements

### 6.1 Agent management

- Catalog returns correctly typed DeepChat and ACP descriptors from the existing `agents` table.
- ACP descriptors are additionally discriminated by `source: 'manual' | 'registry'`; manual launch config and
  registry/install metadata are not optional fields on one shape.
- Catalog reads remain tolerant per current malformed-row/null/default/filter behavior; executable descriptor
  resolution is capability-strict and returns typed unavailable errors without failing the whole list or
  guessing another kind.
- DeepChat CRUD only publishes generic/DeepChat catalog updates; it does not invoke ACP-specific refresh by
  name or ownership.
- AgentManager loads the current app session `agentId`, resolves its descriptor kind and verifies any hydrated
  backend binding; `new_sessions.session_kind` remains the unrelated `regular | subagent` field.
- Unknown/mismatched kinds fail fast with a typed internal error.
- App session list, activate/deactivate, pin/title/draft/window binding stay shared.

### 6.2 DeepChat instance

- Instance owns effective identity/config, status, pending input coordination, ordered pending interactions,
  runtime-activated skills and session caches.
- Pre-stream cancellation/status exists before the externally visible active generation is registered; the
  current registration point after assistant projection creation remains stable.
- Turn-local abort, run id, request sequence, provider recovery flags and mutable conversation state live in
  one `LoopRun`, not in global maps.
- Lazy hydration preserves restored sessions and does not instantiate the complete history list at startup.
- Destroy/clear/edit/retry paths invalidate exactly the same generation, summary and Memory state as today.

### 6.3 Loop engine

- Provider request and tool-loop order matches the current `processMessage -> runStreamForMessage ->
  processStream -> dispatch` behavior.
- Fixed stage callbacks may be async and are cancellation-aware.
- Awaiting a transform pauses in-memory progression. Persistent user pause is only produced by typed tool
  interaction outcomes: pre-check permission, question interception, post-call `requiresPermission`, or
  post-success skill-draft confirmation.
- A paused provider run settles. Each response performs and persists the first origin-specific action; if more
  interactions remain the session stays paused, and only resolving the final item rebuilds context and starts
  one fresh resume run.
- The engine preserves max provider/tool rounds, rate-limit gate, context recovery, tool parallelization,
  skill refresh, output fitting, cancellation and stale-run guards.
- The engine imports ports/contracts only, not presenters, routes, Electron windows or concrete SQLite owner.

### 6.4 ACP

- ACP catalog/install/launch/alias/debug/process/session/protocol/persistence/mapping have one domain module
  owner with route/provider compatibility adapters where still required.
- ACP uses its external loop and protocol permission continuation.
- Direct ACP writes through an `AcpCompatibilityProjectionAdapter` backed by the existing structured message,
  Tape and renderer event writers; `acp_turns` remains metadata and cannot replace transcript persistence.
- Direct ACP uses an `AcpRequestTracePort` with the current endpoint/body, correlation, redaction/truncation and
  fail-open trace-before-`connection.prompt` order.
- Direct regular ACP uses an `AcpCompatibilityPromptBuilder` to preserve the current runtime/env/tool/skill/
  local-resource first system message; ACP-backed subagent keeps its current bypass.
- Regular ACP and ACP-backed subagent compatibility behavior remain separately tested.
- `AcpProvider` remains as long as a DeepChat descriptor may select `providerId='acp'`. It delegates to the same
  ACP core, but keeps the current DeepChat outer-loop compatibility prompt/resource behavior.

### 6.5 Resources and cross-cutting behavior

- Prompt section order is deterministic and equivalent to the baseline.
- ToolPresenter remains the tool source aggregate and collision/dispatch owner.
- DeepChat MCP delivery uses tool definitions; ACP MCP delivery uses ACP session-init config conversion.
- Skill discovery, pinning, runtime activation and agent-scoped policy keep current semantics.
- DeepChat ordered tool interactions and ACP protocol permission are separate continuations behind a shared UI
  decision port only.
- Compaction CAS/anchor/message/event boundaries remain atomic at the same point.

### 6.6 Tape and Memory

- Existing Tape facts, replacement/retraction fold, bootstrap, ViewManifest, trace and replay contracts remain
  intact.
- Lifecycle observability joins existing Tape/message terminal status/trace data and an optional current
  non-hydrating runtime status. Renderer event history is not persisted and must be reported as unavailable,
  never inferred from message state. Adding a new Tape entry kind or durable event history is a separate
  data/behavior SDD, not part of this structural migration.
- Observation reads are proven non-interfering across existing Tape/message/trace/Memory projection tables:
  they do not change effective view, replay privacy/hash state, ingestion projection/cursor state, complete user
  schema or routes, and an AST guard prevents Memory runtime, event-subscription and storage-write edges. This
  test/proof slice adds no production raw-token persistence. TapeService has no public projection-retry cooldown
  seam; that contract remains assigned to `ASLR-059`. This proof does not close the persisted renderer
  event-history gap.
- Memory injection remains opt-in, sanitized, hard-budgeted and fail-open.
- Memory extraction remains background, per-session serialized, exact-lineage and cursor-safe.
- Memory edit/delete/retry/clear/shutdown invalidation and fencing remain unchanged.

## 7. Acceptance criteria

### Architecture

- [x] `AgentRegistry` no longer exists in production flow.
- [x] `IAgentImplementation` optional mega-interface is removed.
- [x] Internal descriptors use one canonical `kind`; legacy aliases are quarantined at boundary adapters.
- [x] `AgentManager` contains no prompt, provider round, tool execution, compaction or Memory logic.
- [x] `kind=acp` cannot be dispatched through DeepChat `LoopEngine`; the generic provider port still supports
  the documented DeepChat + ACP-provider combination.
- [x] DeepChat session state has one instance owner and LoopEngine has no cross-session maps.
- [x] `src/main/lib/agentRuntime` no longer exists; every file has an explicit owner.

### Behavior parity

- [x] Normal, tool, multi-round, queue, steer, cancel, question and permission flows preserve event and
  persistence order.
- [x] Prompt and provider request parity tests pass for initial, tool-loop, resume and overflow-recovery turns.
- [x] ACP regular/subagent, workdir, mode/config/commands, cancel and permission timeout tests pass.
- [x] DeepChat descriptor + ACP provider request/prompt/tool-resource compatibility fixtures pass.
- [x] Tape golden flow and replay/privacy tests pass.
- [x] All Memory correctness, native, performance and lifecycle gates listed in
  [migration-and-validation.md](./migration-and-validation.md) pass.
- [x] Remote, cron, subagent, transfer, import, export, search and dashboard integrations pass.

### Compatibility

- [x] No unapproved shared route/event schema diff.
- [x] No database schema or migration version change is required by the refactor.
- [x] Old sessions restore and continue without eager migration.
- [x] Each implementation slice can be reverted without data rollback.
- [x] Architecture guards describe the new paths and reject resurrection of retired paths.

## 8. Success measures

Success is measured by ownership and parity, not by arbitrary file-count or line-count targets:

- a developer can locate agent catalog, concrete session state, loop, Tape, ACP protocol and Memory adapter
  from the directory tree without reading a god object;
- each state has one writer/owner;
- kind-specific code does not appear as optional shared capabilities;
- lifecycle order is tested directly;
- changing a resource adapter does not require constructing the full presenter graph;
- adding a future agent kind requires a new backend and explicit router branch, not ACP/DeepChat conditionals
  inside LoopEngine.

## 9. Open questions

None. Every implementation-affecting choice is locked above. Any request to alter behavior, wire schema, data
schema or Tape/Memory semantics creates a separate SDD goal.
