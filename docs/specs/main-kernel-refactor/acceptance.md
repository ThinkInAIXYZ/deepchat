# Main Kernel Refactor Acceptance

## Acceptance Model

本项目采用“双层验收”：

- 阶段验收：每个 phase 都必须单独通过
- 最终验收：所有阶段通过后，再检查最终结构和行为指标

若阶段验收未通过，则该阶段不能宣告完成，即使代码已经合入。

## Phase Gate Rules

每个阶段都必须同时满足以下条件：

1. 该阶段定义的主路径切换已经完成
2. 该阶段新增 bridge / adapter 已列入 bridge register，并写明 `deleteByPhase`
3. 该阶段要求的自动化验证已经通过
4. 该阶段要求的 smoke 验证已经通过
5. 文档、任务状态和基线报告已经同步更新
6. 该阶段对应 slice 只存在一个 active owner
7. 该阶段没有超期 bridge

## Migration Governance Requirements

以下规则来自 [migration-governance.md](./migration-governance.md)，属于验收硬门槛：

- 同一条用户路径只能有一个 active owner
- bridge 只能单向 `old -> new`
- bridge 默认最多存活 1 个 phase
- 旧实现一旦进入迁移阶段即冻结
- phase 完成必须看到 legacy 指标净下降

## Build vs Buy Requirements

以下规则来自 [build-vs-buy.md](./build-vs-buy.md)，属于实施边界：

- `dependency-cruiser` 可用于架构依赖治理
- `p-retry` 可用于 `Scheduler.retry`
- `p-queue` 仅在并发/背压需求明确时引入
- `Scope` 必须保持仓库内自写实现
- `EventBus` 必须保持仓库内自写语义模型
- `Emittery` 只允许作为风格借鉴对象，不作为第一批运行时依赖
- `neverthrow` 不属于第一批基础设施

## Phase Acceptance Criteria

### Phase 0: Guardrails & Baseline

- 能自动阻止新增 `usePresenter()`、新增 direct renderer IPC、新增 renderer -> `electron` import
- 能自动阻止新增裸 channel 字符串和 bridge 内部实现名泄漏
- 能自动报告 presenter / IPC / timer / direct bridge 的趋势基线
- 文档集合完整可导航

### Phase 1: Typed Contracts & Preload Bridge

- 存在统一的 shared route registry
- 首批主路径存在 schema 化 input/output
- preload bridge 由 shared route registry 生成
- renderer 可以通过 `renderer/api` client 调用主链路能力
- 新增功能不再依赖 `usePresenter()` 接入

### Phase 2: Main Kernel & Scoped DI

- 存在唯一 `createAppKernel` 风格的 composition root
- service 依赖可以通过 scope 注入，而不是 presenter singleton 查找
- `app/window/session` 生命周期语义明确且可测试

### Phase 3: Settings Pilot Slice

- settings 主读写链路走新 contract + route + service
- settings 相关 renderer/store 不再依赖旧 presenter 作为主入口
- 旧 settings 桥接已删除或明确进入下一阶段删除计划

### Phase 4: Sessions & Event Store

- session 创建、恢复、切换链路走新 service
- 关键会话状态变更可在 `SessionEventStore` 中观测
- 恢复行为有自动化测试和手工 smoke 证明

### Phase 5: Chat Runtime Cutover

- 发送消息、流式回复、停止流主链路走新 service
- timeout/retry/cancel 通过 `Scheduler` 管理
- 原 chat runtime presenter 不再拥有主执行 owner 身份

### Phase 6: Providers & Tools Boundary

- provider/tool 的主协调关系能通过 service + port 描述
- provider 切换与工具执行不再依赖 presenter 全局隐式协作
- MCP/tool/provider 核心链路具备测试覆盖

### Phase 7: Legacy Removal & Final Cleanup

- 旧 presenter 运行时不再参与主链路
- renderer 不再依赖 `usePresenter()`、`window.electron`、`window.api`
- 散落字符串 IPC 和裸 timer 已清理到目标范围
- active docs 已切换到新架构叙述

## Final Acceptance Checklist

### Architecture

- [ ] `src/main/presenter` 不再是活跃运行时
- [ ] `main/bootstrap` 是唯一 composition root
- [ ] `main/app` 负责业务逻辑
- [ ] `main/domain` 保持无 infra 反向依赖
- [ ] `main/ports` 是业务层依赖边界
- [ ] `main/infra` / `main/platform/electron` 只实现 adapter 责任
- [ ] `Scope` 为仓库内自写实现，而不是重型外部 DI 容器
- [ ] `EventBus` 为仓库内自写语义模型

### Renderer Boundary

- [ ] renderer 只通过 `renderer/api` + `window.deepchat` 调用 main 能力
- [ ] 组件和 store 不直接拼裸 channel 字符串
- [ ] `window.deepchat` 只暴露 capability facade，不泄漏 presenter/repository/sqlite 等内部实现名
- [ ] renderer 对 `electron` 的直接 import 为 `0`
- [ ] renderer 对 `window.electron` 的依赖为 `0`
- [ ] renderer 对旧 `window.api` 多入口桥接的依赖为 `0`
- [ ] renderer 对 `usePresenter()` 的活跃依赖为 `0`

### IPC

- [ ] 所有主链路 route 都在共享 route registry 中定义
- [ ] 所有 input/output 都有 schema
- [ ] `ipcMain` handler 通过统一 router/controller 收口
- [ ] preload bridge 从同一份 registry 生成
- [ ] 不再新增匿名字符串 channel

### Runtime

- [ ] 业务层裸 `setTimeout` / `setInterval` 为 `0`
- [ ] 关键时序通过 `Scheduler` 管理
- [ ] 关键状态变化可通过 typed event 或 event store 追踪
- [ ] stream lifecycle 具备 cancel、timeout、error 三类可观测信号

### Cleanup

- [ ] `ServiceLocator` / presenter singleton 使用为 `0`
- [ ] presenter direct import 为 `0`
- [ ] 散落 legacy event name 不再承载新主链路
- [ ] 临时 adapter 和兼容桥接已按计划删除
- [ ] bridge register 为 `0`
- [ ] `bridge.expired.count` 为 `0`

### Quality

- [ ] 无新增循环依赖
- [ ] 新架构关键模块具备对应测试
- [ ] 文档、基线、任务状态同步
- [ ] `pnpm run format`、`pnpm run i18n`、`pnpm run lint`、`pnpm run typecheck` 通过
- [ ] 第三方库引入符合 build-vs-buy 决策，没有越界替代产品边界

### User-Visible Behavior

- [ ] 创建会话正常
- [ ] 恢复会话正常
- [ ] 发送消息正常
- [ ] 流式回复正常
- [ ] 停止流正常
- [ ] 切换 provider 正常
- [ ] 工具 / MCP 调用正常
- [ ] 重启应用后核心状态可恢复

## Evidence Required Before Final Sign-Off

- 最新基线报告
- route registry 与 bridge 分组摘要
- 最新 bridge register
- 最新 migration scoreboard
- 对应阶段与最终 smoke 记录
- 自动化测试结果摘要
- 文档更新记录
- 待删除临时 bridge 清单为 `0`
