# AgentManager 与顶层控制面

> 状态：目标设计；不描述已经落地的代码。  
> 上位合同：[总体设计](../README.md) · [规格](../spec.md) ·
> [迁移与验证](../migration-and-validation.md)

## 1. 模块目的

`AgentManager` 是 agent 子系统的应用控制面，只回答三个问题：

1. 当前有哪些 agent，它们分别是什么 kind；
2. 一个 app session 应该由哪个 backend 打开和处理；
3. route、remote、cron、subagent 等入口怎样获得稳定且兼容的 session 操作。

它不是资源总管，也不是第三套 runtime。MCP、skills、memory、provider、plugin 仍由各自 Presenter
拥有。`AgentManager` 只持有它们暴露出来的窄引用，或者把引用交给具体 backend。

## 2. BEFORE

当前顶层入口分散在三个位置：

- `AgentSessionPresenter` 同时承担 route façade、session application service、kind dispatch 和大量
  DeepChat/ACP 专属操作；
- `AgentRegistry` 的生产注册表只有 `deepchat`，但 `resolveAgentImplementation()` 会把
  `deepchat` 和 `acp` 都解析为同一个 `AgentRuntimePresenter`；
- `ConfigPresenter -> AgentRepository` 才是真正给 UI 提供 agent catalog 的路径。

因此 registry、catalog 和 runtime routing 是三套不同事实源。`IAgentImplementation` 为了容纳双方
能力，把大量方法设成 optional；调用方只有在运行时检查“有没有这个方法”。

当前简化关系：

```text
route -> AgentSessionPresenter
          ├─ AgentRegistry (one implementation)
          ├─ ConfigPresenter -> AgentRepository (actual catalog)
          └─ AgentRuntimePresenter (both kinds)
```

问题不在于缺少更多接口，而在于公共接口覆盖了并不公共的能力。

## 3. AFTER 的所有权

```text
AgentManager
├─ AgentCatalog
│  ├─ DeepChatAgentRepository
│  └─ AcpAgentRepository
├─ AppSessionService
├─ DeepChatAgentBackend
└─ AcpAgentBackend
```

`AgentManager` 负责：

- 查询、创建、更新和删除 agent descriptor；
- 将 legacy route DTO 转换为内部 discriminated descriptor；
- 根据 app session 持久化的 agent identity 解析明确 kind；
- 显式路由公共 session 操作；
- 为 kind-specific route 返回 required capability，而不是 optional method；
- 维持 façade 兼容期内的旧 route/event contract。

`AgentManager` 不负责：

- DeepChat provider/tool round；
- ACP process/protocol loop；
- prompt 拼装、Tape、compaction、Memory 策略；
- MCP server、skill、provider 或 plugin 的生命周期；
- Electron window 渲染与具体 SQLite statement。

## 4. 最小内部合同

```ts
type AgentDescriptor = DeepChatAgentDescriptor | AcpAgentDescriptor

interface AgentDescriptorBase {
  id: string
  kind: 'deepchat' | 'acp'
  name: string
  enabled: boolean
}

interface DeepChatAgentDescriptor extends AgentDescriptorBase {
  kind: 'deepchat'
  config: DeepChatAgentConfig
}

interface AcpAgentDescriptorBase extends AgentDescriptorBase {
  kind: 'acp'
  source: 'manual' | 'registry'
}

interface AcpManualAgentDescriptor extends AcpAgentDescriptorBase {
  source: 'manual'
  launch: {
    command: string
    args: string[]
    env: Record<string, string>
  }
}

interface AcpRegistryAgentDescriptor extends AcpAgentDescriptorBase {
  source: 'registry'
  registry: AcpRegistryReference
  installState: AcpInstallState | null
}

type AcpAgentDescriptor = AcpManualAgentDescriptor | AcpRegistryAgentDescriptor
```

内部 executable descriptor 只使用 `kind`。当前 DTO 中的 `type`、`agentType?` 只允许存在于 boundary
codec。catalog list 对 malformed legacy row 保持当前宽容/null/default/filter 语义；真正 open backend 时
若 required capability 不成立，返回 typed `AgentUnavailable`，不能 fallback 到 DeepChat。

双方真正共享的 active-session 合同保持很薄：

```ts
interface AgentSessionHandle {
  readonly sessionId: string
  readonly kind: 'deepchat' | 'acp'

  send(input: AgentInput): Promise<MessageStartResult>
  cancel(reason?: string): Promise<void>
  snapshot(): Promise<AgentSessionSnapshot>
  close(): Promise<void>
}
```

`open()` 属于 backend factory。draft、retry、steer、compaction、remote ACP mode 等不是公共能力：

```ts
interface DeepChatAgentBackend {
  open(input: OpenDeepChatSession): Promise<DeepChatAgentInstance>
}

interface AcpAgentBackend {
  open(input: OpenAcpSession): Promise<AcpAgentInstance>
}
```

## 5. 路由规则

任何 session 入口都执行同一套解析顺序：

