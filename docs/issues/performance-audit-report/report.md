# DeepChat 性能审计报告

## 1. 范围与方法

本报告基于当前 worktree 的静态代码审计、构建输出和现有 Playwright E2E smoke 运行结果，覆盖：

- Electron 主进程启动/关闭生命周期、Presenter 聚合、SQLite、MCP/Plugin、protocol handler、workspace watcher。
- Vue renderer 启动、主聊天窗口、Settings 窗口、会话/消息列表、Markdown/worker、Provider/Model UI、Workspace UI。
- 现有 E2E 能触达的窗口与路由：主窗口、Settings、browser route、readonly settings/routes、agent CRUD、workspace watcher。

证据分类：

- **动态验证**：本次实际执行过的命令、E2E 结果、耗时和构建输出。
- **静态审计**：当前代码的触发路径与文件/行号，未声称已经用 profiler 量化。

### 本次复核说明（2026-07-04）

本报告的所有 17 个性能点（F1–F16 + V1）均已由独立代码审计逐条复核，复核覆盖原报告引用的每一处文件与行号；构建产物体积、`01-launch` 启动耗时、`04-settings-navigation` 失败均已在本机重新运行复现。每个发现新增「验证结论」与「修复收益」两节，并对原报告表述不精确之处做了修正。复核使用的模型为 GLM-5.2，4 组并行审计分别覆盖 F1–F4、F5–F8、F9–F12、F13–F16+V1。

## 2. 动态验证摘要

| 命令 | 结果 | 性能/覆盖信息 |
| --- | --- | --- |
| `pnpm run build` | 通过 | typecheck 通过；main bundle `out/main/index.js` 约 5,170 KB；renderer 出现多个 >500 KB chunk，包括 `index-CegBs835.js` 约 4,087 KB、`icons-BoZyWSAb.js` 约 3,695 KB、`index-BA7gsQOk.js` 约 2,924 KB、`ChatTabView` 约 716 KB。构建同时刷新了 `resources/model-db/providers.json` 和 `resources/acp-registry/registry.json`。 |
| `pnpm run e2e:smoke:ci` | 失败 | `01-launch` 通过但耗时 20.8s；`04-settings-navigation` 失败，等待 `settings-tab-mcp` 超时。失败不是启动崩溃，而是测试仍期待 Settings 侧边栏中存在隐藏路由 tab。 |
| `pnpm exec playwright ... 01-launch --repeat-each=3` | 通过 | 三次启动/关闭分别约 4.7s、4.2s、4.1s，说明基础冷启动路径可稳定完成。 |
| `pnpm exec playwright ... 07 08 09 --repeat-each=2` | 通过 | floating、browser typed route、main IPC boundary 共 6 次通过，总耗时 27.8s，单次约 4.1–4.7s。 |
| `pnpm run e2e:smoke` | 部分失败 | 30 个 spec：21 passed、3 skipped（provider 凭据相关）、6 failed。失败均为 Settings 隐藏路由 tab 缺失：mcp、remote、skills 等，不是 runtime crash。总耗时 5.7m。 |
| `pnpm exec playwright ... 10 12 14 15 17 18 20 21 22 23 24 25 26 27 28` | 通过 | 15 个 Settings/typed route/CRUD 稳定通过，总耗时 1.4m，单项约 4.8–6.8s。 |
| `pnpm exec playwright ... 29 30 --repeat-each=3` | 通过 | workspace readonly + watcher 共 6 次通过，总耗时 31.0s，单项约 4.3–5.7s。 |

### 本次复核新执行的验证（2026-07-04）

| 命令 | 结果 | 用途 |
| --- | --- | --- |
| `pnpm run build`（重新执行） | 通过，EXIT=0 | 重新核对 bundle 体积，验证 F9/F11/F16 的构建证据 |
| `pnpm exec playwright ... 01-launch --repeat-each=3` | 通过，3 passed (14.5s)，单次 4.6s / 4.7s / 4.1s | 复现启动耗时，验证 F1/F4/F7 |
| `pnpm exec playwright ... 04-settings-navigation` | 失败，`getByTestId('settings-tab-mcp')` `toBeVisible` 超时 30s（element not found） | 复现 V1 失败 |

复核确认的构建产物体积（`out/`，按字节精确统计）：

| 文件 | 字节数 | 报告引用 |
| --- | --- | --- |
| `main/index.js` | 5,170,448 | ~5,170 KB ✓ |
| `renderer/assets/index-CegBs835.js` | 4,087,557 | ~4,087 KB ✓ |
| `renderer/assets/icons-BoZyWSAb.js` | 3,695,438 | ~3,695 KB ✓ |
| `renderer/assets/index-BA7gsQOk.js` | 2,924,069 | ~2,924 KB ✓ |
| `renderer/assets/ChatTabView-DXKa4y6j.js` | 716,319 | ~716 KB ✓ |
| `renderer/assets/mermaidParser.worker-BSPkGSOf.js` | 604,751 | ~605 KB ✓ |
| `renderer/assets/katexRenderer.worker-kYRUX8Vy.js` | 301,980 | ~302 KB ✓ |
| `renderer/assets/tokenflux-color-CwENo5EF.svg` | 1,627,765 | ~1,628 KB ✓ |

证据缺口：

- `02-chat-basic`、`03-session-persistence`、`05-settings-provider` 因默认无 `RUN_PROVIDER_INTEGRATION=true`/真实 provider 凭据而跳过，未覆盖真实模型响应耗时。
- 本次未加入 profiler/trace 性能采样；动态耗时来自 Playwright 输出，不等价于细粒度 CPU/IO attribution。
- 关闭路径由每个 E2E 的 `app.close()` 间接覆盖，但没有独立 shutdown stopwatch 或 MCP 多 server 压测。
- F3 中的 `SELECT * FROM new_sessions/deepchat_messages` 全表内存加载、F12 中的 session fetch 竞态、F13 中的排序触发频率等结论均为静态代码审计推断，未用大数据量 profiler 量化（受环境限制，需构造 1k/10k 量级会话才能量化）。

## 3. 高置信性能点与风险

### F1. 启动关键路径包含同步 SQLite 打开、建表、迁移与 schema 诊断

