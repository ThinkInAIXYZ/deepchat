# 实施计划

## 架构与数据流

```text
ChatMainApp              ChatTabView              ChatPage
shell-mounted            bootstrap / route        session viewport marks
app-stores-ready          interactive / deferred          │
      └──────────────────────────┬─────────────────────────┘
                                 ▼
                    renderer performance reporter
                 (allowlist + elapsed + terminal dedupe)
                                 ▼ typed route
                       main performance log service
                  (schema parse + loggingEnabled gate)
                                 ▼
       <userData>/logs/renderer-performance.ndjson (NDJSON)
```

### 1. 共享 contract 与 typed client

在 `shared/contracts/routes/performance.routes.ts` 定义 renderer 性能记录输入/输出 schema，并注册到 routes union。输入使用 allowlisted enums 与严格 object，禁止自由文本、错误 payload 和任意 metadata。`renderer/api/PerformanceClient.ts` 仅调用该 typed route。

这不是 feature-aggregate bridge：它是现有 `renderer/api/*Client` transport 模式下的单一诊断端口。

### 2. 主进程持久化 owner

新增 app-local `RendererPerformanceLogService`：

- 用 SettingsStore 读取 `loggingEnabled`；关闭时 no-op；
- 通过 `app.getPath('userData')` 写入既有 `logs/`；
- 将每条 schema 已校验记录转成 server timestamp 后 append 到 `renderer-performance.ndjson`；
- Promise 队列序列化追加，防止并发 IPC 交错；
- 限制单文件行的 JSON 字段，不记录用户标识或应用状态原文；
- 捕获 mkdir/append 失败，并避免将失败扩散到 renderer。

`createAppRoutes` 注入一个窄的 `recordRendererPerformance` port；route 解析 input 后 await 该 port，再返回 `{ accepted: boolean }`。记录失败统一返回 false，不使性能诊断影响业务 flow。

### 3. Renderer platform reporter

新增 `platform/performance/rendererPerformance.ts`，而不是将跨 app runtime 逻辑放在 feature：

- renderer 内以 monotonic `performance.now()` 建立 phase elapsed，API 缺失时安全 no-op；
- `recordStartupPhase` 由 app/route shell 使用，允许固定 stage 与 fallback；
- `observeStartupWorkload` 消费当前 store state，terminal `(runId, taskId)` 最多记录一次，并记录已有时间戳计算的耗时；
- `recordChatSessionPhase` 接收既有 allowlisted ChatPage phase 和 epoch，绝不接收 session ID；
- 所有 async submit 都 catch，开发/已启用日志下仅输出固定安全前缀的 console warning；不持有 Vue/Pinia，也不创建 listener。

reporter 以实例方式在 `ChatMainApp` 创建，避免跨 renderer 共享状态。它只在已加载 settings 且 `loggingEnabled` 开启时提交；Performance Timeline marks 保持始终低成本、独立可用。

### 4. 接入与生命周期

- `ChatMainApp` 创建 reporter，mark `shell-mounted`，等待 `initAppStores()` 后启用 recorder、mark `app-stores-ready`，并观察 main startup tasks；unmount 停止 observer / 清空引用。
- `ChatTabView` 接收可选 startup reporter 或使用 app-scoped injection，记录 bootstrap success/fallback、route ready、interactive、deferred settled。`startupRunId` 只来自 bootstrap response。
- ChatPage 保留 feature-private `performance.mark`，改为将 safe phase/epoch 交给 injected/feature adapter，不传递 `sessionId` 到持久化链路。

若 injection 会扩大测试装配复杂度，则使用 platform scoped registration with explicit cleanup in app shell；不得变为 Pinia singleton 或跨 renderer 共享实例。

### 5. 测试策略

- `RendererPerformanceLogService` main unit tests：关闭不写、有效记录写一行并带 recordedAt、顺序稳定、写失败不 reject。
- route tests：input validation、accepted result、窄 port 调用。
- renderer platform unit tests：阶段 elapsed、日志关闭/缺 API、workload terminal dedupe、无敏感输入 API。
- `ChatTabView` startup suite：bootstrap/fallback/interactive/deferred phase 关系。
- ChatPage tests：现有 marks 保留，新增 reporter 不接收 session ID。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 诊断本身拖慢启动 | renderer 不等待 submit；main 写入队列独立；失败吞掉 |
| 记录包含敏感信息 | strict schema + 不暴露自由 metadata + main 二次 parse |
| 多窗口互相污染状态 | reporter 实例由各 app shell 自己创建，run id 随记录传递 |
| workload event 重放导致重复记录 | terminal key 使用 runId/task id/updatedAt |
| 文件并发写损坏 NDJSON | main service 单队列 append |

## 验证命令

```bash
pnpm exec vitest --config vitest.config.renderer.ts test/renderer/lib/rendererPerformance.test.ts test/renderer/components/ChatTabView.test.ts
pnpm exec vitest --config vitest.config.ts test/main/app/rendererPerformanceLogService.test.ts test/main/app/routes.test.ts
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run test:renderer
pnpm run architecture:renderer-baseline:check
```
