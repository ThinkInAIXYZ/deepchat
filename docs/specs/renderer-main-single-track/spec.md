# Renderer-Main Single Track

## Summary

`2026-04-20` main kernel refactor `phase5` 收口之后，项目已经完成了“边界稳定化 + 热路径减耦”的第一轮目标，
但 renderer 侧仍然处于明显的双轨状态：

- 一部分能力已经通过 `renderer/api/*Client` + `window.deepchat` + shared contracts 进入 main
- 另一部分能力仍然通过 `usePresenter()`、`window.electron`、`window.api` 直接触达旧兼容面
- 同一个 store / page / composable 内同时混用两种 transport 和两套 owner 语义

这会直接导致后续开发者在实现功能时继续复制“typed client + legacy presenter + raw IPC”混搭模式，
从而让这次重构的收益逐步回退。

本计划的目标不是再发起一次全量 `main kernel rewrite`，而是把 renderer-main 边界正式收束成单轨模型，
让后续开发只有一条默认正确路径可走。

## Why This Program Exists

`2026-04-20` 的当前基线仍然显示：

| Signal | Baseline | Meaning |
| --- | --- | --- |
| `renderer.usePresenter.count` | `86` | renderer 业务代码仍直接依赖 presenter naming |
| `renderer.windowElectron.count` | `95` | renderer 业务代码仍直接感知 Electron IPC |
| `renderer.windowApi.count` | `33` | preload legacy multi-entry surface 仍暴露在业务层 |

这些数字说明当前分支已经“可运行”，但还没有“可长期维护”。

如果现在在双轨状态下直接合并，后续新功能大概率会继续沿着旧路径长，最终形成：

- typed client 继续存在
- `usePresenter()` 继续存在
- raw `window.electron` / `window.api` 继续存在
- 文档、测试和代码审查标准继续模糊

这正是本计划要阻止的结果。

## Goals

- 让 `src/renderer/src/**` 的业务代码只面对单一、明确、可追踪的 renderer-main 能力入口。
- 把 renderer-main 能力边界定义为：
  - typed route contracts
  - typed event contracts
  - `renderer/api/*Client`
  - 明确命名的 runtime wrapper
- 把 `usePresenter()` 从“通用开发入口”降级为“迁移期间的内部兼容工具”，并最终退出业务层。
- 把 `window.electron` / `window.api` 从业务层清退到极小、可审计、可删除的 wrapper / adapter 范围。
- 把“新功能如何接入 main”这件事写成强规则，而不是口头共识。

## Non-Goals

- 不再发起一次新的全量 `main kernel` 目录重写。
- 不要求本轮删除所有 main presenters。
- 不要求本轮重写全部 EventBus 或全部 preload 兼容层。
- 不要求所有 legacy 能力在第一阶段立刻消失。
- 不以“单纯把指标数字降到 0”作为唯一目标；更关键的是消除业务层双轨。

## User Stories

- 作为后续功能开发者，我只需要沿着一条默认边界接入 main，而不是先猜“这个能力该走 client、presenter 还是 raw IPC”。
- 作为 reviewer，我可以明确判断某个 PR 是否引入了错误 transport，而不是接受“先这样，后面再迁”。
- 作为维护者，我可以从文档和 guard 直接看出哪些路径已经是 single-track，哪些还处于 quarantine。
- 作为测试编写者，我可以围绕 typed client、typed event 和 domain adapter 写测试，而不是围绕 presenter 名称反射写测试。

## In Scope

- `src/renderer/src/**` 的 renderer-main 调用方式
- `renderer/api/*Client`
- typed route / event contract 的继续扩展
- `usePresenter()` / `window.electron` / `window.api` 的 quarantine 与退役路径
- guard、baseline、文档和 merge gate
- 现有 store / page / composable 的 transport 单轨化

## Out of Scope

- main 内部 presenter 是否全部退役
- main 内部所有 service / port / adapter 的再次大改名
- 全量 EventBus 重写
- 不相关的 UI redesign
- 与单轨化无关的性能优化

## Definition Of Single Track

单轨化在本计划中有明确含义，不是“尽量多用 typed client”。

### 1. Single Public Surface Per Capability

同一个 renderer capability 只能有一个公开入口。

例子：

- provider 查询 / 校验统一走 `ProviderClient`
- session 创建 / 激活 / 删除 / 导出统一走 `SessionClient` 的扩展能力或同域 typed client
- window / device / workspace 相关能力统一走对应 typed client 或 runtime wrapper

### 2. No Mixed Transport In Business Modules

