# Main Kernel Refactor

## Summary

本规格定义 DeepChat 下一阶段的主架构重构目标：把当前以 `src/main/presenter/` 为中心的 main
process 运行时，重构为一个 `Clean Main Kernel + Typed Bridge` 的可组合、可测试、可维护应用内核。

这次工作不是“一步大爆炸重写”，而是一项按阶段推进的结构治理工程。每个阶段都必须满足三个条件：

- 可单独验收
- 可单独检测
- 完成后项目更接近最终目标，而不是积累新的历史债务

本规格只定义目标、边界、阶段原则与最终验收口径；不在本轮直接改动运行时代码。

## Baseline

以下基线来自 `2026-04-19` 对当前仓库的快速扫描，用于确定优先级。它们是文本命中/目录规模信号，不是正式审计报告，但足够说明问题集中区域。

| Signal | Baseline | Notes |
| --- | --- | --- |
| `src/main/presenter/index.ts` 行数 | 769 | 组合根过重 |
| `src/main/presenter/` 子目录数 | 31 | main 领域职责分散 |
| renderer `usePresenter(` 命中 | 90 | renderer 仍深度依赖 presenter |
| renderer `window.electron*` 命中 | 111 | 存在直接 IPC / Electron 暴露 |
| renderer `window.api` 命中 | 33 | 预加载桥接仍是多入口 |
| `ipcMain` / `ipcRenderer` 相关命中 | 105 | channel 分散 |
| `setTimeout` / `setInterval` 命中 | 135 | 时序与可测性风险明显 |

当前已存在的治理基础：

- `scripts/architecture-guard.mjs`
- `scripts/generate-architecture-baseline.mjs`
- `docs/specs/architecture-simplification/*`
- `docs/specs/legacy-agentpresenter-retirement/*`
- `docs/specs/legacy-llm-provider-runtime-retirement/*`

本次重构将建立在这些成果之上，而不是忽略它们重新发明一套流程。

## Goals

- 将 main process 重构为单一 composition root 驱动的应用内核。
- 将业务逻辑从 presenter singleton 迁移到 `app services + domain + ports + infra adapters`。
- 将 renderer 与 main 的边界收敛到 `shared contracts + generated preload typed API`。
- 清理字符串 IPC、隐式事件、散落 timeout、renderer 直连 main 的路径。
- 引入明确的 lifecycle scope：`app`、`window`、`session`。
- 先把 provider、tool、settings、command 的内部边界理清，不把插件化作为本轮单独目标。
- 将 `window.deepchat` 收敛为稳定能力门面，而不是业务方法垃圾桶。
- 让 renderer 主要依赖 `renderer/api` client，而不是直接拼 IPC 或直接依赖 preload 细节。
- 保持用户可见能力不下降；如必须重构内部实现，外部行为必须保持等价或更稳定。
- 最终删除旧 presenter singleton 架构，而不是长期双栈共存。

## User Stories

- 作为维护者，我可以从一个清晰的 composition root 看见 main process 的依赖装配关系。
- 作为功能开发者，我可以新增一个业务能力，而不需要穿透全局 presenter、隐式事件和散落 IPC。
- 作为测试编写者，我可以对 service、port、IPC contract 做独立单测和集成测试。
- 作为 QA，我可以在每个阶段结束时使用固定的 smoke matrix 验证行为没有回退。
- 作为最终用户，我不会因为内部重构失去会话、发消息、恢复历史、切换 provider 或运行工具能力。

## In Scope

- `src/main/` 的结构重组与职责重划
- `src/preload/` 的单一 typed bridge 设计
- `src/shared/` 的 contract registry、event、error、DTO 设计
- renderer 与 main 的通信边界清理
- `renderer/api` client 层与能力分组约定
- EventBus、Scheduler、SessionEventStore 等基础设施设计
- main kernel 的分阶段迁移路线、验收标准与测试方案
- 迁移执行纪律、bridge 生命周期与阶段治理规则
- build-vs-buy 决策与第三方依赖引入边界
- 与架构重构直接相关的 guardrail、baseline 与文档更新

## Out of Scope

- 新增面向最终用户的产品功能
- 全量 UI 视觉改版
- 一次性替换全部数据库表结构
- 新增独立 plugin host、plugin runtime、第三方插件接入能力
- 为旧 presenter 再加一层长期兜底封装
- 在没有阶段验收的情况下做大爆炸式代码迁移

## Constraints

