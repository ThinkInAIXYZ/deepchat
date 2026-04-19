# Main Kernel Refactor Build vs Buy

## Purpose

本文件定义本轮 main kernel 重构中“哪些自己实现，哪些引第三方库”的默认决策。

目标不是尽量少写代码，也不是尽量少引依赖，而是：

- 把通用基础设施交给成熟库
- 把 Electron 安全边界、产品能力边界和运行时语义留在仓库内部掌控

## Decision Rule

采用以下判断标准：

- 如果问题是通用基础设施问题，并且已有成熟稳定方案，优先考虑引库
- 如果问题直接定义 `window.deepchat`、IPC contract、service 编排、scope 生命周期、事件语义，则优先自写
- 引入的第三方库必须被本地接口或 facade 包裹，不能直接侵入业务层心智模型

一句话原则：

- 买通用问题
- 自己定义边界

## Decisions

| Area | Decision | Why |
| --- | --- | --- |
| contract/schema | 继续使用 `zod` | 仓库已经广泛使用，统一性最好 |
| preload bridge 生成 | 自写 | 这是 Electron 安全边界和产品 API 形状，不适合外包 |
| IPC router | 自写 | 与 shared route registry 强绑定，代码量不大，收益高 |
| 架构依赖检查 | 引 `dependency-cruiser` | 标准通用问题，不值得长期手搓 |
| retry/backoff | 引 `p-retry` | 通用能力成熟，适合承接 `Scheduler.retry` |
| queue/backpressure | 按需引 `p-queue` | provider/tool/MCP 若出现并发与超时治理需求，收益明显 |
| DI container | 先小自写 | `app/window/session` scope 与 dispose 语义很具体，不先引大魔法 |
| 事件总线 | 先自写模型 | 需要 `publishAndWait`、事件分类、event store，不只是 emitter |
| 事件总线风格 | 借鉴 `Emittery` | 未来可参考其 async emitter 风格，但本轮不作为运行时依赖 |
| 错误模型 | `neverthrow` 暂缓 | 有价值，但会显著改变编码风格，不放第一批 |

## Approved Third-Party Libraries

以下库属于本轮允许引入范围：

- `dependency-cruiser`
- `p-retry`

以下库属于“条件成立时允许评估”：

- `p-queue`

以下库当前不作为第一批运行时依赖：

- `Awilix`
- `tsyringe`
- `Emittery`
- `neverthrow`

这不代表它们不好，只代表当前阶段不适合作为默认解。

## Self-Owned Components

以下组件明确由仓库内自写并长期掌控：

- `shared/contracts/routes.ts`
- `src/preload/createBridge.ts`
- `src/preload/index.ts`
- `src/main/ipc/IpcRouter.ts`
- `src/main/di/Scope.ts`
- `src/main/di/serviceIds.ts`
- `src/main/EventBus` 抽象与语义
- `renderer/api/*Client`

这些组件不只是技术实现，更是：

- Electron 安全边界
- 产品能力边界
- main/renderer 心智模型
- 测试和迁移治理边界

## DI Container Policy

本轮 `DI Scope` 明确自写。

原因：

- 需要的能力其实很收敛：`registerValue`、`registerSingleton`、`get`、`createChild`、`dispose`
- `app/window/session` scope 语义是 DeepChat 特有，不是通用 web request scope
- 现在最重要的是“可见、可测、可控”，不是“更强大的容器魔法”

实施要求：

- 不引入 `Awilix`、`tsyringe`、`Inversify` 之类重型容器作为第一批基础设施
- 先完成最小 Scope 实现
- 只有当自写 Scope 明显成为维护负担时，再重新评估 `Awilix`

## Event Bus Policy

本轮 `EventBus` 明确自写语义模型。

原因：

- 需要的不只是 `emit/on`
- 还包括 `publishAndWait`
- 还包括 domain/integration/ui 事件分类
- 还包括 event store、correlation、关键流确认

实施要求：

- 不把业务事件模型直接绑定到第三方 emitter API
- 如需参考成熟风格，可以借鉴 `Emittery` 的 async emitter 思路
- 若未来要在底层实现上借用 emitter 库，也必须包在本地 `EventBus` 接口后面

## Scheduler Policy

本轮 `Scheduler` 抽象自写，但内部实现允许借成熟库：

- `sleep`：本地封装
- `timeout`：本地封装
- `retry`：优先用 `p-retry`

要求：

- 业务层永远依赖 `Scheduler` 接口
- 不允许业务层直接依赖 `p-retry`
- 第三方库只出现在 scheduler adapter 内部

## Queue Policy

`p-queue` 不是第一批必引依赖。

只有出现以下明确需求时才评估：

- provider 并发上限
- tool 执行队列
- MCP 请求背压
- per-task timeout / cancellation / pending visibility

在没有这些信号之前，不主动引入。

## Error Model Policy

`neverthrow` 暂不进入第一批。

原因：

- 会改变 service/use case 的错误处理风格
- 在 presenter 退场、typed bridge、scope、scheduler 同时变化时，变量太多

建议：

- 先用现有异常模型完成主架构切换
- 等 `settings` 或 `sessions` slice 稳定后，再决定是否试点

## Adoption Rules

新增第三方库前必须回答：

1. 这是通用基础设施问题，还是产品边界问题？
2. 这个库是否会改变 `window.deepchat`、IPC contract、service 边界的形状？
3. 这个库能否被本地接口包住？
4. 它能否减少维护成本，而不是引入新的框架心智负担？

只有当答案对本轮目标明确有利时，才允许引入。

## Current Default Stack

本轮默认采用：

- `zod` for schema/contracts
- `dependency-cruiser` for dependency rules
- `p-retry` behind `Scheduler.retry`
- local `Scope`
- local `EventBus`
- local `createBridge`
- local `IpcRouter`

这套组合的目标是：

- 边界留在仓库内
- 通用重复劳动交给成熟库
- 迁移复杂度可控
