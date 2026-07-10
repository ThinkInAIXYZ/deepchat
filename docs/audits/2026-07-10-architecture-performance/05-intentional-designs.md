# 05 - 反常但有意的设计：保留项与待决策项

本章专门反驳“看起来重复/反常，所以一定应该删”的结论。只有找到 spec、测试、历史约束或明确
owner 语义才判为有意设计。

## 结论矩阵

| 设计 | 结论 | 依据 |
| --- | --- | --- |
| main + preload/renderer 两层 Zod boundary validation | 保留 | authority boundary 与 consumer trust boundary 不同 |
| MCP before-quit + final destroy 两次 shutdown | 必须保留当前保证 | CUA spec 明确要求双保险和幂等 |
| `SessionPresenter` 与 `AgentSessionPresenter` 并存 | 当前保留 | 前者是 import/export/legacy data facade，不是当前 chat owner |
| structured rows + legacy JSON fallback | 当前保留 | migration/read compatibility 明确要求逐记录 fallback |
| Tape append-only 与 message source 并存 | 保留目标，补 watermark/retention | audit/replay 与 lazy backfill 是明确需求 |
| skill worker 失败退 main thread | 保留 fallback，观测命中率 | startup plan 明确 worker-first/main fallback |
| FFF 失败退 filesystem | 保留 fallback，修重复失败 | 大 workspace issue 明确要求 bounded fallback |
| subagent early init retry | 保留 | 明确限制一次重试和 fresh session |
| tool image preview cache 失败时丢弃图片数据、保留 metadata | 保留 | 防止 raw base64 泄漏到 remote result |
| MCP connect cleanup `.catch(() => undefined)` | 保留 | 处理 cleanup branch rejection，原 promise 仍向 caller 传播 |
| hot-path ports | 保留 seam | 已替换真实 dependency，提供 service test seam |
| 三类 utility process 机制不同 | 不判重复 | workload、隔离、lifetime 不同 |
| Workspace register 后 app-lifetime 不 revoke | 待 owner 决策 | 历史有拆分意图，但 scope 未文档化 |

---

## I-01 Typed event 的双边界 validation 不是无意义重复

