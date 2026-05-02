# Main Kernel Refactor

## Summary

本轮重构在原计划基础上收敛为一套“稳定性优先”的方案。

目标不是一次性把 `src/main` 改造成完整的 `main/app + domain + infra` 新世界，也不是在本轮强行把
`src/main/presenter/` 清零；目标是先解决当前最影响稳定性、可维护性和可测试性的几类问题：

- renderer 通过 `useLegacyPresenter()`、`window.electron`、`window.api` 直接知道 main 内部实现
- main hot path 通过 presenter-to-presenter 直接协作，owner 不清楚
- session / window 生命周期和 stream / timer cleanup 缺少明确 owner
- 新代码继续回流到旧边界，导致耦合只增不减

这是一轮“边界稳定化 + 热路径减耦”工程，而不是全量目录重建工程。

## Program Reset

原方案中保留的高收益部分：

- typed renderer-main boundary
- hot path presenter coupling 拆解
- lifecycle owner 明确化
- scheduler / cancel / timeout / retry 收口
- 分阶段迁移与净减 legacy 指标

本轮主动砍掉的目标：

- 不要求一次性交付完整 clean architecture 目录骨架
- 不要求本轮删除整个 `src/main/presenter/`
- 不要求先引入完整 DI container 或自写大 Scope 系统
- 不要求先重写整个 EventBus 体系
- 不把“内存下降”作为主成功指标

## Baseline

以下基线来自 `2026-04-19` 的最新扫描，用于说明问题集中区域：

| Signal | Baseline | Why it matters |
| --- | --- | --- |
| `src/main/presenter/index.ts` 行数 | 769 | 组合根过重，依赖装配和运行时 owner 混在一起 |
| main dependency cycles | 30 | presenter 互相引用和全局入口回流仍明显 |
| renderer `useLegacyPresenter(` 命中 | 90 | renderer 仍依赖 presenter naming |
| renderer `window.electron*` 命中 | 111 | renderer 仍深度感知 Electron / IPC 实现 |
| renderer `window.api` 命中 | 34 | preload 仍是多入口兼容面 |
| `setTimeout` / `setInterval` 命中 | 123 | cleanup、超时和轮询语义散落 |

这些数字说明，真正的问题是：

- 边界不稳定
- owner 不清楚
- 热路径依赖过粗
- 可测性差

而不是“目录名字不够先进”。

## Detailed Design Docs

本轮仍保留以下设计文档，但都按“最小必要抽象”执行：

- [ports-and-scheduler.md](./ports-and-scheduler.md)
- [route-schema-catalog.md](./route-schema-catalog.md)
- [eventbus-migration.md](./eventbus-migration.md)

## Goals

- 让 renderer-main 主边界收敛到 typed route registry、typed event 和 `renderer/api` client。
- 阻止新增 `useLegacyPresenter()`、新增 raw renderer IPC、新增旧桥接依赖。
- 拆掉 chat / session / provider hot path 上最深的 presenter-to-presenter 直接耦合。
- 让 session / window / stream cleanup 的 owner 明确且可测试。
- 让关键流程可以通过 fake port、stub provider、fake scheduler 做稳定测试。
- 每个阶段结束时，legacy 指标净下降，而不是只新增第二套实现。

## Non-Goals

- 不交付完整 clean architecture 目录重排。
- 不替换现有 `LifecycleManager`。
- 不要求删除所有 presenter 或所有 singleton。
- 不要求一次性清理所有历史事件常量和所有旧桥接。
- 不把内存或启动速度优化作为本轮核心目标。

## User Stories

- 作为维护者，我可以看清 renderer 究竟通过哪些能力边界调用 main，而不是继续猜测 presenter 方法名。
- 作为功能开发者，我可以在 hot path 上新增逻辑，而不用沿着全局 `Presenter` 和隐式事件链继续扩散耦合。
- 作为测试编写者，我可以对发送消息、停止流、provider 查询、设置读写分别做独立测试。
- 作为 QA，我可以验证迁移后的主路径行为没有回退，而不是只验证“代码还能跑”。

## In Scope

