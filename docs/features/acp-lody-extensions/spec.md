# ACP Lody Extension Client Support

## Scope and protocol baseline

DeepChat 的直接 ACP 会话消费 Lody 扩展。外部 agent 拥有执行循环、工具、子任务和目标；
DeepChat 拥有连接、用户交互、消息投影及扩展快照。ACP-provider 兼容路径继续提供原有行为，
不声明没有对应消费端的 elicitation、plan 或 subagentEvents 能力。

依赖固定为 `@agentclientprotocol/sdk@1.4.0` 和 `acp-extension-core@0.1.9`。SDK 默认入口
仍使用 ACP wire `protocolVersion: 1`；SDK 版本、wire 版本、每个 Lody capability 的版本互相
独立。Core 核对源码为 `c80616271c52de79ab4502fd58901d1e72088b86`，核对日期 2026-09-28。
执行和验证状态见 [plan.md](./plan.md)。

不引入新的 agent framework、执行循环、任务调度器、provider、插件注册器或第二套 JSON-RPC
transport。远端计划不自动执行，远端子代理不创建本地会话。

## Negotiation and compatibility

每次连接 initialize 独立读取 `agentCapabilities._meta.lody`，逐能力验证 version 和字段；
单项无效不影响其他能力。旧快照不能授权新连接上的操作。普通 ACP agent 保持原行为。

直接 ACP client 声明标准 `elicitation: { form: {}, url: {} }`、`plan: {}`，以及
`_meta.lody.elicitation = { version: 1, answerNotes: true }` 和
`_meta.lody.subagentEvents = { version: 1 }`。Agent 不需要声明不存在的 elicitation capability。

| Protocol surface | Consumer behavior |
| --- | --- |
| `elicitation/create`, `elicitation/complete` | Session/request scoped forms and explicit URL consent |
| `plan`, `plan_update`, `plan_removed` | Legacy plan plus items/markdown/file plans keyed by planId |
| `usage_update` | Standard context occupancy, separate from billing |
| `_lody/session/usage_update` | Cumulative model/scope accounting and latest-operation display |
| `_lody/rate_limits/update`, `get` | Full quota windows, reset times, wallet and optional query filters |
| `_meta.lody.task`, `activity`, `notice` | Remote task, compaction/retry and non-blocking notices |
| `_lody/subagents/event` | Independent run snapshot/progress/output streams |
| `_lody/subagents/list`, `output`, `cancel` | Capability-gated controls using proven remote taskId |
| `_lody/session/steer`, `steer_applied` | Request/same/active injection and durable delivery receipts |
| `_lody/session/goal`, prompt `goalControl` | Pause/clear controls; set/resume own an ordinary local prompt |
| `_lody/session/history/read` | Idle staging, bounded preview, verified complete import |
| Standard `session/fork` plus `forkAtTurn` | Remote anchored fork and target-history import |
| `worktreeProject` | Trusted logical project identity on new/load/resume/fork |
| `titleSource`, `messagePhase`, `turnId`, `toolName` | Title ownership, commentary/final labels, fork anchors, canonical tool names |
| `plan_mode` | Existing boolean configuration UI, only when advertised |

SDK integration uses public imports and the typed client builder. Stable list/resume/close methods use
public request names; the local compatibility facade retains legacy model selection for older agents.
There is no renderer-facing arbitrary method passthrough.

## Ownership and state

```text
Agent process / SDK client connection
  connectionId + remoteSessionId
    -> scoped session, permission, fs, terminal and extension handlers
    -> elicitation bridge (ephemeral questions and replies)
    -> session controller (idle state + active parent projection)
         -> independent per-run mapper for remote child output
         -> metadata persistence + typed invalidation event
              -> ACP store / question dock / status popover
```

Connection IDs are generated locally and never derived from an agent name or remote session ID.
Two processes may use the same remote session, tool, run or request ID without sharing state.
Request-scoped forms must refer to an actual outstanding request on the source connection.

`AcpExtensionState` lives in existing ACP session metadata; no database migration or extra store is
required. It separates context, accounting, plans, goals, tasks, runs, receipts and history. Metadata
merges are serialized; writes tied to an old remote binding cannot resurrect a replaced session.
Revision and connection identity protect renderer hydration from stale responses. Child output writes
and invalidation are batched at 200 ms; terminal state is immediate.

Disconnect marks context and task controls stale, running children unknown, and unconfirmed steering
unknown. A parent prompt finishing clears only parent mapping; background child output remains
observable until the session or connection ends.

## Structured elicitation

