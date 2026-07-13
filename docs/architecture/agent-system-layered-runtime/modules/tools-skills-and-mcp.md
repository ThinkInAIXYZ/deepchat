# Tools、Skills 与 MCP 资源接线

> 状态：目标设计，不是 current API reference。资源 owner 保持独立，loop 只消费解析后的能力；下文
> resource model、adapter 和迁移步骤是目标合同，当前 concrete API 以实施进度明确列出的 slice 为准。

> 实施进度：ASLR-045 已把 message-scoped runtime skill selection、prompt snapshot 和 final tool-definition
> snapshot cache 迁入 `DeepChatAgentInstance`，全局 tool registry revision 由 `DeepChatAgentRuntime`
> 广播失效。ASLR-055 已把 session-scoped catalog、execution 和 result-normalization ports 接入现有
> loop/process/dispatch：catalog cache 仍按 profile fingerprint 和 registry revision 失效，最终 definitions
> 只来自 `ToolPresenter.getAllToolDefinitions()`；execution/result adapters 等价委托现有 pre-check、call、
> screenshot normalization 和 output guard。SkillPresenter、ToolPresenter、McpPresenter、configured
> selection 与 collision policy 的 owner 均未移动。ASLR-056 已把四种合法 pause origin 映射为
> ordered typed batch outcome，并由 instance 持有当前 batch execution state。

## 1. 模块目的

这个模块定义 DeepChat 和 ACP 怎样使用 tools、skills、MCP，而不把这些 subsystem 搬进 agent
runtime。关键区分是 ownership、selection 和 delivery：

```text
Presenter/service owns catalog/runtime
agent/session stores selection references
backend adapter resolves and delivers capabilities
```

## 2. BEFORE

MCP 本身相对独立，但 `AgentRuntimePresenter` 在 prompt、tool refresh、dispatch、permission、skill
activation 等多个位置直接调用相关 Presenter。ACP 又通过自己的 session config 使用 MCP，而不是使用
传给 `AcpProvider` 的 DeepChat tool list。

`src/main/lib/agentRuntime/questionTool` 还把一个具体 tool 放在名为 runtime 的混合目录里，进一步模糊
ownership。

## 3. AFTER 的 owner

| 能力 | 数据/运行 owner | DeepChat delivery | ACP delivery |
| --- | --- | --- | --- |
| local built-in tools | `ToolPresenter` | `DeepChatToolPort` | 不作为 direct ACP callable tools；regular direct ACP 与 DeepChat + ACP-provider 均保留当前 prompt descriptions |
| MCP servers/tools | `McpPresenter` + `ToolPresenter` aggregate | ToolPresenter 返回最终 provider definitions + dispatcher | direct ACP session MCP config |
| skill catalog/content | `SkillPresenter` | prompt sections、activation、skill tools | direct ACP 不新增 callable skill；regular/subagent 当前 system-prompt 差异保持 |
| plugin-provided capabilities | `PluginPresenter`/对应 owner | 经 Tool/Skill adapter | 仅经 ACP 明确支持的 adapter |

`AgentManager` 只管理 selection reference 与 agent association，不复制 catalog/runtime。

## 4. Resource model

```ts
interface SessionResourceSelection {
  skillIds: string[]
  mcpServerIds: string[]
  extensionPolicy: AgentExtensionPolicy
}

interface ResolvedDeepChatResources {
  promptSections: PromptSection[]
  tools: ResolvedTool[]
  revision: ResourceRevision
}
```

selection 与 resolved resource 分离：前者可持久化且轻量，后者只对当前 turn/round snapshot 有效。resolved
object 不得跨 owner revision 永久缓存。

## 5. DeepChat resource assembly

```text
load session/agent selection
  -> query SkillPresenter for prompt/activation data
  -> query DeepChatToolCatalogPort -> ToolPresenter for the final merged definitions
       (ToolPresenter alone applies MCP/local/plugin scope and collision policy)
  -> build prompt sections + use those final provider tool definitions
  -> freeze resource revision for provider attempt
```

provider 返回 tool call 后：

```text
normalize identity/arguments
  -> resolve same revision or approved refresh mapping
  -> pre-check permission when current policy applies
  -> question interception or ToolPresenter execution
  -> capture post-call permission / post-success skill-draft interaction
  -> normalize/fix output size
  -> persist fact/projection
  -> apply skill activation/resource revision
  -> refresh before next provider round when current rule requires
```

`processStream` 和 legacy `dispatch` 只持有 `ToolCatalogPort`、`ToolExecutionPort` 与 `ToolResultPort`，
不再直接持有 `IToolPresenter`、normalization callback 或 concrete `ToolOutputGuard`。ASLR-056 后，
legacy batch dispatcher 把 permission/question/post-call/skill-draft decision 映射成 ordered typed
outcome；adapter 不决定 pause。已调用与已提交 result 的 call ids 随 outcome 交给 instance，逐项响应期间
不会重新运行整个 batch 或重放已提交 side effect。

tool collision priority、parallel eligibility、argument repair、result fitting 和 renderer payload 均保持当前
行为。

