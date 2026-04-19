# Main Kernel Refactor Ports and Scheduler

## Purpose

本文件回答四个问题：

1. `port` 是什么
2. 什么能力应该进入 `port`
3. 当前 legacy runtime 的内容应该拆到哪个 `port`
4. `Scheduler` 为什么必须存在，以及后续承接什么内容

## Decision Rule

先用这张表判断一个能力应该落在哪层：

| 如果问题是… | 落点 | 说明 |
| --- | --- | --- |
| renderer 请求 main 的能力 | `shared/contracts` + route registry | 这是跨进程边界，不是 `port` |
| main 业务编排 | `main/app/*Service` / `*UseCase` | service 持有流程 owner |
| main 业务依赖外部能力或跨 slice 能力 | `main/ports/*` | `port` 由业务层拥有 |
| 数据库 / Electron / provider SDK / MCP SDK 的具体实现 | `main/infra/*` / `main/platform/electron/*` | adapter 实现 `port` |
| 纯业务规则和值对象 | `main/domain/*` | 不依赖 port |

一句话：

- route 解决进程边界
- port 解决业务依赖边界

## What A Port Is

`port` 是业务层定义的、面向能力而不是面向实现的接口。

`port` 的目标不是“把所有东西都抽象一遍”，而是把这些不稳定依赖从 service 里隔开：

- Electron 能力
- 数据库存取
- provider / MCP / tool runtime
- 文件系统 / dialog / clipboard
- 需要 fake/mock 才能稳定测试的时序和外部系统

`port` 必须满足：

1. 由 `main/app` 或 `main/domain` 的使用方来拥有
2. 按业务原因分组，而不是按旧 presenter 名称分组
3. 能被 in-memory fake 或 stub 替换
4. 不暴露 `Presenter`、`SQLitePresenter`、`BrowserWindow`、`ipcMain` 之类实现名

以下情况不要抽 `port`：

- 只在单个 service 内部使用的纯计算 helper
- 没有外部副作用的 domain 逻辑
- 只是为了“看起来更架构”而多包一层的内部函数

## Target Port Layout

建议目录先按能力分组，不按技术分组：

```text
src/main/ports/
  Scheduler.ts
  EventBus.ts
  repositories/
    SettingsRepository.ts
    SessionRepository.ts
    MessageRepository.ts
    SessionEventStore.ts
  providers/
    ProviderCatalogPort.ts
    ProviderExecutionPort.ts
    ProviderSessionPort.ts
    TitleGenerationPort.ts
  tools/
    ToolExecutionPort.ts
    SessionPermissionPort.ts
  platform/
    WindowCommandPort.ts
    WindowEventPort.ts
    FileDialogPort.ts
  mcp/
    McpRegistryPort.ts
  skills/
    SkillSessionStatePort.ts
  agents/
    AgentCatalogPort.ts
```

这不是要求第一天把所有文件都建出来，而是先把命名和责任面锁住。

## Port Catalog

### Repository Ports

| Port | Responsibility | Current legacy source | Primary consumers |
| --- | --- | --- | --- |
| `SettingsRepository` | 读取和写入设置快照、版本、监听源 | `configPresenter` / `electron-store` 路径 | `SettingsService` |
| `SessionRepository` | session 元数据读写、list、archive、restore | `agentSessionPresenter`、`sessionPresenter`、sqlite tables | `SessionService` |
| `MessageRepository` | message append/list/update/retry lookup | `agentRuntimePresenter`、`messageManager`、sqlite tables | `ChatService`、`SessionService` |
| `SessionEventStore` | 记录可重放的 session state change | 目前没有稳定 owner，分散在 eventBus + sqlite side effect | `SessionService`、debug/replay tooling |

### Provider Ports

| Port | Responsibility | Current legacy source | Primary consumers |
| --- | --- | --- | --- |
| `ProviderCatalogPort` | provider、model、custom model、capabilities 查询 | `ConfigQueryPort`、`configPresenter`、`LLMProviderPresenter` 查询方法 | `SessionService`、`ProviderService` |
| `ProviderExecutionPort` | 文本生成、completion、stream、provider-level rate limit | `LLMProviderPresenter.generate*`、`executeWithRateLimit` | `ChatService`、`ProviderService` |
| `ProviderSessionPort` | ACP session/workdir/mode/config option 这类 provider-owned session runtime | `LLMProviderPresenter` ACP 相关方法 | `SessionService` |
| `TitleGenerationPort` | 会话标题总结，不让 `SessionService` 直接知道 provider 细节 | `summaryTitles` | `SessionService` |

