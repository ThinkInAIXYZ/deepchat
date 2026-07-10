# 09 - 实施任务拆分与路线图

本路线图基于本目录 A-01–A-13、P-01–P-12、D-01–D-10、Ponytail cut list 和旧审计对账生成。
它把 [`07-prioritized-actions.md`](./07-prioritized-actions.md) 的决策输入拆成可独立评审、验证和回滚的
实施切片；不代表所有切片已经获得实施授权。

## 先反驳一种错误排法

不能单纯按“从易到难”执行。这样会先删除 feature flag、Compat 壳等低价值代码，却继续保留 prompt
错误、unknown-outcome mutation、错误解绑和 fatal exception fail-open。

本路线图采用以下规则：

1. **优先级优先**：P0 语义/可靠性错误先于性能与结构清理。
2. **依赖优先于难度**：measurement、owner decision、contract 和 migration 设计必须先于实现。
3. **同优先级内从低难度开始**：先交付可快速降低风险的切片，再进入跨模块改造。
4. **行为修复与结构提取分开**：不得在同一个 PR 同时改变语义并拆 God object。
5. **性能结论以数据为门槛**：P-04、P-10、P-12 没有测量结果前不得直接实施高风险方案。

## 评估口径

### 优先级

| 等级 | 含义 |
| --- | --- |
| P0 | 已确认的正确性、可靠性或状态机错误；不等待 profiler |
| P1 | 已证明的高成本路径、关键 migration/index 前提、阻止债务继续扩张的架构护栏 |
| P2 | owner/产品决策、生命周期治理、中等维护债和有条件优化 |
| P3 | 低风险、低收益清理；只在不阻塞更高优先级时处理 |

### 难度

| 等级 | 相对范围 | 约束 |
| --- | --- | --- |
| XS | 半天内，局部删除或文档同步 | 仍需 focused test/静态检查 |
| S | 1–2 个开发日，1–3 个紧密相关文件 | 单 PR、可直接回滚 |
| M | 3–5 个开发日，跨少量模块或含 migration/test fixture | 一般单 PR；复杂 bug 先写 issue spec |
| L | 1–2 周，一个跨 contract/process/database 的内聚目标 | 进入 ready 前证明无法再独立拆分，否则继续拆 |
| XL | 超过 2 周或涉及核心状态所有权 | 不得直接开工，必须继续拆分 |

难度是相对估算，不包含 review/fix 循环，也不是交付承诺。

## P0：先修正确性与状态机

下表按“优先级相同、难度较低优先”排列；实际执行还必须遵守 `depends-on`。

| 顺序 | Task | Finding | 难度 | depends-on | 独立交付目标 | 验证门槛 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `FTL-001` | A-06 | S | — | 写 `docs/issues/*/spec.md`，分别决定 `uncaughtException`、`unhandledRejection`、controlled exit/relaunch/crash reporter/safe mode 和 network error owner | 明确 owner-handled rejection 与升级为 fatal 的边界；非 network fatal 不能继续以“可恢复”处理；无 `[NEEDS CLARIFICATION]` |
| 2 | `PRM-001` | P-07 | S | — | 写 `docs/issues/*/spec.md`，固定 env/skill revision 或 late-refresh invalidation contract 和失败测试 | spec 覆盖首次读取超时、late result、同名 skill 内容更新；无 `[NEEDS CLARIFICATION]` |
| 3 | `CRD-001` | A-10 | S | — | 让 pending/running cancel 走统一 settlement，清理 dedupe record | 重复 create/cancel target 后 map/pending/runs 不增长；rejection 只 settle 一次 |
| 4 | `CRD-002` | A-10 | M | `CRD-001` | 实现真正的 idle barrier，并定义等待开始后新任务是否属于当前 generation | deferred CPU + 2 IO 全部 settle 后才执行 callback；generation 边界有测试 |
| 5 | `PRM-002` | P-07 | M | `PRM-001` | 按已确定 contract 修复外层 composed prompt cache | 真实双层 cache 测试覆盖首次读取超时、late result 和同名 skill 内容更新 |
| 6 | `FTL-002` | A-06 | M | `FTL-001` | 把 network UX 错误处理移回请求 owner，顶层 fatal handler 只执行已决策策略 | network error 不走 fatal；非 network uncaught exception 和 unhandled rejection 均按策略落盘并退出/重启 |
| 7 | `SES-001` | A-05 | M | — | 写 issue/architecture SDD，定义 `available/unavailable/transient_error/missing` 与旧 renderer compatibility | 先补失败测试：transient failure 保留 binding；永久未知 agent 不拖垮列表 |
| 8 | `SCH-001` | A-04 | M | — | 写 architecture SDD，对 operation 分类为 cancellable、idempotent、non-cancellable | 每类 operation 的 timeout、retry、settlement、reconciliation contract 明确 |
| 9 | `SCH-002` | A-04 | M | `SCH-001` | 改造 cancellable task API，让 owner 获得 `AbortSignal`；禁止 retry 与未结束 attempt 重叠 | deferred timeout/cancel/retry 测试证明上一 attempt 已终止或 operation 幂等 |
| 10 | `SES-002` | A-05 | M | `SES-001` | 扩内部 result，移除 `null as unknown as`，让 list/get/active binding 保留四态语义 | transient failure 保留 binding；永久 unavailable 可降级显示；现有 route 暂走兼容映射 |
| 11 | `SES-003` | A-05 | M | `SES-002` | 迁移 route schema 和 renderer compatibility，公开已定义的 availability state | missing/unavailable/transient 四态 integration test；旧 renderer compatibility 明确且有测试 |
| 12 | `SCH-003` | A-04 | L | `SCH-001` | 为一个选定的不可取消 mutation 建 operation identity、unknown-outcome 和 reconciliation 样板 | create 晚落库/晚绑定可被查询并收敛；caller 不会收到虚假的确定失败；其他 mutation 另按样板逐项迁移 |