- **证据**：静态审计 + 启动 E2E 动态覆盖。
- **风险级别**：高。
- **代码位置**：
  - [`databaseInitHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/init/databaseInitHook.ts#L46-L52)：INIT 阶段创建 `DatabaseInitializer`、`initialize()`、`migrate()`（`critical: true`，行号为 L46 起，原报告 L45 偏移 1 行）。
  - [`DatabaseInitializer.ts`](../../../src/main/presenter/lifecyclePresenter/DatabaseInitializer.ts#L48-L62)：启动时循环打开数据库、验证连接、执行 startup schema diagnosis（`diagnoseStartupSchema()` L59）。
  - [`index.ts`](../../../src/main/presenter/sqlitePresenter/index.ts#L322-L328)：`SQLitePresenter.initializeDatabase()` 同步 `openSQLiteDatabase`、`SELECT 1`、`initTables()`、`migrate()`。
  - [`index.ts`](../../../src/main/presenter/sqlitePresenter/index.ts#L406-L466)：启动时实例化并 `createTable()` 27 个 active tables（原报告「20+」准确）。
  - [`index.ts`](../../../src/main/presenter/sqlitePresenter/index.ts#L514-L571)：按版本同步执行 migration SQL。
- **触发路径**：`app.whenReady()` → `lifecycleManager.start()` → `INIT` → `database-initialization`。
- **风险说明**：better-sqlite3/SQLCipher 类操作在主进程同步执行；首次启动、版本升级、schema repair 或大数据库 schema 诊断时，会直接拉长主窗口创建前的时间。`SQLitePresenter` 构造函数（`index.ts:255-263`）同步调用 `initializeDatabase()`，是真正的同步 migration 落点。
- **验证结论**：✅ 准确。行号除 `databaseInitHook.ts` 偏移 1 行外全部吻合。`01-launch` 三次复现 4.6/4.7/4.1s 证明启动路径稳定，但无法在 E2E 内分解 SQLite 同步耗时。
- **修正**：原报告暗示 `DatabaseInitializer.migrate()`（`DatabaseInitializer.ts:128-142`）是迁移执行点；实际它是 **no-op stub**（注释「Migration logic is already handled in SQLitePresenter constructor」），真正的同步 migration 在 `SQLitePresenter` 构造函数经 `initializeDatabase()` → `migrate()`（`index.ts:328, 514-571`）执行。引用行号正确，暗示的调用链略有夸大。
- **修复收益**：保留必须的 open/解密/最小 schema 校验在关键路径；将可延迟的 `diagnoseStartupSchema()` 扫描、repair 建议、非关键表 `createTable()` 移入 `StartupWorkloadCoordinator` 的 background/io 任务。预期收益：冷启动在 schema 有漂移或表多时节省数十至数百 ms；干净 DB 上 `CREATE TABLE IF NOT EXISTS` 本身很快，收益较小。**最值得后移的是 schema diagnosis 扫描**。给 migration/repair 增加阶段耗时日志。**修复必要：是（针对大库/schema 漂移场景）。**

### F2. `AFTER_START` 的 ACP registry migration 在主窗口创建前执行

- **证据**：静态审计。
- **风险级别**：中。
- **代码位置**：
  - [`acpRegistryMigrationHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/acpRegistryMigrationHook.ts#L6-L10)：priority `0`，`critical: false`。
  - [`acpRegistryMigrationHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/acpRegistryMigrationHook.ts#L21-L29)：同步 await `runIfNeeded()` 和 `compensateEnabledRegistryAgentInstalls()`，两调用外层 try/catch。
  - [`windowCreationHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/windowCreationHook.ts#L11-L16)：主窗口创建 hook priority `1`，`critical: true`。
  - [`index.ts`](../../../src/main/presenter/lifecyclePresenter/index.ts#L190-L215)：同 phase 按 priority 分组串行执行（`Promise.allSettled` 等待当前组完成再进下一组）。
- **触发路径**：`AFTER_START` priority 0 → ACP migration → priority 1 `window-creation`。
- **风险说明**：即使该 migration 是非 critical，它仍在主窗口创建前被 await；当 registry/agent 安装状态需要补偿写库时，会增加可见窗口前的等待。
- **验证结论**：✅ 准确（含一处 nuance）。行号全部吻合。
- **修正**：原报告未点明该 hook 是 `critical: false` 且两调用包在 try/catch 内——因此它**只在成功路径上延迟窗口创建，失败不会阻塞启动**。实际成本取决于两个调用是否真有迁移工作：稳定库上多走 fast-path（幂等检查），首次运行或 registry/agent 安装变更后才实质化。
- **修复收益**：如果不影响首屏，改成主窗口创建后 background task；若必须先跑，至少添加「已迁移」快速路径验证 + 迁移行数/耗时日志。稳定库上收益接近 0，迁移场景可省几十 ms。**修复必要：边际（仅迁移场景有价值）。**

### F3. 首屏后多个 backfill fire-and-forget 可能与渲染争抢 SQLite/CPU

- **证据**：静态审计。
- **风险级别**：中。
- **代码位置**：
  - [`legacyImportHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/legacyImportHook.ts#L22-L25)、[`rtkHealthCheckHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/rtkHealthCheckHook.ts#L22-L24)、[`usageStatsBackfillHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/usageStatsBackfillHook.ts#L22-L24)、[`sqliteMainlineNormalizationHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/sqliteMainlineNormalizationHook.ts#L22-L27)、[`disabledSearchToolCleanupHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/after-start/disabledSearchToolCleanupHook.ts#L22-L27)：均为 fire-and-forget（`void ...catch`），priority 20–23。
  - [`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L3424-L3477)：mainline normalization 全表读取 sessions/messages，并每 200 条才 yield。
  - [`agentSessionPresenter/index.ts`](../../../src/main/presenter/agentSessionPresenter/index.ts#L3684-L3732)：usage stats backfill 遍历候选 assistant messages，并每 200 条才 yield。
- **触发路径**：主窗口创建后 `AFTER_START` priority 20+ → 多个后台任务并行启动。
- **风险说明**：这些任务不阻塞 lifecycle 完成，但会在首屏交互阶段消耗主进程 SQLite 和 CPU；大型历史库中，200 条一 yield 的粒度可能仍导致明显卡顿。
- **验证结论**：✅ 准确。5 个 hook 行号、priority 20–23 全部吻合。
- **修正/补充**：原报告**低估**了一项风险——`startMainlineNormalizationBackfill` 中 `SELECT * FROM new_sessions`（L3425-3426）和 `SELECT * FROM deepchat_messages`（L3462-3463）是**无界内存全表加载**，不仅是 CPU 争抢，更是内存峰值风险（独立于并发问题）。better-sqlite3 同步写入每条都会阻塞主线程，与 renderer IPC 处理直接竞争。
- **修复收益**：统一纳入 `StartupWorkloadCoordinator`（cpu:1/io:2 限流），把 `SELECT *` 换成 cursor/streaming + 更小 batch 提交，给每个 backfill 增加 batch size、耗时、processed count 日志。预期收益：在数百+会话/消息的账号上消除首屏后数秒的 UI 卡顿/抖动，并消除内存峰值。小库上收益接近 0。**修复必要：是（F1–F4 中收益最高的一项，针对有历史数据的账号）。**

### F4. Presenter 构造仍是启动关键路径中的同步聚合点

- **证据**：静态审计 + 启动 E2E 覆盖。
- **风险级别**：中。
- **代码位置**：
  - [`presenterInitHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/ready/presenterInitHook.ts#L15-L21)：READY 阶段创建 Presenter 并调用 `presenter.init()`，`critical: true`。
  - [`presenter/index.ts`](../../../src/main/presenter/lifecyclePresenter/index.ts)：构造函数同步创建 Window、Tab、LLMProvider、MessageManager、Device、MCP、Upgrade、Shortcut、File、Sync、Deeplink、Notification、Tray、Floating、Dialog 等约 20 个对象（`presenter/index.ts:159-220`）。
  - [`presenter/index.ts`](../../../src/main/presenter/index.ts#L733-L805)：`Presenter.init()` 设置 provider 并调度 floating、yo-browser、skills、MCP、remote 等 startup tasks。
  - [`startupWorkloadCoordinator/index.ts`](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L72-L75)：后台任务并发限制为 CPU 1、IO 2。
- **风险说明**：MCP/Skills 等重初始化已被调度到 background，这是好的；但 Presenter 构造本身仍集中创建大量对象。任何子 Presenter 构造函数中的同步 IO/复杂初始化都会回到首屏关键路径。
- **验证结论**：✅ 准确（作为结构性风险）。行号全部吻合。
- **修正**：原报告框架正确，但需明确——当前各子 presenter 构造函数只做对象引用装配（接收 config/sqlite 引用，IO 延迟到 `init()`），**构造函数本身当前不热**。这是一个**结构性/潜在风险**而非当前热点：任何未来新增的子 presenter 若在 constructor 做 IO/DB 扫描会无声回到关键路径。
- **修复收益**：维持 constructor 轻量化约束；新增 presenter 时禁止在 constructor 做文件/网络/数据库扫描；把重初始化放入 `StartupWorkloadCoordinator` 并设置 resource/phase。当前无可测启动收益，价值是**护栏**（防止未来回归）。**修复必要：边际（预防性，非当前可测热点）。**

### F5. MCP 已不阻塞首屏，但后台初始化存在长尾与退出风险

- **证据**：静态审计。
- **风险级别**：中。
- **代码位置**：
  - [`presenter/index.ts`](../../../src/main/presenter/index.ts#L795-L806)：`main:mcp-init` 作为 background/io startup task 调度。
  - [`mcpPresenter/index.ts`](../../../src/main/presenter/mcpPresenter/index.ts#L157-L175)：初始化时读取配置（`Promise.all`），并可能检测 npm registry。
  - [`serverManager.ts`](../../../src/main/presenter/mcpPresenter/serverManager.ts#L97-L144)：registry 检测对多个 registry 并发请求，单次 timeout 10s（`AbortController`）。
  - [`mcpPresenter/index.ts`](../../../src/main/presenter/mcpPresenter/index.ts#L195-L210)：enabled servers 串行 `startServer()`（`for...of` + `await`）。
  - [`mcpClient.ts`](../../../src/main/presenter/mcpPresenter/mcpClient.ts#L467-L499)：单个 MCP 连接 timeout 为 5 分钟（`Promise.race`）。
- **风险说明**：当前代码显示 MCP 初始化已是 background，不应再视为首屏阻塞；但一旦用户有多个 enabled servers，后台串行启动和 5 分钟连接 timeout 会造成长尾任务、资源占用和退出等待风险。最坏情况长尾 ≈ N × 5 分钟。
- **验证结论**：✅ 准确。所有行号吻合。
- **修正**：无。
- **修复收益**：为 startup/background 场景设置更短 soft timeout（如 30–60s）；区分「首轮能力可用」和「慢 server 继续重试」；串行启动保守但可增加总耗时上限和可观测状态。收益：后台长尾有界、MCP 可用性信号更快、减少卡住的后台任务。**修复必要：是（针对配多 server 的用户）。**

### F6. 自定义 protocol handler 在主进程同步读文件

- **证据**：静态审计。
- **风险级别**：中。
- **代码位置**：
  - [`protocolRegistrationHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L74-L129)：`deepcdn` handler 使用 `existsSync`（L87, L108）+ `readFileSync`（L117），全量读入内存返回 `Response`。
  - [`protocolRegistrationHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L132-L181)：`imgcache` handler 同步 `existsSync`（L139）+ `readFileSync`（L170）。
  - [`protocolRegistrationHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/beforeStart/protocolRegistrationHook.ts#L184-L211)：`workspace-preview` handler 使用 `existsSync`/`statSync`/`readFileSync`（L194, L204）。
- **风险说明**：protocol 请求在主进程处理；大量图片、workspace preview、大文件或慢盘会阻塞主进程事件循环，影响窗口响应和 IPC。
- **验证结论**：✅ 准确。三个 handler 全部使用同步 fs，无 streaming。
- **修正**：风险分层需细化——`deepcdn` 服务内置 CDN 资源（有界、小），风险低；`imgcache`/`workspace-preview` 服务用户文件，可大、可在慢盘上，并发抓取（如图片画廊）会在主线程串行化并阻塞 IPC/窗口响应，风险集中在后两者。
- **修复收益**：改为 `fs.promises`/streaming `Response`（Node streams 已被 Electron `protocol.handle` 支持）；为 `workspace-preview` 增加大小上限和 MIME cache；避免对频繁请求重复 `exists/stat`。收益：图片密集/大文件/慢盘下主进程不阻塞。**修复必要：是（imgcache/workspace-preview 路径）。**

### F7. Splash window 无条件创建，可能增加冷启动成本

- **证据**：静态审计。
- **风险级别**：低。
- **代码位置**：
  - [`lifecyclePresenter/index.ts`](../../../src/main/presenter/lifecyclePresenter/index.ts#L86-L97)：启动一开始 `await splashManager.create()`（L88），完成后 close（L97）。
  - [`SplashWindowManager.ts`](../../../src/main/presenter/lifecyclePresenter/SplashWindowManager.ts#L127-L193)：创建 BrowserWindow、加载 splash renderer（L150-192）。
  - [`SplashWindowManager.ts`](../../../src/main/presenter/lifecyclePresenter/SplashWindowManager.ts#L142-L145)：`SPLASH_SHOW_DELAY_MS = 200`（L54），200ms 后才允许 show。
  - [`SplashWindowManager.ts`](../../../src/main/presenter/lifecyclePresenter/SplashWindowManager.ts#L108-L117)：主窗口创建时可 `suppressSplashShow`/`closeHiddenSplashWindow()`。
- **风险说明**：200ms timer 本身不阻塞 lifecycle，但 splash BrowserWindow/WebContents 仍无条件创建并开始加载；当主窗口很快出现时，这部分可能成为纯额外成本。
- **验证结论**：✅ 准确（含一处 nuance）。行号吻合。
- **修正**：原报告已正确提到 L108-117 的 suppress 机制，但需强调——`suppressSplashShow` 只抑制**可见性**，`BrowserWindow`/`WebContents`/renderer load 的创建成本已经发生，无法回收。
- **修复收益**：改成延迟到「预计启动超过阈值」时再创建 BrowserWindow，而不是先创建再延迟 show；数据库解锁等必须 UI 可保留强制显示路径。收益：快冷启动上省 BrowserWindow 创建/load 成本；但增加复杂度并可能回归数据库解锁强制显示路径。**修复必要：边际（已有 suppress 机制，低优先级）。**

### F8. 关闭路径正确但重资源销毁串行，缺少耗时观测

- **证据**：静态审计 + E2E 间接覆盖。
- **风险级别**：中。
- **代码位置**：
  - [`lifecyclePresenter/index.ts`](../../../src/main/presenter/lifecyclePresenter/index.ts#L423-L456)：`before-quit` preventDefault 后 await `requestShutdown()` 再 `app.quit()`。
  - [`mcpShutdownHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/beforeQuit/mcpShutdownHook.ts#L9-L20)：priority 5 先关闭 MCP。
  - [`presenterDestroyHook.ts`](../../../src/main/presenter/lifecyclePresenter/hooks/beforeQuit/presenterDestroyHook.ts#L13-L23)：Presenter destroy priority `Number.MAX_VALUE`，最后执行。
  - [`presenter/index.ts`](../../../src/main/presenter/index.ts#L954-L981)：destroy 中依次 shutdown plugin → mcp → remote → memory → sqlite → workspace → skill。
  - [`pluginPresenter/index.ts`](../../../src/main/presenter/pluginPresenter/index.ts#L136-L157)：plugin shutdown 遍历 plugin-owned MCP server，逐个 `await stopServer()`（串行）。
  - [`mcpPresenter/index.ts`](../../../src/main/presenter/mcpPresenter/index.ts#L240-L248)：MCP shutdown 遍历 running clients，逐个 stop（串行）。
- **风险说明**：顺序保证安全，但在多 MCP server、plugin runtime、workspace watcher、memory consolidation 同时存在时，退出可能出现长尾；当前 E2E 只证明正常关闭成功，没有 shutdown duration 分解。
- **验证结论**：✅ 准确（含一处 nuance）。
- **修正/补充**：原报告未提到一处**部分缓解**——`closeTransport` 对 stdio transport 调用 `terminateProcessTree(child, { graceMs: 2000 })`（`mcpClient.ts:562-575`），给出 2s 进程杀 grace。但整体 `disconnect`/`transport.close()` 的 await 无 timeout，非 stdio 或无响应 transport 仍可无限期拖住串行循环。
- **修复收益**：为 BEFORE_QUIT hook 增加 duration 日志；对相互独立的 plugin-owned server stop 做 `Promise.allSettled` 或受限并发；MCP shutdown 增加 per-server timeout（`Promise.race` 包裹 `disconnect`）。收益：退出有界、可诊断。**修复必要：是。**

## 4. Renderer / UI 热点

### F9. Renderer 启动时立即加载/创建 Markdown workers，与「lazy」注释不一致

- **证据**：静态审计 + 构建输出。
- **风险级别**：中。
- **代码位置**：
  - [`main.ts`](../../../src/renderer/src/main.ts#L11-L20)：renderer 入口直接调用 `ensureMarkdownWorkers()`（L18，在 `app.mount` 前）。
  - [`markdownWorkerLifecycle.ts`](../../../src/renderer/src/lib/markdownWorkerLifecycle.ts#L73-L90)：动态 import KaTeX/Mermaid worker constructor（L79-82）。
  - [`markdownWorkerLifecycle.ts`](../../../src/renderer/src/lib/markdownWorkerLifecycle.ts#L132-L141)：立即创建 katex/mermaid workers 并注册给 markstream。
- **风险说明**：即使没有首屏 Markdown/KaTeX/Mermaid 内容，也会启动 worker 加载路径；构建输出中 `katexRenderer.worker` 约 302 KB、`mermaidParser.worker` 约 605 KB，且 Mermaid/Katex 相关 chunk 较大。
- **验证结论**：✅ 准确。构建体积复现精确：`katexRenderer.worker-kYRUX8Vy.js` = 301,980 B（~302 KB），`mermaidParser.worker-BSPkGSOf.js` = 604,751 B（~605 KB）。文件头注释（L4-6）声称「Workers are created on first use rather than during renderer startup」，与入口调用直接矛盾。
- **修正**：`main.ts:14-17` 注释承认该 eager 调用是有意为之（「awaiting here is unnecessary」），属「有意但可商榷」的选择，非疏漏。
- **修复收益**：真正按需初始化：首次渲染含 KaTeX/Mermaid/code block 时再 `ensureMarkdownWorkers()`；首屏只注册 fallback。markstream-vue 在 worker 未就绪时降级为纯文本，fallback 路径已存在。收益：无 markdown 内容的冷启动省 ~900 KB worker parse/实例化。**修复必要：是。**

### F10. i18n 全量同步导入所有语言包

- **证据**：静态审计。
- **风险级别**：中。
- **代码位置**：
  - [`i18n/index.ts`](../../../src/renderer/src/i18n/index.ts#L1-L20)：一次性静态导入 20 个 locale（zh-CN, en-US, ja-JP, ko-KR, zh-HK, zh-TW, ru-RU, fr-FR, fa-IR, pt-BR, da-DK, he-IL, es-ES, de-DE, tr-TR, id-ID, ms-MY, it-IT, pl-PL, vi-VN）+ 别名。
  - [`main.ts`](../../../src/renderer/src/main.ts#L22-L28)：主 renderer 初始化时把 `locales` 全量注入 vue-i18n。
  - [`settings/main.ts`](../../../src/renderer/settings/main.ts#L41-L48)：Settings renderer 同样全量注入。
- **风险说明**：主窗口和 Settings 窗口都会同步解析所有语言资源，增加 JS parse/evaluate 与内存；首屏实际只需要当前语言和 fallback。
- **验证结论**：✅ 准确（风险程度为 partial）。行号吻合，确为 20 个 locale 全静态导入。
- **修正**：实际 parse/eval 成本取决于 Vite 如何分块——`out/renderer/assets` 中未能清晰归属到单一 locale bundle，可能被内联/共享，运行时成本真实但未必很大。
- **修复收益**：只内联 `zh-CN`/`en-US` fallback；其他 locale 改为动态 import，并在切换语言时加载。收益：有界（locale JSON 体量不大），冷启动与内存少量改善，幅度小于 F9/F11。**修复必要：边际到是。**

### F11. Iconify collection 与 Provider 图标包体偏大

- **证据**：静态审计 + 构建输出。
- **风险级别**：高。
- **代码位置**：
  - [`iconLoader.ts`](../../../src/renderer/src/lib/iconLoader.ts#L41-L49)：异步加载完整 lucide、vscode-icons、line-md collection（`addCollection`）。
  - [`main.ts`](../../../src/renderer/src/main.ts#L46-L51) 与 [`settings/main.ts`](../../../src/renderer/settings/main.ts#L104-L109)：mount 后 `setTimeout(...,0)` 调用 `preloadIcons()`。
  - [`ModelIcon.vue`](../../../src/renderer/src/components/icons/ModelIcon.vue#L6-L82)：静态 import 约 77 个 provider 图标资源（SVG/PNG），构建 `icons` map（L85-184）。
- **动态证据**：构建输出出现 `icons-BoZyWSAb.js` 约 3,695 KB（最大 renderer 资产）、`tokenflux-color` SVG asset 约 1,628 KB（单个图标超 1.5 MB）。复现精确：3,695,438 B 与 1,627,765 B。
- **风险说明**：虽然 icon preload 不阻塞 mount，但会在首屏后立即抢占网络/磁盘/parse；Provider 列表和 ModelIcon 的静态图标映射使 Settings provider 页面和模型选择相关 chunk 更重。
- **验证结论**：✅ 准确。四项中收益最高。行号与构建体积全部吻合。
- **修正**：无。
- **修复收益**：按使用到的 icon 白名单生成 collection；Provider 图标改为 manifest/url 映射或按 provider lazy import；特别处理超大 SVG asset（tokenflux-color 1.6 MB 极可能应优化/替换）。预期可从关键资源图移除数 MB。**修复必要：是（高收益）。**

### F12. App/ChatTabView 启动数据加载存在重复调度与 IPC 峰值

- **证据**：静态审计。
- **风险级别**：中。
- **代码位置**：
  - [`App.vue`](../../../src/renderer/src/App.vue#L522-L529)：mount 时同时 `initAppStores()`、`providerStore.ensureInitialized()`、`modelStore.initialize()`、`sessionStore.fetchSessions()`。
  - [`storeInitializer.ts`](../../../src/renderer/src/lib/storeInitializer.ts#L19-L24)：`initAppStores()` 内并行 `providerStore.initialize()` + `uiSettingsStore.loadSettings()`。
  - [`ChatTabView.vue`](../../../src/renderer/src/views/ChatTabView.vue#L94-L116)：ChatTabView 继续启动 agent/project/model/ollama 加载，`finally` 中以 `!hasLoadedInitialPage` 守卫再调 `sessionStore.fetchSessions()`。
- **风险说明**：部分 store 具备 initialization promise，可降低重复请求；但启动时仍会形成多个 route/store IPC 的峰值，增加首屏后主进程压力。
- **验证结论**：⚠️ 部分准确。行号全部吻合，但「重复调度」表述需修正。
- **修正**：`providerStore.initialize()`（`providerStore.ts:350-353`）和 `modelStore.initialize()`（`modelStore.ts:1391-1392`）均通过 `initializationPromise` 守卫**自去重**——`App.vue` 中冗余的 `ensureInitialized()` 只是 await 已有 promise，不重新请求。**真正无去重的是 `sessionStore.fetchSessions()`**（无顶层 `if (initialized) return`，每次调用都发 IPC `listLightweight`，`session.ts:520`）：App.vue 无守卫调用可能与 ChatTabView 的 `hasLoadedInitialPage` 守卫调用竞态——若 App 的 fetch 未完成时 ChatTabView mount（子组件在父之后 mount，但 fetch 异步），`hasLoadedInitialPage` 仍为 false，第二次 IPC 触发。`initialPageRequestId`（`session.ts:514,529`）只丢弃过期**结果**，不阻止重复**请求**。
- **修复收益**：明确 startup bootstrap 的单一 owner；把 session fetch 加 in-flight promise 守卫关闭竞态；provider/model 首屏必要字段合并到 bootstrap。收益：有界（都是轻量列表调用，且多数并行），主要消除 session 的时序竞态。**修复必要：边际（provider/model 已自去重，仅 session 竞态需修）。**

### F13. 消息 store 对每次插入/更新执行排序，长对话会放大

- **证据**：静态审计。
- **风险级别**：中。
- **代码位置**：
  - [`message.ts`](../../../src/renderer/src/stores/ui/message.ts#L71-L80)：`sortMessageIdsByOrderSeq()` 全量 sort。
  - [`message.ts`](../../../src/renderer/src/stores/ui/message.ts#L82-L94)：`upsertMessageRecord` 在 `shouldSort` 为 true 时调用 sort（新 id 或 orderSeq 变化）。
  - [`message.ts`](../../../src/renderer/src/stores/ui/message.ts#L55-L122)：`parsedMessageCache` 是无上限 Map。
  - [`message.ts`](../../../src/renderer/src/stores/ui/message.ts#L128-L141)：block 复用比较对最多 5 个字段 `JSON.stringify`（`extra`/`tool_call`/`artifact`/`image_data`/`reasoning_time`），且在 `isReusableStableAssistantBlock` 内、被 status/type/timestamp/id 检查门控。
- **风险说明**：大历史会话、流式消息更新或批量加载时，排序 O(n log n)、字符串化比较和无上限 cache 会叠加为 renderer 卡顿/内存增长。
- **验证结论**：⚠️ 部分准确。行号全部吻合，但标题「对每次插入/更新执行排序」**夸大**了触发频率。
- **修正**：`shouldSort` 仅在**新 id 或 orderSeq 变化**时为 true。内容-only 更新（流式最常见的 `applyStreamingBlocksToMessage`，L512-517）仍走 `upsertMessageRecord`，但 orderSeq 不变且 id 已存在→**跳过排序**。`parsedMessageCache` 无上限但在 `loadMessages`（L360）、`clear`（L481）会清空，并按 id 在 `removeOptimisticMessage` 清理——是「会话内无上限」而非「永不清理」。`JSON.stringify` 比较被前置检查门控，不是每次比较都跑。
- **修复收益**：按 `orderSeq` 二分插入（仅对新 id）；批量加载时一次排序；给 parsed cache 增加 LRU/按 session 清理；对 block payload 使用版本/hash 或浅层字段比较。收益：数千+消息会话改善明显，但门控已避开最坏的流式路径。**修复必要：边际到是（针对超长会话）。**

### F14. Session sidebar fingerprint/watch 会对大列表反复构造大字符串并触发布局检查

- **证据**：静态审计。
- **风险级别**：中。
- **代码位置**：
  - [`WindowSideBar.vue`](../../../src/renderer/src/components/WindowSideBar.vue#L1690-L1699)：`visibleSessionFingerprint` 拼接 pinned 和 visible group/session ids。
  - [`WindowSideBar.vue`](../../../src/renderer/src/components/WindowSideBar.vue#L1703-L1718)：多个依赖任一变化都会 `scheduleSessionListFillCheck()`。
  - [`WindowSideBar.vue`](../../../src/renderer/src/components/WindowSideBar.vue#L1656-L1688)：fill check 读取 `scrollHeight/clientHeight`（L1671）并可能 `loadNextPage()`（L1676），循环最多 50 轮。
- **风险说明**：会话多、分组多、搜索/折叠频繁时，字符串 fingerprint 和 DOM 尺寸读取会放大；首屏自动补页逻辑虽有用，但需要避免过度触发。
- **验证结论**：✅ 准确（含一处 nuance）。行号吻合。
- **修正**：原报告「触发布局检查」准确，但**低估了已有缓解**——`scheduleSessionListFillCheck` 已 rAF coalesce（L1040-1048）并去重在帧内的请求，连续多次依赖变化在一帧内只触发一次 fill check，不是每次变化一次。
- **修复收益**：用 revision counter 或轻量 hash 替代完整 join；把布局读取合并到 `requestAnimationFrame`（已部分做到）；对连续 session store 变化做 debounce。收益：主要对极大 session 列表（数百+）在切换/搜索时有改善；rAF 守卫已限制布局读取频率。**修复必要：边际。**

### F15. ChatStatusBar watcher 链依赖范围大，部分 immediate/deep watcher 容易反复触发 IPC/计算

- **证据**：静态审计。
- **风险级别**：中。
- **代码位置**：
  - [`ChatStatusBar.vue`](../../../src/renderer/src/components/chat/ChatStatusBar.vue#L2297-L2310)：监听 `modelStore.chatSelectableModelGroups` 且 `deep: true`，`immediate` 同步 draft model selection。
  - [`ChatStatusBar.vue`](../../../src/renderer/src/components/chat/ChatStatusBar.vue#L2312-L2337)：session/permission watcher `immediate` 读取 permission mode（异步 IPC `sessionClient.getPermissionMode`，有 `permissionSyncToken` 竞态守卫）。
  - [`ChatStatusBar.vue`](../../../src/renderer/src/components/chat/ChatStatusBar.vue#L2362-L2375)：provider/model/draft/acp 变化触发 generation settings sync（6 deps，`immediate`）。
  - [`ChatStatusBar.vue`](../../../src/renderer/src/components/chat/ChatStatusBar.vue#L2377-L2395)：8 个依赖调度 ACP config sync（`immediate`，可取消 `scheduleStartupDeferredTask` L2389-2392）。
- **风险说明**：状态栏是聊天页常驻组件；模型列表、session 切换、draft 状态变化都可能触发多条 watcher，尤其模型组 deep watcher 会随大模型列表变化被放大。`activeSessionId` 在 3 个 watcher 中重复出现，单次 session 切换可能触发多个 handler。
- **验证结论**：✅ 准确。行号全部吻合。
- **修正**：无。已有 token/cancellable-task 守卫处理竞态（正确性 OK），问题在触发次数。
- **修复收益**：去掉 deep watcher，改为监听模型列表 revision/selected provider；把 permission/generation/acp sync 做去重和请求 coalescing；合并重叠的 `activeSessionId` watcher；增加 traceDebug 下 watcher 触发计数。收益：低风险、减少最易放大的触发源。**修复必要：是（本组中最易实施且安全的优化）。**

### F16. Settings provider 页面渲染全部 provider + draggable + 图标，且 E2E 显示该路径耗时较高

- **证据**：静态审计 + E2E 动态覆盖。
- **风险级别**：中。
- **代码位置**：
  - [`ModelProviderSettings.vue`](../../../src/renderer/settings/components/ModelProviderSettings.vue#L61-L121)：enabled providers 使用 draggable 全量渲染。
  - [`ModelProviderSettings.vue`](../../../src/renderer/settings/components/ModelProviderSettings.vue#L124-L180)：disabled providers 使用 draggable 全量渲染。
  - [`ModelProviderSettings.vue`](../../../src/renderer/settings/components/ModelProviderSettings.vue#L650-L692)：computed 每次按 enable/disable/filter 生成列表并支持 reorder。
  - [`ModelIcon.vue`](../../../src/renderer/src/components/icons/ModelIcon.vue#L6-L82)：每个 provider row 依赖静态 provider icon map（~77 图标，L85-184），`iconKey` 对每个实例做 `modelIdLower.includes(key)` 线性扫描（~90 keys，L206-227）。
- **动态证据**：`04-settings-navigation` 在 Provider Center 截图后失败前已进入包含 57 个 disabled providers 的页面；`18-provider-readonly-route` 单项约 6.4s，Settings subset 中偏高。
- **风险说明**：provider 数增长后，全部行、图标、Switch、draggable watcher 会增加 Settings 打开和搜索成本。约 57 个 disabled providers 时挂载 ~57 个 draggable 行 + ModelIcon 实例，每个 ModelIcon 跑 O(n) `includes` 扫描。
- **验证结论**：✅ 准确（含一处 nuance）。
- **修正**：原报告「图标 lazy load」建议略偏——图标已是**静态 import 打包**（运行时无 fetch 成本），lazy-load `<img>` 收益很小；真正收益是**减少行数**（虚拟化/折叠）和把 `draggable` 限制到「编辑排序模式」。
- **修复收益**：provider 列表虚拟化或按 group 折叠；draggable 仅在「编辑排序模式」启用；`iconKey` 的 `includes` 扫描可换精确 map。收益：provider 数增长后 Settings 打开/搜索成本下降，与 `18-provider-readonly-route` 6.4s 耗时一致。**修复必要：边际到是。**

## 5. E2E/验证能力问题（影响性能回归门禁）

### V1. Settings smoke 仍期待隐藏路由出现在侧边栏，导致 CI smoke 与 full smoke 多项失败

- **证据**：动态验证 + 静态审计。
- **风险级别**：高。
- **代码位置**：
  - [`settingsNavigation.ts`](../../../src/shared/settingsNavigation.ts#L163-L170)：MCP `hiddenInSidebar: true`（L170）。
  - [`settingsNavigation.ts`](../../../src/shared/settingsNavigation.ts#L173-L180)：Remote `hiddenInSidebar: true`（L180）。
  - [`settingsNavigation.ts`](../../../src/shared/settingsNavigation.ts#L211-L220)：Plugins `hiddenInSidebar: true`（L219）。
  - [`settingsNavigation.ts`](../../../src/shared/settingsNavigation.ts#L222-L229)：Skills `hiddenInSidebar: true`（L229）。
  - [`settingsNavigation.ts`](../../../src/shared/settingsNavigation.ts#L338-L342)：Settings sidebar 只取 `!hiddenInSidebar` 的 navigation items。
  - [`settings/App.vue`](../../../src/renderer/settings/App.vue#L37-L49)：只为侧边栏 button 渲染 `data-testid=settings-tab-*`（L534-535）。
  - [`04-settings-navigation.smoke.spec.ts`](../../../test/e2e/specs/04-settings-navigation.smoke.spec.ts#L41-L44)：`TABS` 数组列出 `settings-tab-mcp`/`-remote`/`-plugins`/`-skills`（L42, 57, 67, 73）。
  - [`helpers/settings.ts`](../../../test/e2e/helpers/settings.ts#L52-L55)：`openSettingsTab` 断言 `toBeVisible` 后才点击。
- **动态结果**：`e2e:smoke:ci` 的 `04` 失败；full smoke 的 `04/06/11/13/16/19` 均因 hidden tab 找不到失败。
- **本次复现**：`pnpm exec playwright ... 04-settings-navigation` 失败，错误为 `getByTestId('settings-tab-mcp')` `toBeVisible` 超时 30s，`element(s) not found`，调用栈 `helpers/settings.ts:54` → `04-settings-navigation.smoke.spec.ts:137`。这是**确定性失败**（非 flake）。
- **影响**：性能报告仍能使用通过的 focused specs，但 CI smoke 当前不能作为 Settings 全量性能门禁。
- **验证结论**：✅ 准确。行号、失败模式、复现全部吻合。
- **修正**：无。
- **修复收益**：E2E 对 hidden route 改为直接 `window.location.hash`/typed settings navigation，而不是侧边栏 tab；或为隐藏路由提供测试专用 route launcher。收益：解锁 CI smoke 作为 Settings 性能门禁；纯测试改动，零产品风险。**修复必要：是（高，不修则无稳定性能基线）。**

## 6. 已检查但不应误判的点

- **MCP 初始化不是首屏阻塞**：当前 `Presenter.init()` 将 `main:mcp-init` 调度为 background/io task（[`presenter/index.ts`](../../../src/main/presenter/index.ts#L795-L806)），因此不能再把 enabled MCP server 启动描述为窗口创建前的必然阻塞；它是后台长尾风险。复核确认。
- **`registerMainKernelRoutes` 不是大量 `ipcMain.handle` 注册循环**：当前只注册 `DEEPCHAT_ROUTE_INVOKE_CHANNEL` 一个 handler（[`routes/index.ts`](../../../src/main/routes/index.ts#L4162-L4179)），性能关注点应放在 route module/bundle 体积和 runtime dispatch，而不是大量 handler 注册。
- **Workspace watcher 已有基本节流和忽略目录**：忽略 `node_modules/dist/build/.cache/out` 等目录（[`workspacePresenter/index.ts`](../../../src/main/presenter/workspacePresenter/index.ts#L57-L74)），main/renderer 均有 debounce（[`workspacePresenter/index.ts`](../../../src/main/presenter/workspacePresenter/index.ts#L302-L340)、[`useWorkspaceSync.ts`](../../../src/renderer/src/components/sidepanel/composables/useWorkspaceSync.ts#L280-L302)）。大仓库仍建议压测，但当前 E2E 6 次通过。

## 7. 优先级建议

> 优先级综合「风险真实性」「修复收益」「实施成本」三维度，并已采纳本次复核对原排序的调整（F3 提升为启动侧最高收益项）。

1. **先修 E2E Settings hidden route 失败（V1）**：否则 CI smoke 无法提供稳定性能基线。纯测试改动，零产品风险。
2. **启动关键路径减重**：F3 backfill（最高收益，含内存峰值）→ F1 SQLite schema diagnosis/backfill 分层 + lifecycle hook duration 明细 → F2 ACP migration 后移（边际）。
3. **Renderer 首屏减包**：F11 Iconify/provider icon 按需加载（最高收益，数 MB）→ F9 Markdown workers 真正 lazy（~900 KB）→ F10 i18n locale lazy（边际）。
4. **长列表优化**：F15 ChatStatusBar 去 deep watcher（最易实施）→ F13 message upsert 二分/批量排序（超长会话）→ F14 session sidebar fingerprint 改 revision（边际，已有 rAF）→ F16 provider list 虚拟化/折叠。
5. **后台任务/退出长尾治理**：F8 MCP/plugin shutdown timeout + duration → F5 MCP startup soft timeout → F6 protocol handler async/streaming（imgcache/workspace-preview）。
6. **结构性护栏（不当前热点）**：F4 Presenter constructor 轻量化约束。
7. **低优先级**：F7 splash 延迟创建（已有 suppress 机制）。

## 8. 建议新增的性能门禁

- `01-launch --repeat-each=10`：记录 p50/p95 启动到 `app-main` 可见。本次 3 次复现 4.6/4.7/4.1s 已验证路径稳定。
- Settings route smoke 修复后（V1）：`04-settings-navigation --repeat-each=3`，记录 Settings 首屏和 provider page 截图前耗时。
- Synthetic 大数据测试：生成 1k/10k messages、500 sessions，验证 message upsert、sidebar、scroll 的交互耗时（量化 F13/F14 的静态推断）。
- MCP synthetic：配置 3 个 mock MCP server，其中 1 个慢握手，验证 background init 不影响首屏且 shutdown 有总 timeout（量化 F5/F8）。
- Workspace watcher 大仓库测试：在包含 `node_modules/out/dist` 的临时树验证 watcher excludes 和 invalidation debounce。

## 9. 复核结论汇总

| 编号 | 发现 | 验证结论 | 风险真实 | 修复必要 | 关键修正 |
| --- | --- | --- | --- | --- | --- |
| F1 | SQLite 同步 open/建表/迁移/diagnosis | ✅ 准确（行号偏移 1） | 是 | 是 | `DatabaseInitializer.migrate()` 是 no-op stub，真迁移在 SQLitePresenter 构造函数 |
| F2 | ACP migration 在窗口创建前 | ✅ 准确 | 部分 | 边际 | `critical:false` + try/catch，只延迟不阻塞 |
| F3 | backfill fire-and-forget 争抢 | ✅ 准确（低估） | 是 | 是（最高收益） | `SELECT *` 是无界内存全表加载，内存峰值风险 |
| F4 | Presenter 构造同步聚合 | ✅ 准确（结构性） | 部分（潜在） | 边际（护栏） | 当前构造函数不热，是潜在/结构性风险 |
| F5 | MCP 后台长尾/退出 | ✅ 准确 | 是 | 是 | 无 |
| F6 | protocol handler 同步读文件 | ✅ 准确 | 是（imgcache/workspace-preview） | 是 | deepcdn 风险低（内置资源有界） |
| F7 | splash 无条件创建 | ✅ 准确 | 部分 | 边际 | suppress 只抑制可见性，创建成本已发生 |
| F8 | 关闭串行缺观测 | ✅ 准确 | 是 | 是 | stdio 有 2s terminateProcessTree grace（部分缓解） |
| F9 | Markdown workers eager 加载 | ✅ 准确 | 是 | 是 | eager 调用是有意为之（非疏漏） |
| F10 | i18n 全量同步导入 | ✅ 准确 | 部分 | 边际到是 | 实际成本受 Vite 分块影响，未必很大 |
| F11 | Iconify/provider icon 包体 | ✅ 准确 | 是 | 是（高收益） | 无 |
| F12 | 启动重复调度/IPC 峰值 | ⚠️ 部分准确 | 部分（仅 session） | 边际 | provider/model 已自去重，仅 sessionStore 竞态 |
| F13 | 消息 store 排序放大 | ⚠️ 部分准确 | 部分 | 边际到是 | 排序不在每次 upsert，仅 new id/orderSeq；cache 有清理 |
| F14 | sidebar fingerprint/watch | ✅ 准确 | 是（部分） | 边际 | 已有 rAF coalescing |
| F15 | ChatStatusBar watcher 链 | ✅ 准确 | 是 | 是（最易实施） | 无 |
| F16 | Settings provider 页全量渲染 | ✅ 准确 | 是 | 边际到是 | 图标已静态打包，lazy 无收益；真正收益是减行数 |
| V1 | smoke 期待隐藏路由 tab | ✅ 准确 | 是（确定性失败） | 是（高） | 已复现失败 |

**总体**：17 项中 15 项完全准确，2 项（F12、F13）部分准确（表述略有夸大，需按修正收敛）。所有行号引用除 F1 偏移 1 行外全部吻合当前代码。所有构建体积与启动耗时动态证据均已在本机复现。没有发现任何伪造或不成立的发现；复核仅对若干 nuance 做了收敛与补充。
