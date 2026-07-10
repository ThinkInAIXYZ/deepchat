# 08 - Ponytail 复杂度删减清单

只审计 over-engineering/可删除复杂度，不替代正确性与性能报告；本轮未应用任何修改。

## Ranked cut list

1. `[shrink]` [`routes/index.ts`](../../../src/main/routes/index.ts#L1524)：把 2,807 行 dispatcher 中的 Cron/memory/database-security policy 移回 domain handler，root 只保留 contract lookup/context/error envelope；这是 owner 收缩，不承诺净删大量 LOC。
2. `[shrink]` [`core.presenter.d.ts`](../../../src/shared/types/presenters/core.presenter.d.ts#L1)：冻结 2,592 行 compatibility core，修 shared→main 反向 import 后按 domain 提取；不要创建第二个 barrel。
3. `[shrink]` [`RemoteSettings.vue`](../../../src/renderer/settings/components/RemoteSettings.vue#L2083)：删除已退役的 `*Compat` 代理壳，直接使用 `RemoteControlClient`，只保留真实需要的 overload adapter。
4. `[shrink]` [`RemoteControlPresenter.listRemoteChannels`](../../../src/main/presenter/remoteControlPresenter/index.ts#L307)：删除三份 renderer descriptor 副本，改一份 shared catalog/main authority；route 失败显示 unavailable。
5. `[shrink]` [`IAgentImplementation`](../../../src/shared/types/agent-interface.d.ts#L138)：把当前 runtime 必备 method 改 required，删除永远不会执行的 paging/process/compaction fallback；真实差异使用显式 capability map。
6. `[shrink]` [`AgentToolRuntimePort`](../../../src/main/presenter/toolPresenter/runtimePorts.ts#L71)：34 个 app capability 已不是窄 port，按 Tape/memory/Cron/session/system 分组，移除 required method 的 optional getter/default。
7. `[delete]` [`createMainKernelRouteRuntime` fake SQLite](../../../src/main/routes/index.ts#L878)：production/test 都传真实依赖；删除 `as unknown as ISQLitePresenter` fake，需要 activity seam 时注入两方法 port。
8. `[shrink]` [`Remote status routes`](../../../src/shared/contracts/routes/remote-control.routes.ts#L176)：支持窗口结束后删除 Telegram/Weixin 专用 status contract/client/handler，统一 generic `getChannelStatus`。
9. `[shrink]` [`Auto-compaction settings`](../../../src/main/presenter/configPresenter/uiSettingsHelper.ts#L7)：集中 defaults/limits，单独表达 global step=5 与 per-agent integer policy，停止六处复制常量。
10. `[delete]` [`FLOATING_BUTTON_AVAILABLE`](../../../src/shared/featureFlags.ts#L1)：常量已长期为 true，删除 false branches；若需要 kill switch，使用真实 runtime config。
11. `[shrink]` [`Presenter` required-method fallbacks](../../../src/main/presenter/index.ts#L266)：接口已保证 method 存在，删除 `typeof ... === 'function'` 与 `full_access/null/[]` 默认。
12. `[shrink]` `normalizePermissionMode`：同一 normalization 分别存在于
    [`AgentSessionPresenter`](../../../src/main/presenter/agentSessionPresenter/index.ts#L124)、
    [`AgentRuntimePresenter`](../../../src/main/presenter/agentRuntimePresenter/index.ts#L229) 和
    [`ChatStatusBar`](../../../src/renderer/src/components/chat/ChatStatusBar.vue#L1480)；保留一个 shared domain helper。

## 不删清单

- 不删 `AgentRegistry`：有明确多 implementation seam，当前只应收紧 capability contract。
- 不删 `hotPathPorts`：已经替换真实 hard dependency，提供 focused service test seam。
- 不删 MCP 两次 shutdown：spec 明确要求 early stop + final fallback。
- 不删 structured JSON/FTS/Tape 任一层：先完成 migration/retention/size budget。
- 不造通用 Worker/Retry/Cache framework：现有问题来自 owner/语义，不是少一个抽象库。

## 计量边界

本报告不给出净 LOC 承诺。route domain extraction 可能只搬移 owner 而不减行；remote 专用 status
route 只能在确认支持窗口结束后删除；agent optional contract 取决于未来 implementation 计划。能立即确认的
只有“不需要新依赖”，真实删减量应在每个实施 PR 中按 `git diff --stat` 报告。
