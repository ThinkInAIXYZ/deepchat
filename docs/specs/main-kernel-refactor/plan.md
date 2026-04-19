# Main Kernel Refactor Plan

## Planning Goal

本计划将原来的“大而全内核重建”收敛为一条更实际的执行路线：

- 先稳住 renderer-main 边界
- 再切一个低风险 pilot slice
- 再拆 chat/session/provider 热路径 owner
- 最后清理迁移过程中产生的桥接和回流

核心原则不是“目录先重排”，而是“每一步都减少真实耦合”。

## Planning Assumptions

- 当前运行时代码仍然是唯一生产实现。
- 现有 `LifecycleManager` 保留，不单独开一个“重写生命周期系统”的 phase。
- 第一轮默认不用 DI container；优先用显式 factory、setup function 和窄 port。
- 只有当 session / window cleanup 真的需要时，才引入最小生命周期 helper。
- 每个 phase 必须伴随真实 slice 切换，避免连续 foundation-only PR。

## Current Hotspots

当前优先级最高的热点：

- `src/renderer/src/composables/usePresenter.ts` 使 renderer 直接感知 presenter 名称与反射调用协议
- `src/preload/index.ts` 同时承载多入口桥接和旧兼容 API
- `src/main/presenter/index.ts` 同时承担 composition root、service locator、IPC dispatcher
- `SessionPresenter` 仍直接回拿全局 `presenter`
- `AgentSessionPresenter`、`AgentRuntimePresenter`、`LLMProviderPresenter` 之间仍存在主路径直连
- `eventBus.ts` 同时承担 main 内部通知和 main -> renderer 广播

## Target State For This Program

本轮结束时，目标不是完整 clean architecture，而是让主链路至少具备以下形态：

```text
renderer component / store
  -> renderer/api/*Client
  -> window.deepchat
  -> shared/contracts/routes + events
  -> main handlers / orchestrators for migrated slices
  -> narrow ports / adapters around provider, session, permission, scheduler
```

允许保留：

- `src/main/presenter/` 目录
- 现有 `LifecycleManager`
- 非 migrated path 的 legacy presenter

但不允许：

- 在 migrated path 上继续新增 `usePresenter()` / raw renderer IPC
- 在新 hot path 上继续通过 presenter 互相找彼此
- 继续把 cleanup / cancel / timeout 塞进匿名回调和散落 timer

## Migration Rules

### Allowed

- 先定义 contract / client / typed event，再迁一条真实调用链
- 保留旧 owner 作为过渡入口，但只允许单向转发到新实现
- 为测试目的先引入 fake scheduler、fake provider adapter、fake route registry
- 用现有 presenter 包住旧依赖，只要新逻辑不反向依赖它

### Forbidden

- 为了“未来可能会用”而提前大搬目录
- 引入完整 DI container 再慢慢找 slice 迁移
- 用新的 IPC 包装 main 内部互调
- 在 hot path 上继续新增 presenter-to-presenter 直接依赖
- 同一条用户路径长期保留新旧双 owner

## Phase Map

```text
P0 Guardrails & Baseline
  -> P1 Typed Boundary Foundation
  -> P2 Settings Pilot Slice
  -> P3 Chat & Session Hot Path
  -> P4 Provider / Tool Boundary
  -> P5 Consolidation & Re-evaluation
```

## Phase Details

### Phase 0: Guardrails & Baseline

目标：

- 冻结错误方向
- 让后续阶段能证明“legacy 指标净下降”

交付物：

- 扩展 `architecture-guard`
- 扩展 baseline 脚本
- 追踪 `usePresenter`、`window.electron`、`window.api`、hot path direct dependency、raw timer、raw channel
- 定义 bridge register 和轻量 scoreboard

退出条件：

- 能阻止新增 `usePresenter()`、新增 raw renderer IPC、新增 migrated path raw channel
- 能重复生成基线
- 能看出 hot path direct dependency 是否下降

### Phase 1: Typed Boundary Foundation

目标：

- 让 renderer 调用 main 的方式先稳定下来

交付物：

