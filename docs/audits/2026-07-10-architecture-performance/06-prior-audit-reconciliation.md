# 06 - 与 2026-07-04 性能审计的逐项对账

前次报告：[`docs/issues/performance-audit-report/report.md`](../../issues/performance-audit-report/report.md)  
实施记录：[`docs/architecture/perf-fixes-from-audit/tasks.md`](../../architecture/perf-fixes-from-audit/tasks.md)  
主要落地 commit：`7180cf3a`（2026-07-06）

本轮没有把已经修复的旧 finding 改个名字重新报一遍。下面按当前代码逐项标明：已落地、保留不改、
部分完成或需要纠正。

## 逐项状态

| 旧 ID | 旧问题 | 当前状态 | 当前代码判断 |
| --- | --- | --- | --- |
| F1 | SQLite startup 同步 open/migrate/diagnose | 部分缓解 | 已增加阶段耗时、移除成功路径重复诊断；open/init/migrate 仍在 critical path，这是必要基线。新 P-06 是另一条 constructor recovery scan。 |
| F2 | ACP registry migration 在窗口前 | 明确不修 | `critical:false`、失败不阻塞，只有迁移场景有边际成本；当前决策合理。 |
| F3 | 多 backfill 争抢 CPU/SQLite | 主方案已落地，仍有残余 | 已进 coordinator、keyset page、batch yield；P-05 证明 cursor query 缺复合 index，分页仍可能反复 scan/sort。 |
| F4 | Presenter constructor 同步聚合 | 旧判断需纠正 | 原复核称“当前 constructor 只做引用装配”；当前/当时 AgentRuntime constructor 都同步做 pending recovery。P-06 给出真实全表 scan 路径。 |
| F5 | MCP 后台初始化长尾 | 已落地 | 已有 45s soft timeout、状态枚举、shutdown timeout/concurrency；没有把后台 server start 重新算成首屏阻塞。 |
| F6 | protocol handler 同步读文件 | 已落地 | 当前使用 async/streaming Response，并有 workspace preview size limit。 |
| F7 | splash 无条件创建 | 明确不修 | 已有 suppress 机制，收益边际且 database unlock 路径风险较高。 |
| F8 | shutdown 缺耗时与 timeout | 已落地 | `Presenter.destroy` duration logs、MCP bounded shutdown 已存在；D-07 单独讨论 ownership duplicate。 |
| F9 | Markdown workers 非 lazy | 已落地 | eager shell init 已删，Markdown/Think renderer 按 mount ensure。 |
| F10 | i18n 全量同步导入 | 明确不修 | 未发现新证据推翻边际收益判断。 |
| F11 | Iconify/provider icon 体积 | 部分完成 | Iconify generated reduced collection 和 miss fallback 已落地；provider registry 仍静态 import 大量资产，`tokenflux-color.svg` 仍在静态 registry。不能标成完全关闭。 |
| F12 | session fetch 重复调度 | 已落地 | `sessionFetchPromise` 已做 in-flight dedupe。 |
| F13 | message store 排序/cache | 已落地 | binary insertion guard、LRU 上限、比较收敛均存在。P-01 是 main runtime history 重读，不是同一问题。 |
| F14 | sidebar fingerprint/layout | 明确不修 | rAF coalescing 已限制 layout read；没有新动态证据要求提高优先级。 |
| F15 | ChatStatusBar deep/immediate watcher | 已落地 | revision counter + shallow watcher 当前存在。 |
| F16 | provider settings 全量渲染 | 已落地 | disabled provider 默认折叠、icon lookup cache 当前存在。 |
| V1 | Settings smoke 依赖隐藏 tab | 已落地 | E2E helper 已按 route navigation 处理隐藏页面。 |

## 需要特别纠正的两点

### 1. F4 的“constructor 当前不热”不成立

[`AgentRuntimePresenter` constructor](../../../src/main/presenter/agentRuntimePresenter/index.ts#L668) 同步执行
`recoverPendingMessages()`；后者用无 `(status,updated_at)` index 的 query 扫描 message table。该行为在本轮
基线不是新加代码，因此前次“只做对象引用装配”的复核结论过度乐观。

正确说法应是：大多数子 Presenter constructor 已把网络/重初始化移出首屏，但 AgentRuntime crash
recovery 仍是 critical constructor 的同步数据库工作。

### 2. F3 的 keyset pagination 只完成了一半数据库条件

代码已经从 unbounded `.all()` 改为 50 条 page，这是实质改进；但 SQL 按 `(created_at,id)` 和
`(role,created_at,id)` 游标读取，表只有 `(session_id,order_seq)` index。P-05 不是否定前次修复，而是
补上 query/index 必须配套的第二阶段。

## 本轮与旧性能审计边界相邻的新问题

下表是与旧性能 finding 最容易混淆的完整对照，不企图列出本轮所有架构与重复设计
finding；后者请看 02/04 分报告。P-05 是 F3 的残余数据库条件，P-06 是对 F4 的纠正，
已在上表对账，不再算“全新”。

| 新 ID | 为什么不是旧问题换名 |
| --- | --- |
| P-01 | 发送前 8 次 main history materialization；旧 F13 是 renderer message store 排序/cache。 |
| P-02 | rich history query 全局聚合 trace table；旧报告未分析 trace read model。 |
| P-03 | Tape lazy migration 每次全量核对；旧报告未覆盖 Tape steady-state。 |
| P-04 | streaming snapshot 在 JSON/Zod/IPC/DB 多层全量放大；旧报告未跟踪该跨进程热路径。 |
| P-07 | 内外 system prompt cache 组合破坏 late AGENTS refresh；不是一般 cache 内存问题。 |
| P-08 | lightweight session SQL index + Cron metadata N+1；metadata 在旧报告后随 Cron refactor 加入。 |
| P-09 | FTS zero-hit 触发两层 LIKE；旧报告只确认 FTS/LIKE 架构存在。 |
| P-10 | FFF 已知失败在新 query 重试；旧报告未覆盖 workspace file search fallback state。 |
| P-11 | consumed steer tombstone 的 retention 和启动 scan；旧报告未覆盖 pending-input 持久化。 |
| P-12 | message/structured/search/Tape 的 size budget gap；这是待测观察，不是已证明的性能故障。 |
| A-04 | Scheduler 对 mutation 的 unknown-outcome/cancellation 语义；旧报告没有验证。 |
| A-05 | unavailable 与 missing session 合并并解除 binding；属于 reliability/type contract。 |
| A-10 | coordinator `whenIdle` 语义和 pending cancel record；旧报告只看 concurrency limit。 |

## 对旧动态数据的使用边界

前次 build/E2E 结果仍可作为 2026-07-04 的历史基线，但不能自动证明本轮静态热点已量化。特别是：

- Playwright 4-5s launch 无法把 SQLite、Electron window、provider warmup 分开归因；
- 无真实 provider 的 E2E 不能衡量 P-01/P-03/P-04；
- 小 fixture 不会暴露 missing index 的增长曲线；
- bundle size 必须在 F11 后续改动时重新 build，不能沿用旧 hash 文件名。
