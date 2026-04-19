# Main Kernel Refactor Acceptance

## Acceptance Model

本项目采用双层验收：

- 阶段验收：每个 phase 都必须独立通过
- 最终验收：所有阶段完成后，再检查本轮“边界稳定化”目标是否达成

本轮验收重点不是“新目录是否漂亮”，而是：

- migrated path 是否更稳定
- owner 是否更清楚
- 测试是否更容易写

## Phase Gate Rules

每个阶段都必须同时满足以下条件：

1. 该阶段定义的真实 slice 或主路径切换已经完成
2. 该阶段引入的 bridge 已登记 `deleteByPhase`
3. 该阶段要求的自动化验证已通过
4. 该阶段要求的 smoke 验证已通过
5. legacy 指标相对上一阶段净下降，或至少没有反弹

## Governance Hard Requirements

以下要求来自 [migration-governance.md](./migration-governance.md)，属于硬门槛：

- 同一条用户路径只能有一个 active owner
- bridge 只能单向 `old -> new`
- foundation 工作不能连续多轮脱离真实 slice
- 旧实现一旦进入迁移阶段即冻结
- migrated path 完成后必须看到可证明的耦合净下降

## Phase Acceptance Criteria

### Phase 0: Guardrails & Baseline

- 能阻止新增 `usePresenter()`、新增 raw renderer IPC、新增 migrated path raw channel
- 能输出 renderer / preload / hot path 相关趋势基线
- bridge register 和 scoreboard 模板可用

### Phase 1: Typed Boundary Foundation

- 存在统一的 shared route registry
- 存在 typed event catalog，至少覆盖 settings / sessions / chat 首批事件
- preload bridge 和 `renderer/api` client 已能驱动首批主路径
- 新增功能不再依赖 `usePresenter()` 接入

### Phase 2: Settings Pilot Slice

- settings 主读写链路走新 contract + client + handler
- settings 相关 renderer/store 不再依赖旧 presenter 作为主入口
- settings 变更通知通过 typed event 可追踪

### Phase 3: Chat & Session Hot Path

- session create / restore / activate 中至少主路径 owner 已明确
- 发送消息、停止流主链路走显式 orchestration，而不是继续靠 presenter 互调
- timeout / retry / cancel 通过 `Scheduler` 管理
- migrated path 上的 cleanup 行为可测

### Phase 4: Provider / Tool Boundary

- provider query / execution / session 配置边界具备明确 port 或 adapter
- permission / tool response 通过明确 contract 或 typed event 处理
- migrated path 上 presenter 对 provider 的直接依赖已降到可解释范围

### Phase 5: Consolidation & Re-evaluation

- 本轮新增 bridge 已删除
- 文档、baseline、scoreboard、smoke 记录已同步
- 已形成“是否继续做下一轮更彻底 kernel 重构”的结论

## Final Acceptance Checklist

### Boundary

- [ ] migrated path 的 renderer 调用统一走 `renderer/api` + `window.deepchat`
- [ ] migrated path 不再新增 `usePresenter()`、`window.electron`、`window.api` 依赖
- [ ] migrated path 的 route 和 typed event 都能在共享 registry / catalog 中追踪
- [ ] 组件和 store 不直接拼新的 raw channel 字符串

### Runtime Ownership

- [ ] settings、chat、session、provider 这些 migrated path 都有明确 owner
- [ ] `AgentSessionPresenter -> AgentRuntimePresenter` 不再是 migrated chat path 的主 owner 链
- [ ] provider query / execution / permission 边界可解释，不依赖全局隐式协作
- [ ] session / stream / permission cleanup 有明确 owner

### Lifecycle and Scheduling

- [ ] cancel、timeout、retry 在 migrated chat path 上走 `Scheduler`
- [ ] window/session 相关 listener、subscription、abort controller 的清理可验证
- [ ] 现有 `LifecycleManager` 或等价 setup 模块中，migrated path 的装配关系是可读的

### Cleanup

- [ ] 本轮涉及的临时 bridge 已按计划删除
- [ ] 对应 slice 的旧 owner 已冻结，不再继续长新逻辑
- [ ] hot path 直连依赖相较基线净下降
- [ ] 本轮不要求 `src/main/presenter` 目录归零，但 migrated path 不再依赖它的旧协作方式

### Quality

- [ ] route / client / service / scheduler / provider boundary 具备对应测试
- [ ] `pnpm run format`、`pnpm run i18n`、`pnpm run lint`、`pnpm run typecheck` 通过
- [ ] baseline、tasks、test-plan、README 已同步更新

### User-Visible Behavior

- [ ] 修改设置正常
- [ ] 创建会话正常
- [ ] 恢复会话正常
- [ ] 发送消息正常
- [ ] 流式回复正常
- [ ] 停止流正常
- [ ] provider 相关关键交互正常
- [ ] 权限交互正常

## What Is Not Required For Sign-Off

以下内容不属于本轮最终签收硬门槛：

- `src/main/presenter` 整体删除
- `ServiceLocator` / singleton 在全仓归零
- 完整 clean architecture 目录搬迁
- EventBus 全量重写
- 明显内存下降

## Evidence Required Before Final Sign-Off

- 最新基线报告
- route registry 与 typed event catalog 摘要
- bridge register
- migration scoreboard
- 自动化测试结果摘要
- smoke 记录
- 文档更新记录
- 对“是否继续做更彻底 kernel 重构”的结论说明
