# 修复 F5：MCP 后台启动 soft timeout + 扩展状态事件

## 目标
- 为 MCP 启动补一层 **soft timeout**，避免慢 server 把后台初始化长时间拖在单个连接上。
- 保留现有 **5 分钟 hard timeout** 作为最终失败兜底；soft timeout 只负责“尽快放行启动编排”。
- 明确扩展 per-server 状态事件结构，支持 `connecting` / `timeout` / `retrying` / `connected` / `failed`，而不是继续复用当前 `running/stopped` 布尔态。
- 明确 soft timeout 后的 server/client 生命周期，以及它与 shutdown 的交互边界。

## 定位
- `initializeMcp()` 已通过 `startupWorkloadCoordinator.scheduleTask({ id: 'main:mcp-init', phase: 'background', resource: 'io' })` 进入后台任务，因此当前问题不再是首屏被 MCP 同步阻塞，而是后台初始化长尾过长。[`src/main/presenter/index.ts#L795`](../../../src/main/presenter/index.ts#L795)
- `McpPresenter.initialize()` 会先串行做 npm registry 探测，再启动 custom prompts server，随后对 `enabledServers` 使用 `for...of + await` 串行 `startServer()`；单个慢连接会线性拖长总耗时。[`src/main/presenter/mcpPresenter/index.ts#L157`](../../../src/main/presenter/mcpPresenter/index.ts#L157) [`src/main/presenter/mcpPresenter/index.ts#L195`](../../../src/main/presenter/mcpPresenter/index.ts#L195)
- `McpPresenter.shutdown()` 当前仍是串行遍历 running clients 并逐个 `await this.stopServer(...)`；若某个 client 正处于慢连接或慢关闭链路，shutdown 会被拖住。[`src/main/presenter/mcpPresenter/index.ts#L240`](../../../src/main/presenter/mcpPresenter/index.ts#L240)
- `ServerManager.startServer()` 在创建 `McpClient` 后立即 `await client.connect()`；只要 connect 抛错，就会执行 `clients.delete(name)` 并记录 last error。现状没有“soft timeout 后保留 client 持续后台连接”的语义空间。[`src/main/presenter/mcpPresenter/serverManager.ts#L222`](../../../src/main/presenter/mcpPresenter/serverManager.ts#L222)
- `McpClient.emitServerStatusChanged()` 当前只发送 `{ status: 'running' | 'stopped', isRunning: boolean }`，并同步发布 deepchat 事件里的 `isRunning` 布尔态。这个事件结构无法直接表达 `connecting`、`timeout`、`retrying`、`failed` 等中间态，因此本项必须扩展事件 contract，而不是“复用现有布尔态”。[`src/main/presenter/mcpPresenter/mcpClient.ts#L164`](../../../src/main/presenter/mcpPresenter/mcpClient.ts#L164)
- `McpClient.connect()` 目前只有单层 `Promise.race(connectPromise, timeoutPromise)`，timeout 固定 5 分钟；连接成功后发 `running`，没有 soft timeout、没有 startup retry、也没有中间状态事件。[`src/main/presenter/mcpPresenter/mcpClient.ts#L467`](../../../src/main/presenter/mcpPresenter/mcpClient.ts#L467)
- `McpClient` 现有恢复逻辑只覆盖“已建立会话后出现 session error”场景：`checkAndHandleSessionError()` 会 cleanup 并允许后续再连，但不是启动阶段自动 retry，更不会在 startup timeout 后继续后台重试。[`src/main/presenter/mcpPresenter/mcpClient.ts#L933`](../../../src/main/presenter/mcpPresenter/mcpClient.ts#L933)

### 根因
- 现状只有 **5 分钟硬超时**，缺少“先放行初始化、慢 server 后续再处理”的 soft/hard 分层，因此单个 server 的最坏启动等待就是 5 分钟。
- `enabledServers` 启动是串行的，多个慢 server 会把长尾线性叠加。
- 状态事件只有 `running/stopped` 布尔语义，UI/日志/调度层都无法区分“正在连接”“soft timeout 后后台重试”“最终失败”等状态，导致方案无法只靠现有事件落地。
- `ServerManager.startServer()` 的失败路径会立刻删 client；如果 soft timeout 仍按“抛错即清理”的现状处理，就等于把 soft timeout 当 hard failure，无法实现“放行编排但保留后台连接”。
- shutdown 只会 stop 当前 running clients；若引入启动期后台 retry/慢连接但不定义其生命周期与 shutdown 行为，退出路径会继续出现不可控长尾。

## 修复方案
### 4.1 明确采用 soft/hard 两层 timeout
- 保留现有 **5 分钟 hard timeout** 作为最终失败兜底，不改其职责。
- 新增 **startup soft timeout**：仅用于应用启动/初始化场景，达到阈值后立即把该 server 标记为“慢启动”，并让初始化编排继续处理其他 server。
- soft timeout 值当前没有现网分布、registry 10s 探测耗时分布或 npm 安装耗时统计支撑，因此应表述为 **待压测确定的参数**；初始建议值可先取 **45s**，后续通过压测与样本日志再调。

### 4.2 扩展状态事件 contract，不复用布尔态
- 需要新增一个明确的 server lifecycle 状态枚举，例如：
  - `connecting`
  - `timeout`
  - `retrying`
  - `connected`
  - `failed`
  - `stopped`
- 推荐把 `MCP_EVENTS.SERVER_STATUS_CHANGED` 的 payload 从当前 `{ status: 'running' | 'stopped', isRunning: boolean }` 扩展为结构化对象，例如包含：
  - `name`
  - `lifecycleStatus`
  - `isRunning`（可保留作兼容字段，但不再承载全部语义）
  - `phase?: 'startup' | 'manual' | 'retry' | 'shutdown'`
  - `attempt?: number`
  - `reason?: 'soft-timeout' | 'hard-timeout' | 'connect-error' | 'shutdown'`
- deepchat 事件 `mcp.server.status.changed` 也需同步扩展，避免 renderer / 日志 / 诊断各自猜测布尔态含义。
- 兼容策略建议：短期可保留 `isRunning` 供旧消费方读取，但新增逻辑统一读取新的枚举状态；文档中不要再写“复用 running/stopped 表示 connecting/timeout”。

### 4.3 soft timeout 后保留 client，推荐转入后台 retrying
- 推荐方案：**soft timeout 不执行现有失败清理路径**，而是保留已创建的 `McpClient`，将其标记为 `timeout -> retrying`，让底层连接继续在后台完成或进入受控 retry。
- 不推荐把 soft timeout 直接映射到 `cleanupResources()` / `clients.delete(name)`：那会把体验层的“超时放行”误当成真实失败，导致每次慢启动都被重置，既无法后台连上，也与现有 `ServerManager.startServer()` 的 hard failure 语义混淆。
- 为了落地这一点，需要把启动结果拆成至少两类：
  1. **hard failure**：连接明确失败或命中 5 分钟硬超时，沿用删除 client、记录 last error、发 failed 的路径。
  2. **soft timeout**：启动编排层收到“先放行”的结果，但 client 仍保留在 manager 中，状态为 `retrying` 或 `connecting-slow`，后续由 client 自身或 presenter 调度器继续完成连接。
- 推荐实现方向：
  - `client.connect()` 返回可区分 `connected` / `soft-timeout-released` / `failed` 的结果，而不是只靠 throw。
  - `serverManager.startServer()` 只在 hard failure 时删除 client；soft timeout 时保留 client 引用并更新状态。
  - 若后台最终连上，再发 `connected`；若后台最终命中 hard timeout 或真实错误，再转 `failed` 并清理。

### 4.4 启动 retry 与 shutdown 的交互
- 当前代码没有 startup retry；如果本项要支持 soft timeout 后“后台继续连”，就必须显式补一层启动阶段 retry / completion 管理，而不是误用 session error 恢复逻辑。
- retry 形态建议：
  - 对“连接仍在进行中”的场景，优先允许原 connect promise 继续跑完，不要重复发起并行 connect。
  - 只有在原连接明确失败后，才进入下一次延迟 retry。
  - retry 间隔建议作为 **待压测确定的参数**；初始可用固定退避或小规模指数退避。
- shutdown 必须与该机制配套：
  - 若 client 处于 `connecting` / `retrying`，shutdown 不能只看 `getRunningClients()` 的已运行集合，否则这些慢 client 可能绕过停服逻辑。
  - 推荐把 shutdown 扩展为处理“running + connecting/retrying”两类 active clients，并对 stop / cancel connect 设独立超时兜底。
  - 若底层连接仍在进行，shutdown 应优先设置取消标记/中断后续 retry，再执行 disconnect/cleanup；避免应用退出后后台仍残留连接任务。
- 这也意味着 F5 与 F8 存在交叉：F8 的 shutdown timeout 需要覆盖“慢关闭”，F5 还要额外覆盖“慢连接拖住 shutdown”的场景。

### 4.5 启动并发改为待测参数，初始建议 2–3
- `enabledServers` 当前串行启动，长尾最差；推荐改为 **受限并发**。
- 并发值同样缺少真实分布支撑，不应写成拍脑袋常量结论。建议表述为：
  - **待压测确定的参数**；
  - 初始建议取 **2–3**；
  - server 数少（1–2 个）时并发收益有限，可保持等于 server 数；
  - server 数较多、且存在 npm 包安装/子进程启动/网络探测时，优先从 2 起测，资源更宽裕的机器再看 3。
- 即使并发参数暂不落地，soft timeout + 扩展状态事件也应先做，因为它们直接决定“不会被单个 5 分钟连接卡住”这件事。

## 验证
- 代码层验证：确认状态事件 contract 已从布尔态扩展为枚举态，至少能区分 `connecting`、`retrying`、`connected`、`failed`、`stopped`。
- 启动体验验证：构造 1 个慢 server + 1 个正常 server，确认慢 server 命中 soft timeout 后不会阻塞其他 server 的启动编排，且状态可见为 `timeout/retrying`。
- 生命周期验证：确认 soft timeout 后 `ServerManager` 不会立刻删除该 client；后台最终连接成功时会转 `connected`，最终真实失败时才转 `failed` 并清理。
- shutdown 专项验证：构造“连接阶段卡住”的 server，确认应用关闭时不会因为慢连接无限拖住；需要专门验证 shutdown 会处理 `connecting/retrying` client，而不只是已运行 client。
- 并发验证：在 1、2、4+ server 组合下对比串行与受限并发，记录总启动耗时、子进程峰值/CPU/网络占用，作为 2–3 默认值选择依据。
- 基础校验：本次为文档修订，不执行代码命令；实施验收时按仓库规范执行 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`。

## 风险
- 扩展状态事件会触及 main/renderer/event 消费链；若仅新增生产端、不改消费端，UI 仍可能停留在旧的 `running/stopped` 语义。
- soft timeout 后保留 client 虽然能避免重复冷启动，但会引入“半连接中”状态管理复杂度；必须明确 manager 如何识别 active client、何时允许 stop/cancel。
- 若 shutdown 仍只处理 running clients，后台 retry/慢连接会成为新的退出长尾来源，因此 F5 不能只改启动、不补 shutdown 交互说明。
- 45s 与并发 2–3 目前都只是初始建议，不应在实施前宣称为最终最优值；需要以压测或样本日志校准。
- 保留 5 分钟 hard timeout 是为了兼容现有最慢路径与真实失败判定；若未来掌握更细的 transport/registry 分布，可再按 transport 类型分层调参。