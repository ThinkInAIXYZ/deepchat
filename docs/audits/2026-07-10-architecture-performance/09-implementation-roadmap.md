# 09 - 统一实施计划：从审计发现到可验证交付

| 项目 | 值 |
| --- | --- |
| 文档状态 | 实施中 |
| 审计基线 | `f9de202a`（`v1.0.8-beta.4`） |
| 最新 `main` 复核基线 | `65bd1d6e` |
| 合并后工作基线 | `ad597256` |
| 文档 owner | 本文件是本轮审计整改的唯一总计划；`01`–`08` 只提供证据和决策输入 |

本路线图基于本目录 A-01–A-13、P-01–P-12、D-01–D-10、Ponytail cut list 和旧审计对账生成。
它把 [`07-prioritized-actions.md`](./07-prioritized-actions.md) 的决策输入拆成可独立评审、验证和回滚的
实施切片；不代表所有切片已经获得实施授权。

用户明确要求一篇统一实施文档，因此本文件同时承担总目标、优先级、任务依赖、
影响/收益、风险和验收门槛。不再建一份并行的总 `spec/plan/tasks` 集合。但某个具体切片若改动
跨模块 contract、数据迁移或 lifecycle，开工前仍须在对应 `docs/architecture/*`、`docs/issues/*`
或 `docs/features/*` 中完成仓库要求的 SDD。

## 先用大白话说结论

整个整改不是“把大文件拆小”，而是按下面五步走：

| 阶段 | 大白话 | 用户能得到什么 | 开发者能得到什么 | 为什么现在做 |
| --- | --- | --- | --- | --- |
| 0. 恢复可验证基线 | 先确保依赖、typecheck 和基线测试可靠 | 不把环境故障当产品回归 | 后续每个交付切片都有可比对的基线 | 当前本地安装未解析已声明的 `cron-parser`，完整 typecheck 不能作为门槛 |
| 1. 先修错语义 | 先处理“超时了但任务还在跑”、“暂时失败被当成不存在”等问题 | 更少错误解绑、重复执行和旧 prompt | 错误、取消、retry 的 contract 变得可测 | 这些是已证明的正确性问题，不需要等 profiler |
| 2. 修确定性热点 | 先减少重复读全部历史、全表扫描和无效 fallback | 长对话、历史搜索、启动更稳定 | SQL 次数和 query plan 有明确上限 | 调用链和 SQL 已闭环，收益比大重构更直接 |
| 3. 测完再改复杂性能路径 | 对 streaming、FFF、存储放大先记录真实数据 | 避免为了“优化”带来丢流、搜索失效或数据丢失 | 只在证据超预算时承担 delta/migration 复杂度 | 这些热点有静态风险，但还没有真实负载数据 |
| 4. 最后拆边界和清理 | 再处理 God object、route root、optional capability 和兼容壳 | 用户功能原则上不变 | 改一个 domain 不再牵动半个 main process | 先稳定行为再搬家，否则难以区分“修复”和“重构”带来的回归 |

这个顺序的核心只有一句话：**先让行为正确，再让热路径少做事，最后才让代码看起来更干净。**

本文反复使用的几个词，用大白话解释如下：

| 词 | 本文中的含义 |
| --- | --- |
| owner | 最终对这份状态或资源负责的模块；不能两个地方都以为对方会收尾 |
| contract | 调用双方事先约定的输入、输出、错误和状态语义；不只是 TypeScript interface |
| fallback | 主路径失败后的备用路径；只有在文档允许且不掩盖错误时才是可靠性 |
| watermark | 记录“已处理到哪里”的指针，避免每次从第一条数据重新检查 |
| snapshot | 某一时刻的完整状态副本；好处是容易收敛，代价是内容越大、重复传输越贵 |
| migration | 让旧用户数据进入新 schema/contract 的过程；只测新数据库不算完成 |
| measurement gate | 数据达到事先定义条件后，后续复杂方案才允许开工 |
| growth guard | 允许历史债务暂时存在，但阻止它继续增长的 CI 规则 |

## 合并最新 main 后的复核

`f9de202a..65bd1d6e` 修改了 118 个文件，其中包含 renderer UX performance 优化、agent plan
重构、inline input item 和部分 runtime 更新。不能因为 commit 名称含“performance”就宣布本轮问题
已修，因此重新对照了受影响路径：

| 最新 main 变化 | 与本审计的关系 | 计划调整 |
| --- | --- | --- |
| `AgentRuntimePresenter`、`AgentSessionPresenter`、`messageStore` 增加 inline item/扩展策略处理 | 没有改变 Scheduler cancellation、session availability、history 重复物化、Tape watermark 或 prompt cache 契约 | A-04/A-05/P-01/P-03/P-07 任务保留，但后续 fixture 需包含 inline item |
| `pendingInputCoordinator/store` 增加 inline item offset 保留 | 未改变 consumed steer retention 和 claimed-state index；也不是 A-10 的 startup workload coordinator | P-11/A-10 任务保留，避免把两个 coordinator 混为一个 owner |
| `ChatPage`/message window 等 renderer UX 性能优化 | 可能降低部分 renderer commit/scroll 成本，但 main `echo` 全量 snapshot、全窗口 fan-out 和 DB full replace 未改 | P-04 不直接实施 delta；`STR-001` 必须用最新 main 重建 baseline，不沿用旧 renderer 数据 |
| Agent plan block 从 message block 重构为独立 plan state | 属于另一个已有 architecture contract，不是本轮 AgentRuntime owner 拆分 | 不把它加进审计整改，避免扩大范围 |
| `package.json` 仍声明 `cron-parser`，当前本地 install 仍无法解析 | 这是验证环境前置，不是审计 finding | 开工前先同步 pnpm install 并记录 baseline；若同步后仍失败，再单独建 issue，不塞进任一整改切片 |

## 实施台账

历史交付保留原 PR 链接作为证据；从 `SCH-003` 起，修复继续使用独立本地分支、独立 commit 和独立验证，
然后直接本地合入 `docs/audit-remediation-plan`，不再为每个切片创建 GitHub PR。本表是交付状态、自动验证和
无法完全自动验证范围的唯一台账；后续本地合并必须更新对应行。

验证策略也同步收紧：正确性优先使用反例驱动的 targeted tests、类型检查和 architecture/static guards；full
suite 只在一个 atomic integration unit 末尾最多运行一次作为外围回归探测，不在每次 blocker 修复后重复。
E2E 只用于必须经过真实 Electron/process/packaged 边界才能回答的问题；其余真实服务、慢请求、视觉和跨平台
缺口如实进入 manual gap，不用大量模拟 E2E 制造“覆盖率很高”的错觉。