### P0 推荐执行方式

- 第一批的 SDD/测试设计可并行：`PRM-001`、`FTL-001`、`SES-001`、`SCH-001`；`CRD-001`、`CRD-002` 可在同一模块内串行实现。
- 第二批：`PRM-002`、`FTL-002` 可与 `SCH-002` 并行；`SES-002`、`SES-003` 与 Agent runtime/session 热路径任务串行，避免同文件冲突。
- `SCH-003` 不应塞进 `SCH-002`；可取消 task 和不可取消 mutation 是两种不同 contract。

## P1：已证明热路径、数据库前提和增长护栏

| 顺序 | Task | Finding | 难度 | depends-on | 独立交付目标 | 验证门槛 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `ARC-001` | A-01/A-03/A-11 | S | — | 为 route root、compatibility core、shared→main import 建 baseline/trend guard，冻结新增债务 | guard 只阻止增长，不把历史存量一次变成全仓红灯；输出按 transport/agent-edge/main-composition 分类 |
| 2 | `DB-001` | P-05/P-06/P-08/P-11 | M | — | 建 10k/100k fixture，记录 query plan、page latency、migration time、DB size 和写成本，确定索引组合 | 报告覆盖 pending recovery、normalization、usage、session list、claimed input 五类 query |
| 3 | `SEA-001` | P-09 | M | — | 分开 FTS available/migration state、normal zero-hit 和 throw fallback | zero-hit 不调用 LIKE；FTS throw/不可用才进入定义好的 fallback |
| 4 | `DCL-001` | A-03 | M | `ARC-001` | 修 repo-owned declaration 的路径/未导入错误，把 main-owned domain type 移到 shared owner | 显式 `skipLibCheck=false` 检查不再报告已知声明错误；不创建第二个 compatibility barrel |
| 5 | `DCL-002` | A-03 | S | `DCL-001` | 把 repo-owned shared declaration strict check 接入 CI/常规校验 | node/web declaration check 均通过，新 shared→main alias 会失败 |
| 6 | `HIS-001` | P-01/P-02 | M | — | 先加一次 send 的 history/SQL/materialization/provider-start 指标和规模 fixture | 覆盖 10/100/1k/10k messages × 0/10k/100k global traces |
| 7 | `TAP-001` | P-03 | M | — | 测量连续两次 ensure 的 message/tape rows、provenance query、hash/parse 数和耗时 | 基线可重复，并覆盖无变化、live append、partial migration 三类 fixture |
| 8 | `TAP-002` | P-03 | S | `TAP-001` | 更新 Tape architecture SDD，定义 migration version、source cursor/watermark 和 partial recovery | maintained contract 无 `[NEEDS CLARIFICATION]`，并明确 crash/retry/live append 语义 |
| 9 | `STR-001` | P-04 | M | — | 只做 streaming payload/CPU/IPC/DB/renderer measurement，不改变 transport | 覆盖 10KB/100KB/1MB text、1MB stable payload、1/3 windows；形成 go/no-go 数据 |
| 10 | `FFF-001` | P-10 | M | — | 区分 native/init unavailable、workspace timeout、query-specific、transient IO，并记录 reason/count/duration | 5–10 个连续 query 测量重复预算；不得先猜 cooldown 时长 |
| 11 | `LIF-001` | A-07 | S | — | 决定 HooksNotifications 使用 late-bound dispatcher 还是两阶段 `seal()`，固定 identity/lifecycle contract | architecture decision 无 `[NEEDS CLARIFICATION]`；不得保留 dummy-first/reassign |
| 12 | `LIF-002` | A-07 | M | `LIF-001` | 按已选 contract 修复 HooksNotifications identity | real Presenter factory integration test 证明 runtime bridge 使用真实 dispatcher |
| 13 | `LIF-003` | A-09 | S | — | 决定 FileWatcher 由 process owner final teardown，还是零 active request 后 idle-stop | 明确 owner、重启状态机和 teardown 时机；无 `[NEEDS CLARIFICATION]` |
| 14 | `LIF-004` | A-09 | M | `LIF-003` | 按已选 FileWatcher lifecycle contract 实施 | real Presenter lifecycle test；最后 listener 关闭后按 contract 停止或 final destroy |
| 15 | `DB-002` | P-05/P-06/P-11 | M | `DB-001` | 用已有 DB migration 增加经验证的 message backfill/recovery 和 claimed-input 索引 | 旧数据库 migration fixture + query plan；记录写放大和 DB size，不只改 fresh schema |
| 16 | `SES-LIST-001` | P-08 | M | `DB-001` | 增加经测量确认的 session filter/order index | 1k/100k sessions 的 page 1/deep cursor query plan 达标，并记录写入成本 |
| 17 | `SES-LIST-002` | P-08 | M | `DB-001` | 把 session metadata N+1 改为 batch query 或 join | page query 数不随 page size 线性增长；Cron badge 语义不变 |
| 18 | `HIS-002` | P-01 | M | `HIS-001` | 增加 `hasMessages` existence API，替换只为 `length > 0` 的完整读取 | `hadMessages` 不再物化 history；空/非空/title generation 测试通过 |
| 19 | `HIS-003` | P-01/P-02 | L | `HIS-001` | 建 runtime history/predicate projection，不携带 UI trace count | runtime guard/context 不聚合全局 trace table；UI rich history 保留 trace metadata |
| 20 | `HIS-004` | P-01 | L | `HIS-002`, `HIS-003` | 一次 send orchestration 最多构建并复用一个完整 history snapshot | 规模矩阵下 `getMessages`/SQL 次数满足目标，pending/question 正确性测试不回退 |
| 21 | `TAP-003` | P-03 | L | `TAP-002` | 实现可恢复 watermark migration；live append 推进 cursor；无变化 ensure 走 O(1)/增量 fast path | partial migration/crash/live append/legacy session 测试；第二次 ensure 不再全量核对 |
| 22 | `FFF-002` | P-10 | L | `FFF-001` | 实现 per-workspace failure state、cooldown、single half-open probe 和成功清状态 | bad pattern 不压掉其他 query；连续 query 不重复支付已知 workspace failure 成本 |
| 23 | `RTE-001` | D-06 | S | `ARC-001` | 要求真实 SQLite dependency；若 activity fixture 仍需 seam，只注入窄 activity port | production/test 都不再用 `as unknown as ISQLitePresenter` fake |
| 24 | `RTE-002` | A-01 | L | `ARC-001`, `RTE-001` | 选择一个高变更 domain 提取 handler，不批量搬 route | root 只保留 lookup/context/error envelope；domain handler 有 focused fixture |

