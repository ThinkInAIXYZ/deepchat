# Main Kernel Refactor Plan

## Planning Goal

本计划定义从当前 `presenter` 主导结构，迁移到 `Clean Main Kernel + Typed Bridge`
的执行顺序。核心原则不是一次写完，而是按 vertical slice 做“先立新边界，再切主链路，最后删旧层”。

## Planning Assumptions

- 当前运行时代码在计划阶段仍然是唯一生产实现。
- 每个阶段都必须先建立 guardrail，再做切换，再删旧路径。
- 不把“后续会删”当作放宽标准的理由。
- 允许临时 bridge，但 bridge 必须有删除时点，且不能承载新增业务逻辑。
- preload 暴露层应尽量稳定，新增跨进程能力主要通过补 route registry 和 handler 完成。

## Current Hotspots

需要优先治理的现状热点：

- `src/main/presenter/index.ts` 仍承担过重的 composition root 职责。
- `src/renderer/src/composables/usePresenter.ts` 让 renderer 继续深度依赖 presenter naming 和调用协议。
- `src/preload/index.ts` 同时承担多种桥接职责，且 renderer 侧还存在 `window.api` 与 `window.electron` 双入口。
- `src/main/eventbus.ts`、`src/main/events.ts` 与各 renderer store/component 之间存在大量隐式事件链。
- timeout 与 listener cleanup 分散在 main / preload / renderer 多处路径。

## Target Architecture

```text
src/
  shared/
    contracts/
      routes.ts
    events/
    errors/
  main/
    bootstrap/
      createAppKernel.ts
      registerLifecycle.ts
      createMainWindow.ts
    di/
      serviceIds.ts
      Scope.ts
    ipc/
      IpcRouter.ts
      routes/
    app/
    domain/
    ports/
    infra/
    platform/electron/
  preload/
    createBridge.ts
    index.ts
  renderer/
    api/
```

固定依赖方向：

```text
renderer -> preload -> shared/contracts -> main/ipc -> main/app
         -> main/domain + main/ports -> main/infra/platform
```

## Bridge Model

本轮采用以下边界模型：

```text
renderer component / store
  -> renderer/api/*Client
  -> window.deepchat
  -> shared/contracts/routes.ts
  -> main/ipc/registerRoutes
  -> main/app/*Service
  -> main/ports
  -> main/infra / platform/electron
```

关键约束：

- `window.deepchat` 是稳定 capability facade，不是 presenter 替身
- capability facade 从 shared route registry 生成，不靠 preload 手写散落 wrapper
- renderer 业务代码优先依赖 `renderer/api` client，而不是直接触碰 bridge 细节
- main 内部 service/repository 名称不进入 bridge API 名称
- 后续若引入插件扩展，也应优先走 contribution registry，而不是继续扩张 bridge surface

## Migration Governance

实施过程必须遵守 [migration-governance.md](./migration-governance.md)。

这里直接强调四条执行纪律：

1. 同一条用户路径只能存在一个 active owner
2. bridge 只能单向 `old -> new`
3. bridge 默认最多存活 1 个 phase
4. phase 完成必须看到 legacy 指标净下降

## Migration Rules

### Allowed

- 先引入新 contract / client / service，再将旧入口导向新实现
- 先切单个 slice，再扩展到相邻 slice
- 用 fake port / in-memory adapter 为测试先行铺路
- 用同一份 route registry 同时驱动 preload bridge 与 main route registration

### Forbidden

- 在旧 presenter 上继续长新分支
- 在 renderer 新增任何 `usePresenter()` 调用点
- 在 renderer 新增 `window.electron.ipcRenderer.*` 监听
- 在组件或 store 中直接拼裸 channel 字符串
- 在 `window.deepchat` 中暴露 repository、presenter、sqlite 这类内部对象名
- 在业务层新增裸 timer
- 为了“先过”而保留长期双栈逻辑

## Phase Map

```text
P0 Guardrails & Baseline
  -> P1 Typed Contracts & Preload Bridge
  -> P2 Main Kernel & Scoped DI
  -> P3 Settings Pilot Slice
  -> P4 Sessions & Event Store
  -> P5 Chat Runtime Cutover
  -> P6 Providers & Tools Boundary
  -> P7 Legacy Removal & Final Cleanup
```

## Phase Details

### Phase 0: Guardrails & Baseline

目标：

- 冻结错误方向，避免项目在重构期间继续加重旧依赖
- 形成可重复更新的客观基线

交付物：

- 扩展 `scripts/architecture-guard.mjs`
- 扩展 `scripts/generate-architecture-baseline.mjs`
- 新增本次重构的文档集
- 补充针对 renderer/preload/main 边界的检查项
- 明确 `window.deepchat` 命名和粒度约束

退出条件：

- 能稳定检测新增 `usePresenter`、新增 direct IPC、新增裸 timer、新增 renderer -> electron 依赖
- 能稳定检测新增裸 channel 字符串和 bridge 内部实现名泄漏
- 当前基线报告可重跑，可用于后续阶段比对

本阶段不做：

- 不做业务切换
- 不引入大规模目录搬迁

### Phase 1: Typed Contracts & Preload Bridge

目标：

- 让 renderer 只依赖 typed bridge，而不是直接知道 presenter 名称或 `ipcRenderer`
- 让跨进程 API 由 route registry 统一驱动，而不是到处手写 wrapper

交付物：

