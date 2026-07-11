# Session Availability Resolution Contract

Status: decision complete; implementation is intentionally split into `SES-002` and `SES-003`.

Runtime owner: [`AgentSessionPresenter`](../../../src/main/presenter/agentSessionPresenter/index.ts)
owns session-resolution classification. `NewSessionManager` owns persisted session existence and
window binding; `AgentRegistry` owns the directly registered built-in runtime identity;
`AgentRepository` owns persisted non-built-in Agent identity; `AgentRuntimePresenter` owns runtime
state hydration; route services own bounded retry and renderer compatibility.

Audit source:
[A-05](../../audits/2026-07-10-architecture-performance/02-architecture-findings.md#a-05-高可靠性已确认且部分故意-unavailable-session-被伪装成-missing-session).

Roadmap task:
[`SES-001`](../../audits/2026-07-10-architecture-performance/09-implementation-roadmap.md#p0先修正确性与状态机).

GitHub issue sync: not requested; no GitHub issue was created.

## Plain-language decision

先反驳一个看似简单的修法：不能把当前 `catch` 直接删掉。它最初就是为了避免一个旧 Agent
拖垮整个会话列表，这个目标是对的。真正的问题是，当前代码把四件完全不同的事都说成了
“没有这个会话”：

1. 会话存在，而且一切可读；
2. 会话存在，但它引用的 Agent 已经无法被识别；
3. 会话存在，但本次读取碰到了数据库、初始化或 runtime 的暂时/不确定错误；
4. 会话记录确实不存在。

本决策把它们固定为四种内部结果：

- `available`
- `unavailable`
- `transient_error`
- `missing`

`null` 不再承担四种含义。最重要的约束是：

- 单个未知 Agent 不能让整个列表失败；
- `transient_error` 绝不能解除 window 或 remote binding；
- Agent 暂时不可执行，不等于会话记录不存在；
- 只有权威的 session record miss、明确的 deactivate，或 remote binding owner 的明确解绑命令，
  才允许解除 binding；
- availability 与生成状态 `idle | generating | error` 是两套状态，不能混成一个 enum。

这不是数据库重构，也不是 Agent 系统重写。`SES-002` 先让 main process 内部语义正确；
`SES-003` 再用向后兼容的附加 route 字段把状态交给 renderer，并补最小错误界面。

## Issue

### Current collapse point

[`buildSessionWithState()`](../../../src/main/presenter/agentSessionPresenter/index.ts) 先解析
Agent implementation，再读取 runtime state。它的调用链可能发生以下结果：

- `NewSessionManager.get()` 返回 `null`：session record 不存在；
- `ConfigPresenter.getAgentType()` 返回 `null`：record 存在，但 Agent identity 无法从当前 catalog
  确认；
- catalog、registry 或 runtime state read 抛错：本次解析结果不确定；
- runtime state 正常返回：会话可用；
- runtime state 返回 `null`：历史实现按 `idle`、空 provider/model 兼容。

[`tryBuildSessionWithState()`](../../../src/main/presenter/agentSessionPresenter/index.ts) catch
所有异常，打印一条 `Skipping unavailable session`，再返回
`null as unknown as SessionWithState`。它既把暂时错误说成 unavailable，又通过 cast 隐瞒真实返回
类型。

`getSession()` 因此无法区分“记录不存在”和“本次 hydration 失败”。`getSessionList()` 又把所有
falsey result 都从列表删除。

### Binding damage

[`getActiveSession()`](../../../src/main/presenter/agentSessionPresenter/index.ts) 只要收到 falsey
session 就调用 `unbindWindow()`。因此一个 `getSessionState()` rejection 会沿下面路径破坏真实 binding：

```text
session record exists
  -> state/catalog read throws
  -> tryBuildSessionWithState() returns fake null
  -> getSession() returns null
  -> getActiveSession() unbinds window
```

同样的语义也存在于 remote binding：

- [`RemoteConversationRunner.getCurrentSession()`](../../../src/main/presenter/remoteControlPresenter/services/remoteConversationRunner.ts)
  在 `getSession()` 返回 null 时清除 endpoint binding；
- [`getConversationSnapshot()`](../../../src/main/presenter/remoteControlPresenter/services/remoteConversationRunner.ts)
  也会清除 binding，并告诉用户会话“不再存在”。

这两个 caller 都没有证据证明 session record 被删除，只是继承了被压扁的 `null`。

### Retry is present but bypassed

[`SessionService.restoreSession()`](../../../src/main/routes/sessions/sessionService.ts) 已经用
`Scheduler.retry()` 包住 session lookup，设置两次 attempt。可是 retry 只在 Promise reject 时运行；
`tryBuildSessionWithState()` 把 rejection 转成 fulfilled `null`，所以第二次 attempt 永远不会发生。

这不是“缺少 retry 配置”，而是错误状态在 retry owner 之前被吞掉。

### Renderer sees a false empty session

当前 route schema 只有 `SessionWithState | null`：

- [`sessions.restore`](../../../src/shared/contracts/routes/sessions.routes.ts) 收到 null 后返回空 message
  page；
- [`sessions.getActive`](../../../src/shared/contracts/routes/sessions.routes.ts) 也只有 nullable session；
- [`sessions.list`](../../../src/shared/contracts/routes/sessions.routes.ts) 只能返回完整
  `SessionWithState[]`。

renderer 的 [`messageStore.loadMessages()`](../../../src/renderer/src/stores/ui/message.ts) 会把 route
error 和真实 missing 都转成 null；[`ChatPage`](../../../src/renderer/src/pages/ChatPage.vue) 在 restore
前已经清空 message state。用户最终看到的是空白对话，而不是“读取暂时失败”。

[`sessionStore.hydrateActiveSessionSummary()`](../../../src/renderer/src/stores/ui/session.ts) 对 null
没有错误状态；与此同时 main process 已经可能把 binding 清掉。renderer 的 active id、main 的 binding
和实际 session record 因而可能三者不一致。

## Current code truth

### Persisted session identity and Agent identity are separate

[`new_sessions`](../../../src/main/presenter/sqlitePresenter/tables/newSessions.ts) 将 `agent_id` 存成普通
`TEXT NOT NULL`，没有指向 `agents` 的 foreign key。旧数据、迁移遗漏或历史删除都可能留下
“session record 存在但 agent row 不存在”的状态。不能用 session row 的存在推断 Agent 一定可解析。

[`AgentRepository.getAgentType()`](../../../src/main/presenter/agentRepository/index.ts) 只按 Agent row
返回 `deepchat | acp | null`，不检查 `enabled`。这有明确现实含义：禁用 Agent 是“不再用于新选择”，
不是“删除它的历史会话”。

现有 repository 也尽量阻止新 orphan：

- `deleteDeepChatAgent()` 在有关联 session 时拒绝删除；
- `removeManualAcpAgent()` 在有关联 session 时拒绝删除；
- registry uninstall 在有关联 session 时拒绝清除安装。

因此，对没有直接 registry identity 的 Agent，`agent_type === null` 是确定的 catalog miss；但不能进一步
猜测它来自用户删除、旧版本迁移、损坏数据还是未来 catalog 回补。

### One runtime implementation serves multiple Agent identities

[`AgentRegistry`](../../../src/main/presenter/agentSessionPresenter/agentRegistry.ts) 当前只直接注册 built-in
`deepchat` runtime implementation。`resolveAgentImplementation()` 的真实顺序是：先处理 ACP legacy alias，
再检查 registry direct hit；`deepchat` direct hit 不读取 catalog。只有 direct miss 才查询
`getAgentType()`，已知 `deepchat` 或 `acp` 都复用已注册的 `deepchat` implementation。

`SES-002` 保留这个 fast path。直接注册的 built-in identity 是充分证据；不能为了统一代码形状而强制
增加 catalog read。对其余 id，“没有单独注册 implementation”也不是 unavailable；只有 authoritative
catalog lookup fulfilled null 才是当前可证明的 `unavailable`。catalog lookup 抛错，或已知 catalog type
之后 registry resolve 抛错，都属于 indeterminate runtime resolution，应归为 `transient_error`，不能伪装成
Agent 永久缺失。

### Disabled and not-installed are execution readiness, not session availability

`ConfigPresenter.getAcpAgents()` 只把 enabled 且 installed 的 registry Agent 暴露为可启动 Agent；
`listAgents()` 和 `getAgentType()` 则仍能看到完整 Agent row。这个差异说明仓库已有两种概念：

- catalog identity：这个 Agent 是谁；
- execution readiness：现在能不能启动新的 ACP process。

本 contract 只描述 session record 能否被解析和展示，不替代 Agent execution readiness。下列状态
不能单独判定 session 为 `unavailable`：

- `Agent.enabled === false`；
- global ACP disabled；
- ACP `installState` 是 `not_installed | installing | error`；
- session generation status 是 `error`；
- provider/model 当前不可连接。

这些状态可以让 send/launch 失败，但历史 session identity 仍然存在。

### A fulfilled null runtime state is an existing compatibility rule

`IAgentImplementation.getSessionState()` 从最初设计起就允许返回 null；
`buildSessionWithState()` 从 `c86f1fb1` 起一直把它映射为 `idle`、空 provider/model。当前
`AgentRuntimePresenter.getResolvedSessionState()` 在 runtime map 和 persisted runtime row 都不存在时会返回
null。

没有证据证明这次整改可以把该历史 fallback 改成 unavailable。因此：

- fulfilled null state 在 `SES-002` 继续生成 `available` compatibility snapshot；
- thrown state read 才进入 `transient_error`；
- 若以后要淘汰 null runtime state，必须另立 migration/repair 任务，不能混入 A-05。

### Lightweight list is a partial mitigation, not the contract

`752286fd` 引入 `getLightweightSessionList()` 和 startup bootstrap。它们只读 persistent records，并用
内存 status snapshot 或 `idle`，不逐条触发 runtime hydration。当前主 renderer 的 sidebar 因此通常不会
因为 unknown Agent 消失，startup bootstrap 也直接读取 `getActiveSessionId()`。

但这只绕开了部分路径：

- 选择 session 后的 `getActive()` 仍会走错误 unbind；
- restore 仍把 transient failure 变成空消息；
- remote binding 仍可能被清除；
- legacy/full list 和其他 main consumers 仍只看 `SessionWithState | null`。

因此不能因为 sidebar 现在使用 lightweight route 就关闭 A-05。

## Historical intent

### `72dc7e5d`: deliberate list isolation

`72dc7e5d` (`feat: support custom in welcome`) 的内部 commit 明确写了
`fix(session): skip unavailable agent sessions`。它做了三件事：

1. 把单条 session hydration 包进 `tryBuildSessionWithState()`；
2. list 遇到失败时跳过该条，继续返回健康条目；
3. active lookup 收到 null 时解除 binding。

当时方法签名诚实地写成 `Promise<SessionWithState | null>`。测试同时固化了 unknown Agent、state
read failure 都不拖垮列表，以及 active null 会解绑。

结论：**列表隔离是故意的**。但是当时没有区分 deterministic catalog miss 和 thrown runtime error，
也没有为 binding destruction 建立证据门槛。

### `f0a91b77`: type lie was introduced for a mutation return type

`f0a91b77` 增加 `setSessionProjectDir(): Promise<SessionWithState>` 时，把
`tryBuildSessionWithState()` 的返回类型从 nullable 改成 non-null，并把真实 null 写成
`null as unknown as SessionWithState`。同一 diff 没有增加新的 availability 规则、retry、route schema 或
error UI。

因此 unsafe cast 不是经过设计的 resilience policy；它是为满足新 mutation return type 而引入的类型
绕过。后续 commit 继承了它。

### Intent verdict

- 保留：单个坏 session 不能拖垮 list。
- 保留：旧 Agent identity 不应导致整个 UI 启动失败。
- 推翻：任意异常都等同于 unavailable/missing。
- 推翻：任意 falsey lookup 都足以解除 binding。
- 删除：`null as unknown as SessionWithState`。

## Availability contract

### Internal result

`SES-002` 使用一个 exhaustive discriminated union。类型放在 Presenter port 的真实 owner
[`src/shared/types/presenters/agent-session.presenter.d.ts`](../../../src/shared/types/presenters/agent-session.presenter.d.ts)，
并由 `presenters/index.d.ts` 导出。它不放进通用 `agent-interface.d.ts`，避免把 main orchestration
结果混进所有 Agent implementation 的 domain protocol。该类型只描述 main Presenter port，不自动成为
renderer route schema：

```typescript
type SessionResolutionStage =
  | 'record_read'
  | 'agent_lookup'
  | 'runtime_resolution'
  | 'state_read'

type SessionResolutionResult =
  | {
      availability: 'available'
      session: SessionWithState
    }
  | {
      availability: 'unavailable'
      sessionId: string
      record: SessionRecord
      reason: 'agent_unknown'
    }
  | {
      availability: 'transient_error'
      sessionId: string
      record: SessionRecord | null
      error: {
        code: 'SESSION_RESOLUTION_FAILED'
        stage: SessionResolutionStage
        retryable: true
        cause: unknown
      }
    }
  | {
      availability: 'missing'
      sessionId: string
    }
```

这里的 `transient_error` 表示“本次读取无法给出确定结论”，不是承诺底层错误一定会自行恢复。即使原因
最终是 persistent bug，resolution owner 也不能在没有权威证据时删除 identity 或 binding。它允许一次
有界 read retry，并要求之后把错误显式交给 caller。

internal `cause` 不跨 IPC。public schema 只保留稳定 code、stage 和 `retryable`。

### Evidence table

| Observation | Availability | Evidence rule | Retry |
| --- | --- | --- | --- |
| session record read returns no row | `missing` | authoritative `new_sessions.get(id)` miss | no automatic retry after a successful read |
| record exists; alias-normalized id directly hits built-in registry entry | continue toward `available` | registered built-in runtime identity; do not add a catalog read | none |
| record exists; registry direct miss; alias-normalized `getAgentType()` returns null | `unavailable` | deterministic persisted catalog miss | no immediate retry; re-evaluate on explicit refresh/config change |
| record/catalog/runtime/state read throws | `transient_error` | result is indeterminate; error text is not classification evidence | bounded read-only retry where caller already owns one |
| known Agent type resolves runtime and state read fulfills | `available` | full session snapshot built | none |
| state read fulfills null | `available` compatibility snapshot | retained historical rule, not proof of failure | none |

No implementation may classify by matching strings such as `Agent not found`, `SQLITE_BUSY`, `timeout`, or
`unavailable`. Error text is diagnostic data, not state evidence.

### Owners

| Owner | Responsibility | Must not do |
| --- | --- | --- |
| `NewSessionManager` | Read persistent record; own window binding identity | infer Agent availability; clear binding on a thrown read |
| `AgentRepository` / `ConfigPresenter` | Resolve alias-normalized persisted Agent identity/type after a registry direct miss | make `enabled` or install state mean session missing |
| `AgentRegistry` | Own directly registered built-in identity and resolve the shared implementation for known catalog types | turn registry invariant failures into `agent_unknown`; force built-in direct hits through catalog |
| `AgentRuntimePresenter` | Return runtime state or a rejected state-read operation | decide window/remote binding lifecycle |
| `AgentSessionPresenter` | Combine the evidence into exactly one four-state result | catch everything into null; parse error messages |
| `SessionService` | Apply bounded read retry and map to route compatibility fields | mutate binding because a route cannot represent a state yet |
| window/remote binding owner | Retain or clear binding from explicit state evidence | clear on `unavailable` or `transient_error` |
| renderer store (`SES-003`) | Display public availability and keep local state coherent | infer missing from a generic IPC rejection |

## Retry contract

1. `AgentSessionPresenter` classification itself does not sleep or create background retry timers.
2. `SessionService.restoreSession()` keeps its existing two-attempt, 25ms-delay read retry. A
   `transient_error` result is converted to a typed/rejected read attempt so `Scheduler.retry()` can actually
   run. `missing` and `unavailable` resolve immediately and are not retried.
3. `getActive` uses the same two-attempt read policy because it is read-only and user-facing. It must not
   retry indefinitely or reset the binding between attempts.
4. Full list hydration does not retry each bad row. Per-row retries would multiply latency and database/runtime
   load by page size. It returns one classified result per record and lets a later explicit refresh re-evaluate.
5. Lightweight list remains record-only and adds no runtime read retry.
6. Chat send, tool execution and other mutations are never retried by this contract. A caller may retry the
   preceding read, but once a mutation starts it follows the separate Scheduler mutation contract (`SCH-*`).
7. Timeout attempts are read-only/idempotent here. This contract does not claim that `Scheduler.timeout()`
   cancels underlying work; A-04 remains separate.

## Binding contract

### Window binding

| Event/result | Binding action | Reason |
| --- | --- | --- |
| explicit `deactivateSession()` | clear | direct user/renderer intent |
| bound lookup returns `missing`, including the first lookup after deletion | clear | persisted identity no longer exists |
| `available` | retain | normal active session |
| `unavailable` | retain | record exists and may recover after Agent restore/migration |
| `transient_error` | retain | no evidence of deletion; destructive action is forbidden |
| record read throws before existence is known | retain | indeterminate is not missing |
| Agent disabled/global ACP disabled/not installed | retain | execution readiness is a separate contract |

`getActiveSessionId()` remains the binding identity source. `getActiveSession` becomes an envelope rather than
forcing “no binding” into the four session states:

```typescript
type ActiveSessionResolution =
  | { binding: 'none' }
  | {
      binding: 'bound'
      sessionId: string
      resolution: SessionResolutionResult
    }
```

`binding: 'none'` is not `missing`; no session lookup was requested. If a bound lookup returns `missing`, the
owner clears it and reports the missing resolution for that request so renderer can converge intentionally.

当前 `deleteSessionInternal()` 删除 record，但 `NewSessionManager.delete()` 不扫描
`windowBindings`，因此“delete 立即解绑所有窗口”不是现有事实。`SES-002` 采用最小一致决定：不新增
sessionId → windows 的反向索引，也不把 A-13 的 destroyed-webContents 清理混进本任务。显式
`deactivateSession()` 仍立即解绑；删除后的 main binding 在下一次 bound lookup 读到 authoritative
`missing` 时清除。renderer 同时继续通过现有 `sessions.updated(reason='deleted')` 收敛本地 active state。
测试必须覆盖这条 next-lookup convergence，且不能伪造 `deactivated` event。

### Remote binding

Remote endpoint bindings use the same destructive-evidence rule:

- clear only on an explicit remote unbind/replace command or `missing`；删除同样通过下一次 lookup 的
  `missing` 收敛；
- retain on `unavailable` and `transient_error`;
- do not auto-create a replacement session after transient failure;
- do not tell the user “no longer exists” unless the result is `missing`.

This prevents a temporary lookup failure from silently switching a channel to a new conversation.

## API behavior

### Authoritative APIs and legacy adapters

`SES-002` does not change the meaning of an existing method in place. It adds three classified Presenter-port
methods and makes them the authority for new main-process code:

```typescript
resolveSession(sessionId: string): Promise<SessionResolutionResult>
resolveSessionList(filters?: SessionResolutionListFilters): Promise<SessionResolutionResult[]>
resolveActiveSession(webContentsId: number): Promise<ActiveSessionResolution>
```

`SessionResolutionListFilters` is the current inline `getSessionList` filter shape promoted into the same
Presenter declaration (`agentId`, `projectDir`, `includeSubagents`, `parentSessionId`); it is not the main-local
route `SessionListFilters` type.

The existing methods remain as explicitly named legacy adapters during this remediation branch:

```typescript
getSession(sessionId: string): Promise<SessionWithState | null>
getSessionList(filters?: SessionResolutionListFilters): Promise<SessionWithState[]>
getActiveSession(webContentsId: number): Promise<SessionWithState | null>
```

They delegate to `resolve*`, return only `available.session`, and map every other result to honest nullable/list
shapes without an unsafe cast. `getActiveSession()` may clear a binding only because delegated
`resolveActiveSession()` already proved `missing`; mapping unavailable/transient to null must not itself unbind.
Keeping these adapters avoids a flag-day signature change while correctness-critical consumers move to the
classified API. A source-level allowlist test prevents new production call sites from adopting the legacy
adapters.

### `list`

`resolveSessionList()` returns classified results in the original record order.

- `available`: include full `SessionWithState`.
- `unavailable`: include persistent `SessionRecord` plus `agent_unknown`; continue with the next row.
- `transient_error`: include persistent record when it was read, include sanitized diagnostic metadata, and
  continue with the next row.
- `missing`: only possible for a race or by-id lookup after the initial record snapshot; do not fabricate a row.

One unknown Agent and one state-read rejection must not reject or truncate the healthy remainder of the list.

如果最外层 `new_sessions.list(...)` 查询本身抛错，caller 连 record identity 集合都没有拿到，整个 list
request 应以一次 list-level transient error 失败；不得凭空制造部分 session result。逐条隔离只适用于
records 已经成功读取后的 catalog/runtime hydration。

The current `sessions.listLightweight` path stays record-only. It already preserves session identity without
paying runtime hydration per sidebar row. Availability learned from active/restore is overlaid in renderer
during `SES-003`; this task must not turn lightweight startup back into an N+1 runtime read.

### `get`

`resolveSession()` always returns `SessionResolutionResult` and never fake-null-casts:

- missing row -> `missing`;
- row + unknown Agent -> `unavailable`;
- thrown resolution/hydration -> `transient_error`;
- completed snapshot -> `available`.

Correctness-sensitive main-process consumers switch exhaustively. A consumer that only needs persistent fields
may use the record carried by unavailable/transient results. A consumer that requires runtime fields must return
or reject with a typed unavailable/transient outcome; it cannot call them missing.

The migration inventory is fixed before implementation:

| Consumer | `SES-002` contract |
| --- | --- |
| route hot-path `SessionRepository` / `SessionService` | use all three `resolve*` methods; own bounded route retry and legacy route-field mapping |
| `ChatService` send/steer lookup | use `resolveSession`; only `available` may start a mutation; preserve distinct typed missing/unavailable/transient errors |
| `RemoteConversationRunner` current/use/snapshot/list | use `resolveSession` / `resolveSessionList`; retain binding and never create a replacement on unavailable/transient |
| MCP session context and conversation search | use `resolveSession`; consume persistent record only where sufficient, otherwise surface a typed non-missing failure |
| `Presenter` tool runtime workdir/session-info ports | use `resolveSession`; workdir may come from a carried record, runtime fields require available |
| hooks notification fallback | adapt classified result to optional persistent fields; do not label transient as missing |
| `SkillSessionStatePort.hasNewSession` | true for available/unavailable and transient with a record; false only for missing; propagate indeterminate record-read failure instead of returning false |
| floating-button full list | intentionally remains on available-only `getSessionList` until that secondary renderer has an availability UI; it is the sole production list-adapter allowlist entry |
| tests and third-party Presenter mocks | legacy methods remain type-compatible; new contract tests target `resolve*` directly |

`SES-002` uses a TypeScript AST/type/provenance guard rather than a text grep. It follows direct property access,
local aliases, local assignment chains, variable/parameter/assignment object destructuring (including local
object-rest bindings) and bound method references rooted in the repository-owned `IAgentSessionPresenter` type,
including `Pick`, `Partial`, constrained type parameters and local type aliases. The real
`Presenter.agentSessionPresenter` property is covered through
that type source, not by trusting the property name. Positive and negative fixtures prove these forms are
distinguished from unrelated `any` values and classes that happen to expose the same nested property or method
names. This is intentionally not full JavaScript dataflow: computed assignments, re-exports and values that have
already been erased to `any` remain outside the guard. After migration, the allowlist names the owning method and
adapter exactly; the floating button's
`loadSessions#getSessionList` boundary is the sole production entry. An unexplained legacy reference is a failing
test, not an implicit compatibility decision.

### `getActive`

- no binding -> `binding: 'none'`;
- bound + available -> return snapshot, retain binding;
- bound + unavailable -> return unavailable record, retain binding;
- bound + transient error -> return retryable error state, retain binding;
- bound + missing -> clear binding, return missing for renderer convergence.

No availability lookup publishes a fake `deactivated` event. Deactivation remains explicit; missing convergence
is represented by the route result and the existing deletion/session-list update flow.

### `restore`

- `available`: read the message page exactly as today.
- `missing`: return missing and no message page.
- `unavailable`: return persistent session identity and unavailable reason; do not attempt a message read through
  an implementation that could not be resolved.
- `transient_error`: finish bounded lookup retry; if still failing, return the retryable resolution and do not
  clear cached renderer messages or binding.

Reading history for an unknown Agent through a new implementation-independent SQLite port is useful but not
required for A-05. `SES-003` shows an unavailable surface instead of pretending the conversation is empty.

## Route and renderer compatibility

### `SES-002`: keep existing route shapes

The first implementation PR changes main-internal semantics only. Existing route fields remain:

- `sessions.restore.session: SessionWithState | null`
- `sessions.getActive.session: SessionWithState | null`
- `sessions.list.sessions: SessionWithState[]`

The compatibility mapping is explicit and typed:

| Internal result | Legacy route field |
| --- | --- |
| `available` | existing `SessionWithState` |
| `missing` | null / omitted from legacy list |
| `unavailable` | null / omitted from legacy list |
| exhausted `transient_error` | null / omitted from legacy list, plus structured main diagnostic |

Information-loss mapping is allowed only in the named compatibility boundaries: `SessionService` legacy route
fields and the three Presenter legacy adapters above. It must not reintroduce an unsafe cast or mutate binding.
The floating-button call site is explicitly allowlisted because it consumes the available-only list adapter;
no other production caller may silently filter a classified result. `SES-003` removes the route information loss
for the primary renderer. Removal of the Presenter adapters is a later compatibility cleanup, not hidden inside
`SES-003`.

### `SES-003`: additive public result

Existing route names and legacy fields stay in place. Add optional fields rather than creating parallel route
names:

```typescript
type PublicSessionResolution =
  | { availability: 'available'; session: SessionWithState }
  | {
      availability: 'unavailable'
      sessionId: string
      record: SessionRecord
      reason: 'agent_unknown'
    }
  | {
      availability: 'transient_error'
      sessionId: string
      record: SessionRecord | null
      error: {
        code: 'SESSION_RESOLUTION_FAILED'
        stage: SessionResolutionStage
        retryable: true
      }
    }
  | { availability: 'missing'; sessionId: string }
```

- `sessions.restore` adds `resolution?: PublicSessionResolution`.
- `sessions.getActive` adds `resolution?: PublicSessionResolution | null`; null means no binding.
- `sessions.list` adds `results?: PublicSessionResolution[]` while retaining available-only `sessions`.
- `sessions.listLightweight` stays unchanged; renderer overlays resolution by `sessionId`.

The fields are optional for the compatibility window. New main always emits them; new renderer falls back to
legacy fields when talking to an old main during development/HMR. Old renderer parses the old `z.object` schemas,
which ignore additive keys; the installed Zod behavior has been verified locally and must be protected by an
explicit old-schema/new-output test.

Legacy fields remain through this remediation branch. Removing them requires a separate compatibility cleanup;
it is not part of `SES-003`.

### Minimal renderer behavior

`SES-003` adds availability state beside, not inside, `UISessionStatus`.

- `available`: current chat behavior.
- `unavailable`: keep sidebar row and active id, disable send controls, show a stable “Agent unavailable” panel.
- `transient_error`: keep active id and already cached messages, disable send for this failed hydration, show a
  retryable panel; Retry re-runs restore without creating a new session.
- `missing`: clear renderer active state and navigate to New Thread with a localized “session no longer exists”
  notification.
- compatibility field absent: use legacy `session` behavior, but never invent a missing classification from a
  generic rejection.

A rejected legacy/new route invocation has no `PublicSessionResolution` payload and therefore cannot prove any
public state. The renderer records a renderer-local transient refresh failure, retains active id/sidebar row and
cached messages, disables send, and shows the same Retry surface. It must not fabricate a public `stage` or emit
deactivate/navigation. This covers old-main development/HMR, message-page read failures and transport failures
without adding `route_read` to the main resolution enum.

UI layout target:

```text
BEFORE (transient state is collapsed)
+------------------------------------------------------+
| Session title                                        |
|                                                      |
|                 (empty message area)                 |
|                                                      |
| [ Message input remains contextually ambiguous ]     |
+------------------------------------------------------+

AFTER: transient_error
+------------------------------------------------------+
| Session title                         Temporary issue |
|                                                      |
| Existing cached messages remain when available       |
|                                                      |
| [ Session could not be refreshed. ]   [ Retry ]       |
| [ Message input disabled until refresh succeeds ]    |
+------------------------------------------------------+

AFTER: unavailable
+------------------------------------------------------+
| Session title                          Unavailable    |
|                                                      |
| This conversation is still saved, but its Agent      |
| cannot be resolved.                                  |
|                                                      |
| [ Retry ]   [ Message input disabled ]                |
+------------------------------------------------------+
```

All visible strings use existing vue-i18n structure. The first renderer increment does not add an Agent repair,
reinstall, migration or auto-move wizard.

### `SES-003` implemented ownership and state flow

实现保持现有 owner，没有为了这四个状态再建一个全局 store：

```text
main SessionService
  ├─ owns bounded read retry
  ├─ maps internal cause-bearing result -> sanitized public result
  └─ keeps legacy session/sessions fields
          |
          v
typed route schema -> SessionClient -> messageStore
                                      ├─ owns message window/cache replacement
                                      └─ keeps the old cache when invoke rejects
                                                |
                                                v
                                         sessionStore
                                         ├─ owns availabilityBySessionId
                                         ├─ keeps UISessionStatus separate
                                         └─ owns missing navigation convergence
                                                |
                                                v
                                           ChatPage
                                           ├─ renders one active-state panel
                                           ├─ disables mutation controls
                                           └─ Retry restores the same sessionId

floating renderer
  └─ stays on the named available-only legacy list adapter; no new UI or IPC path
```

实际状态转移如下；虚线表示兼容或 transport 路径，不伪造 main classification：

```text
available ------------------------------> normal chat + send enabled
    ^                                              |
    | Retry succeeds                               | later refresh
    |                                              v
unavailable <---------------------------- authoritative agent_unknown
    | keep active id/sidebar/cache; Retry same id; send disabled
    |
transient_error <------------------------ exhausted classified read
    ^
    | route rejection / legacy null ..... renderer-local transient
    | keep active id/sidebar/cache; no stage is invented
    |
missing <-------------------------------- authoritative record miss
    └─ clear local active/message ownership -> New Thread -> localized notice
```

Renderer 性能边界也保持不变：sidebar 仍只调用 `listLightweight`，不会逐行做 runtime hydration；
新增响应式状态只是一份按 session id 索引的小记录和一个 active computed，ChatPage 只在异常状态挂载一个
panel，没有给 message row 或 sidebar row 增加 watcher/component。

独立复核补强了三条 renderer 生命周期约束：

- `getActive` hydration 只返回纯 outcome；`selectSession` 与当前窗口的 `activated` IPC handler 都先核对
  request id、当前 active id 和 response session id，再同步 apply。较早的 A 请求即使晚于 B 完成，也不能
  写入 A 的 summary/availability；全局 `getActive` 若已经返回 B，也不能把 B 的结果标到调用方 A 上。
- `getActive.resolution` 保留三值：`null` 是主进程确认的 unbound，清理 renderer active ownership 并回到
  New Thread；`undefined` 是旧主进程未提供 additive field，继续作为 legacy transient；object 才是 bound
  resolution。mapper 不再用 nullish coalescing 合并前两者。
- `availabilityBySessionId` 的 owner set 是当前 active id 与 renderer 当前持有的 lightweight list id 并集；
  list replacement、close/deactivate、delete/prune 时同步收敛。非 owner 的历史 lookup 不写入 map，而当前
  active 的 `unavailable`/`transient_error` 即使暂时不在首屏 list 也必须保留。

## Error visibility and privacy

### Main diagnostics

Classification and terminal reporting are separate. `resolveSession()` and the per-record classifier never log;
they cannot know whether a retry owner will make another attempt. A single shared
`reportTerminalSessionResolution(operation, result, attemptCount)` helper is called only after the boundary has
accepted the result as terminal:

| Boundary | Diagnostic owner |
| --- | --- |
| `SessionService.restore/getActive` | route service, once after immediate unavailable/missing or exhausted transient retry |
| classified Chat/MCP/search/tool/hook lookup | the service that converts the result to its terminal return/rejection |
| remote current/use/snapshot lookup | `RemoteConversationRunner`, once before its terminal remote outcome |
| `resolveSessionList` consumer | list boundary, once per non-available row after the no-per-row-retry decision |
| legacy Presenter adapter | the adapter itself, once; a caller must not log the same resolution again |

Each terminal non-available lookup records one structured diagnostic:

- stable operation name
- `sessionId`
- `availability`
- `stage`
- stable error `code`
- stable `retryable` flag
- attempt count when retry ran

The original `cause` exists only in the in-memory classified result so typed owners can decide whether a settled
read is retryable. It is discarded at the terminal logging boundary. No raw `Error`, message, stack, configured
Agent identity, absolute path, SQL text, command, environment data or provider secret is passed to
`electron-log`. Unavailable/missing diagnostics infer their stable stage (`agent_lookup` / `record_read`) without
fabricating a cause. List isolation must avoid duplicate warnings from both classifier and adapter. One failed row
produces one terminal diagnostic per list request, not one per layer or retry attempt. Tests spy on the shared
helper/logger to prove a transient-first/success-second retry emits no terminal error, an exhausted retry emits
exactly one, and injected secret/path text is absent from every logger argument.

### Renderer payload

IPC never receives raw `Error`, stack, SQLite query text, command line, environment variables, provider
credentials or Agent launch spec. The renderer receives only stable code/stage/retryability and the persisted
session fields it already receives through lightweight list. `record.projectDir` remains because it is an existing
session field; the error object must not duplicate it or add other filesystem paths.

User copy distinguishes:

- unavailable Agent identity;
- temporary session refresh failure;
- truly deleted/missing session.

It does not display JavaScript error text as product copy.

## Implementation split

### `SES-002`: main-internal semantics and compatibility adapter

Scope:

1. Add the Presenter-port four-state result and authoritative `resolveSession`, `resolveSessionList` and
   `resolveActiveSession` paths in `AgentSessionPresenter`.
2. Preserve the registered built-in fast path; separate non-built-in authoritative catalog null from thrown
   catalog/registry/runtime/state errors without string matching.
3. Remove `null as unknown as SessionWithState` and implement the three existing `get*` methods as typed legacy
   adapters over `resolve*`.
4. Migrate the fixed consumer inventory to classified APIs; keep only the allowlisted floating-button list caller
   on a legacy adapter and prevent new production legacy call sites.
5. Preserve window and remote bindings for unavailable/transient results; clear only on missing/explicit
   deactivate or remote unbind. Preserve deletion's existing next-lookup convergence rather than adding a binding
   reverse index.
6. Make existing restore retry observe `transient_error`; add the bounded active read retry and terminal-only
   diagnostic ownership.
7. Keep current route schemas and add only typed compatibility mapping at named adapters.
8. Keep lightweight list record-only and preserve ordering/startup cost.

Exit condition: main code contains the four states and no destructive caller still treats
`transient_error` as missing, while the existing renderer runs unchanged.

### `SES-003`: additive route schema and renderer state

Scope:

1. Add sanitized public resolution schemas and optional additive route fields.
2. Emit resolution/results while retaining all legacy fields.
3. Update `SessionClient`, session store, message restore and ChatPage to handle all four states.
4. Preserve cached messages and active identity on transient failure.
5. Show minimal localized unavailable/transient/missing UX and disable mutation controls when runtime state is not
   available.
6. Add old-renderer/new-main and new-renderer/legacy-field compatibility tests.
7. Add dispatcher-to-store integration coverage for all states.

Exit condition: new renderer no longer infers missing from null/error, old renderer remains schema-compatible, and
all four public states are testable without production fault injection.

## Failing tests to write first

### `SES-002`

- [ ] Record exists and `getSessionState()` rejects: `resolveSession()` returns `transient_error`, not
      null/unavailable; legacy `getSession()` maps it to null without a cast or unbind.
- [ ] Bound window plus transient state read: lookup may retry, but `getActiveSessionId()` remains unchanged and
      `unbindWindow()` is not called.
- [ ] A transient first attempt followed by success returns available and keeps the same binding throughout.
- [ ] A transient error that exhausts the bounded attempts retains binding and reaches the compatibility adapter
      with one terminal diagnostic.
- [ ] Record read throws before existence is known: active binding is retained.
- [ ] Record read returns no row: result is missing and bound active lookup clears binding.
- [ ] Explicit delete does not fabricate `deactivated`; the next bound lookup returns missing and clears the stale
      window binding exactly once.
- [ ] Built-in `deepchat` direct registry hit resolves without calling catalog lookup even when the catalog stub
      would return null or throw.
- [ ] Catalog lookup returns null for one record while another is healthy: full list returns unavailable +
      available results and never rejects the list.
- [ ] Catalog lookup throws: classify transient_error, not unavailable.
- [ ] Known disabled Agent type still resolves the session; `enabled=false` is not session unavailable.
- [ ] ACP legacy id is normalized before authoritative lookup.
- [ ] Known Agent type plus registry implementation failure is transient_error.
- [ ] Runtime state fulfills null: preserve available compatibility snapshot with idle/empty model fields.
- [ ] One state-read rejection does not stop hydration/classification of later list rows.
- [ ] Lightweight list returns unknown-Agent records without runtime hydration or extra retry.
- [ ] Remote binding survives unavailable/transient lookup and clears only on missing.
- [ ] Chat/tool/search/hook/skill consumers use exhaustive resolution handling and never report transient as “not
      found”; an indeterminate `hasNewSession` read is not returned as false.
- [ ] `getSessionList()` remains available-only for the allowlisted floating button, while
      `resolveSessionList()` returns unknown/transient rows in original order.
- [ ] Terminal diagnostic spy proves transient-first/success-second logs none and exhausted transient logs once.
- [ ] AST/type/provenance guard fixtures prove direct, aliased, destructured and bound legacy references fail
      closed, unrelated same-name methods remain allowed, the unsafe fake-null cast is absent, and floating
      `loadSessions#getSessionList` is the only production allowlist entry.

### `SES-003`

- [ ] Shared schemas parse `available`, `unavailable`, `transient_error` and `missing`, and reject malformed
      combinations.
- [ ] `getActive.resolution === null` means unbound and is distinct from a bound missing result.
- [ ] New main output with additive fields passes a captured legacy route output schema; unknown keys are ignored.
- [ ] New renderer handles route payloads without `resolution` by using the legacy fields.
- [ ] A legacy/new route rejection with no resolution becomes a renderer-local transient state, keeps active id
      and cached messages, and does not navigate, deactivate or fabricate a main `stage`.
- [ ] Legacy `session` and `sessions` fields exactly match their current available-only/null contract.
- [ ] Unknown Agent produces an unavailable list result while healthy sessions remain ordered and visible.
- [ ] Selecting an unavailable session keeps active id/sidebar row, disables send and renders unavailable copy.
- [ ] Transient restore keeps active id, binding and cached messages; Retry reuses the same session id.
- [ ] Missing active session clears local active state and navigates exactly once.
- [ ] Available restore preserves current message paging and active summary behavior.
- [ ] Public transient error metadata contains no raw Error, stack, SQL, command, environment data or additional
      filesystem path; only the existing `record.projectDir` session field may contain a workdir.
- [ ] i18n validation covers every new user-facing string.

## Acceptance criteria

- [ ] `SessionResolutionResult` is exhaustive and is the authoritative main-process output of `resolve*`;
      nullable/available-only loss exists only in the three named legacy Presenter adapters and legacy route
      fields.
- [ ] There is no `null as unknown as SessionWithState` or equivalent fake non-null cast.
- [ ] A deterministic unknown Agent never rejects a session list and never hides healthy rows.
- [ ] The registered built-in Agent fast path remains catalog-read-free; catalog authority applies after a
      registry direct miss.
- [ ] A state/catalog/runtime throw is never classified from error text and never clears window or remote binding.
- [ ] Missing is produced only from an authoritative session-record miss.
- [ ] Explicit deactivation clears immediately; deletion keeps the current no-reverse-index behavior and its next
      bound lookup clears on authoritative missing without a fake deactivation event.
- [ ] Disabled/uninstalled execution state is not conflated with session availability.
- [ ] Fulfilled null runtime state keeps the documented compatibility mapping for this remediation.
- [ ] Restore retry actually makes its second attempt for transient resolution and does not retry unavailable/missing.
- [ ] List does not add per-row retries or turn lightweight startup into runtime N+1 hydration.
- [ ] Every direct/bound session consumer uses `resolve*` or appears in the explicit legacy-adapter allowlist;
      floating-button full list is the only production available-only list caller.
- [ ] Terminal diagnostics are emitted once per terminal boundary, never per retry attempt or classifier layer.
- [ ] New route fields are additive and sanitized; legacy fields remain parseable by the old schemas.
- [ ] New renderer displays unavailable/transient/missing distinctly and never clears identity on transient failure.
- [ ] A route rejection without a public resolution is renderer-local transient state, never fabricated missing.
- [ ] Focused tests, typecheck, format, i18n and lint pass; full test failures do not grow beyond the branch baseline.

## Migration and rollback

### Data migration

No SQLite schema or stored row changes are required. Availability is derived from current record/catalog/runtime
evidence on every lookup. Persisting it would become stale as Agent configuration and runtime health change.

No existing session, Agent, binding or message is rewritten by either PR.

### Code migration order

1. Merge `SES-002` alone. Existing renderer and route schemas continue to run; binding semantics become safer.
2. Validate main unit/integration tests and full branch baseline.
3. Merge `SES-003`. New renderer reads additive public fields; legacy fields remain.
4. Validate normal available startup/session selection in the release-equivalent packaged binary. Validate
   unavailable/transient packaged behavior only through the non-release fixture build described below; never add
   a runtime fault switch to the shipped binary.

The two PRs must not be squashed into one large source/UI rewrite. The intermediate state is deliberately runnable
and reviewable.

### Packaged fixture strategy

The release binary must not accept an environment variable, debug route or user-visible command that fabricates
session availability. Existing `debug.createMockChatSession` is disabled when `app.isPackaged`, so it cannot be
claimed as packaged fault coverage.

If `SES-003` includes packaged unavailable/transient automation, it builds a separate unsigned, non-publishable
E2E fixture artifact. Its test-only main composition injects a `SessionResolutionFixturePort` before packaging:

- `unknown-agent` seeds a persistent session record whose non-built-in Agent lookup fulfills null;
- `transient-once` rejects the selected session state read once, then delegates to the real implementation;
- `transient-always` rejects every selected read for the test lifetime;
- the port is selected at build time, has no IPC/debug route, and is absent from the release main entry;
- Playwright launches the fixture artifact with a disposable `DEEPCHAT_E2E_USER_DATA_DIR` and asserts identity,
  cached-message, Retry and no-navigation/no-replacement behavior.

The normal packaged smoke still runs against the release-equivalent artifact. If the non-release fixture artifact
is not implemented in `SES-003`, unit and dispatcher-to-store integration remain the automated evidence, and the
PR description must state that packaged unknown/transient injection is unverified. It must not claim complete
packaged automation or add a production fault-injection flag merely to turn that row green.

### Rollback

- Rolling back `SES-003` leaves `SES-002` internal correctness in place. Old renderer behavior returns, but no data
  migration must be reversed.
- Rolling back `SES-002` reintroduces the known null-collapse/binding defect. It is mechanically safe for data but
  only acceptable for a release-blocking regression, and the PR rollback description must name that reliability
  loss.
- Additive route fields can be removed without database action. During the compatibility window, old/new mixed
  parsing tests must stay green before any field removal.
- No feature flag is needed because there is no dual persisted format or irreversible rollout step.

## Expected impact and benefit

| Area | Change | Benefit | Cost/risk |
| --- | --- | --- | --- |
| Session correctness | Four explicit outcomes replace null collapse | Missing/unavailable/transient become testable facts | More exhaustive switches in main consumers |
| Window/remote stability | Binding clears only with destructive evidence | Temporary reads no longer make a conversation disappear or silently switch | An unavailable session remains selected until user acts |
| User experience | Minimal state panel replaces blank chat | User knows whether to retry or restore an Agent | Adds renderer/i18n state in `SES-003` |
| List reliability | Per-record isolation remains | One legacy Agent cannot block healthy sessions | Full list carries result metadata; legacy field still filters |
| Performance | Lightweight list stays record-only; list has no per-row retry | No startup N+1 regression | Active/restore may perform one extra read attempt on failure |
| Type safety | Unsafe cast is removed | Future consumers must handle every outcome | Shared Presenter signatures and tests need coordinated update |
| Security/privacy | Public error envelope is sanitized | No raw runtime/command/env leakage to renderer | Main logs still need disciplined structured fields |
| Storage/migration | No DB changes | Rollback is simple; no stale health column | Availability is recomputed on each explicit lookup |

This task has no promised throughput improvement. Its measurable benefit is fewer false unbinds, honest error
semantics and smaller regression ambiguity before later AgentRuntime refactors.

## Rejected approaches

| Approach | Decision | Reason |
| --- | --- | --- |
| Delete the catch and let list reject | reject | Breaks the deliberate `72dc7e5d` isolation goal; one orphan would block every healthy session. |
| Keep null and only add comments/logging | reject | Retry still cannot observe failure and binding still lacks evidence. |
| Match `Agent not found` or timeout strings | reject | Error text is not a stable typed boundary and can misclassify DB/runtime failures. |
| Add availability values to `SessionStatus` | reject | Generation lifecycle and resolution availability have different owners and transitions. |
| Treat `enabled=false` or ACP not-installed as unavailable | reject | Current repository deliberately preserves catalog identity independently of launch readiness. |
| Always unbind on non-available result | reject | Repeats the defect for transient and restorable Agent states. |
| Never unbind | reject | Leaves a provably deleted/missing session permanently bound. |
| Retry every row or retry forever | reject | Multiplies list latency/load and can turn a persistent bug into a retry storm. |
| Persist availability in SQLite | reject | Runtime health is derived and mutable; a stored value would become a second stale truth. |
| Hydrate every lightweight sidebar item | reject | Reverses the startup optimization and reintroduces runtime N+1 reads. |
| Redesign AgentRegistry into one implementation per Agent | reject | Current shared implementation is intentional and unrelated to the null-collapse defect. |
| Force the registered built-in id through catalog lookup | reject | Changes a working direct registry identity into an extra DB/init dependency and contradicts the current fast path. |
| Change `getSession/getSessionList/getActiveSession` return types in place | reject | Forces every consumer into one large commit; additive `resolve*` methods permit a bounded, allowlisted compatibility window. |
| Add a sessionId → windows reverse index only for deletion | defer | Deletion already converges through authoritative missing; a second binding index expands A-13 lifecycle scope. |
| Expose raw `Error` to renderer | reject | Leaks implementation details and produces unstable product copy. |
| Create parallel `sessions.resolve*` routes | reject | Additive fields on existing typed routes provide staged compatibility without a duplicate API family. |
| Add a feature flag | reject | There is no irreversible data migration; a flag would create two binding semantics and double the test matrix. |
| Read unknown-Agent history through a new SQLite port in this task | defer | Useful follow-up, but not required to preserve identity and prevent false unbind; it expands message ownership. |

## Non-goals

- No Agent creation/removal/install UX redesign.
- No change to ACP process launch, provider retry or model connectivity.
- No deletion or repair of orphaned session records.
- No foreign key migration between `new_sessions` and `agents`.
- No removal of the historical fulfilled-null runtime-state fallback.
- No message repository extraction for unknown-Agent history.
- No Scheduler cancellation/unknown-outcome redesign (`SCH-*` owns it).
- No AgentRuntimePresenter split or route-root extraction.
- No change to session list sorting, pagination or database indexes.
- No window-binding map cleanup for destroyed webContents; A-13 remains separate.
- No sessionId → window reverse index; deletion uses the documented next-lookup missing convergence.
- No long-term removal of legacy route fields in `SES-003`.
- No removal of Presenter legacy `get*` adapters until their explicit allowlist reaches zero in a later cleanup.

## Task checklist

### Decision (`SES-001`)

- [x] Verify current list/get/active/binding call chains.
- [x] Verify AgentRegistry, AgentRepository, ACP alias/install/enable semantics.
- [x] Verify route schemas, renderer restore behavior and lightweight bootstrap mitigation.
- [x] Verify `72dc7e5d`, `f0a91b77` and `752286fd` history.
- [x] Define state evidence, owners, retry, binding, compatibility and error visibility.
- [x] Split implementation into independently runnable `SES-002` and `SES-003`.

### Implementation (`SES-002`)

- [x] Add failing main tests from this spec.
- [x] Implement Presenter-port four-state `resolve*` APIs plus typed legacy adapters.
- [x] Migrate the fixed consumer inventory, enforce the legacy allowlist and preserve list isolation.
- [x] Remove unsafe cast and preserve the built-in registry fast path.
- [x] Fix window and remote binding decisions without adding a deletion reverse index.
- [x] Activate bounded transient read retry.
- [x] Enforce terminal-only diagnostics, keep legacy route shapes and run repository validation.

### Renderer contract (`SES-003`)

- [x] Add schema/compatibility/store tests.
- [x] Add sanitized additive route fields.
- [x] Implement renderer availability state and minimal UI.
- [x] Preserve cached data/binding on public or renderer-local transient error.
- [x] Add i18n keys for every maintained locale.
- [ ] Run the normal release-equivalent packaged smoke; the optional non-release fault fixture artifact was not
      implemented in this slice.
- [x] Run repository validation and compare full-suite failures with branch baseline.

`SES-003` implementation validation on 2026-07-11:

- focused main/renderer/API/schema suites after independent-review fixes: `388 passed` (`248` renderer/route
  coverage plus `140` Presenter/consumer coverage);
- full repository suite after independent-review fixes: `4635 passed`, `5` known baseline failures,
  `135 skipped`;
- the five failures remain the three `SpotlightOverlay` Pinia-fixture failures, the existing converted-steer
  context assertion, and the debug mock missing-plan assertion;
- `pnpm run format`, `pnpm run i18n`, `pnpm run lint`, `pnpm run typecheck` and `git diff --check` passed;
- packaged unknown/transient injection remains unverified because this slice intentionally did not add a
  production fault flag or a separate fixture artifact.

## Validation for this decision PR

This PR changes documentation only. Its validation gates are:

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `git diff --check`

Independent review should verify the spec against current source and history, especially these counterexamples:

- disabled Agent row is still catalog-resolvable;
- built-in `deepchat` is a registry direct hit and does not read catalog;
- state-read rejection is not proof of Agent absence;
- deletion does not currently scan or immediately clear `windowBindings`;
- fulfilled null runtime state has historical compatibility semantics;
- lightweight list avoids the full hydration path but does not fix active/restore/remote binding;
- old Zod object parsing accepts additive output keys;
- floating-button full list is the one intentional production legacy-list adapter caller.

## Residual product boundary

The repository does not currently define a repair experience for an orphaned Agent id. This spec deliberately
chooses the reversible minimum: preserve the conversation identity, show that its Agent cannot be resolved, and
allow explicit retry after configuration changes. It does not guess whether the right future action is reinstall,
remap, export, delete or an automated migration.

That product boundary does not block `SES-002` or `SES-003`: neither needs to modify data or choose a repair
workflow to stop transient failures from destroying bindings.