### 条件任务：数据过门后才进入 ready

| Task | Finding | 当前状态 | 转为 ready 的门槛 | 可能方案顺序 |
| --- | --- | --- | --- | --- |
| `STR-002` | P-04 | blocked-by-measurement | `STR-001` 证明 snapshot bytes/CPU/fan-out/DB rewrite 超预算 | targeted webContents → stable block reference → changed-block upsert → revisioned delta |
| `FFF-003` | P-10 | blocked-by-measurement | `FFF-001` 证明 filesystem fallback 重复扫描是主要成本 | resumable cursor；不得删除 bounded fallback |

`STR-002` 即使解锁，也必须优先尝试 contract 风险较低的前三项；revisioned delta 是最后选项。

## P1 架构程序：复用现有 AgentRuntime split，不重复建方案

A-02 的唯一任务真源仍是
[`docs/architecture/agent-runtime-presenter-split/tasks.md`](../../architecture/agent-runtime-presenter-split/tasks.md)。
不要创建平行重构目录。

| 现有任务 | 建议难度 | 执行条件 |
| --- | --- | --- |
| T2 `sessionSettingsService` | M | P0 runtime/session 行为修复合入后 |
| T3 `generationControlService` | M | `SCH-*` cancellation owner 已稳定 |
| T4 `pendingInputCoordinator` | L | `SES-*` 与 pending/steer contract 已稳定 |
| T5 message/tape façade delegation | L | `HIS-*`、`TAP-*` 完成，避免提取后立即二次改 contract |
| T6 `turnRunner` | XL，开工前继续按 turn phase 拆分 | T2–T5 完成；不得一个 PR 搬完整 agent loop |
| T7 façade `<1000` lines | L | T2–T6 完成；只做 wiring/delegation 收口 |

