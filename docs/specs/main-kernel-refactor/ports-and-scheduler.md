# Main Kernel Refactor Ports and Scheduler

## Purpose

本文件回答三个问题：

1. 本轮到底需要哪些 port
2. 哪些能力现在不要急着抽象
3. `Scheduler` 为什么是本轮少数值得提前引入的接口

本轮原则不是“把一切都 port 化”，而是只抽出能直接减少 hot path 耦合的最小集合。

## Decision Rule

只有同时满足以下条件时，能力才进入 port：

1. 它是 orchestration 层依赖的外部能力或跨 slice 能力
2. 现有直接依赖已经造成 owner 不清、测试困难或 presenter 互调
3. 抽出来后能立刻替换一条真实主路径

如果只是为了“以后可能更优雅”，本轮不要抽。

## Minimum Port Set

### 1. SessionRepository

责任：

- session 元数据读取、创建、恢复、状态更新

为什么现在就需要：

- chat/session orchestration 不能继续直接掺着 presenter 和 sqlite 管理 session owner

### 2. MessageRepository

责任：

- message append、查询、状态更新、重试相关读取

为什么现在就需要：

- send / stop / retry 这些路径要有可替换的数据面，方便做单测和集成测试

### 3. ProviderCatalogPort

责任：

- provider、model、custom model 查询

为什么现在就需要：

- 这是 `ConfigQueryPort` 中最容易外溢的一部分，也是 session/chat 在选 provider、校验 model 时的明确依赖

### 4. ProviderExecutionPort

责任：

- completion、stream、provider 级执行入口

为什么现在就需要：

- migrated chat path 不应该继续直接知道 `LLMProviderPresenter` 的完整接口面

### 5. ProviderSessionPort

责任：

- 仅限会话级 provider runtime 配置，如 ACP session / workdir / mode

注意：

- 只有当 Phase 4 真切到这些路径时才落地
- 不要求在本轮一开始就完整抽出

### 6. SessionPermissionPort

责任：

- 权限请求响应、权限批准、权限清理

为什么现在就需要：

- `SessionRuntimePort` 当前把 UI 刷新、权限清理、权限批准混在一起，边界过胖

### 7. WindowEventPort

责任：

- 向 renderer 发布 typed UI event

为什么现在就需要：

- migrated path 不能继续依赖 `eventBus.sendToRenderer()` 这种混合语义

### 8. Scheduler

责任：

- `sleep`
- `timeout`
- `retry`

为什么现在就需要：

- send / stop / provider failure 这些路径的可测性和 cleanup 可靠性都强依赖统一时序语义

## What We Intentionally Do Not Port Yet

以下能力本轮不急着抽：

- browser / yoBrowser 全量能力
- workspace 全量能力
- exporter
- remote control
- dialog/file picker 的全量系统能力
- 完整事件总线抽象

这些能力不是不重要，而是当前不是 hot path 的最大耦合来源。

## Legacy To Port Mapping

### `ConfigQueryPort`

本轮只拆最必要的部分：

| Legacy capability | New target |
| --- | --- |
| `getProviderModels` | `ProviderCatalogPort` |
| `getCustomModels` | `ProviderCatalogPort` |
| `getAgentType` | 先保留在现有 adapter 或单独 `AgentCatalogPort`，仅在 chat/session 需要时再抽 |

### `SessionRuntimePort`

本轮拆成：

| Legacy capability | New target |
| --- | --- |
| `refreshSessionUi` | `WindowEventPort` |
| `clearSessionPermissions` | `SessionPermissionPort` |
| `approvePermission` | `SessionPermissionPort` |

### Direct `LLMProviderPresenter` Usage

本轮拆法：

| Current usage | New target |
| --- | --- |
| model / custom model query | `ProviderCatalogPort` |
| completion / stream / rate-limit-wrapped execution | `ProviderExecutionPort` |
| ACP session / workdir / mode | `ProviderSessionPort` |
| permission-related collaboration | `SessionPermissionPort` |

## Scheduler

### Suggested Interface

```ts
export interface Scheduler {
  sleep(input: SleepInput): Promise<void>
  timeout<T>(input: TimeoutInput<T>): Promise<T>
  retry<T>(input: RetryInput<T>): Promise<T>
}

export interface SleepInput {
  ms: number
  reason: string
  signal?: AbortSignal
}

export interface TimeoutInput<T> {
  task: Promise<T>
  ms: number
  reason: string
  signal?: AbortSignal
}

export interface RetryInput<T> {
  task: () => Promise<T>
  maxAttempts: number
  initialDelayMs: number
  backoff: number
  reason: string
  signal?: AbortSignal
}
```

### Why It Must Exist

当前仓库里的 raw timer 混杂了：

- 业务等待
- 超时保护
- 重试退避
- 清理延迟
- watcher / polling

如果继续散落使用，会带来三个直接问题：

1. 无法稳定测试
2. 无法统一取消
3. cleanup owner 不清楚

因此，本轮虽然不追求全量新架构，但 `Scheduler` 仍值得提前抽出来。

### Implementation Policy

- 接口自写
- `retry` 内部可用 `p-retry`
- 业务层不直接依赖任何第三方重试库

## Port Design Guardrails

实施时必须检查：

1. 这个 port 是否直接替换了一个真实 hard dependency？
2. 它是否缩小了 orchestration 层需要知道的实现细节？
3. 它是否有明确的 fake / stub 测试价值？
4. 它是否按能力分组，而不是按旧 presenter 名称分组？

如果答案不明确，本轮就不要抽。