main publisher 在 [`createDeepchatEventEnvelope`](../../../src/main/routes/publishDeepchatEvent.ts#L20) 对
producer payload 做 authority validation；preload bridge 在
[`createBridge`](../../../src/preload/createBridge.ts#L52) 对跨 IPC consumer payload 再验证。两次校验分属
不同 trust boundary，移除任意一层都需要重新定义信任模型。

P-04 的问题是 high-frequency full snapshot 还叠加内部 JSON deep clone、全窗口 fan-out 和 DB full replace，
不是“两层 Zod 一定重复”。优化应先 profile payload/fan-out，或提供经过验证的 hot-path envelope，不能
直接绕过 typed contract。

---

## I-02 MCP double shutdown 是明确的 defense in depth

[`cua-sidecar-cleanup-on-quit/spec.md`](../../issues/cua-sidecar-cleanup-on-quit/spec.md) 明确要求：

- before-quit 有专用 MCP hook，早于 Presenter teardown；
- shutdown 可多次调用；
- hook 失败不阻塞退出；
- 不得删除 `Presenter.destroy()` 的 final MCP fallback。

[`McpPresenter.shutdown`](../../../src/main/presenter/mcpPresenter/index.ts#L253) 合并 concurrent call，后续
sequential call 在 active client 为空时很轻。这里看似重复，实际是为 CUA sidecar process tree cleanup
建立两道时序保证。D-07 只建议审查 Cron/floating/window 的重复，不触碰这个约束。

---

## I-03 两个 Session Presenter 不是同一主路径的双 owner

[`ARCHITECTURE.md`](../../ARCHITECTURE.md) 明确：当前 chat 主链是 AgentSessionPresenter →
AgentRuntimePresenter；`SessionPresenter` 只承担 legacy 数据访问、导入/导出和兼容 facade。仅凭类名相似
不能判定重复。

真正需要审计的是具体 route 是否仍把新 chat mutation 写入 legacy owner；本轮没有找到这种闭环证据，
因此不列问题。后续移除 legacy 表必须先完成 import/export 迁移和数据支持窗口决策。

---

## I-04 多层消息表示是三种目标叠加，不是简单“存了五遍”

- legacy JSON 保证旧数据/旧 reader compatibility；
- structured rows 支持 block/user/file/query projection；
- search document/FTS 支持历史搜索；
- Tape 支持 append-only audit/replay 和 derived view。

这些目标分别记录在 [`agent-system.md`](../../architecture/agent-system.md)、
[`deepchat-tape-baseline/spec.md`](../../architecture/deepchat-tape-baseline/spec.md) 和 Tape view specs。

其中 search projection 只是提取文本，FTS 是 external-content index；Tape message fact 才包含完整
record，tool fact 还可额外包含 response/preview。所以 P-12 只将其定义为待测的 size、retention、
offload、migration completion budget，不是直接删除某个真源。
真正可疑的是 Tape 每次全量回查和 migration 永不进入 O(1) steady state。

---

## I-05 Skill worker failure 回退 main thread 是可靠性策略

历史 startup plan `752286fd` 明确采用 worker-first、main-thread fallback，目标是 worker 不可用时技能发现
仍可用。不同平台、打包和权限环境下保留这层有价值。

性能改进应记录 fallback 命中率、原因和 main-thread duration；如果长期为 0，再讨论删分支。不能仅因
存在两个 execution path 就判重复。

---

## I-06 FFF filesystem fallback 应保留，重复失败应修

[`fff-large-workspace-timeout/spec.md`](../../issues/fff-large-workspace-timeout/spec.md) 的 acceptance 明确要求
FFF initial scan/glob 失败时使用 bounded filesystem scan，并避免 warning spam。该 fallback 解决真实大
workspace 可用性问题。

P-10 指出的偏离是“同一 workspace 失败后，每个新 query 仍重试 FFF”，以及 filesystem scan
没有可恢复 cursor。重试已由代码/测试证明，但只有 timeout 类失败可能再付出最多 2.5s budget，
并非每次固定等待。正确方向是按 native/init、workspace timeout、query-specific 和 transient IO
分类的 cooldown/half-open + resumable fallback，不是全错误统一熔断，更不是恢复为 FFF-only。

---

## I-07 Subagent initialization retry 是有界状态恢复

`AgentSessionPresenter` 的 child init retry 只针对 early child initialization，限制一次，并在需要时创建
fresh session。历史 `9414461b` 的 spec 把范围和失败语义写清。它不是无界 retry，也不是 Scheduler
A-04 那种上一 operation 未停止就重试的同类问题。

---

## I-08 Tool image preview cache 失败时丢弃数据、保留 metadata，不应回退 raw base64

[`cachePreviewData`](../../../src/main/lib/toolCallImagePreviews.ts#L89) 在 cache failure 后返回
`undefined`；[`extractToolCallImagePreviews`](../../../src/main/lib/toolCallImagePreviews.ts#L235) 仍创建包含
`id`/`mimeType`/`source` 的 preview，只不附 `data`。
[`remote-tool-result-images/spec.md`](../../issues/remote-tool-result-images/spec.md) 与
[`toolCallImagePreviews.test.ts`](../../../test/main/lib/toolCallImagePreviews.test.ts#L69) 明确保护该行为，目的是避免把
raw image/base64 塞进 remote text/tool result。

这是安全/体积 fallback：失败时 UI 仍知道存在一个 preview，但不传输无法安全缓存的数据；
它比“兜底发送原数据”更正确。

---

## I-09 MCP connect 的 silent catch 位于 cleanup branch

[`mcpClient.ts`](../../../src/main/presenter/mcpPresenter/mcpClient.ts#L294) 的
`.catch(() => undefined)` 附着在 cleanup/settlement branch，用于避免附加 promise 产生 unhandled
rejection；原 connect promise 仍由 caller await/处理。不能只看单行 catch 就判主错误被吞。

相反，A-06 的 global `uncaughtException` handler 才是已经确认扩大范围的 fail-open。

---

## I-10 Hot-path ports 有实际边界价值

[`hotPathPorts.ts`](../../../src/main/routes/hotPathPorts.ts#L31) 的 SessionRepository、MessageRepository、
ProviderExecution/Catalog、Permission、WindowEvent port 是 `8ef5c858` 的明确最小集合，已经被
Session/Chat/Provider service 和 focused tests 使用。

当前只有一个 presenter adapter 不等于抽象无用；它缩小 service fixture，并将 typed route orchestration
与完整 Presenter interface 分开。应修的是 A-01 中“其余 domain 没有继续按同一原则迁移”，以及 D-05
中 port semantics 已被 pending queue 演化改变，不是删除全部 port。

---

## I-11 File watcher、Cron、background exec 使用不同 process 机制不构成重复

三者的工作负载、lifetime、RPC 和 crash isolation 不同。没有代码证据证明合成一个通用 worker host 会
更简单或更可靠。A-09 只指出 FileWatcher singleton 缺 final teardown owner，不建议引入“万能 utility
process framework”。

---

## I-12 无证据项：不写成问题

[`appMain.ts`](../../../src/main/appMain.ts#L76) 设置
`webrtc-max-cpu-consumption-percentage=100` 和 V8 `--max-old-space-size=4096`，仓内没有 rationale。
这值得单独 benchmark，但：

- 4GB heap cap 不等于启动时预分配 4GB；
- WebRTC cap 不等于应用会持续使用 100% CPU；
- 没有 before/after 数据，无法给出可靠结论。

因此本轮只记录证据缺口，不把它们列入 finding。