建议现在先加“主文件不得新增新责任”的 review/guard 规则，但不要在 P0 和 hot-path 行为仍变化时并行搬动同一代码。

## P2：owner 决策、中等治理和条件优化

| 顺序 | Task | Finding | 难度 | depends-on | 独立交付目标 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `EVT-001` | A-08 | S | — | 修正 event 文档，标注 `ephemeral/replayable/durable`，明确 startup snapshot 是否允许 drop |
| 2 | `WSP-001` | A-12 | S | — | 决定 workspace capability 是 app/session/webContents scope，并定义 revoke 语义；只做决策文档 |
| 3 | `CHAT-001` | D-05 | S | — | 决定 ChatService 是 enqueue owner 还是 generation owner；只做 contract/产品决策 |
| 4 | `CMP-001` | D-08 | S | — | 确认 global step=5 与 per-agent integer 是否为有意差异 |
| 5 | `RMT-001` | D-01 | S | — | 决定 shared catalog 或 main authority，定义 `supportsNotifications` 和 route failure 语义 |
| 6 | `CAP-001` | D-10 | S | — | 删除 required method 的 `typeof` fallback，尤其禁止默认 `full_access` |
| 7 | `STEER-001` | P-11 | S | — | 确认 consumed steer 的 audit/retention 需求，决定 delete/TTL/精简 tombstone 并写 migration contract |
| 8 | `CAP-002` | D-04 | S | `CAP-001` | 写 capability architecture SDD，区分 runtime required method 与真实 optional descriptor，完成 port ownership map |
| 9 | `RMT-002` | D-01 | M | `RMT-001` | 按已选 authority 建 catalog 单一真源；route 失败显示 unavailable |
| 10 | `RMT-003` | D-02 | S | `RMT-002` | 删除无转换/策略的 Compat wrappers，只保留真实 overload adapter |
| 11 | `STEER-002` | P-11 | M | `STEER-001`, `DB-002` | 按已定 contract 实施 retention/tombstone migration；claimed-state index 由 `DB-002` 交付 |
| 12 | `STO-001` | P-12 | M | — | 用 `dbstat`/fixture 测 text/tool/image/file 在 messages/structured/search/Tape 的物理放大 |
| 13 | `ICON-001` | F11 residual | M | — | 重新测 provider icon registry 与 `tokenflux-color.svg` 的 bundle/载入体积，形成预算结论 |
| 14 | `CMP-002` | D-08 | M | `CMP-001` | 共享 compaction defaults/limits，分别表达 global normalization 与 per-agent policy |
| 15 | `CAP-003` | D-04 | L | `CAP-002` | 按已定 contract 把 runtime 必备能力改 required，真实差异迁入显式 capability descriptor |
| 16 | `CHAT-002` | D-05 | L | `CHAT-001` | 若 enqueue owner：删除假 stream controller/30min timeout；若 generation owner：返回 observable handle 并统一 cancel owner |
| 17 | `WSP-002` | A-12 | L | `WSP-001` | 仅当 scope 为 session/webContents 时实现 refcount 与 destroyed/deactivate revoke |
| 18 | `EVT-002` | A-08 | L | `EVT-001` | 仅当 durable/replay requirement 不能由 query 满足时，引入 injected `WindowEventPort`/buffer，替换 ambient sink |

