# DeepChat 架构与性能审计总览

审计日期：2026-07-10  
代码基线：`f9de202a`（`v1.0.8-beta.4`）  
审计性质：只读代码、测试、文档和 Git 历史审计；除本目录报告外未修改产品代码。

## 先说反面结论

DeepChat 不是“没有架构”。typed renderer-main boundary、route/event contract、Presenter owner、
utility process 隔离、startup coordinator、structured message storage 都有明确设计依据，现有
architecture guard 也确实阻止了部分 legacy transport 回流。

真正的问题是：多次增量迁移留下的临时 seam 已经继续承接新功能，逐渐变成第二套长期架构。
最典型的是 4,351 行的 route dispatcher、7,350 行的 Agent runtime、2,592 行的 shared
compatibility declaration，以及大量“接口可选 + 静默默认”的兼容分支。它们没有立即证明系统慢，
但已经造成 owner 模糊、错误语义被吞、热路径重复物化和后续变更放大。

## 结论摘要

| ID | 结论 | 级别 | 证据性质 |
| --- | --- | --- | --- |
| A-01 | typed route 已演化成第二个 composition root 和 2,807 行单函数 dispatcher | 高 | 代码、AST、历史闭环 |
| A-03 | shared presenter compatibility barrel 反向依赖 main，仓内声明错误被 `skipLibCheck` 隐藏 | 高 | 代码、显式 typecheck |
| A-04 | `Scheduler.timeout()` 只停止等待，不停止 mutation；retry 可与上一轮并行 | 高 | 语言语义、调用链、测试缺口 |
| A-05 | session 不存在和 runtime 暂时失败都被压成 `null`，并可能解除真实 window binding | 高 | 代码、测试、历史闭环 |
| A-06 | 为 network toast 安装的全局 handler 吞掉全部 main-process uncaught exception | 高 | 代码、历史来源 |
| A-10 | `whenIdle()` 不等待真正 idle；pending cancel 不清 dedupe record | 高 | coordinator 状态机闭环 |
| P-01 | 常规一次发送约触发 8 次完整 session message 物化，约 40 条同步 SQL | 高 | 完整调用链 |
| P-02 | 每次富消息读取都会先聚合全局 trace 表 | 高 | SQL、索引、query plan |
| P-03 | Tape lazy backfill 没有 ready watermark，每次操作都全量核对 message 与 tape | 高 | 代码、Tape spec |
| P-04 | streaming 全量 snapshot 在 JSON/Zod/IPC/renderer/DB 多层放大 | 高风险，待量化 | 热路径静态证据 |
| P-06 | 启动 critical constructor 每次无索引扫描全部 message 做 crash recovery | 高 | SQL、lifecycle 调用链 |
| P-07 | 200ms `AGENTS.md` fallback 与日级外层 prompt cache 冲突，慢读结果可能整天不生效 | 高 | 两层 cache 组合路径 |
| P-09 | FTS 正常零命中也进入两层同步 `%LIKE%` fallback | 高 | 代码、迁移 spec |
| P-10 | FFF 失败后新 query 仍重试；timeout 类失败可再付出最多 2.5s budget | 高 | 重试已确认，满额延迟待测 |
| D-01 | Remote channel descriptor 有四份真源且 capability 已漂移 | 中 | 四处代码、投递能力、历史 |
| D-04 | 单一 agent implementation 上约 35 个 optional capability 产生死 fallback 和 fail-open 默认 | 中/潜在高 | 类型、registry、实现闭环 |

“高”不等于已经测得明显卡顿。可靠性/语义类“高”表示行为已由代码证明；性能类若没有 profiler，
统一写成“高置信风险”而不是虚构毫秒收益。证据口径见[审计方法](./01-scope-methodology.md)。

## 当前最该做的事

1. 先修语义，不先做大重构：明确 timeout 的 cancellation/unknown-outcome 语义，拆分 session
   `missing` 与 `unavailable`，修复 system prompt cache 组合错误，收紧 fatal error policy。
2. 再处理已证明的热路径重复：一次发送只构建一个 history snapshot；给 Tape 加 migration/version
   watermark；把 runtime predicate 与 UI rich read model 分开。
3. 补与查询形状一致的索引：trace count、pending recovery、backfill cursor、session list。
4. streaming 先埋点再决定 delta：记录 snapshot bytes、Zod/JSON CPU、IPC fan-out、DB block rewrite，
   不应在没有数据时贸然把 snapshot 改成 delta。
5. 架构治理按 domain 小步做：先冻结 `routes/index.ts`、`core.presenter.d.ts` 和
   `AgentRuntimePresenter` 的继续增长，再逐域迁移，不做 big-bang rewrite。

决策级排序和验证门槛见[行动清单](./07-prioritized-actions.md)；可独立交付的任务、依赖和实施波次见
[实施路线图](./09-implementation-roadmap.md)。

## 报告索引

- [01 - 范围、方法与证据边界](./01-scope-methodology.md)
- [02 - 架构、边界与生命周期问题](./02-architecture-findings.md)
- [03 - 性能热点与数据库查询问题](./03-performance-findings.md)
- [04 - 重复设计、冲突与过度兜底](./04-duplication-conflicts-fallbacks.md)
- [05 - 反常但有意的设计：保留项与待决策项](./05-intentional-designs.md)
- [06 - 与 2026-07-04 性能审计的逐项对账](./06-prior-audit-reconciliation.md)
- [07 - 分级行动、测量与回归要求](./07-prioritized-actions.md)
- [08 - Ponytail 复杂度删减清单](./08-ponytail-audit.md)
- [09 - 实施任务拆分与路线图](./09-implementation-roadmap.md)

## 代码规模快照

| 对象 | 当前值 | 说明 |
| --- | ---: | --- |
| `src` TypeScript/Vue 文件 | 1,395 | `rg --files` 统计 |
| `src` TypeScript/Vue 行数 | 334,696 | 物理行数，不等于复杂度 |
| `AgentRuntimePresenter/index.ts` | 7,350 行 / 209 class methods | 已有 split proposal，尚未实施 |
| `AgentSessionPresenter/index.ts` | 4,201 行 / 146 class methods | proposal 明确排在 runtime split 之后 |
| `routes/index.ts` | 4,351 行 / 349 typed route cases | 最大函数 2,807 行 |
| `core.presenter.d.ts` | 2,592 行 | compatibility quarantine 仍继续增长 |
| `@shared/presenter` import 文件 | 292 | 其中 main 186、renderer 89 |
| `as unknown as` / `as any` / TS suppression | 160 | 仅作导航信号，未一概判错 |

这些规模数据用于定位 owner 和审查成本，不能单独证明性能问题。