## 6. Skills

skill 有三种参与形式，必须分开：

1. catalog metadata：让模型知道可用 skill；
2. pinned/activated content：按固定 prompt 顺序注入；
3. activation/tool result：可能改变下一 round 的 resource revision。

`SkillPresenter` 继续拥有 catalog、内容加载、activation policy 和关联数据。loop adapter 只查询并产生
`PromptSection`/resource delta。禁止把 skill 文本复制进 instance 成为第二事实源。

agent-scoped extensions 的 enabled/disabled、global/agent/session 合并和 existing precedence 由现有合同
锁定；本次只让调用点变得明确。

## 7. MCP

`McpPresenter` 继续拥有 server definitions、connectivity、tool discovery 和调用状态。两个 backend 使用
不同 adapter：

```text
DeepChatToolCatalogPort:
  selection -> ToolPresenter aggregate -> final collision-resolved definitions/dispatcher

AcpMcpDeliveryAdapter:
  selected servers -> ACP-compatible server configuration -> remote ACP session
```

不能为了复用让 ACP MCP 先变成 DeepChat `ToolDefinition[]` 再还原。server identity、enabled state、
collision 和 refresh 行为必须保持。

## 8. Question 与交互 tool

`questionTool` 是 `ToolPresenter` 管理的 DeepChat tool implementation，不属于 platform runtime。dispatch
按当前规则拦截它并产生 ordered interaction，不调用 underlying tool。post-call
`requiresPermission` 和 post-success skill-draft confirmation 也进入同一 ordered batch；instance 保存
`PendingInteraction[]`，不是单个 current-run callback。tool 本身不直接访问 Electron window。

## 9. 错误与取消

- resource owner 查询失败按现有 required/optional policy 处理；
- 单个 disabled/disconnected MCP server 不得改变其他 server 的稳定顺序；
- tool execution 使用当前 `AbortSignal`，late result 通过 run/interaction epoch 拒绝；
- `ToolExecutionPort` 不另造 cancel channel；现有 owner 只支持把同一个 `AbortSignal` 传入 `callTool`，
  deferred tool 也沿用该合同；
- skill refresh 失败不能使用未验证的半新 revision；
- tool 输出 normalization/fitting 失败按当前 tool error fact 处理；
- ACP MCP delivery 失败由 ACP backend 映射，不能落入 DeepChat tool error 分支。

## 10. 迁移步骤

1. 冻结 tool list/order/collision、skill prompt、MCP delivery 和 output fixtures。
2. 给现有 Presenter 调用增加窄 read/execute ports，内部实现不动。
3. 建 `SessionResourceSelection` 与 revision snapshot。
4. 把 DeepChat prompt resolution 收敛到 resource adapter，tool list 只通过 ToolPresenter aggregate port。
5. 把 dispatch 改为 `DeepChatToolPort`，保留 permission/output policy。
6. 把 `questionTool` 移到 ToolPresenter owner，并在同一 slice 更新 imports/tests、删除旧路径。
7. 给 ACP 建独立 MCP delivery adapter。
8. 删除 runtime 对 Skill/MCP concrete Presenter 的散落调用。

## 11. 验证

- zero/one/many local、MCP、plugin tools 的 exact definition order；
- duplicate tool names 与当前 collision winner；
- enabled/disabled/disconnected MCP server；
- global/agent/session extension selection precedence；
- pinned、activated、missing、changed skill；
- skill activation 后下一 round prompt/tool revision；
- parallel/sequential tool execution 与 output fitting；
- permission allow/deny/pause/cancel；
- pre-check、question、post-call permission、skill-draft 和同批 multiple interactions；
- ACP MCP config snapshot 与 current baseline；
- owner shutdown/reconnect 时 session 不保留 stale callable object。

ASLR-055 的 typed-port 与 real-boundary proof 位于
`test/main/presenter/agentRuntimePresenter/toolAdapters.test.ts`、`process.test.ts`、`dispatch.test.ts`、
`toolOutputGuard.test.ts` 和 `test/main/presenter/toolPresenter/toolPresenter.test.ts`。它们锁定
zero/one/many、collision、policy/cache/revision、parallel/sequential ordering、exact call options、
normalization/offload/failure、skill refresh 和 abort forwarding。

ASLR-056 的 ordered-outcome proof 位于 `dispatch.test.ts`、`process.test.ts`、
`agentRuntimePresenter.test.ts` 与 `deepChatAgentRuntime.test.ts`。它锁定现有 persisted action 顺序、
四种 origin、live-store refresh、逐项 execution-state 演进、post-call no-replay，以及 final-item-only
fresh resume。

## 12. 明确不做

- 不合并 `McpPresenter`、`SkillPresenter`、`ToolPresenter`；
- 不将 resources 注册到 generic lifecycle plugin bus；
- 不给 direct `kind=acp` 自动新增可调用的 DeepChat-only tools/skills；不删除 regular ACP 或 DeepChat +
  ACP-provider 已有 system-prompt descriptions；
- 不更改 collision、parallel 或 output fitting policy；
- 不新增 dependency 或通用 resource framework。