`CAP-002` 的 ownership map 需要为 Tape、memory、Cron、session、system 等 capability group 各生成一个后续
`CAP-PORT-<group>` 任务；每个任务只拆一个 port group，不创建“把 34 个方法一次拆完”的总括 PR。

### 需要外部确认后才能做的清理

| Task | Finding | 难度 | 前置确认 |
| --- | --- | --- | --- |
| `RMT-004` | D-03 | S | 旧 app/renderer 跨版本支持窗口已经结束，才删除专用 status routes |
| `SHD-001` | D-07 | S | 明确 Cron/floating/window 的 early-stop 与 final-fallback owner；MCP 双保险不在删除范围 |

## P3：低收益清理

| 顺序 | Task | Finding | 难度 | 目标 | 验证 |
| ---: | --- | --- | --- | --- | --- |
| 1 | `FLG-001` | D-09 | XS | 删除常量 `FLOATING_BUTTON_AVAILABLE` 和 false branches；若需 kill switch，另建 runtime config | main/renderer focused test + typecheck |
| 2 | `WIN-001` | A-13 | S | 确认 `null` 无独立语义后，unbind/window-destroyed 时删除历史 webContents key | create/destroy/rebind 循环后 map 不增长 |
| 3 | `PERM-001` | Ponytail #12 | S | 将三份 `normalizePermissionMode` 收敛到一个 shared domain helper | main/renderer normalization contract 一致 |

这些任务不应抢占 P0/P1 review 带宽。适合在对应文件被高优先级任务触达时顺手独立提交，而不是开“misc cleanup”大 PR。

## 推荐实施波次

```text
Wave 0  Freeze growth
        ARC-001

Wave 1  P0 bounded fixes / decisions
        PRM-001 → PRM-002 ─────────┐
        CRD-001 → CRD-002 ─────────┤ parallel by owner
        FTL-001 → FTL-002 ─────────┤
        SES-001 → SES-002 → SES-003┤
        SCH-001 → SCH-002/003 ─────┘

Wave 2  Fast semantic/performance wins + DB evidence
        SEA-001
        DB-001 → DB-002 / SES-LIST-001 / SES-LIST-002
        DCL-001 → DCL-002
        LIF-001 → LIF-002
        LIF-003 → LIF-004

Wave 3  Hot-path evidence then behavior
        HIS-001 → HIS-002 / HIS-003 → HIS-004
        TAP-001 → TAP-002 → TAP-003
        STR-001 → [gate] → STR-002
        FFF-001 → FFF-002 → [gate] → FFF-003

Wave 4  Architecture extraction
        RTE-001 → RTE-002
        AgentRuntime split T2 → T3 → T4 → T5 → decomposed T6 → T7

Wave 5  Product/owner decisions and cleanup
        P2 decisions → their implementations → P3 opportunistic cleanup
```

### 第一批最合理的实际开工集合

如果下一步立即实施，建议只开以下 4 个互不混杂的工作流：

1. `PRM-001`：先固定用户输出正确性的 cache contract，再进入实现。
2. `CRD-001`：先修确定的 cancel settlement 泄漏；同模块后续接 `CRD-002` idle barrier。
3. `FTL-001`：先完成 fatal policy 决策，不在工程实现中临时猜产品策略。
4. `ARC-001`：低成本冻结增长，防止修复期间继续扩大 routes/shared debt。

同时准备 `SES-001` 和 `SCH-001` 的 SDD，但不要在决策未完成前写生产代码。

## 并行边界

### 可并行

- Prompt cache、startup coordinator、fatal policy、declaration check、FTS fallback 位于不同 owner，可用独立 worktree 并行。
- DB measurement、streaming measurement、storage amplification measurement 都是只增 fixture/metric 的前置任务；路径不重叠时可并行。
- Remote、FileWatcher、HooksNotifications 与 AgentRuntime hot path 可并行，但最终合并仍逐个验证。