### Tool and Permission Ports

| Port | Responsibility | Current legacy source | Primary consumers |
| --- | --- | --- | --- |
| `ToolExecutionPort` | 工具发现、执行、结果返回、工具错误归一化 | `toolPresenter`、`mcpPresenter`、agent tool handlers | `ChatService`、`ToolService` |
| `SessionPermissionPort` | 会话内权限请求、批准、清理、已批准状态查询 | `SessionRuntimePort`、permission services、runtime callback | `ChatService`、`ToolService`、`SessionService` |

### Platform Ports

| Port | Responsibility | Current legacy source | Primary consumers |
| --- | --- | --- | --- |
| `WindowCommandPort` | 打开设置窗、发送命令到指定窗口、聚焦窗口 | `WindowRoutingPort`、`windowPresenter` | `SettingsService`、system use cases |
| `WindowEventPort` | 向 renderer 发布 typed UI event | `eventBus.sendToRenderer/sendToWindow/sendToWebContents` | `ChatService`、`SessionService`、`ProviderService` |
| `FileDialogPort` | 文件选择、保存路径、reveal in folder | `dialogPresenter` / Electron dialog | export/import and file-related use cases |

### Cross-Cutting Ports

| Port | Responsibility | Current legacy source | Primary consumers |
| --- | --- | --- | --- |
| `Scheduler` | sleep、timeout、retry，统一时序语义 | 分散的 `setTimeout` / `setInterval` / ad-hoc retry | 多个 service/use case |
| `EventBus` | main 内部 typed domain/integration event publish/subscribe | `src/main/eventbus.ts` 的 main-side emit/on | cross-slice service orchestration |
| `McpRegistryPort` | provider/tool 读取 MCP registry 与 server metadata | `ProviderMcpRuntimePort`、`mcpPresenter` | `ProviderService`、`ToolService` |
| `SkillSessionStatePort` | session skill state、legacy repair、new session skill persistence | 当前 `skillPresenter` 暴露的 session state 能力 | `SessionService`、tool orchestration |
| `AgentCatalogPort` | agent type、agent metadata 查询 | `ConfigQueryPort.getAgentType` | `SessionService`、`ChatService` |

## Legacy To Port Mapping

这部分直接回答“现在的一系列内容应该哪些去 port，去哪个 port”。

### Current Legacy Runtime Ports

| Legacy port | Problem | Target split |
| --- | --- | --- |
| `ConfigQueryPort` | 同时承载 provider model 查询和 agent metadata | `ProviderCatalogPort` + `AgentCatalogPort` |
| `SessionRuntimePort` | 同时处理 UI 刷新、权限清理、权限批准 | `WindowEventPort` + `SessionPermissionPort` |
| `WindowRoutingPort` | 窗口命令与 UI 发送混在一起 | `WindowCommandPort` |
| `ProviderMcpRuntimePort` | provider 通过 presenter 回拿 MCP registry | `McpRegistryPort` |
| `SkillSessionStatePort` | 名字可保留，但要迁到 `main/ports/skills` | `SkillSessionStatePort` |

### Current Fat Runtime Adapter Split

`AgentToolRuntimePort` 现在是一个明显过胖的 runtime adapter，不应一比一迁移。

| Legacy capability in `AgentToolRuntimePort` | Target |
| --- | --- |
| `resolveConversationWorkdir` / `resolveConversationSessionInfo` | `SessionService` 查询接口或 session query port |
| `createSubagentSession` | `SessionService` / `CreateSubagentSessionUseCase` |
| `sendConversationMessage` / `cancelConversation` | `ChatService` |
| `subscribeDeepChatSessionUpdates` | `WindowEventPort` + typed UI event |
| `getSkillPresenter` | `SkillSessionStatePort` |
| `getYoBrowserToolHandler` | browser-specific tool adapter，不进入通用 `ToolExecutionPort` |
| `getFilePresenter` | `FileDialogPort` 或 file preparation adapter |
| `getLlmProviderPresenter` | `ProviderExecutionPort` |
| `createSettingsWindow` / `sendToWindow` | `WindowCommandPort` |
| `getApprovedFilePaths` / `consumeSettingsApproval` | `SessionPermissionPort` |