- `shared/contracts/routes`
- `shared/contracts/events`
- preload bridge builder 或统一 bridge registration 机制
- `renderer/api/*Client`
- 第一批 typed route：settings、sessions/chat 必需入口、系统窗口入口

退出条件：

- 新增功能不再通过 `usePresenter()` 接入
- migrated path 的 renderer 调用能从 route registry 追踪
- typed event 能承接 settings / sessions / chat 的首批 UI 通知

### Phase 2: Settings Pilot Slice

目标：

- 选择低风险、行为可观察的 slice 验证新边界是否真的好用

交付物：

- `SettingsClient`
- settings contract / handler / adapter
- settings store 调整为 client-first
- typed `settings.changed` event

退出条件：

- settings 主读写链路不再依赖 `usePresenter()` 或 raw IPC
- 设置持久化和变更通知具备独立测试
- 对应 bridge 无超期残留

### Phase 3: Chat & Session Hot Path

目标：

- 拆掉最关键的 owner 混杂点
- 让发送消息、停止流、恢复会话的执行链更可解释

交付物：

- `ChatService` / orchestrator
- `SessionService` 或等价 session orchestration 层
- 最小必要 port：`SessionRepository`、`MessageRepository`、`ProviderExecutionPort`、
  `ProviderCatalogPort`、`SessionPermissionPort`、`WindowEventPort`、`Scheduler`
- typed chat/session events
- cancel / timeout / retry 通过 `Scheduler` 管理

退出条件：

- 发送消息、停止流、恢复会话的 migrated path owner 明确
- `AgentSessionPresenter -> AgentRuntimePresenter` 不再是 migrated path 的主 owner 链
- migrated path 的 cleanup / cancel 行为可测试

### Phase 4: Provider / Tool Boundary

目标：

- 把 provider/tool 相关主协作从 presenter 互调中抽出来

交付物：

- `ProviderExecutionPort`
- `ProviderCatalogPort`
- `ProviderSessionPort` 或仅限 ACP/会话配置所需的 provider session adapter
- `SessionPermissionPort`
- tool / permission 的明确响应 contract

退出条件：

- migrated path 上 `SessionPresenter` / `AgentSessionPresenter` / `AgentRuntimePresenter`
  不再直接把 provider 当作全局协作者乱用
- provider query / execution / permission 边界可单测
- 相关 renderer 交互走 typed route / typed event

### Phase 5: Consolidation & Re-evaluation

目标：

- 清理本轮新增 bridge
- 更新基线和文档
- 判断是否还需要下一轮更彻底的 kernel 重构

交付物：

- 删除 migrated path 临时桥接
- 收敛 docs、baseline、scoreboard、smoke 记录
- 形成“是否继续做全量 kernel 重构”的结论

退出条件：

- 本轮涉及 slice 的 bridge register 归零
- migrated path 的 legacy 指标较起点净下降
- 本轮目标路径具备稳定测试和 smoke 证据

## Cross-Cutting Streams

所有阶段都同步处理：

- guardrail 更新
- baseline 更新
- 文档同步
- bridge register / scoreboard 维护
- 针对 migrated path 的测试补齐
- 对旧 owner 的冻结和清理

## Recommended PR Sequence

1. `chore(architecture): tighten guards and baselines for boundary stabilization`
2. `refactor(ipc): add typed route registry and renderer clients`
3. `refactor(settings): migrate settings to typed boundary`
4. `refactor(chat): introduce chat/session orchestration and scheduler`
5. `refactor(providers): narrow provider and permission boundaries`
6. `refactor(architecture): remove temporary bridges and refresh docs`

## Risk Notes

- 最大风险仍然是“多搭一层新框架，但旧 owner 一点没退”。
- 另一类风险是把 phase 2 之前的基础工作拖太久，导致迟迟不切真实 slice。
- `Chat / Session / Provider` 三块最耦合，不应并行乱切；建议按 owner 顺序推进。
- 如果某个阶段不得不引入桥接，必须在下一阶段优先删除，而不是留到“最后统一收尾”。
