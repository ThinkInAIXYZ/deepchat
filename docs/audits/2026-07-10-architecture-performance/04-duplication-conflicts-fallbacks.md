# 04 - 重复设计、冲突与过度兜底

本章只列“同一语义有多份实现/真源”“fallback 掩盖契约失败”“抽象已失去真实分支”的情况。
名字相似但 owner 不同，不算重复。

---

## D-01 [中][已确认] Remote channel descriptor 有四份真源且已经漂移

### 四份定义

| 位置 | Telegram `supportsNotifications` | 其他 channel |
| --- | --- | --- |
| [`RemoteControlPresenter.listRemoteChannels`](../../../src/main/presenter/remoteControlPresenter/index.ts#L307) | `false` | 全 `false` |
| [`PluginsCatalogPage`](../../../src/renderer/src/pages/plugins/PluginsCatalogPage.vue#L111) fallback | `true` | 全 `false` |
| [`WindowSideBar`](../../../src/renderer/src/components/WindowSideBar.vue#L625) fallback | `true` | 全 `false` |
| [`RemoteSettings`](../../../src/renderer/settings/components/RemoteSettings.vue#L1843) fallback | `false` | 全 `false` |

### 与实际能力冲突

当前 Cron remote delivery 明确支持 Telegram、Feishu、Discord、Weixin
([`REMOTE_DELIVERY_CHANNELS`](../../../src/main/presenter/remoteControlPresenter/index.ts#L93) 与
[`deliverCronJobResult`](../../../src/main/presenter/remoteControlPresenter/index.ts#L440))，QQBot 不支持。
如果 `supportsNotifications` 指 outbound notification，main 的全 false 和 renderer 的 Telegram-only true 都
已经过期；如果它指别的能力，type 没有注释，production code 也不消费这个 field。

### 历史意图

- main catalog 在 `0558b88b` 引入时全 false，早于当前 Cron delivery。
- renderer fallback 在 `eb81a612` 引入，目的是 IPC 失败时仍显示 plugin cards；当时就与 main 的
  Telegram 值不同。
- 2026-07-05 remote delivery 扩展后，没有任何一份 catalog 同步为四 channel。

### 判断

fallback 的可用性动机真实，但复制完整 capability catalog 会把 contract failure 伪装成“channel 存在但
未启用”，并已经产生数据漂移。当前 `supportsNotifications` 未驱动明显 UI 行为，所以不是已确认的用户
功能错误；它是已确认的多真源和语义失效。

### 建议

保留一份 shared static catalog 或一份 main authority；route 失败时显示 unavailable/error，而不是伪造
完整 capability。给 field 写清语义并由 delivery adapter capability 生成。

---

## D-02 [低运行时/中维护][已确认] `RemoteSettings.vue` 留下 145 行失效的 Compat 壳

[`RemoteSettings.vue`](../../../src/renderer/settings/components/RemoteSettings.vue#L2083) 的
`listRemoteChannelsCompat`、`get/saveChannelSettingsCompat`、status、binding、pairing、Feishu auth/install、
Weixin login/account 等 wrapper 延伸到 L2227。

绝大多数只做 `return await remoteControlClient.*`，没有 fallback、转换或 policy。历史上它们确实兼容
optional legacy presenter API；`32bacc5f` 完成 typed route migration 后旧分支被删，wrapper 名称和调用层
保留。

少数 overload 对 TypeScript channel-specific return type 有价值；不应机械删除全部 145 行。只保留真正
需要的窄类型 adapter，其余直接调用 `RemoteControlClient`。

---

## D-03 [低][已确认基本不可达] generic remote status 之外仍保留专用 routes

- generic contract/client：
  [`remote-control.routes.ts`](../../../src/shared/contracts/routes/remote-control.routes.ts#L103)、
  [`RemoteControlClient`](../../../src/renderer/api/RemoteControlClient.ts#L58)；
- Telegram/Weixin 专用 contract：同文件
  [L176](../../../src/shared/contracts/routes/remote-control.routes.ts#L176)、
  [L255](../../../src/shared/contracts/routes/remote-control.routes.ts#L255)。

唯一 production fallback 在
[`WindowSideBar`](../../../src/renderer/src/components/WindowSideBar.vue#L1296)：只有当 generic statuses
包含 null 才调用专用 API。但 typed generic route 返回非 null status，调用失败会 throw 到外层 catch，
不会产生 null entry，因此该 fallback 在当前契约下基本不可达。

这是 `32bacc5f` 为兼容原 API 一并保留的迁移残留。确认支持窗口后可统一 generic route；不要在未确认
旧 app/renderer 跨版本支持策略前直接删除。

---

## D-04 [中/潜在高][已确认现状，未来意图未知] 单一 agent 实现上约 35 个 optional capability

### 代码真相

- [`IAgentImplementation`](../../../src/shared/types/agent-interface.d.ts#L138) 有约 35 个 optional method。
- production [`AgentRegistry`](../../../src/main/presenter/agentSessionPresenter/agentRegistry.ts#L3) 只注册一个
  `'deepchat'` implementation
  ([`AgentSessionPresenter`](../../../src/main/presenter/agentSessionPresenter/index.ts#L298))。
- deepchat 与 ACP agent 最终都解析到同一 implementation
  ([`resolveAgentImplementation`](../../../src/main/presenter/agentSessionPresenter/index.ts#L2683))。
- 当前 `AgentRuntimePresenter` 已实现主要 capability。

### 由 optional 产生的 fallback

- paging capability 缺失时，加载全部 messages 后内存分页
  ([`AgentSessionPresenter`](../../../src/main/presenter/agentSessionPresenter/index.ts#L1147))；当前唯一实现已有
  native page API。
- compaction capability 缺失时伪造 idle state。
- steer method 缺失时可静默返回，但上层 `ChatService` 仍返回 `{accepted:true}`。
- permission capability 缺失时默认 `full_access`，setter 可 no-op
  ([L2279-L2300](../../../src/main/presenter/agentSessionPresenter/index.ts#L2279))。

### 意图核验

`c86f1fb1` 和 [`agent-system.md`](../../architecture/agent-system.md) 明确把 Registry 作为未来多 agent
implementation seam，所以 Registry 不是 YAGNI 证据，不能只因当前一个实现就删除。

问题是 capability 差异没有显式 descriptor，全部由 `typeof method === 'function'` 隐式决定。当前死分支
很多，未来第二实现又可能在安全/acknowledgement 能力缺失时悄悄 fail-open。

### 建议

当前 runtime 必需能力改为 required；真实可选能力放进显式 capability object，并让 route 对不支持返回
明确错误。permission、steer acknowledgement 不允许 default/no-op。未来第三方 implementation 计划无法
从当前仓库确认，因此不能现在把全部 optional 一刀切掉。

---

## D-05 [中][已确认 owner 混淆] `ChatService.activeControllers` 不拥有真实 generation

### 代码真相

- [`ChatService`](../../../src/main/routes/chat/chatService.ts#L16) 维护 `activeControllers`，错误文案是
  “A stream is already active”，并用 30 分钟 timeout 包装 `providerExecutionPort.sendMessage()`。
- 当前 AgentSession send 发现 `queuePendingInput` 后，只 enqueue 并返回 null ids
  ([`AgentSessionPresenter`](../../../src/main/presenter/agentSessionPresenter/index.ts#L773))。
- [`AgentRuntime.queuePendingInput`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L1055) 用
  fire-and-forget 启动真正 `processMessage`，enqueue 很快返回。
- `ChatService` 随即在 finally 删除 controller；真实 generation 由 AgentRuntime 的
  `abortControllers/activeGenerations` 拥有
  ([`AgentRuntimePresenter`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L624))。
- stop 先 abort route wrapper controller，再单独调用真正的 `cancelGeneration`
  ([`ChatService.stopStream`](../../../src/main/routes/chat/chatService.ts#L130))。

### 判断

该 controller 只覆盖 route lookup/enqueue 窗口，不覆盖 stream；guard 只阻止同时发生的两次 route call，
之后再次发送会进入 runtime pending queue。这可能正是 pending queue 产品语义，但命名、30min timeout 和
双层 abort owner 仍给出相反暗示。

### 建议

先决定 route service 只负责“accepted/enqueued”，还是负责 generation lifetime：

- 若只负责 enqueue，删除 stream controller/30min timeout 语义，返回 queue item/operation id；
- 若负责 generation，port 必须返回可观察 handle 并把 cancellation owner 明确交给一层。

---

## D-06 [中][已确认死 fallback/type lie] MainKernel 的 optional SQLite fake 已无真实调用方

[`createMainKernelRouteRuntime`](../../../src/main/routes/index.ts#L725) 把 `sqlitePresenter` 声明为 optional，
缺失时构造只有 `recordSettingsActivity/listSettingsActivity` 两个 method 的对象，再
`as unknown as ISQLitePresenter`
([L878-L895](../../../src/main/routes/index.ts#L878))。

当前 production 唯一工厂调用始终传真实 SQLite
([`Presenter`](../../../src/main/presenter/index.ts#L1042))；dispatcher test 也传 sqlite fake。branch 来源
`5e56c47f`，用于早期 Settings Control Center 测试/迁移。现在 runtime 其他 route 会访问 database security、
memory table 等完整能力，这个 fake 一旦真被使用只会把失败推迟到更深层。

建议直接要求真实 dependency；如果 Settings activity 需要独立测试 seam，就注入窄
`SettingsActivityPort`，不要伪造完整 `ISQLitePresenter`。

---

## D-07 [低/混合意图] shutdown 中有重复 cleanup，但 MCP 双保险必须保留

当前 before-quit hooks 与 `Presenter.destroy()` 都触达部分 owner：

| 资源 | 早期 hook | final destroy | 判断 |
| --- | --- | --- | --- |
| MCP | [`mcpShutdownHook`](../../../src/main/presenter/lifecyclePresenter/hooks/beforeQuit/mcpShutdownHook.ts#L6) | [`Presenter.destroy`](../../../src/main/presenter/index.ts#L985) | **故意双保险，保留** |
| Cron | [`cronJobsStopHook`](../../../src/main/presenter/lifecyclePresenter/hooks/beforeQuit/cronJobsStopHook.ts#L5) | `Presenter.destroy` L974 | 重复 idempotent stop，owner 可统一 |
| Floating button | [`floatingDestroyHook`](../../../src/main/presenter/lifecyclePresenter/hooks/beforeQuit/floatingDestroyHook.ts#L10) | `Presenter.destroy` L992 | 重复 destroy，低成本但 owner 模糊 |
| Window quitting flag | lifecycle manager [L423-L452](../../../src/main/presenter/lifecyclePresenter/index.ts#L423) | [`windowQuittingHook`](../../../src/main/presenter/lifecyclePresenter/hooks/beforeQuit/windowQuittingHook.ts#L10) | fallback 重复 |

[`cua-sidecar-cleanup-on-quit/spec.md`](../../issues/cua-sidecar-cleanup-on-quit/spec.md) 明确要求 MCP 早停、允许
多次调用、且不得删除 final fallback；`McpPresenter.shutdown()` 也合并 concurrent call。因此不能把所有
重复 teardown 一概清理。

Cron/floating/window 没找到同等级约束，且 stop/destroy 当前 idempotent，属于低成本 ownership debt。
如果统一，必须保留“早停有序 + final fallback”所需的资源，而不是只追求调用次数变少。

---

## D-08 [中/待产品确认] Auto-compaction default 与 normalization policy 多处重复

默认/限制散落于：

- [`uiSettingsHelper`](../../../src/main/presenter/configPresenter/uiSettingsHelper.ts#L7)；
- ConfigPresenter 多个 read/write path；
- [`CompactionService`](../../../src/main/presenter/agentRuntimePresenter/compactionService.ts#L659)；
- [`AgentRepository`](../../../src/main/presenter/agentRepository/index.ts#L114)；
- renderer store 与 `DeepChatAgentsSettings.vue`。

全局设置把 83 按 step=5 归一成 85
([`uiSettingsHelper.test`](../../../test/main/presenter/configPresenter/uiSettingsHelper.test.ts#L75))；per-agent
设置把 91 原样保存
([`DeepChatAgentsSettings.test`](../../../test/renderer/components/DeepChatAgentsSettings.test.ts#L859))。

这可能是故意差异：全局 slider 使用 step=5，per-agent expert number input 允许任意整数。仓库没有文档
说明，因此只能确认“同名字段策略不同且 default/limit 重复”，不能确认 91 是 bug。

建议共享 defaults/limits；单独命名/记录 global step normalization 与 per-agent integer policy。

---

## D-09 [低][已确认死分支] `FLOATING_BUTTON_AVAILABLE` 已常量 true

[`featureFlags.ts`](../../../src/shared/featureFlags.ts#L1) 只有
`FLOATING_BUTTON_AVAILABLE = true`，仍在 main 和 renderer 保护多条 false branch。它在 `e1a089b2` 作为
临时隐藏 flag=false 引入，六天后 `b2b591f8` 改 true，此后未变化。

改这个常量仍需发布版本，因此它不是 runtime kill switch。删除 flag/guards 是低风险简化；如果产品需要
紧急开关，应改成真实 runtime config/capability。

---

## D-10 [中维护][已确认] Presenter assembler 保留接口已经保证不会缺失的 fail-open 分支

[`Presenter` 的 `AgentToolRuntimePort`](../../../src/main/presenter/index.ts#L241) 检查
`getPermissionMode/getSessionGenerationSettings/getSessionDisabledAgentTools` 是否是 function；缺失时分别
默认 `full_access/null/[]` ([L266-L277](../../../src/main/presenter/index.ts#L266))。

但 [`IAgentSessionPresenter`](../../../src/shared/types/presenters/agent-session.presenter.d.ts#L210) 已把这些
method 声明为 required，当前 concrete presenter 也全部实现。正常 production 对象中这些 fallback 不可达；
它们只会掩盖未来 wiring/contract 回归，其中 `full_access` 还是 fail-open 语义。

同一 port 已聚合 Tape、memory、Cron、subagent、skill、browser、file、provider、window、permission 共约
34 个 capability
([`runtimePorts.ts`](../../../src/main/presenter/toolPresenter/runtimePorts.ts#L71))，已接近 app capability
locator，而不是窄 port。

建议删掉 required method 的 compatibility checks；按 capability group 拆 port。不要因为当前 assembler
工作正常就继续用 optional getter 解决 constructor ordering。