### 必须串行

- `SES-*`、`HIS-*`、`TAP-*` 与 AgentRuntime split 会重叠 runtime/session state，按本路线图顺序串行。
- 所有 SQLite index/migration 任务从同一 `DB-001` 结论出发，并逐个合并、重跑 migration fixture。
- Route domain extraction 必须在 `ARC-001` baseline 后执行。
- P-04 delta、P-10 resumable filesystem cursor、P-12 offload/retention 都必须经过 measurement gate。

## Finding 覆盖矩阵

| Finding | Task / disposition |
| --- | --- |
| A-01 | `ARC-001`, `RTE-002` |
| A-02 | 复用 AgentRuntime split T2–T7 |
| A-03 | `ARC-001`, `DCL-001`, `DCL-002`，后续按 feature touch 提取 domain declaration |
| A-04 | `SCH-001`–`SCH-003` |
| A-05 | `SES-001`–`SES-003` |
| A-06 | `FTL-001`, `FTL-002` |
| A-07 | `LIF-001`, `LIF-002` |
| A-08 | `EVT-001`；`EVT-002` 条件执行 |
| A-09 | `LIF-003`, `LIF-004` |
| A-10 | `CRD-001`, `CRD-002` |
| A-11 | `ARC-001` |
| A-12 | `WSP-001`；`WSP-002` 条件执行 |
| A-13 | `WIN-001` |
| P-01/P-02 | `HIS-001`–`HIS-004` |
| P-03 | `TAP-001`–`TAP-003` |
| P-04 | `STR-001`；`STR-002` measurement gate 后执行 |
| P-05/P-06 | `DB-001`, `DB-002` |
| P-07 | `PRM-001`, `PRM-002` |
| P-08 | `DB-001`, `SES-LIST-001`, `SES-LIST-002` |
| P-09 | `SEA-001` |
| P-10 | `FFF-001`, `FFF-002`；`FFF-003` 条件执行 |
| P-11 | `DB-001`, `DB-002`, `STEER-001`, `STEER-002` |
| P-12 | `STO-001`；offload/retention 只在超预算后另立任务 |
| D-01/D-02/D-03 | `RMT-001`–`RMT-004` |
| D-04/D-10 | `CAP-001`–`CAP-003`, `CAP-PORT-*` |
| D-05 | `CHAT-001`, `CHAT-002` |
| D-06 | `RTE-001` |
| D-07 | `SHD-001`；保留 MCP double shutdown |
| D-08 | `CMP-001`, `CMP-002` |
| D-09 | `FLG-001` |
| F11 residual | `ICON-001` |
| Ponytail #12 | `PERM-001` |

## 明确保留，不创建修复任务

以下设计在 [`05-intentional-designs.md`](./05-intentional-designs.md) 中已有证据，不应借本轮清理删除：

- typed event 双边界 validation；
- MCP early stop + final shutdown fallback；
- AgentRegistry 多 implementation seam；
- structured JSON、FTS、Tape 的既有 contract；
- skill worker 的 main-thread fallback；
- bounded filesystem fallback；
- subagent bounded initialization retry；
- tool image preview 失败时保留 metadata、丢弃 raw data；
- hot-path ports 的 focused test seam；
- FileWatcher、Cron、background exec 使用不同 process mechanism。

## 每个实施切片的统一交付门槛

1. 先有 focused failure/timeout/cancel test，不只覆盖 happy path。
2. 跨 route/service/Presenter contract 或 migration 的任务先完成对应 SDD，且无 `[NEEDS CLARIFICATION]`。
3. 实现与 verify 使用不同 agent/reviewer；blocking finding 修完后重新验证。
4. 运行任务专项测试，以及 `pnpm run typecheck`。
5. 完成功能切片后运行 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`。
6. main hot path 运行 `pnpm run test:main`；renderer event/list 变化运行 `pnpm run test:renderer`。
7. SQLite 变更必须包含已有 DB migration fixture、query plan 和规模数据。
8. UI 行为变化必须给 BEFORE/AFTER ASCII layout；当前路线图本身不改 UI。
9. 每个 PR 只交付一个 task ID；不得创建总括性的 `architecture cleanup` PR。