- `src/shared/contracts/routes.ts`
- route registry 与 schema
- `src/preload/createBridge.ts`
- `src/preload/index.ts` 的 generated typed facade
- `src/renderer/api/*Client`
- 首批 route group：`chat`、`session`、`settings`、`window/system`

退出条件：

- 新增功能不再通过 `usePresenter()` 接入
- renderer 有明确的 client 使用入口
- route registry 成为跨进程 API 的唯一事实源
- 旧 bridge 只作为迁移对象，不再扩张

本阶段不做：

- 不直接迁移复杂业务逻辑
- 不删除 presenter 运行时

### Phase 2: Main Kernel & Scoped DI

目标：

- 建立唯一 composition root 与显式生命周期

交付物：

- `createAppKernel.ts`
- `SERVICE_IDS`
- `Scope` / child scope / dispose 机制
- `app` / `window` / `session` 的 scope 约定
- main bootstrap 与 BrowserWindow 创建解耦

退出条件：

- 新服务可通过 scope 获取依赖，不再依赖全局 presenter locator
- window/session 生命周期的 owner 清晰

本阶段不做：

- 不在此阶段一口气迁移全部业务 slice

### Phase 3: Settings Pilot Slice

目标：

- 选择风险最低、行为最可观察的 slice 验证新架构链路

交付物：

- `SettingsService`
- `SettingsRepository` port
- 对应 contract、IPC route、renderer client 调用
- 与 renderer store 的最小替换闭环

退出条件：

- settings 相关 renderer 调用不再依赖旧 presenter
- 设置读写、事件通知、持久化路径在新链路下可验证

本阶段不做：

- 不把 settings 扩张成通用“先全量重写其他模块”的借口

### Phase 4: Sessions & Event Store

目标：

- 重建会话生命周期，给恢复、调试、审计提供稳定状态面

交付物：

- `SessionService`
- `CreateSessionUseCase`
- `RestoreSessionUseCase`
- `SessionEventStore`
- session 路由与 `SessionClient`

退出条件：

- 新 session 创建、恢复、切换具备新 service 路径
- 关键 session state 变化可追踪、可回放、可测试

本阶段不做：

- 不在 event store 还未稳定前删掉必要的兼容读路径

### Phase 5: Chat Runtime Cutover

目标：

- 用 `ChatService` / `UseCase` 替换核心消息发送与流式运行时

交付物：

- `ChatService`
- `SendMessageUseCase`
- `StreamAssistantReplyUseCase`
- stream cancellation / timeout / retry 的 `Scheduler` 接口化
- typed stream event contract

退出条件：

- 发送消息、流式回复、中断流、工具回调主链路走新架构
- 对应 presenter runtime 不再是主执行入口

本阶段不做：

- 不在 chat 切换未稳定前同时引入新的外部扩展机制

### Phase 6: Providers & Tools Boundary

目标：

- 把 provider/tool/MCP 边界从 presenter 体系中剥离，为内部职责清晰和测试隔离铺路

交付物：

- `ProviderService` / `ProviderRegistry`
- `ToolService` / `ToolExecutor`
- provider/tool port 定义
- rate limit、permission、tool execution 的边界整理

退出条件：

- provider 切换、工具执行、MCP 相关主路径可以通过 service + port 推理
- presenter 不再是 provider/tool 的唯一协调者

本阶段不做：

- 不在边界未清晰前扩展新的外部扩展机制

### Phase 7: Legacy Removal & Final Cleanup

目标：

- 删除旧层，结束双轨状态

交付物：

- 删除活跃 `src/main/presenter` 运行时依赖
- 删除 `usePresenter()` 主链路依赖
- 删除 `window.electron` / `window.api` 旧入口
- 删除散落字符串 IPC constants
- 更新架构文档为新主链路

退出条件：

- 新架构是唯一活跃路径
- 旧 presenter 不再参与运行时
- baseline 指标达到最终目标

本阶段不做：

- 不保留“以后可能还会用”的 dormant legacy source

## Cross-Cutting Streams

所有阶段都要同步处理以下横切事项：

- 文档：更新 spec / tasks / baselines / active architecture docs
- 测试：为新引入的 service、route、bridge、scope 提供对应测试
- 安全：renderer 不直接拿 Electron 原语
- 可观测性：关键事件、超时、取消、错误要能定位
- 清理：每完成一个 slice，立即删除该 slice 上不再需要的桥接逻辑
- API 设计：bridge 按 capability 分组，组件通过 client 层调用，不暴露内部实现名
- 治理：更新 bridge register、scoreboard 和阶段退出状态

## Recommended PR Sequence

1. `chore(architecture): extend guardrails for main kernel refactor`
2. `refactor(ipc): add typed contracts and renderer client foundation`
3. `refactor(main): introduce app kernel and scoped dependency container`
4. `refactor(settings): migrate settings to service and typed bridge`
5. `refactor(sessions): migrate session lifecycle and event store`
6. `refactor(chat): cut over chat runtime to services`
7. `refactor(providers): isolate provider and tool boundaries`
8. `refactor(main): remove legacy presenter runtime`

## Risk Notes

- 最大风险不是“技术写不出来”，而是阶段边界失控导致半新半旧结构长期共存。
- chat/runtime/provider/tool 四块耦合最深，必须在 settings/session 验证完基础链路后再切。
- 如果后续要做插件化，也必须建立在 provider/tool 边界已经收口的前提上，但这不属于本轮交付。
- 如果某阶段需要引入临时 adapter，必须在 `tasks.md` 中写出删除任务，不能口头记忆。
