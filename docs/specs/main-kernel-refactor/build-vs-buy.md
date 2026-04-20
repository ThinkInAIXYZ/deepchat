# Main Kernel Refactor Build vs Buy

## Purpose

本文件定义本轮“边界稳定化”工作的引库策略。

本轮原则不是尽量多造轮子，也不是尽量多引框架，而是：

- 用成熟库解决通用问题
- 把 DeepChat 的边界、生命周期语义和 Electron 安全面留在仓库内掌控

## Decision Rule

采用以下判断标准：

- 如果问题是通用基础设施问题，并且能明显减少重复劳动，优先考虑引库
- 如果问题直接定义 renderer-main 能力边界、owner 关系或生命周期语义，优先自写
- 新引入的第三方库必须能被本地接口或 facade 包裹，不能直接成为业务层心智模型

## Decisions

| Area | Decision | Why |
| --- | --- | --- |
| schema/contracts | 继续使用 `zod` | 已有基础最好，统一性高 |
| preload bridge / route registry | 自写 | 属于产品能力边界和 Electron 安全边界 |
| renderer client | 自写 | 需要贴合现有 store / composable 用法 |
| 架构 guard/baseline | 先用现有脚本，必要时再引 `dependency-cruiser` | 当前已有脚本，先控制复杂度 |
| retry/backoff | `p-retry` 可批准 | 适合放在 `Scheduler.retry` 内部 |
| queue/backpressure | `p-queue` 仅在明确证据下评估 | 不是第一批刚需 |
| DI container | 本轮不引入 | 本轮重点是热路径 owner，而不是容器框架 |
| lifecycle helper / scope helper | 按需小自写 | 如果 cleanup 语义需要，再补最小 helper |
| EventBus 全量重写 | 本轮不作为前置要求 | 先解决 migrated path 的 typed event 与 owner |

## Approved Third-Party Libraries

默认可批准：

- `zod`
- `p-retry`

条件成立时再评估：

- `dependency-cruiser`
- `p-queue`

当前不作为第一批依赖：

- `Awilix`
- `tsyringe`
- `Inversify`
- `Emittery`
- `neverthrow`

## Self-Owned Components

以下组件明确由仓库内自写并长期掌控：

- shared route registry
- typed event catalog
- preload bridge builder
- `renderer/api/*Client`
- `Scheduler` interface
- provider / session / permission 的窄 port

这些组件直接定义：

- renderer-main 边界
- 迁移期 owner 关系
- 测试替身注入方式

## DI and Composition Policy

本轮不单独引入 DI container。

默认做法：

- 用显式 factory / setup function 装配依赖
- 用局部 interface 或 port 缩窄依赖面
- 只有当 session / window cleanup 真的需要一致 dispose 语义时，再补最小 helper

一句话：

- 先把 owner 讲清楚
- 再决定是否真的需要 container

## Event Policy

本轮先做两件事：

- 冻结 legacy `eventBus` 的错误扩张
- 为 migrated path 建立 typed UI event

本轮不要求：

- 先把整个 EventBus 系统重写
- 先把全部字符串事件搬迁完

如果未来确实需要 internal typed bus，再在下一轮评估。

## Scheduler Policy

`Scheduler` 仍建议作为本地接口存在，原因是：

- 业务层要表达 timeout / retry / sleep 的语义
- 测试需要 fake scheduler
- cancel 行为需要统一 owner

实施要求：

- 业务层依赖 `Scheduler`，而不是直接依赖 `setTimeout` 或 `p-retry`
- `p-retry` 只允许出现在 scheduler adapter 内部

## Error Model Policy

`neverthrow` 暂不进入本轮。

原因：

- 本轮已经同时在切边界、owner 和测试结构
- 现在再切错误模型，变量太多

建议：

- 先把 migrated path 稳住
- 等 hot path 稳定后，再评估是否值得试点

## Adoption Rules

新增第三方库前必须回答：

1. 它解决的是通用基础设施问题，还是 DeepChat 特有边界问题？
2. 它是否会改变 renderer-main 或 hot path owner 的心智模型？
3. 它能否被本地接口包住？
4. 它是否直接减少当前迁移成本？

如果以上答案不够明确，本轮默认不引。