- 行为兼容优先，特别是聊天、会话恢复、provider 切换、工具执行和设置读写。
- 允许存在临时兼容边界，但兼容边界必须写明 owner、存活阶段和删除节点。
- 不新增旧架构上的新业务逻辑；如果需要桥接，只允许“过桥”，不允许“续命”。
- 每个阶段结束时必须能运行既定验证项，并产出明确的通过/未通过结论。
- 所有用户可见文案、权限边界、安全边界必须继续遵守 Electron 最小暴露原则。

## Architectural Principles

### 1. Single Active Direction

同一条业务链路在任一时刻只能有一个主实现。迁移期间允许短暂 bridge，但不能长期双写、双执行、双监听。

### 2. Contract-First Boundary

跨进程能力先定义 contract，再定义 preload API、IPC route、controller、service。禁止先散落写 channel 再回头补类型。

### 3. Stable Capability Facade

`window.deepchat` 只暴露 renderer 需要请求 main process 的受保护能力、跨进程状态和系统能力。
它按产品能力分组，不按内部类名、repository 名或 presenter 名分组。

允许的例子：

- `window.deepchat.chat.sendMessage()`
- `window.deepchat.sessions.restore()`
- `window.deepchat.settings.watch()`
- `window.deepchat.providers.testConnection()`

禁止的例子：

- `window.deepchat.providerPresenter.getInstance()`
- `window.deepchat.sessionRepository.insert()`
- `window.deepchat.sqlite.execute()`
- `window.deepchat.messageHandler.retryMessage()`

### 4. Contract Registry Is The Source Of Truth

跨进程 API 的唯一事实源是共享 route registry。

同一份 registry 负责：

- route 命名
- input/output schema
- preload bridge 类型生成
- main route 注册校验
- renderer client 的稳定调用基础

### 5. Services Own Business Logic

`ipc controller` 只做参数校验、上下文装配与错误映射；业务逻辑进入 `app/*Service` 与 `app/*UseCase`。

### 6. Ports Own Dependencies

业务层只依赖 port 和 domain model，不直接 import infra 细节。

### 7. Renderer Client Absorbs Bridge Details

组件、页面和 store 应优先依赖 `renderer/api` 下的 `ChatClient`、`SessionClient`、`SettingsClient`
这类前端友好 client。只有 client 层可以直接长期了解 `window.deepchat` 的具体分组。

### 8. No New Legacy Fallback

除阶段迁移中明确列出的临时桥接外，不再给旧 presenter、旧 IPC、旧事件、旧 timeout 机制增加新兜底逻辑。

### 9. Phase Exit Before Expansion

上一阶段未达成 exit criteria，不进入下一阶段的核心切换工作。

## Migration Governance

本轮实施必须遵守 [migration-governance.md](./migration-governance.md) 中定义的执行纪律。

其中最重要的约束是：

- 同一条用户路径只能有一个 active owner
- 临时 bridge 只能单向 `old -> new`
- 临时 bridge 默认最多存活 1 个 phase
- phase 完成标准看 legacy 指标是否净下降，而不是只看新代码是否存在
- 旧实现一旦进入迁移阶段即冻结，不再继续长新业务

## Build vs Buy

本轮实施必须同时遵守 [build-vs-buy.md](./build-vs-buy.md) 中的引库策略。

当前明确决策：

- `zod` 继续作为 contract/schema 标准
- `dependency-cruiser` 和 `p-retry` 属于批准引入范围
- `p-queue` 只在并发/背压需求明确时评估
- `DI Scope` 明确自写，不引入重型容器作为第一批基础设施
- `EventBus` 明确自写语义模型，只借鉴 `Emittery` 风格，不作为第一批运行时依赖

## Capability Boundary Rules

使用以下规则判断能力应该落在哪一层：

| 需求类型 | 主要落点 | 是否进入 `window.deepchat` |
| --- | --- | --- |
| 纯 UI 展示、筛选、折叠、拖拽、局部状态 | `renderer/components` / `renderer/stores` | 否 |
| renderer 请求数据库或持久化数据 | `shared/contracts` + `main/app` + `preload` | 是 |
| renderer 请求系统能力，如文件、剪贴板、窗口、通知 | `main/platform/electron` + `preload` | 是 |
| main 内部 provider 调整 | `main/app/providers` / `main/infra` | 否 |
| 新设置字段的内部存取 | `main/app/settings` + registry/schema | 通常否 |
| 新的跨进程 domain capability | `shared/contracts/routes.ts` | 是 |

一句话约束：

- 进入 `window.deepchat` 的是能力边界
- 进入 `main/app` 的是业务用例
- 进入 `renderer/api` 的是前端友好 client
- 留在 renderer 的是界面状态

## Temporary Compatibility Policy

允许的临时兼容方式：