The bridge uses SDK-owned request cancellation and resolves each request once. Session forms appear
in `ChatInteractionDock`; request-scoped or background-session forms use the global ACP dialog.
Both use the typed `acp.elicitation.list/respond` routes and the ACP owner. Forms are ephemeral; they
do not become assistant action blocks or ordinary chat messages. The shared field normalizer is pure
and reused by MCP; MCP and ACP retain separate request lifecycles.

Schema property names and enum values are authoritative. The form supports strings, numeric values,
booleans, single/multiple selection, defaults, descriptions, previews, custom alternatives and notes.
Single selection returns a string; multiple selection returns an array, never comma-joined labels.
`customAnswerFor` replaces the referenced selection; `noteFor` is additive under its own field key.
Lody `questions` may enrich presentation but cannot rename schema keys or substitute display labels
for enum values. Main validates the final content and relationships before replying.

Responses retain standard `{ action, content }` and, for Lody requests, matching
`_meta.lody.elicitation = { version: 1, answers }`. Decline and cancel finish the original request;
no extra prompt or tool execution is created. A failed validation keeps the form editable.

Secret fields use masked inputs where applicable, omit defaults, and keep values only in live renderer
and bridge memory. Submitted values are removed from the form store. Known literal echoes are redacted
on the active connection before transcript/debug projection. This is not a claim that arbitrary remote
agent output or a later connection can be classified as secret without producer metadata. No secret
answer is deliberately copied into chat history, exports, synchronization or subsequent prompts.

Deadlines are the earlier of relative and absolute metadata; expiration cancels and never auto-accepts.
Cancel, origin completion, disconnect and session teardown clean pending resolvers. URL elicitation
allows only HTTP(S), displays the destination, opens only on explicit user action and treats accept as
consent, not completion; `elicitation/complete` ends the external waiting state.

Bounds: 32 pending requests, 64 fields, 128 options, 256 KiB request and 64 KiB reply. Invalid schema,
relationships or URL are rejected. Renderer cannot fabricate a remote request identity.

## Plans, context, usage and quotas

Plans are keyed by planId, including a dedicated legacy entry. Empty legacy entries clear visible
steps; plan_removed deletes only its matching plan. File plans require an explicit read, a file URI,
the existing workspace path guard and a 256 KiB limit. Markdown uses the existing renderer.
`plan_mode` stays in normal session configuration. Titles update only while the local title matches
the remembered ACP-owned baseline; a manual title disables later automatic overwrites.

ACP context occupancy uses reported `used/size` and stale state; it never fabricates Tape anchors.
Accounting uses cumulative `modelUsage`. Top-level usage is the latest operation; delta is already
included and is never added again. Distinct `usageScopeId` counters sum independently. Repeated reports
are idempotent; decreasing counters or unscoped reconnects mark totals incomplete. Missing cost stays
unknown. Optional cache creation, reasoning and web-search details are retained and displayed.

Quotas preserve provider/account/model scope, all concurrent windows, labels, resets and wallet fields.
If query is supported, opening a session reads an initial quota snapshot. DimCode 0.5.12 enables Lody
notifications only after a first Lody request; this read also activates its usage notifications.
Refresh failures do not prevent ordinary chat. No timers repeatedly query quotas.

## Remote tasks and child streams

Task metadata retains taskId, kind, status, ancestry, parent tool, description and usage. Scheduled and
background observations remain remote state. `skipTranscript` suppresses redundant parent narration.

Subagent events use a distinct mapper/accumulator per local session and runId. Snapshot support flags
control admitted stream types and available controls; nullable progress fields clear previous values.
Early output is held briefly for its snapshot. A unique shared parentToolCallId can link a run to a
legacy task; linked entries share one UI entry. Parent run/task identities remain visible.

Run IDs are never sent as task IDs. Output/cancel require an observed fresh task ID and the negotiated
session subagent capability; linked runs must also advertise the action. Completed tasks cannot be
cancelled; final-tail-only output is unavailable while a run is active. Disconnect disables controls.
Child usage is an observation and does not contribute to the parent billing ledger.

Bounds: 64 runs, 256 tasks, 128 blocks and a 64 KiB retained tail per run, with an explicit incomplete
indicator. Early events are limited to 16 per run / 64 pending runs / 10 seconds. Plans are bounded to
32 entries / 256 KiB each, quota windows to 64 per limit, accounting to 4,096 scopes.

## Steering and goals

Native steering is enabled only for `{ transport: request, upstreamTurn: same, configPolicy: active }`.
It preserves the running prompt and configuration, uses the pending input's persistent ID as steerId,
links the receipt to the current assistant, and sends only the new user's content. It does not cancel
first, start another projection or merge multiple injections under one ID.