- `renderer/api` client、typed route registry、typed preload bridge
- `settings` 作为第一个 pilot slice
- `chat/session/provider` 热路径 owner 收口
- `Scheduler` 接口与 cancel / timeout / retry 语义统一
- session / window 相关 lifecycle cleanup 明确化
- 迁移治理、guardrail、baseline、smoke 和测试方案

## Out of Scope

- 全量 presenter 退役
- 全量 EventBus 重写
- 全量 repository / domain model 重命名或搬目录
- 新增插件系统
- 以性能优化名义大规模重写运行时

## Constraints

- 现有用户可见行为优先保持兼容，尤其是会话创建、恢复、发送消息、流式回复、停止流、provider 切换和权限交互。
- 新抽象必须替代真实耦合点，不能只增加一层新名字。
- renderer-main 边界和 main 内部协作边界必须分开设计，不能混为一谈。
- 每个阶段都必须切一个真实路径，不接受连续多轮纯基础设施 PR。

## Architectural Principles

### 1. Boundary First

先稳住 renderer-main 边界，再谈内部结构继续细化。

如果 renderer 仍直接依赖 presenter 名称，main 内部怎么拆都很难真正稳定。

### 2. Hot Path First

优先处理最深的主链路耦合：

- `useLegacyPresenter()` / raw IPC
- `AgentSessionPresenter -> AgentRuntimePresenter`
- `SessionPresenter` / `AgentSessionPresenter` / `AgentRuntimePresenter` 对 provider 运行时的直接索取

不先从低频边角模块开始。

### 3. Explicit Owner

每条主路径都必须能回答：

- 谁创建资源
- 谁发起执行
- 谁负责取消
- 谁负责 cleanup

如果回答仍然是“某个 presenter 顺手处理一下”，说明边界还不够清楚。

### 4. Minimal New Infrastructure

不为“看起来更像架构”而先造完整 container、完整 event framework、完整 domain taxonomy。

只有当抽象能直接替换一个现有 hard dependency，或者显著提升测试稳定性时，才进入本轮。

### 5. Keep Working Code, Freeze Bad Growth

现有生命周期、presenter 和兼容层允许继续存在，但迁移覆盖到的 slice 上：

- 旧 owner 冻结
- 只允许 `old -> new` 单向转发
- 不允许继续长新逻辑

## Target Snapshot

本轮目标不是完整新目录，而是把活跃热路径调整成以下形态：

```text
renderer
  -> renderer/api/*Client
  -> window.deepchat
  -> shared/contracts/routes + shared/contracts/events
  -> migrated main handlers / services / adapters
  -> existing presenters or managers only behind explicit ports on non-migrated paths
```

main 侧允许在过渡期保持混合结构，但必须满足：

- migrated path 不再由 renderer 直呼 presenter 名称
- migrated path 不再依赖 presenter-to-presenter 直接 owner 链
- lifecycle cleanup 和 scheduler 语义可单独测试

## Success Metrics

本轮重点看以下指标是否下降：

- `renderer.usePresenter.count`
- `renderer.windowElectron.count`
- `renderer.windowApi.count`
- hot path 上的 presenter direct dependency 数量
- migrated path 的 raw channel / raw timer 数量
- 为 migrated path 建立的 contract / unit / integration 测试数量

## Memory Position

内存不是本轮主成功指标。

这轮工作只有在以下情况才可能带来可观的内存收益：

- session / stream / permission 状态在结束时能被更可靠地释放
- window / webContents listener 能按 owner 清理
- 不再长期保留无主的 abort controller、timer、subscription

如果只是把 presenter 换成 service 或 kernel 命名，而对象生命周期并未变化，则不应期待明显内存下降。

## Acceptance Direction

最终验收以以下三类结果为核心：

- renderer 边界更稳定
- hot path 更容易解释和测试
- cleanup / cancel / timeout 行为更可靠

不以“新目录是否看起来更纯粹”作为主要标准。

## Open Questions

本轮不阻塞实施的决策如下：

- 现有 `LifecycleManager` 保留，除非后续 hot path 证明它成为阻塞点。
- `Presenter` 可作为过渡期 composition shell 保留，但不再继续吞新主链路。
- `EventBus` 先冻结新增错误用法，优先给 migrated path 建 typed UI event；是否全量重写，等本轮收敛后再评估。
- 本轮结束后再决定是否还有必要推进更彻底的 `main kernel` 目录重构。