- 用 adapter 把旧调用临时转发到新 service，但适用范围必须限定在单一 slice。
- 在会话恢复阶段，临时保留对 legacy 数据面的只读访问，直到新 event store 验收通过。
- 在 IPC cutover 阶段，短时间保留旧 route 到新 handler 的过渡映射，但需要在同阶段或下一阶段删除。

禁止的临时兼容方式：

- 给 `presenter/index.ts` 继续叠加新业务流程
- 给 renderer 新增 `window.electron`、`window.api`、`usePresenter` 依赖
- 给新功能新增裸字符串 channel
- 给业务时序继续新增裸 `setTimeout` / `setInterval`
- 让旧实现和新实现长期共同维护同一个用户路径

## Target Architecture Snapshot

```text
renderer
  -> renderer/api/*Client
  -> preload/index.ts
  -> shared/contracts/routes.ts
  -> main/ipc/routes
  -> main/app
  -> main/domain + main/ports
  -> main/infra + main/platform/electron
```

目标目录骨架：

```text
src/
  shared/
    contracts/
    events/
    errors/
  main/
    bootstrap/
    ipc/
    app/
    domain/
    ports/
    infra/
    platform/electron/
    di/
  preload/
    createBridge.ts
    index.ts
  renderer/
    api/
```

## Bridge Shape

`window.deepchat` 必须满足以下形态约束：

- 按能力域分组，如 `chat`、`sessions`、`settings`、`providers`、`tools`、`files`、`events`
- API 名称表达用户意图或应用能力，而不是内部实现细节
- 保持粗粒度，renderer 调用用例，不暴露 main 内部编排细节
- 通过 shared route registry 生成 typed bridge，避免 preload 手写重复 wrapper
- 如果未来恢复插件化规划，插件增长默认走 contribution registry，而不是持续扩张 preload API surface

推荐形态：

```ts
window.deepchat = {
  chat: {
    sendMessage,
    startStream,
    stopStream
  },
  sessions: {
    create,
    list,
    get,
    archive,
    restore
  },
  settings: {
    get,
    set,
    watch
  }
}
```

不推荐形态：

```ts
window.deepchat.sessionRepository.insert()
window.deepchat.providerPresenter.getInstance()
window.deepchat.sqlite.execute()
window.deepchat.messages.insertAssistantMessage()
```

## Final Success Metrics

- `src/main/presenter/` 退出活跃运行时
- `ServiceLocator` / presenter singleton 使用为 `0`
- renderer 对 `main` 的直接 import 为 `0`
- renderer 对 `electron` / `window.electron` 的直接依赖为 `0`
- renderer 对旧 `window.api` 多入口桥接的直接依赖为 `0`
- `window.deepchat` 由 shared contract registry 生成，而不是手写散落 wrapper
- 业务层裸 `setTimeout` / `setInterval` 为 `0`
- 所有 IPC route 在共享 contract 注册表中可追踪
- 组件和 store 对 bridge 的直接耦合收敛到 `renderer/api` client 层
- main 新架构核心模块具备可替换 port 和独立测试能力

## Acceptance Criteria

- 存在一套经批准的分阶段计划，覆盖 spec、plan、tasks、acceptance、test plan。
- 存在一套经批准的迁移治理规则，覆盖 bridge 寿命、阶段硬门槛、PR 审查与 scoreboard。
- 存在一套经批准的 build-vs-buy 决策，明确哪些能力引库、哪些能力自写。
- 每个阶段都定义清晰的目标、交付物、退出条件、验证方式和不允许扩张的边界。
- 最终目标架构明确为 `main/app + main/domain + main/ports + main/infra + main/platform/electron + shared contract registry + generated preload bridge + renderer/api clients`。
- 旧 presenter singleton 不被视为长期保留对象，只允许作为受控迁移边界存在。
- 最终验收以结构清理和行为等价双重标准判断，而不是只看“代码跑起来”。

## Open Questions

本规格当前没有阻塞实现启动的 `[NEEDS CLARIFICATION]` 项。以下决策在本轮直接锁定：

- plugin 相关架构不作为本轮单独 phase；这一轮只要求内部边界清晰，不要求交付新的扩展机制。
- guardrail 先扩展现有 `architecture-guard` 与 baseline 脚本；只有当规则复杂度超出脚本维护能力时，再引入更重的依赖图工具。
- `window.deepchat` 将作为最终单一 renderer bridge 名称；现有 `window.api` / `window.electron` 只作为迁移对象，不作为目标长期形态。
- `window.deepchat` 只暴露稳定能力门面，不能随着内部 service 增长而无限膨胀。
