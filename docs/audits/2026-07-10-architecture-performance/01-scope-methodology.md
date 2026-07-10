# 01 - 范围、方法与证据边界

## 范围

本轮覆盖：

- Electron main lifecycle、Presenter 组合、route/event transport、utility process owner。
- Agent session/runtime、pending input、Tape、structured messages、SQLite 表与索引。
- Renderer session/sidebar、Spotlight、streaming message 更新和 Remote settings/catalog。
- 当前测试、架构文档、issue/spec 文档和相关 Git 历史。

本轮不做：

- 不修改产品代码、测试、配置或既有 SDD 文档。
- 不运行真实 provider，不使用用户生产数据库，不声称端到端真实毫秒收益。
- 不把文件大、`catch` 多、类型断言多直接当成问题；只有闭合调用链才进入 findings。
- 不创建 GitHub issue。用户没有要求同步，审计结论也应先经过 owner 决策。

本任务属于诊断与报告，而不是实施架构变更，因此没有为审计本身伪造
`docs/architecture/<goal>/{spec,plan,tasks}.md`。后续若实施 A-01、A-02、A-03 等跨域改造，
应分别走 architecture SDD；复杂可靠性修复则走 issue spec。

## 证据等级

| 等级 | 定义 | 可用于什么结论 |
| --- | --- | --- |
| A | 当前代码与测试、spec 或 Git 历史中至少一类独立证据相互印证 | 可确认代码行为与设计意图的偏差；仍不等于已测得性能体感 |
| B | 当前代码调用链或 query plan 闭合，但缺独立意图证据或真实 workload profile | 可确认调用次数、scan/sort 形状或 lifecycle gap；不能报具体毫秒/用户影响 |
| C | 只确认设计预算缺口、可疑模式或尚未闭环的假设 | 仅进入待测/待决策项，不作删改结论 |

证据等级和严重度是两个维度。例如 P-04 的“全量 snapshot 路径”是已确认行为，
但用户可感影响仍待 profile，所以归 B；A-12 只证明 capability scope 没有显式契约，
并未证明存在安全漏洞，所以归 C。

| 等级 | Finding IDs |
| --- | --- |
| A | A-01–A-08、A-10–A-11；P-03、P-07、P-09–P-10；D-01–D-04、D-07–D-09 |
| B | A-09、A-13；P-01–P-02、P-04–P-06、P-08、P-11；D-05–D-06、D-10 |
| C | A-12、P-12 |

各 finding 按问题复杂度裁剪段落，不强制套用五段模板；标题中的“已确认/待
profile/意图不明”和上表共同给出证据边界。详细 finding 会尽量区分：

- **代码真相**：当前代码一定做了什么。
- **意图核验**：测试、文档或历史为什么这样做。
- **判断**：哪里是有意取舍，哪里已偏离原意。
- **影响边界**：已确认的语义后果，与仍需 profile 的性能后果。
- **验证建议**：用什么数据证明是否值得实施。

## 使用的方法

### 静态调用链

使用 `rg`、`nl -ba`、TypeScript AST 和精确文件阅读完成：

- route case、class method、函数跨度统计；
- renderer → preload → route → service/port → presenter → SQLite 的闭环追踪；
- startup/shutdown owner、cache invalidation、fallback 和 retry 状态机追踪；
- SQL query shape 与已声明 index 对照。

### 历史意图

使用 `git blame`、`git log -S`、`git show <commit>:<path>` 复核反常设计。重点历史：

| Commit | 用途 |
| --- | --- |
| `8ef5c858` | main typed IPC、service graph、minimum ports 与 Scheduler 初始决策 |
| `32bacc5f` | presenter transport 全量迁到 typed route/event |
| `752286fd` | startup workload 与 idle warmup 原始目标 |
| `948f3b87` | AgentRuntime split proposal |
| `7180cf3a` | 上一轮性能修复与 review hardening |
| `0b615c7b` | Cron metadata、remote delivery 和 scheduler 重构 |
| `72dc7e5d` / `f0a91b77` | unavailable session fallback 与后续 unsafe cast |
| `a44ead3e` | HooksNotifications constructor cycle workaround |

### 有限动态检查

本轮动态证据只用于验证静态判断，不冒充真实用户 workload：

- `node scripts/architecture-guard.mjs`：通过。
- `node scripts/agent-cleanup-guard.mjs`：通过，baseline violations 为 0。
- `pnpm run typecheck:web`：通过。
- `pnpm run typecheck`：在 node 阶段因当前安装/lock 中无法解析
  [`package.json`](../../../package.json#L116) 已声明的 `cron-parser` 而停止；这是审计前产品依赖状态，
  与本目录 Markdown 无关，本轮未擅自改 lockfile。
- 对 repo-owned declaration 强制 `skipLibCheck=false`：失败，暴露 A-03 所列声明错误。
- 使用内存 SQLite 按当前 schema 运行 `EXPLAIN QUERY PLAN`，确认 P-02、P-05、P-06、P-08、
  P-11 所列 scan/temp B-tree 形状。

未运行 build 或 E2E；2026-07-04 审计已经覆盖相应基线，本轮重点是当前代码路径与残余问题。

## 性能表述规则

下面几类事实可以由静态证据确认：

- 一条路径调用完整 `getMessages()` 多少次；
- SQL 是否缺少与 filter/order 对齐的 index；
- snapshot 是否全量、广播到多少类 webContents；
- cache 是否无上限、fallback 是否每次重试、migration 是否每次全量核对。

下面几类结论不能在本轮确认：

- 用户设备上具体慢多少毫秒；
- 哪个问题当前贡献了最大 CPU/RSS；
- delta streaming 一定优于 snapshot；
- 增加 index 后的实际写放大是否可接受。

因此报告使用“静态高置信热点”“疑似性能风险”“需 profile”，不会使用未经测量的百分比。

## 规模与热点导航

AST 统计得到：

| 文件 | 最大函数 | 跨度 |
| --- | --- | ---: |
| `src/main/routes/index.ts` | `dispatchDeepchatRoute` | 2,807 行 |
| `AgentRuntimePresenter/index.ts` | `runStreamForMessage` | 654 行 |
| `AgentRuntimePresenter/index.ts` | `processMessage` | 392 行 |
| `AgentSessionPresenter/index.ts` | `searchHistory` | 162 行 |

从 2026-03-01 到当前基线，对应文件分别有 43、73、25 个触达 commit。这里用于证明变更集中，
不用于评价作者或单个 PR。

## 已知限制

- 没有真实 provider 和真实 10k-message 用户库。
- 没有 Electron profiler、event-loop delay、heap snapshot、IPC byte counter。
- 部分历史设计文档已在历史 commit 中、不在当前 tree；报告用 commit hash 标明来源。
- SQL query plan 来自等价内存 schema；SQLCipher、真实统计信息和数据分布可能影响 planner 选择。
- 行号基于 `f9de202a`，后续改动可能漂移，finding 同时保留 symbol 名和调用链。