| Task | 状态 | 交付 / merge | 自动验证证据 | 未完全自动覆盖的范围 |
| --- | --- | --- | --- | --- |
| `BASE-001` | 已完成 | 无代码变更 | 同步 pnpm 依赖后 typecheck/lint 通过；基线全量测试为 4,463 passed / 5 failed | 5 个基线失败另立切片，不让不相关交付顺手修复 |
| `CRD-001` | 已合入 | [#1921](https://github.com/ThinkInAIXYZ/deepchat/pull/1921) / `8b6506f8` | focused 5/5、typecheck、format、i18n、lint 通过；合入后全量 4,465 passed / 5 failed，失败集与基线完全一致 | 不响应 `AbortSignal` 且永不 settle 的底层任务仍会占用 lane；提前释放会破坏并发上限，强制终止属于任务 owner |
| `ARC-001` | 已合入 | [#1923](https://github.com/ThinkInAIXYZ/deepchat/pull/1923) / `bcd5daff` | focused 21/21、typecheck、format、i18n、lint 通过；合入后全量 4,479 passed / 5 failed，失败集与基线完全一致 | 静态 literal/regex guard 不覆盖 computed import、CommonJS `require()` 和间接 helper；指标下降后需人工同步收紧 baseline，baseline 变更本身仍依赖 review |
| `FTL-001` | 已合入 | [#1925](https://github.com/ThinkInAIXYZ/deepchat/pull/1925) / `1591737c` | 文档门禁全部通过；独立 real Electron 40.10.5 harness 证明 framework 会让 monitor/default-exit 方案继续存活，并验证最终 `prependListener` + `process.exit(1)` 机制 | `FTL-002` 必须固化 real Electron harness；macOS/Windows/Linux child tree 与 fatal-write SQLite 重启完整性无法由单主机测试完整覆盖，按 PR 描述作为 blocking smoke |
| `PRM-001` | 已合入 | [#1926](https://github.com/ThinkInAIXYZ/deepchat/pull/1926) / `2f6efe1f` | focused prompt/env 179/179 与文档门禁通过；多轮独立复核闭合 mixed skill snapshot、hung mutation、双 200ms 串行等待等反例 | 外部文件写入到 watcher event 被观察前仍是 eventual-consistency window；实现已拆为 `PRM-002A`–`PRM-002C`，只在 C 完成后关闭 P-07 |
| `CRD-002` | 已合入 | [#1927](https://github.com/ThinkInAIXYZ/deepchat/pull/1927) / `729d22fe` | focused 13/13、typecheck、format、i18n、lint 通过；合入后全量 4,487 passed / 5 failed，失败集与基线完全一致 | barrier 后提交的任务可按 contract 与 callback 重叠；忽略取消且永不 settle 的 captured task 会如实阻塞；真实冷启动 warmup 时序仍建议按 PR 步骤 smoke |
| `PRM-002A` | 已合入 | [#1928](https://github.com/ThinkInAIXYZ/deepchat/pull/1928) / `351a50aa` | focused 195/195、typecheck、format、i18n、lint、architecture guard 通过；独立复验与合入后全量均为 4,503 passed / 5 failed / 135 skipped，失败集与基线一致 | env/verification 已共享一个 absolute 200ms deadline；outer prompt fingerprint、skill epoch 和 prompt/tool 同源仍待 B/C；按 resolved path 的 process-local Map 暂无 eviction，纳入长期 workspace churn 容量观察 |
| `SES-001` | 已合入 | [#1929](https://github.com/ThinkInAIXYZ/deepchat/pull/1929) / `a0410a1f` | 文档门禁、typecheck 通过；focused session 297 passed / 1 个既有失败；独立代码与历史复核闭合 built-in fast path、deletion/binding 收敛、consumer allowlist、old-main schema 和 terminal diagnostic owner | 本 PR 只固定四态与 rollout contract，不改变运行时；packaged fault-injection artifact 可选且不得进入 release；SES-002/003 仍需分别验证 internal classified API 与 renderer compatibility |
| `PTG-001` | 已合入 | [#1930](https://github.com/ThinkInAIXYZ/deepchat/pull/1930) / `7aaaeca1` | 多轮独立复验闭合 helper boundedness、public failure sentinel、preload/Electron shell opener、SDK-wrapped MCP launcher 和不可复验 probe 表述；links、format、i18n、lint、diff check 通过 | 本 PR 只固定 process-tree governance；当前 macOS 已证实 fatal 后 utility host 退出但 detached shell/grandchild 存活；Windows/Linux、dev/package、全部 launcher matrix 尚未执行，未取得证据前不得选择 watchdog/OS containment |
| `SCH-001` | 已合入 | [#1931](https://github.com/ThinkInAIXYZ/deepchat/pull/1931) / `8fccae55` | 三轮独立代码/history/IPC 复核闭合 SES retry/binding、零 consumer abstraction、create unknown outcome、restart cursor/dedupe、stale binding、durable input acceptance 与 Electron error serialization；文档门禁、typecheck、focused route/session/provider/chat/runtime/renderer tests 通过 | 本 PR 只固定 `OperationRunner`、`PRV-CAN-001` 和 atomic `SCH-003A/B` contract；provider 5s/60s 仍是 observation deadline，A-04 在 owner cancellation、safe consumer migration 与 create cutover 完成前保持 open |
| `PTG-H0` | 已合入 | [#1932](https://github.com/ThinkInAIXYZ/deepchat/pull/1932) / `4889309b` | final focused 48/48、typecheck、format、i18n、lint、architecture guard 通过；合入后全量 4,518 passed / 5 failed / 135 skipped，失败集与基线一致；real macOS child 用 PID+marker+start identity 验证 callback/close 后已退出 | 只治理 Workspace Git 30s、Device query 10s、skill command probe 5s+1s 的 direct child；unconfirmed reap typed reject，不用 raw PID kill；Windows/Linux native evidence与所有 descendants/owner-loss containment仍未完成，不解锁 FTL-002 |
| `PRM-002B` | 已合入 | [#1933](https://github.com/ThinkInAIXYZ/deepchat/pull/1933) / `0d17af50` | final focused 136/136、typecheck、format、i18n、lint、architecture guard 通过；独立复核闭合 immutable/LKG snapshot、plugin re-register、uninstall/late watcher、odd/even settlement 与 CAS convergence；在仓库外的 merge-commit worktree 复验全量为 4,546 passed / 5 failed / 135 skipped，失败集与基线一致 | 本 PR 只发布 immutable skill runtime snapshot；outer prompt/tool cache wiring 与 env/verification/skill 同一 200ms deadline 仍待 `PRM-002C`；外部文件 watcher 仍是 eventual consistency，Windows/Linux watcher 行为与长期 source-map 容量需继续观察 |
| `PTG-M1` | 已合入 | [#1934](https://github.com/ThinkInAIXYZ/deepchat/pull/1934) / `24c4846c` | final focused 36/36、62-site inventory guard、真实 Node ESM import shape 10/10、typecheck、format、i18n、lint、diff check 通过；仓库外 merge-commit worktree 合入后全量为 4,582 passed / 5 failed / 135 skipped，失败集与基线一致；多轮独立复核闭合 CJS/dynamic/default/named-default/trivia/computed/opaque alias 等 fail-open 反例 | 只建立静态 launcher inventory 与增长门禁，不证明 runtime containment；same-file same-API 语义替换、dependency/native launcher 仍靠 review/runtime census；保守 module-loader 规则可能误报 `report('electron')` 一类调用；descendants、parent-loss 与三平台矩阵未完成，不解锁 `FTL-002` |
| `SES-002` | 已合入 | [#1935](https://github.com/ThinkInAIXYZ/deepchat/pull/1935) / `a999103d` | final focused 206/206、typecheck、format、i18n、lint、architecture guard、diff check 通过；仓库外 merge-commit worktree 合入后全量为 4,606 passed / 5 failed / 135 skipped，失败集与基线一致；多轮独立复核闭合四态 authority、built-in fast path、missing-only unbind、2×25ms settled retry、terminal privacy 与 canonical type/provenance guard 逃逸 | 本 PR 只迁移 main 内部 classified API 并保留 legacy route shape；renderer/public schema 四态仍待 `SES-003`；full-list 外层查询失败仍整单 reject，per-row 不做 retry；guard 只承诺本地 TypeScript type/assignment provenance，不分析跨函数 JavaScript dataflow |
| `PRM-002C` | 已合入，待人工关闭 P-07 | [#1936](https://github.com/ThinkInAIXYZ/deepchat/pull/1936) / `25749879` | non-native focused 348/348；Electron ABI raw-pin 5/5、native SQLite 120/120；typecheck、format、i18n、lint、62-site launcher guard、diff check 通过；仓库外 merge-commit worktree 合入后全量为 4,629 passed / 5 failed / 139 skipped，失败集与基线一致；独立复核闭合 t=0 shared deadline、immutable prompt/tool pair、bounded rebuild、matching fallback、tool failure 零缓存、atomic refresh 与 raw pin no-repair | 仍需同 session `AGENTS.md` late refresh、同名 skill body/allowedTools/scripts、`package.json` verification 和日志无 source content 的 real-app smoke；完成前不把 P-07 标为 closed；global skill epoch 会产生低频全 session false invalidation，source Map 长期容量与 Windows/Linux watcher timing 继续观察 |
| `SES-003` | 已合入，待人工 UI/packaged smoke | [#1937](https://github.com/ThinkInAIXYZ/deepchat/pull/1937) / `c065c72a` | rebase 后 final focused 249/249；typecheck、format、i18n、lint、62-site launcher guard、diff check 通过；仓库外 merge-commit worktree focused 218/218、全量 4,659 passed / 5 failed / 139 skipped，失败集与基线一致；独立复核闭合 `null`/omitted/object 三值兼容、四态 ownership、缓存保留、missing 收敛、旧请求 mutation fence、bounded availability 与 sidebar no-N+1 | 仍需 release-equivalent packaged normal smoke，以及 light/dark、resize、长消息滚动、缓存保留、Retry/键盘焦点、禁用输入的实机 UI 检查；packaged unavailable/transient fault injection 未实现；orphan Agent repair/reinstall/remap 不在本切片范围 |
| `PTG-M2A` | 已合入，FTL 仍阻断 | [#1938](https://github.com/ThinkInAIXYZ/deepchat/pull/1938) / `61488f92` | final focused 24/24 + 1 个 macOS 上的 Linux-native skip；typecheck、format、i18n、lint、62-site launcher guard、diff check 通过；`/usr/bin/false` 安全失败与 macOS Electron 40.10.5 healthy/owner-loss/callback 三场景通过；仓库外 merge-commit worktree 全量 4,683 passed / 5 failed / 140 skipped，失败集与基线一致；独立复核闭合 PID/marker/start identity、unknown fail-closed、零信号、证据脱敏与 source hash | 本 PR 只建立机制中立 development harness，并真实证明 macOS owner-loss 时 shell/grandchild 存活；Windows/Linux 原生、三平台 packaged、完整 owner/helper matrix 和 production containment 均未完成；synthetic 平台测试不是原生证据，不解锁 `FTL-002` |
| `SCH-002A` | 已合入 | [#1940](https://github.com/ThinkInAIXYZ/deepchat/pull/1940) / `d8d2ca6b` | final combined focused 137/137 + 1 个 Linux-native harness skip；typecheck、format、i18n、lint、architecture/process guards、diff check 通过；仓库外 merge-commit worktree 全量 4,715 passed / 5 failed / 140 skipped，失败集与基线一致；独立复核闭合 factory 内 abort+sync throw、late settlement drain、overall deadline/no-overlap、输入校验，以及 direct/alias/destructure/routes 外 legacy guard 绕过 | 本 PR 只交付 `OperationRunner` core 和迁移边界，不迁 production consumer 语义，也不声称性能收益；当前 19 个 legacy timeout + 2 个 retry 被精确冻结；owner-aware cancellation、provider/session consumer 迁移与 domain 行为验证仍属于 `SCH-002B` |
| `SCH-002B` | 已合入 | [#1941](https://github.com/ThinkInAIXYZ/deepchat/pull/1941) / `0199f709` | final independent focused 438/438，blocker-specific Chat/guard 46/46；typecheck、format、i18n、lint、architecture/process guards、diff check 通过；仓库外 merge-commit worktree 全量 4,734 passed / 5 failed / 140 skipped，失败集与基线一致；独立复核闭合 session `2×25ms` settled-only retry/binding、Chat preflight stop fence 与 owner-started truth、provider 60s/no-uniform-bound truth、namespace/type/factory alias guard | legacy 已收窄为 `SessionService.createSession` 与 `ProviderService.testConnection` 两项，retry surface/caller 为零；create unknown outcome 仍待 `SCH-003A/B` 原子切换；provider probe 的 route 5s 与 model 60s 都只是 observation，真实 owner cancellation 仍待 `PRV-CAN-001`；不声称吞吐性能收益 |
| `PRV-CAN-001` | 已合入，待真实服务/UI smoke | [#1942](https://github.com/ThinkInAIXYZ/deepchat/pull/1942) / `e95fcaa2` | final independent focused 340/340 + `runCancellable` adversarial；typecheck、format、i18n、lint、architecture/process guards、diff check 通过；仓库外 merge-commit worktree focused 541/541、全量 4,773 passed / 5 failed / 140 skipped，失败集与基线一致；独立复核 60-provider inventory、60s cancel 后 physical settlement、AWS/Groq/GitHub/Codex abort-no-fallback、ACP/media/Voice model/Fireworks pre-effect unsupported 与 Electron-safe code | 未用真实 provider 账户/quota 做 AWS、key-status、GitHub Copilot、OpenAI Codex、Voice.ai、Ollama 网络 smoke，未墙钟等待真实 60s deadline，未在设置 UI 检查 unsupported 文案；底层若忽略 signal，caller 会按 contract 继续等待真实 settle；legacy timeout 现只剩 `SessionService.createSession`，由 atomic `SCH-003A/B` 删除 |
| `SCH-003A/B` | 已本地合入，待真实 Electron/UI smoke | local merge `7d74f42f` | backend final focused `220 passed`、Electron ABI143 native SQLite `6 passed`；renderer/API final `126 passed`，history cache blocker repair 后 `4 + 67 passed`；typecheck、format、i18n、lint、architecture guard、diff check 通过。唯一一次 atomic full probe 为 `4811 passed / 25 failed / 146 skipped`：4 项是既有 debug/Spotlight 基线，21 项是旧测试夹具未登记新 table 或仍要求 create 自动激活；仅改 3 个测试文件后 migration `1/1`、usage `5/5`、integration `15/16`，唯一失败恢复为既有 long-steer 基线，production code 未再变化，因此未重复 full/E2E | create 已改为 content-free durable journal、unknown/reconcile、unbound backend 与 renderer current/stale 1/0 activation，消除 5 秒后假失败/重复创建语义；仍需真实 Electron restart recovery、真实 DeepChat/ACP 超 5 秒慢创建、真实 event timing，以及 recovery UI 键盘/窄窗口/light/dark/视觉检查；完成前 A-04 不标 closed |
| `DB-001` | 已本地合入 | local squash `8d0b158f` | deterministic 10k/100k、current + 4 candidate scenarios、50%/90%/99% cursor、expanded-OR/row-value、pre/post-ANALYZE、metadata 31/2/1 queries、5k lifecycle writes；raw 15 samples 与 report 全量独立复算通过，400 个 query records 的 ordered-row hash 全等；1k smoke、受控失败 temp cleanup、`typecheck:node`、format、script OxLint/syntax、diff check 通过；未跑 full/E2E | 证据否定“把五个 full composite index 一次加上”：100k DB core 约 `3.06 MiB`、write `1.10x`，full 约 `21.30 MiB`、write `1.82x`，pending/claimed 读收益相同。后续只允许 partial pending/claimed + shared message cursor，并必须配套 row-value query；session index 暂不批准，metadata 优先 batch。isolated SQL/direct build 不代表真实 startup/migration，留给后续 gate |
| `SEA-001` | 已本地合入 | local fast-forward `d7918109` | Presenter + Sync targeted `137/137`；Electron ABI143 real SQLite FTS5 `4/4`，覆盖 available zero/hit 与三个 trigger 任一缺失；`typecheck:node`、format、i18n、lint、architecture/process guards、diff check 通过；两轮独立审查先发现 live DB import/reopen blocker，再复核修复后 `PASS / 0 BLOCKER`；未跑 full/E2E | completed corpus 的 FTS zero 直接返回，不再进入 structured/raw `%LIKE%`；FTS unavailable/throw 仍保留 structured fallback，incomplete corpus 才保留 raw correctness fallback。overwrite/reopen 重读同一 marker，increment/legacy raw import 删除 marker，process-local generation fence 禁止旧 worker跨库提交。仍需真实 sync backup overwrite/increment 与大历史库重启 backfill smoke；import 后在既有 normalization 再运行前会有意保留较慢 raw fallback，以正确性优先，不声称未经测量的墙钟收益 |
| `DCL-001` | 已本地合入 | local fast-forward `5f713c30` | repo-owned shared declaration strict probe 从 19 roots / 44 diagnostics 收敛到 `19 / 0`；node/web typecheck、format、i18n、lint、diff check 通过；shortcut/formatter/Tape/Sync、remote runner、renderer API 等 targeted tests 通过，architecture guard final `37/37`；独立审查发现非 presenter 的 `@/*` alias 漏检后，补 `@/eventbus` mutation 并复核 `PASS / 0 BLOCKER`；未跑 full/E2E | Shortcut、ImportMode、MCP entry 等 contract 回到 shared owner，旧 import path 只保留直接 compatibility re-export；没有创建第二个 barrel，也没有借机拆 2,565 行 compatibility quarantine。`DCL-002` 仍须把当前一次性 strict probe 固化为常规脚本/CI gate；本切片只冻结 shared→main import 为 0，并拒绝 node 配置下全部 `@/*` edge，不宣称已消除 broad compatibility debt |
| `FTL-002` | 阻断中 | 本地 WIP `994af870`，未 push/merge | fatal helper/entry/config focused 11/11；`PTG-M2A` 已把 macOS healthy/owner-loss/callback 固化为可复验 artifact，真实结果仍为 `[utility exited, shell alive, grandchild alive]` | 剩余 blocking dependency 为 Windows/Linux 原生与三平台 packaged pre/post matrix、完整 owner/helper fixtures、containment 选型和实现；SQLitePresenter schema/version 与 fatal-write 重启完整性也未完成；不得把 orphan 写成 expected 结果 |

## 先反驳一种错误排法

不能单纯按“从易到难”执行。这样会先删除 feature flag、Compat 壳等低价值代码，却继续保留 prompt
错误、unknown-outcome mutation、错误解绑和 fatal exception fail-open。

本路线图采用以下规则：

1. **优先级优先**：P0 语义/可靠性错误先于性能与结构清理。
2. **依赖优先于难度**：measurement、owner decision、contract 和 migration 设计必须先于实现。
3. **同优先级内从低难度开始**：先交付可快速降低风险的切片，再进入跨模块改造。
4. **行为修复与结构提取分开**：不得在同一个交付切片同时改变语义并拆 God object。
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
| S | 1–2 个开发日，1–3 个紧密相关文件 | 单切片、可直接回滚 |
| M | 3–5 个开发日，跨少量模块或含 migration/test fixture | 一般单切片；复杂 bug 先写 issue spec |
| L | 1–2 周，一个跨 contract/process/database 的内聚目标 | 进入 ready 前证明无法再独立拆分，否则继续拆 |
| XL | 超过 2 周或涉及核心状态所有权 | 不得直接开工，必须继续拆分 |

难度是相对估算，不包含 review/fix 循环，也不是交付承诺。

### 收益和影响怎么计

本计划不用“感觉更快”做验收。每类收益使用不同口径：

| 维度 | 验收方式 | 不接受的说法 |
| --- | --- | --- |
| 正确性 | 失败、timeout、cancel、retry 的状态转移测试；数据/绑定最终收敛 | “大部分时候没事” |
| 用户体验 | 明确的 loading/unavailable/unknown-outcome 状态；不丢草稿、绑定和已完成结果 | “多 catch 一下更稳” |
| 性能 | 调用次数、SQL query plan、处理 rows/bytes、main-thread duration、IPC fan-out | 没有 fixture/profiler 的毫秒或百分比 |
| 存储 | 不同 payload 的物理 pages/bytes、migration time、写放大和备份影响 | 只看表数量就说“存了五遍” |
| 可维护性 | owner 和 contract 单一、严格类型检查可运行、root 不再增长、单 domain 切片影响面收窄 | 只报 LOC 下降 |
| 安全/故障处理 | fatal 不被吞、required capability 不 fail-open、workspace scope/revoke 可解释 | 为了“不报错”返回 `full_access`/`null`/`[]` |

### 实施前置（BASE-001）

这一步不修审计问题，但没有它就无法证明后续交付切片没有回归：

1. 按当前 `package.json` 同步 pnpm 依赖，先确认 `cron-parser` 可解析。
2. 运行 `pnpm run typecheck`、`pnpm run lint`、`pnpm test`，记录最新 main 的通过项和已知失败。
3. 若依赖同步后 typecheck 仍失败，单独立 issue/spec；不允许后续任务把环境失败当成自己的
   baseline，也不在业务切片里顺手改依赖。
4. 固定性能 fixture 的机器、SQLite 版本、数据量和重复次数；不跨机器直接比毫秒。

`BASE-001` 的退出条件是“有可重复的基线”，不是“所有历史问题全绿”。

## P0：先修正确性与状态机

下表按“优先级相同、难度较低优先”排列；实际执行还必须遵守 `depends-on`。

| 顺序 | Task | Finding | 难度 | depends-on | 独立交付目标 | 验证门槛 |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | `FTL-001` | A-06 | S | — | 写 `docs/issues/*/spec.md`，分别决定 `uncaughtException`、`unhandledRejection`、controlled exit/relaunch/crash reporter/safe mode 和 network error owner | 明确 owner-handled rejection 与升级为 fatal 的边界；非 network fatal 不能继续以“可恢复”处理；无 `[NEEDS CLARIFICATION]` |
| 2 | `PRM-001` | P-07 | S | — | 写 `docs/issues/*/spec.md`，固定 env/skill revision 或 late-refresh invalidation contract 和失败测试 | spec 覆盖首次读取超时、late result、同名 skill 内容更新；无 `[NEEDS CLARIFICATION]` |
| 3 | `CRD-001` | A-10 | S | — | 让 pending/running cancel 走统一 settlement，清理 dedupe record | 重复 create/cancel target 后 map/pending/runs 不增长；rejection 只 settle 一次 |
| 4 | `CRD-002` | A-10 | M | `CRD-001` | 实现真正的 idle barrier，并定义等待开始后新任务是否属于当前 generation | deferred CPU + 2 IO 全部 settle 后才执行 callback；generation 边界有测试 |
| 5a | `PRM-002A` | P-07 | M | `PRM-001` | 建 env/verification rendered snapshot、shared pending 和固定 30s retry；保留旧 string wrapper | 首读/late result/transient I/O/package.json 测试；两个 source 共享一个 200ms deadline；A 单独合入仍可运行 |
| 5b | `PRM-002B` | P-07 | L | `PRM-002A` | 建 immutable skill runtime snapshot、LKG/quarantine/reconcile 和有界 stable epoch | invalid watcher/parse-null/rollback unknown/hung worker 均不暴露 mixed pair；现有 skill/tool tests 全过；B 单独合入仍不宣称 P-07 已修 |
| 5c | `PRM-002C` | P-07 | M | `PRM-002A`, `PRM-002B` | 并行取得三类 snapshot，把同一 skill snapshot 接入 composed prompt 与 tool profile cache | 真实双层 cache 覆盖 timeout、late result、同名 skill/package scripts；只有 C 完成后关闭 P-07 |
| 6 | `FTL-002` | A-06 | M | `FTL-001` | 把 network UX 错误处理移回请求 owner；最早 built-in-only handler 同步双 sink 后显式 `process.exit(1)` | owner-handled network error 不 fatal；real Electron 中 uncaught/rejection/import/start failure 均单次记录并 exit 1；跨平台 orphan 与 SQLite smoke 通过 |
| 7 | `SES-001` | A-05 | M | — | 写 issue/architecture SDD，定义 `available/unavailable/transient_error/missing` 与旧 renderer compatibility | 先补失败测试：transient failure 保留 binding；永久未知 agent 不拖垮列表 |
| 8 | `SCH-001` | A-04 | M | — | 写 architecture SDD，对 operation 分类为 cancellable、idempotent、non-cancellable | 每类 operation 的 timeout、retry、settlement、reconciliation contract 明确 |
| 9 | `SCH-002` | A-04 | M | `SCH-001` | 改造 cancellable task API，让 owner 获得 `AbortSignal`；禁止 retry 与未结束 attempt 重叠 | deferred timeout/cancel/retry 测试证明上一 attempt 已终止或 operation 幂等 |
| 10 | `SES-002` | A-05 | M | `SES-001` | 扩内部 result，移除 `null as unknown as`，让 list/get/active binding 保留四态语义 | transient failure 保留 binding；永久 unavailable 可降级显示；现有 route 暂走兼容映射 |
| 11 | `SES-003` | A-05 | M | `SES-002` | 迁移 route schema 和 renderer compatibility，公开已定义的 availability state | missing/unavailable/transient 四态 integration test；旧 renderer compatibility 明确且有测试 |
| 12 | `SCH-003` | A-04 | L | `SCH-001` | 为一个选定的不可取消 mutation 建 operation identity、unknown-outcome 和 reconciliation 样板 | create 晚落库/晚绑定可被查询并收敛；caller 不会收到虚假的确定失败；其他 mutation 另按样板逐项迁移 |

### P0 推荐执行方式

- 第一批的 SDD/测试设计可并行：`PRM-001`、`FTL-001`、`SES-001`、`SCH-001`；`CRD-001`、`CRD-002` 可在同一模块内串行实现。
- 第二批：`PRM-002A`–`PRM-002C` 严格串行；该链与 `FTL-002`、`SCH-002` 可按 owner 并行；`SES-002`、`SES-003` 与 Agent runtime/session 热路径任务串行，避免同文件冲突。
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
| 15 | `DB-002` | P-05/P-06/P-11 | M | `DB-001` | 用已有 DB migration 增 partial pending/claimed + shared message cursor index，并把 normalization/usage keyset 改为 row-value comparator | old-current DB migration、fresh/upgraded parity、0/1/10/100 sparse states、真实 open+migrate 阻塞、query result/plan、写放大和 DB size；禁止退回 full status/role/state index |
| 16 | `SES-LIST-001` | P-08 | M | `DB-001` | 先把 session keyset expanded OR 改为 row-value comparator；只在不同 regular/subagent density 重测仍超预算时考虑 session index | page 1 与 50%/90%/99% cursor result/plan；当前证据不批准 agent composite 或两个永久 session indexes |
| 17 | `SES-LIST-002` | P-08 | M | `DB-001` | 把 listPage/getMany/prioritize 的 session metadata N+1 收敛到 batch owner，不绑定 session index 才能工作的 JOIN | page query count 从 1+N 收敛到 2；Cron parse/missing/badge 语义不变，query 数不随 page size 线性增长 |
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
| T6 `turnRunner` | XL，开工前继续按 turn phase 拆分 | T2–T5 完成；不得一个切片搬完整 agent loop |
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
`CAP-PORT-<group>` 任务；每个任务只拆一个 port group，不创建“把 34 个方法一次拆完”的总括切片。

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

这些任务不应抢占 P0/P1 review 带宽。适合在对应文件被高优先级任务触达时顺手独立提交，而不是开“misc cleanup”大切片。

## 推荐实施波次

```text
Wave 0  Restore baseline and freeze growth
        BASE-001 → ARC-001

Wave 1  P0 bounded fixes / decisions
        PRM-001 → PRM-002A → 002B → 002C ┐
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

### 每个波次什么时候算完成

| 波次 | 退出条件 | 不允许带到下一波的未完成项 |
| --- | --- | --- |
| Wave 0 | 依赖可解析，typecheck/lint/test baseline 已记录；增长 guard 可用 | “本地本来就失败”这种无法归因的验证环境 |
| Wave 1 | timeout/cancel/fatal/session/prompt 的 contract 和 failure test 全部闭环 | 仍用 `null`/silent no-op/重叠 retry 掩盖未定义语义 |
| Wave 2 | FTS/index/declaration/lifecycle 等可独立收益已交付，数据库读写代价已记录 | 只改 fresh schema、不测旧 DB migration 的 index 变更 |
| Wave 3 | history/Tape 达到明确调用/row 目标；streaming/FFF 只有过 gate 的方案进入实施 | 没有数据便引入 delta、breaker 或 blob store |
| Wave 4 | 选定 domain 已脱离 route root；runtime split 每个 service 有真实 integration test | 只搬文件、仍由旧 God object 偷偷持有状态的“假拆分” |
| Wave 5 | owner/产品决策已记录，高优先级回归稳定，低收益清理不抢 review | 没有支持窗口证据就删兼容 route，或把有意的 MCP 双保险当重复删掉 |

### 第一批最合理的实际开工集合

先完成 `BASE-001`。基线可重复后，建议只开以下 4 个互不混杂的工作流：

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

## 每个 finding 怎么处理、有什么影响和收益

下表是从审计结论到实施任务的唯一覆盖矩阵。“用户收益”写可感结果，“工程收益/代价”
明确为达成该结果需要承担的复杂度；不把代码更少自动当成用户价值。

| Finding | 当前影响 | 准备怎么处理 | 用户收益 | 工程收益/代价 | Task / disposition |
| --- | --- | --- | --- | --- | --- |
| A-01 | route root 同时做 dispatch 和 domain policy，一个改动容易牵动大文件 | 先用 guard 冻结增长，再选一个高变更 domain 提取 handler | 直接体感不大，但降低新功能破坏旧 route 的几率 | review 范围收窄；代价是搬迁期会有两种组织形态 | `ARC-001`, `RTE-002` |
| A-02 | runtime/session God object 让不相关功能共享状态和 review 范围 | 不新建方案，复用现有 split T2–T7，等热路径 contract 稳定后逐服务提取 | 新改动带来的回归更少 | 是长期收益，不承诺直接提速；搬迁期回归面大 | 复用 AgentRuntime split T2–T7 |
| A-03 | shared declaration 反向依赖 main，部分错误被 `skipLibCheck` 隐藏 | 先修真实声明错误并加 strict check，再随 domain 改动提取 | 减少升级/打包时才暴露的类型回归 | boundary 可被 CI 强制；初期会暴露一批存量错误 | `ARC-001`, `DCL-001`, `DCL-002` |
| A-04 | timeout/retry 可让上一次 mutation 仍在运行，调用方却已重试 | 先区分可取消、幂等、不可取消 operation；前者传 `AbortSignal`，后者引入 operation identity/reconciliation | 减少重复创建、晚到结果和“界面说失败但后台成功” | contract 变清楚；代价是不可取消 mutation 需新状态和查询途径 | `SCH-001`–`SCH-003` |
| A-05 | session 不存在、永久不可用、暂时失败都变成 `null`，可误解绑 | 定义四态 result，先改内部，再迁移 route/renderer 兼容 | 暂时故障不再让当前会话“消失”，真不可用时有明确说明 | 错误语义可测；代价是 schema/UI state 需迁移 | `SES-001`–`SES-003` |
| A-06 | 为 network toast 安装的顶层 handler 会吞掉其他 fatal exception | network 错误回归请求 owner；最早 process handler 只做 opt-in file log、同步 `stderr` 和 `process.exit(1)` | 减少应用带着未知损坏状态继续运行 | fatal 可诊断；代价是某些真正 fatal 会立即退出且跳过正常 cleanup，不自动重启 | `FTL-001`, `FTL-002` |
| A-07 | HooksNotifications 两次构造，runtime bridge 长期指向 dummy instance | 选 late-bound dispatcher 或两阶段 `seal()`，用真实 Presenter factory 测试 | 避免部分 hook 通知在特定构造顺序下丢失 | 单一 identity；代价是需要重写构造时序测试 | `LIF-001`, `LIF-002` |
| A-08 | event 文档、ambient sink 和 startup drop 语义不一致 | 先标记 event 是 ephemeral/replayable/durable；只在 query 无法回放 durable state 时引入 buffer/port | 启动阶段不再偶发丢必要状态 | 事件 contract 可解释；代价是 durable event 需 retention 和顺序策略 | `EVT-001`；`EVT-002` 条件执行 |
| A-09 | shared FileWatcher utility 没有明确生产 teardown owner | 决定 process-final teardown 或零 active request idle-stop，再实施 | 长时运行/重启 watcher 后更少残留进程和句柄 | lifecycle 可测；代价是要覆盖多平台重启时序 | `LIF-003`, `LIF-004` |
| A-10 | `whenIdle()` 不是真 idle barrier，pending cancel 又会留 dedupe record | 先统一 settlement/cleanup，再定义 generation-aware idle barrier | 启动后台任务不再重复、过早或永久卡住 | coordinator 语义可信；代价是某些 warmup 执行时机会改变 | `CRD-001`, `CRD-002` |
| A-11 | architecture guard 的名称大于实际覆盖面 | 建分类 baseline/trend guard，先阻止新增债务 | 无直接 UI 收益，但减少同类回归重现 | 架构约束可自动执行；代价是 guard 需避免误报和“刷数字” | `ARC-001` |
| A-12 | workspace register 的 app/session/webContents scope 和 revoke 语义不明 | 先做 owner/安全决策；只在选 session/webContents scope 时做 refcount/revoke | workspace 授权生命周期更符合用户预期 | 减少隐式权限保留；代价是 tab/window 关闭时需处理并发 revoke | `WSP-001`；`WSP-002` 条件执行 |
| A-13 | window binding map 保留历史 `webContents` key | 确认 `null` 无独立语义后在 unbind/destroy 直接 delete | 长时多开关窗口时少量降低内存增长 | 状态简化；收益低，不应抢高优先级 review | `WIN-001` |
| P-01/P-02 | 一次 send 重复完整物化 history，rich read 又全局聚合 trace | 先埋点，再分 existence/predicate 和 UI rich view，最后复用单次 history snapshot | 长会话发送前等待更稳定，trace 很多时不拖累正常对话 | SQL/物化次数有硬上限；代价是 snapshot 传递必须防止过期 | `HIS-001`–`HIS-004` |
| P-03 | Tape 每次 ensure 都全量核对 message 和 tape | 增 migration version/source watermark，覆盖 crash、partial migration 和 live append | Tape 搜索/回放和发送不再重复打扫整段历史 | 无变化 ensure 进入 O(1)/增量路径；代价是 migration state 本身必须可恢复 | `TAP-001`–`TAP-003` |
| P-04 | streaming 全量 snapshot 在 JSON/Zod/IPC/renderer/DB 放大 | 先用最新 main 重测；超预算后先 targeted fan-out/stable block/upsert，delta 最后 | 大输出/大 tool response 场景可能更顺，但不牺牲丢包后收敛 | 先拿数据再买复杂度；delta 需 revision/order/recovery，是最高代价备选 | `STR-001`；`STR-002` measurement gate 后执行 |
| P-05/P-06 | keyset cursor 和 pending recovery 缺匹配 index，可扫描/排序大表 | DB-001 已选 partial pending + shared message cursor + row-value keyset；DB-002 再走真实 old DB migration | 大历史数据时启动、迁移和恢复更可预期 | DB core 实测远小于 full composites；代价仍是约 `3.06 MiB/100k` 和 synthetic lifecycle write `1.10x` | `DB-001`, `DB-002` |
| P-07 | 200ms 内层 fallback 被日级外层 cache 放大，late `AGENTS.md` 可整天不生效 | 先定义 snapshot/epoch contract，再依次交付 source snapshot、skill immutable snapshot 和 orchestration wiring | prompt/技能文档和相关 package scripts 按契约生效，不用重启碰运气 | 正确性收益大于纯性能；代价是显式 LKG/quarantine 状态和少量有界重读 | `PRM-001`, `PRM-002A`–`PRM-002C` |
| P-08 | session list expanded OR 让 deep cursor 退化，每行 Cron metadata 又 N+1 | DB-001 证据要求先用 row-value keyset，不先加 session index；metadata 用 batch owner，不采用依赖新 index 的 JOIN | 会话很多时翻页更稳定，metadata query 从 1+N 收敛到 2 | 先拿 query-shape 大收益，避免额外约 `4.09 MiB/100k` session indexes；真实密度重测后再决定 index | `DB-001`, `SES-LIST-001`, `SES-LIST-002` |
| P-09 | FTS 正常零结果也进入 structured/raw `%LIKE%` 扫描 | 分开 available、migration incomplete、zero-hit 和 throw | 搜不到内容时不再反而最慢 | fallback 语义与 spec 一致；代价是 migration 状态必须可查 | `SEA-001` |
| P-10 | FFF 失败后新 query 仍重试，timeout 场景可重复付出 budget | 先分 native/init、workspace timeout、query-specific、transient IO，再做有界 cooldown/half-open | 大 workspace 连续输入时减少重复等待，好 query 不被坏 pattern 连坐 | breaker 有可恢复状态；代价是分类错了可压掉可恢复请求，必须先测 | `FFF-001`, `FFF-002`；`FFF-003` 条件执行 |
| P-11 | consumed steer tombstone 永久保留，claimed startup query 又缺匹配 index | claimed lookup 用 partial index；retention 仍先确认审计需求，再选 delete/TTL/精简 tombstone | 启动不必扫描全部 consumed rows，同时不偷做数据保留决策 | partial/full 读收益相同且写成本更小；retention 未解决，不能把 index 当清理 | `DB-001`, `DB-002`, `STEER-001`, `STEER-002` |
| P-12 | message/structured/search/Tape 多层表示没有 size/retention budget | 只做 `dbstat`/fixture 测量；超预算才新建 offload/retention 设计 | 若证明超预算，可降低大图/工具结果对磁盘、备份的压力 | 先分清完整副本与搜索投影；不过早引入 blob store/TTL | `STO-001`；超预算后另立任务 |
| D-01/D-02/D-03 | Remote descriptor 四份且已漂移，Compat 壳和专用 status route 延续旧交通层 | 先决定 shared catalog/main authority，再删无策略 wrapper；专用 route 等支持窗口结束 | 通道能力不再在不同页面互相矛盾；后端失败时显示 unavailable 而不是假“未启用” | 单一真源；代价是故障会更可见，且不能过早删跨版本 route | `RMT-001`–`RMT-004` |
| D-04/D-10 | 唯一 runtime 之上有大量 optional method，缺能力时可默认 `full_access`/noop/empty | 先删 required-method fail-open，再定义真正 capability descriptor，最后分组收紧 port | 缺安全/确认能力时明确报错，不会假成功 | 无效 fallback 减少；代价是会暴露原先被隐藏的 implementation gap | `CAP-001`–`CAP-003`, `CAP-PORT-*` |
| D-05 | `ChatService.activeControllers` 只管 enqueue 窗口，名称却像 generation owner | 决定它是 enqueue owner 还是 generation owner；前者删假 controller，后者返回可观测 handle | cancel/timeout 行为不再与真实生成脱节 | lifecycle owner 单一；代价是可能改 service API | `CHAT-001`, `CHAT-002` |
| D-06 | route runtime 使用 fake `ISQLitePresenter` cast，测试 seam 与生产真相不一致 | 要求真实 SQLite dependency；若只需 activity，注入两方法窄 port | 无直接可感收益，但减少测试通过、生产爆炸 | 测试 seam 诚实；代价低 | `RTE-001` |
| D-07 | shutdown 多 owner 有些是双保险，有些是无文档重复 | 明确 Cron/floating/window owner；保留 MCP early stop + final fallback | 退出时少残留进程，也不因过度去重删掉救命保险 | 清理语义明确；代价是每类资源需单独判断，不能造通用 shutdown framework | `SHD-001`；保留 MCP double shutdown |
| D-08 | auto-compaction default/limit 多处复制，global 与 per-agent normalization 不同 | 先确认 step=5 与任意整数是否有意，再共享 defaults/limits 但显式保留策略差异 | 不同设置入口不再出现未说明的取整差异 | 默认值不漂移；代价是需一次产品决策，不可用“去重”代替 | `CMP-001`, `CMP-002` |
| D-09 | 常量为 true 的 feature flag 保留死分支 | 删 flag/guards；若真需 kill switch，另建 runtime config | 行为不变 | 少一层假灵活性；收益低，后做 | `FLG-001` |
| F11 residual | provider icon registry/大 SVG 仍可能影响 bundle，旧数据已过时 | 用最新 build 重测资产体积/加载，只在超预算时实施 | 若真超预算，可减少设置/首次图标加载成本 | 避免重复优化已解决部分；代价是需 build 产物数据 | `ICON-001` |
| Ponytail #12 | `normalizePermissionMode` 在 main/runtime/renderer 三份 | 收敛到 shared domain helper，保留一组 contract test | 权限模式在不同入口的 normalize 结果一致 | 删重复规则；收益低，与高优先级文件不冲突时再做 | `PERM-001` |

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

## 兼容、回滚和发布策略

| 变更类型 | 实施规则 | 回滚方式 | 最大风险 |
| --- | --- | --- | --- |
| 纯内部语义（cache/coordinator/fatal） | 先加失败测试，一个 task 一个本地合并单元，不同时搬文件 | 直接 revert 该 task merge/commit | 新语义与某个未记录 caller 的隐式假设冲突 |
| Route/event/schema contract | 先加新字段/状态和兼容映射，迁移 main/renderer，最后才删旧 route | 回滚实现但保留向后兼容 schema；不在同一发布删旧字段 | 新旧 renderer/app 跨版本调用不兼容 |
| SQLite index/migration | expand-first：先增 index/metadata，旧 reader 仍可运行；数据删除/压缩另立任务 | 回滚代码时不回滚已安全创建的兼容 index/metadata；后续 migration 再清理 | 大库 migration 锁住 main process，或 index 写放大超过读收益 |
| Tape/retention | 先写 watermark 并验证可重建；删 payload/TTL 前先完成审计需求决策 | 保留 legacy full-scan repair path 一个支持窗口，但不让它默认走热路径 | watermark 错误导致漏 backfill，或过早删除可回放事实 |
| Streaming transport | 先 measurement，再 targeted snapshot/upsert；只有前者不足才设计 revisioned delta | 保留周期性全量收敛通道，直到 delta 的丢包/乱序测试稳定 | 丢包、乱序、跨窗口 fan-out 让 renderer 与 main 状态分叉 |
| 安全/权限 | required capability 缺失时 fail closed；workspace scope 改动需明确 UI state 和 revoke 时机 | 优先回滚调用链，不回滚为默认 `full_access` | 为了兼容重新引入 fail-open，或 revoke race 中断正在使用的 workspace |
| 纯结构提取 | 行为测试先锁定，只搬一个 domain/service，不同时改 contract | revert 整个提取 merge unit，不在新旧两套 owner 之间打补丁 | 新 service 只是代理壳，状态 owner 仍留在 God object，形成又一层假抽象 |

默认不为每个修复新增 feature flag。只有无法通过单一 merge unit/revert 安全回滚的跨版本 migration 才考虑
临时 runtime gate，并必须在同一 SDD 写清删除条件和后续 task。

## 每个实施切片的统一交付门槛

1. 先有 focused failure/timeout/cancel test，不只覆盖 happy path。
2. 跨 route/service/Presenter contract 或 migration 的任务先完成对应 SDD，且无 `[NEEDS CLARIFICATION]`。
3. 实现与 verify 使用不同 agent/reviewer；blocking finding 修完后重新验证。
4. 运行任务专项反例测试，以及 `pnpm run typecheck`；生产代码准确性由 contract 反例、类型和静态边界共同
   证明，不以 E2E 数量代替。
5. 完成功能切片后运行 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`。
6. main hot path 运行对应 main focused files；renderer event/list 变化运行对应 renderer focused files。只有
   atomic integration 末尾最多做一次 full probe；修复 probe 暴露的问题后，若 production code 未再变化，
   用失败文件定向复验，不重复 full/E2E。
7. SQLite 变更必须包含已有 DB migration fixture、query plan 和规模数据。
8. UI 行为变化必须给 BEFORE/AFTER ASCII layout；当前路线图本身不改 UI。
9. 每个本地 merge unit 只交付一个 task ID；不得创建总括性的 `architecture cleanup` 合并。
10. measurement task 必须保存机器/数据量/重复次数/原始结果，并明确 go/no-go；“有点慢”不解锁后续复杂方案。
11. 需产品/owner 决策的 task 在文档中记录最终结论和被否决方案；不把决策留在聊天或临时 review 记录里。
12. 任务合并后回填本文件的 task 状态/验证链接；若实际证据否定原 finding，标记“证据否定”而不为了完成路线图强行改代码。