原则不是把一个 fat port 换成另一个 fat port，而是按能力拆散。

## Presenter Method To Port Mapping

### `LLMProviderPresenter`

| Current method family | Future home |
| --- | --- |
| `getProviderModels` / `getCustomModels` | `ProviderCatalogPort` |
| `generateCompletion` / `generateCompletionStandalone` / `generateText` | `ProviderExecutionPort` |
| `executeWithRateLimit` | `ProviderExecutionPort` 内部策略，或其 adapter 内部能力 |
| `summaryTitles` | `TitleGenerationPort` |
| `prepareAcpSession` / `clearAcpSession` / `getAcpSessionCommands` / `getAcpSessionConfigOptions` / `setAcpSessionConfigOption` | `ProviderSessionPort` |
| `getAcpWorkdir` / `setAcpWorkdir` / `warmupAcpProcess` / `getAcpProcessModes` / `setAcpPreferredProcessMode` / `setAcpSessionMode` / `getAcpSessionModes` | `ProviderSessionPort` |
| `resolveAgentPermission` | `SessionPermissionPort` |

### `AgentRuntimePresenter`

| Current responsibility | Future home |
| --- | --- |
| session generation orchestration | `ChatService` |
| stream lifecycle | `StreamAssistantReplyUseCase` + `WindowEventPort` |
| retry / timeout / cancellation | `Scheduler` |
| direct provider invocation | `ProviderExecutionPort` |
| permission resolution callback | `SessionPermissionPort` |

### `SessionPresenter` and `AgentSessionPresenter`

| Current responsibility | Future home |
| --- | --- |
| create/list/restore/archive session | `SessionService` |
| title generation | `TitleGenerationPort` through `SessionService` |
| ACP workdir / mode management | `ProviderSessionPort` through `SessionService` |
| session UI activation/deactivation broadcast | `WindowEventPort` |
| session permission cleanup | `SessionPermissionPort` |

## Scheduler

### What It Is

`Scheduler` 是业务层的时间语义 port，不是一个“定时器工具类”。

建议位置：

```text
src/main/ports/Scheduler.ts
src/main/infra/scheduler/DefaultScheduler.ts
```

建议接口：

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

现在项目里大量 `setTimeout` / `setInterval` 混杂了几种完全不同的语义：

- 真正的业务等待
- 超时保护
- 重试退避
- 清理延迟
- watcher / heartbeat / polling
- UI 层动画或节流

这些语义如果继续直接写成裸 timer，会带来四个问题：

1. 无法稳定测试
2. 无法统一取消
3. 无法附带 reason 和日志
4. 无法区分“正常等待”和“临时兜底”

`Scheduler` 的存在就是把业务时序变成一个显式依赖。

### What Goes Into Scheduler

以下内容应迁入 `Scheduler`：

| Current pattern | Use `Scheduler` as |
| --- | --- |
| `await new Promise((resolve) => setTimeout(resolve, ms))` | `sleep` |
| `Promise.race([task, timeout])` | `timeout` |
| 手写 retry loop + backoff | `retry` |
| 需要统一 abort 的等待 | `sleep` / `timeout` with `AbortSignal` |

### What Does Not Go Into Scheduler

这些内容不要强行塞进 `Scheduler` 第一版：

- renderer UI 动画 timer
- Electron window layout animation
- `chokidar` / process heartbeat 这类 infra 自己管理的循环
- 纯 debounce/throttle util

原则：

- 业务层 timer 必须进 `Scheduler`
- infra 内部 timer 如果只是 adapter 细节，可以先留在 adapter 自己内部

### What Scheduler Will Own Later

后续阶段中，`Scheduler` 会逐步承接这些明确的业务时序：

- provider backoff / retry
- session restore grace period
- stream timeout
- tool approval timeout
- subagent init retry
- 关键清理动作的 named delay

但它不会变成一个通用 cron / queue / animation manager。

### Scheduler and Third-Party Libraries

- 接口保持仓库内自写
- `retry` 内部 adapter 可以使用 `p-retry`
- 业务层永远只依赖 `Scheduler`

## Implementation Guardrails

实施时必须坚持：

1. service 只依赖 `port`，不依赖 presenter
2. `port` 名称按能力命名，不按旧类名命名
3. 一个 port 只负责一种业务原因
4. 新增 port 前，先确认它不是 route、service helper 或 infra detail
5. `Scheduler` 只承接业务时序，不承接 renderer UI timer