`accepted` means locally submitted, `applied` requires the matching notification, and `failed/unknown`
remain unread. Applied-before-response is supported and cannot be downgraded. Missing confirmation,
disconnect or restart becomes unknown with no automatic replay. Ordinary ACP and unsupported steering
combinations retain the existing explicit cancel/handoff behavior. Prompt-transport steering is gated
until an adapter's concurrent prompt/output attribution is verified; no additional prompt slot is opened.

Goal set/resume use promptActions and an empty wire prompt with `_meta.lody.goalControl`, inside the
existing local projection and prompt lifecycle. Pause/clear use controlActions and do not create a turn.
The action union alone does not authorize a transport. Goal execution does not inherit the ordinary
single-turn timeout. User Stop still cancels the current prompt; no unsupported budget setter exists.

## History, fork and project identity

History read holds the instance's idle-operation slot. It stages the complete bounded sequence rather
than merging by equal text; repeated text in different turns remains distinct. During replay, parent
projection, metadata/accounting changes, permissions, host tools and elicitation are suppressed.
Timeout/error closes the connection before releasing the replay gate, preventing late replay from
becoming live output. Snapshot identity is a digest of the full ordered replay. Import is atomic into
an empty conversation and idempotent for exactly the same snapshot; it creates no billing entries.

The complete replay/response delimiter is wire-verified for DimCode 0.5.12. Other producers receive
read-only preview until that delimiter is verified. Standard resume is preferred to load for a bound
session; history import is explicit rather than silently appending a second source.

Anchored fork requires standard fork, Lody forkAtTurn, history capability, a completed local assistant
message, and a turnId confirmed in the current source's remote history. Fork inherits cwd and MCP
configuration. The target's own history supplies rewritten turn IDs; source IDs are never copied as
target anchors. Inherited cumulative model usage is a baseline; incremental fork usage starts at zero.
If no baseline arrives, the UI explicitly says it is unknown.

A bounded pending/created/complete record survives remote success followed by local failure. A retry
reuses a known remote result; an unknown pending outcome blocks automatic retry. Remote fork and replay
requests have 30-second bounds. Failures do not delete a remote session automatically.

worktreeProject is sent only when negotiated and an existing trusted project root contains the chosen
cwd. It communicates logical identity only; it cannot change cwd, path guards or worktree lifecycle.
No out-of-tree relationship is invented from a remote path.

## UI

```text
BEFORE
[tool calls / assistant answer]
[single question choice or permission]
[composer]                     [model / settings]

AFTER
[parent tool calls / commentary / final answer]
[question dock]
  Strategy  ( ) Minimal  (x) Complete
  Checks    [x] Types    [x] Tests
  Note      [........................]
  Preview   [expand]
                     [Cancel] [Decline] [Submit]
[composer]   [reported context] [Agent status]
                                 Usage / quotas / plans
                                 Goal [pause] [resume]
                                 Tasks and linked child runs
                                 History preview / import
```

Existing shadcn popover/dialog, buttons, markdown and tool detail components are reused. Copy uses
vue-i18n. Forms use native input semantics and submit only on explicit confirmation; task output is
read-only. Typed ACP routes reject unnegotiated or stale control actions in main, regardless of UI.

## Verification boundaries

Real DimCode 0.5.12 verification uses a temporary cwd and synthetic prompts with host permissions
denied. Production process/session/controller/elicitation code verifies structured single/multi-select
answers, normal prompt continuation, context, cumulative usage, empty valid quota/task responses,
complete history without duplicate accounting, remote fork with rewritten anchors, inherited baseline,
and request steering applied during the same prompt. Goal control uses bounded set/pause/clear probes.

DimCode does not advertise latest subagent events. Local protocol fixtures cover their snapshot,
progress, output isolation, support gates, ancestry and disconnect behavior. Fixtures also cover URL
and request-scoped elicitation, cancellation, deadlines, notes/custom alternatives, invalid data,
ordinary ACP compatibility and renderer behavior. Synthetic tests are not reported as real-agent support.

Real background/scheduled task production, nonempty provider quotas, compaction/retry, plan_mode,
worktreeProject and prompt-transport steering are not claimed as DimCode end-to-end observations.

## Sources

- [Lody Core contracts](https://github.com/LodyAI/acp-extension-core/tree/c80616271c52de79ab4502fd58901d1e72088b86)
- [Lody Core README](https://github.com/LodyAI/acp-extension-core/blob/c80616271c52de79ab4502fd58901d1e72088b86/README.md)
- [ACP SDK 1.4.0 package](https://registry.npmjs.org/@agentclientprotocol/sdk/1.4.0)
- [ACP extension guidance](https://agentclientprotocol.com/protocol/extensibility)