```text
validate route DTO
  -> load app session agentId (`new_sessions.session_kind` is only regular|subagent)
  -> load current typed AgentDescriptor by agentId
  -> verify any already-hydrated backend binding still matches the current descriptor
  -> switch (descriptor.kind)
       deepchat -> DeepChatAgentBackend
       acp      -> AcpAgentBackend
  -> expose common or required kind-specific facet
```

禁止以下兼容捷径：

- 按 agent id 字符串猜 kind；
- unknown kind 默认走 DeepChat；
- backend 缺方法时静默 no-op；
- 读取 mixed `Agent` 后在下游反复判断 optional fields；
- 为了满足 `kind=acp` 公共 backend 入口而把 ACP agent session 再包装回 `LLMProvider`；这不禁止下述
  DeepChat provider compatibility adapter。

`descriptor.kind` 与 DeepChat provider selection 正交：`kind=deepchat + providerId=acp` 是当前支持的
组合，仍由 DeepChat backend 打开，再由 generic ProviderPort 选择 ACP compatibility adapter。
`kind=acp` 才进入 direct ACP backend。

## 6. 与入口的关系

### Renderer / typed routes

迁移期间 `AgentSessionPresenter` 仍保留公开 route façade，方法签名不变。方法体逐组变成：验证输入、
调用 `AgentManager` 或 kind-specific backend、映射输出。最后才决定是否改名或删除 façade。

### Remote、cron 与 subagent

这些入口不能绕过 manager 自行构造 runtime。它们传递明确的 `agentId`、`sessionId` 与 kind-specific
input，复用同一 descriptor/session 解析。现有 subagent 在 DeepChat 与 ACP 下的差异继续由对应
backend 负责。

### Transfer

`new_sessions` 没有 backend kind column。ACP -> DeepChat transfer 在一个明确 application operation 中：
先验证目标 descriptor，再按当前 commit point 清理 ACP binding/remote mapping并更新 `agent_id`，最后让旧
ACP instance 失效、下次 hydrate 进入 DeepChat backend。顺序由现有 transfer tests 锁定，不新增
`session_kind` 含义。

### Catalog 通知

catalog 的变更通知按 domain 发送：

- DeepChat CRUD 只发送 DeepChat/catalog change；
- ACP registry/install/manual CRUD 只发送 ACP/catalog change；
- 若 UI 需要统一刷新，再由 `AgentCatalog` 聚合成通用 catalog revision。

不得继续用 `notifyAcpAgentsChanged()` 表示所有 agent 变化。

## 7. 错误、取消与关闭

- descriptor 缺失、kind 不匹配、backend 不可用使用明确 error code；
- 单个 malformed legacy catalog row 不让整批 list 失败；backend open 才执行 capability-strict decode；
- manager 不吞掉 backend 错误，只在 boundary 做当前 route 需要的错误映射；
- `cancel()` 委托当前 session instance，不能靠 manager 扫描不同 backend 的内部 Map；
- `close()` 是幂等操作，先阻止新输入，再由 backend 完成 run/process/drain 清理；
- app shutdown 由 manager 枚举已打开 handle 并发起有界关闭，但 backend 决定内部顺序。

## 8. 迁移步骤

1. 为当前 mixed DTO 写 characterization tests 与 boundary codec。
2. 引入 discriminated `AgentDescriptor`，先不删除旧 route types。
3. 从 `AgentRepository` 提取两个 typed repository view，物理表不变。
4. 引入 `AgentCatalog`，让旧 `ConfigPresenter` 委托给它。
5. 引入 `AgentManager`，仅接管 catalog 和 backend resolution。
6. 让 `AgentSessionPresenter` 的公共 open/send/cancel/close/snapshot 委托 manager。
7. 按能力组迁移 kind-specific routes，删除 optional capability checks。
8. 两个 backend 均独立后删除 fake `AgentRegistry` 和 `IAgentImplementation`。
9. façade 全部变成薄 adapter 后，再单独评估命名和目录移动。

每一步都必须保持旧 route、event、DTO 和数据库 schema 可用。

## 9. 验证

- 同一 catalog 返回的 id/name/enabled/config/install state 与基线一致；
- legacy `type` / `agentType` 的所有有效组合转换结果一致；
- manual ACP required launch fields 与 registry ACP reference/install overlay 分别 round-trip；
- malformed config/state JSON、missing manual command、invalid source×kind 和 source/id collision 保持当前
  list/default/filter/winner 行为；
- invalid/unknown combination 不会被错误路由；
- DeepChat session 只创建 DeepChat backend；ACP session 只创建 ACP backend；
- DeepChat descriptor 选择 ACP provider 仍创建 DeepChat backend，并保留 `MessageStartResult`；
- route、remote、cron、regular subagent、ACP-backed subagent 的 backend 选择有表驱动测试；
- delete/clear/cancel/close 重复调用保持幂等；
- DeepChat CRUD 不再误发 ACP-only 通知，同时 renderer 的统一刷新不回归。

## 10. 明确不做

- 不创建第三种 generic agent plugin API；
- 不让 renderer 直接依赖内部 descriptor；
- 不在本模块统一 DeepChat/ACP 的专属配置；
- 不更改 catalog/session table；
- 不借重构修复已有业务行为差异。