同一个 `src/renderer/src/**` 模块内，不允许同时出现：

- typed client
- `usePresenter()`
- raw `window.electron`
- raw `window.api`

如果某个能力还没迁完，也必须先收口到单独的 adapter，而不是继续在业务模块里混用。

### 3. Legacy Quarantine Only

legacy transport 只允许存在于显式 quarantine 区域。

唯一允许的 quarantine 路径固定为：

- `src/renderer/api/legacy/**`

业务代码不能直接 import / 调用 legacy transport helper。

### 4. Typed-First For New Work

后续新增 renderer-main 能力时，必须先定义：

- route contract 或 event contract
- 对应 client / runtime wrapper
- 对应测试

不允许新增 “先走 `usePresenter()`，以后再迁” 的临时实现。

## Acceptance Criteria

- `src/renderer/src/**` 业务模块中直接 import `@/composables/usePresenter` 的数量降为 `0`。
- `src/renderer/src/**` 业务模块中 direct `window.electron` 的数量降为 `0`，仅允许文档明确列出的 bridge / runtime wrapper 保留。
- `src/renderer/src/**` 业务模块中 direct `window.api` 的数量降为 `0`，仅允许文档明确列出的 bridge / runtime wrapper 保留。
- `useIpcQuery` / `useIpcMutation` 不再建立在 presenter-name / method-name reflection 之上，或被更明确的 typed helper 替代。
- 已迁移 slice 的业务模块中不再混用 typed client 和 legacy transport。
- `scripts/architecture-guard.mjs` 能按“业务层禁用 + quarantine 白名单”而不是单纯“防增长”执行检查。
- `docs/README.md`、`docs/ARCHITECTURE.md`、`docs/spec-driven-dev.md`、`docs/guides/getting-started.md` 等高频入口明确声明 single-track 规则。
- 合并前存在一份清晰的 merge gate，能让 reviewer 判定“是否允许进入主线”。

## Phase Gates

为了避免 merge gate 只剩最终口号，本计划为每个阶段定义中间达标线：

| Phase | Gate |
| --- | --- |
| `P0` | quarantine 路径、guard 规则、baseline 维度和 merge gate 已固定成文档与脚本任务 |
| `P1` | `src/renderer/src/**` direct import `@/composables/usePresenter` = `0`，业务层 direct `window.electron` / `window.api` 新增点 = `0`，legacy transport 已收口到 `src/renderer/api/legacy/**` 或 typed runtime wrapper |
| `P2` | business layer `configPresenter` hits = `0`，business layer `llmproviderPresenter` hits = `0`，config/provider/model family 的 raw event listeners 清零 |
| `P3` | business layer `windowPresenter` / `devicePresenter` / `workspacePresenter` / `projectPresenter` / `filePresenter` / `yoBrowserPresenter` / `tabPresenter` hits = `0` |
| `P4` | business layer remaining presenter family hits = `0`，包括 `agentSessionPresenter` / `skillPresenter` / `mcpPresenter` / `syncPresenter` / `upgradePresenter` / `dialogPresenter` / `toolPresenter` 等 |
| `P5` | `src/renderer/src/**` business layer direct `usePresenter` / direct `window.electron` / direct `window.api` 全部为 `0`，quarantine 目录为空或满足量化退出标准 |

## Success Metrics

重点不只是总数下降，而是“业务层清零，兼容层收口”。

至少跟踪：

- `renderer.usePresenter.count`
- `renderer.windowElectron.count`
- `renderer.windowApi.count`
- business-layer direct import / direct access count
- quarantine-layer count
- typed client / typed event 覆盖的 capability 数量

## Quarantine Exit Standard

本计划的理想终点是 quarantine 清零。

如果在 `P5` 合并前仍因阻塞性兼容约束需要保留 quarantine，则必须同时满足：

- `src/renderer/src/**` 业务层 direct legacy access 仍为 `0`
- `src/renderer/api/legacy/**` 文件数 `<= 3`
- 剩余 quarantine 只允许覆盖 `<= 1` 个 capability family
- 每个剩余文件都必须在 `tasks.md` 或后续 follow-up 规格中写明 owner、删除条件和最晚退出阶段

如果做不到以上条件，则不满足 single-track merge gate。

## Open Questions

当前无阻塞性 `[NEEDS CLARIFICATION]` 项。

实现层面的命名差异，例如某些能力最终是扩展现有 `Client` 还是拆成新 `Client`，
由 `plan.md` 在不破坏 single-track 原则的前提下决定。
