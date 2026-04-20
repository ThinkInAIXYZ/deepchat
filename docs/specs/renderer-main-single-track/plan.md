# Renderer-Main Single Track Plan

## Planning Goal

本计划解决的是一个非常具体的问题：

`main kernel refactor` 已经把 renderer-main 主边界做成了可迁移、可测试、可扩展的 typed path，
但 renderer 业务层还没有真正切到单轨。

因此，这一轮计划的目标不是继续“重构 main”，而是：

- 先把 renderer 业务层的 transport 心智模型收成一条
- 再按 capability family 分批迁掉剩余 legacy 调用
- 最后用 guard + docs + merge gate 固化规则

## Baseline Snapshot

以下基线来自 `2026-04-20` 当前仓库扫描：

| Metric | Value | Meaning |
| --- | --- | --- |
| `renderer.usePresenter.count` | `86` | 业务代码仍直接知道 presenter naming |
| `renderer.windowElectron.count` | `95` | 业务代码仍直接知道 Electron IPC |
| `renderer.windowApi.count` | `33` | 业务代码仍直接知道 legacy preload multi-entry |
| `hotpath.presenterEdge.count` | `10` | main hot path 已明显收口，但 renderer 入口仍不单轨 |
| `bridge.active.count` | `0` | `main kernel refactor` 已经没有过渡 bridge 残留 |

这说明当前分支的主要风险已经不在 main hot path，而在 renderer 开发入口仍然模糊。

## Current Presenter Hotspots

按 `usePresenter()` 名称分布，当前主要热点为：

| Legacy Surface | Current Hits | Target Single-Track Surface | Priority |
| --- | --- | --- | --- |
| `configPresenter` | `26` | 扩展 `SettingsClient`，并补 `ConfigClient` / provider-model typed contracts | P2 |
| `agentSessionPresenter` | `13` | 扩展 `SessionClient` 覆盖 session action / pending-input / export 等能力 | P4 |
| `windowPresenter` | `9` | `WindowClient` + typed window/system events | P3 |
| `devicePresenter` | `8` | `DeviceClient` + runtime wrappers | P3 |
| `workspacePresenter` | `5` | `WorkspaceClient` | P3 |
| `llmproviderPresenter` | `4` | 扩展 `ProviderClient` 或补 `ModelClient` | P2 / P4 |
| `skillPresenter` | `4` | `SkillClient` | P4 |
| `filePresenter` | `2` | `FileClient` | P3 |
| `mcpPresenter` | `2` | `McpClient` + typed events | P4 |
| `projectPresenter` | `2` | `ProjectClient` | P3 |
| `tabPresenter` | `2` | `TabClient` 或并入 window runtime layer | P3 |
| `yoBrowserPresenter` | `2` | `BrowserClient` | P3 |
| others | `1` each | 对应 typed client / runtime wrapper | P4 |

这决定了迁移顺序不应该是“86 个点逐个改”，而应该按 capability family 收口。

## Handoff Decision

本计划的关键决策如下：

### 1. Merge Gate Before Branch Merge

当前双轨状态不作为最终可合并状态。

合并前必须先完成 renderer 业务层单轨化，而不是把“后面继续慢慢迁”当作默认路径。

### 2. `usePresenter()` Downgraded To Internal Compatibility Utility

`usePresenter()` 不再是新功能入口。

在计划完成前，它最多只能存在于 quarantine adapter 内部，不能再被 `src/renderer/src/**` 业务模块直接 import。

### 3. Business Layer Must Not See Raw Electron IPC

`window.electron` 和 `window.api` 只能存在于极少数 bridge / runtime wrapper。

业务模块只允许看到：

- typed client
- typed event subscription helper
- 明确命名的 runtime service

### 4. No Mixed Transport Per Module

如果某个模块已经开始用 typed client，就不能再保留 presenter / raw IPC 调用。

允许短期 mixed mode 的唯一位置，是显式 quarantine adapter。

## Target State

目标态如下：

```text
renderer component / store / page / composable
  -> domain-level client or runtime wrapper
  -> src/renderer/api/*Client
  -> window.deepchat
  -> shared/contracts/routes + shared/contracts/events
  -> src/main/routes/*
  -> hot path ports / presenters / runtime internals
```

legacy transport 的唯一允许形态：

```text
temporary quarantine adapter
  -> usePresenter() or raw window.electron / window.api
```

并且 quarantine adapter 不允许被视为“长期公共 API”。

## Allowed Public Surfaces

计划完成后，renderer 对 main 的公开入口只允许是：

- `src/renderer/api/*Client`
- typed event subscription API
- 明确命名的 runtime wrapper，例如 window context / device context / shell integration wrapper

以下实现细节只能留在 wrapper / adapter 层：

- `window.deepchat`
- `window.electron`
- `window.api`
- presenter reflection transport

## Forbidden Surfaces

以下行为在本计划中视为禁止：

1. 在 `src/renderer/src/**` 新增 `usePresenter()` import
2. 在 `src/renderer/src/**` 新增 `window.electron.*`
3. 在 `src/renderer/src/**` 新增 `window.api.*`
4. 在同一个业务模块内混用 typed client 与 legacy transport
5. 用新的 generic helper 再包一层 presenter reflection，表面看像 typed helper，实质仍走旧协议

## Quarantine Model

为了避免“一边迁，一边到处混用”，本计划要求先建立 quarantine 规则：

- 业务层：`src/renderer/src/**`
- typed boundary 层：`src/renderer/api/**`
- temporary quarantine 层：建议为 `src/renderer/api/legacy/**` 或同等显式目录

规则：

- 业务层只能 import typed boundary 层
- quarantine 层可以暂时调用 legacy transport
- 任何 legacy transport 都不得继续散落在业务层

## Phase Map

```text
P0 Rules & Guard Hardening
  -> P1 Transport Consolidation
  -> P2 Config / Provider / Model Family
  -> P3 Window / Device / Workspace Family
  -> P4 Session Residual / MCP / Skill / Misc Family
  -> P5 Retirement, Docs, Merge Gate
```

## Phase Details

### P0: Rules & Guard Hardening

目标：

- 把“单轨化”从目标口号变成强约束
- 让后续改动不能再回流到业务层 legacy transport

交付物：

- single-track spec / plan / tasks
- 更新 `docs/README.md`、`docs/ARCHITECTURE.md`、`docs/spec-driven-dev.md`、`docs/guides/getting-started.md`
- `architecture-guard` 从“防增长”升级为“业务层禁用 + quarantine 白名单”
- baseline 报告增加 business-layer / quarantine-layer 维度

退出条件：

- 新功能无法再在业务层直接新增 `usePresenter()` 或 raw IPC
- 入口文档已经明确 single-track 规则

### P1: Transport Consolidation

目标：

- 先把 transport helper 自己做成单轨
- 移除“helper 名字变了，但底层还是 presenter reflection”的伪单轨

交付物：

- `usePresenter()` 迁入 internal compatibility transport，或降级为 quarantine-only utility
- `useIpcQuery` / `useIpcMutation` 改为：
  - 面向 typed client 的 helper，或
  - 直接退役
- `window.api` / `window.electron` 相关 runtime access 收口到专用 wrapper
- 业务层停止直接 import transport primitive

退出条件：

- `src/renderer/src/**` 不再 direct import `@/composables/usePresenter`
- mixed transport module 被消除

### P2: Config / Provider / Model Family

目标：

- 先清掉最大头的 `configPresenter` 系列调用
- 把 provider / model / config 相关能力全部收成 typed client

交付物：

- 扩展 `SettingsClient`
- 补 `ConfigClient`、`ProviderClient`、必要时补 `ModelClient`
- provider / model / theme / language / system prompt / floating button / shortcut 相关 typed contracts 和 typed events
- 清理 `providerStore`、`modelStore`、`modelConfigStore`、`systemPromptStore`、`themeStore`、`languageStore`、`shortcutKey`、`floatingButton`、`agentModelStore`

退出条件：

- `configPresenter` 和 `llmproviderPresenter` 不再出现在 `src/renderer/src/**` 业务代码
- provider family 的事件监听改为 typed event subscription

### P3: Window / Device / Workspace Family

目标：

- 清掉第二批最容易让开发者“顺手继续写 raw IPC”的能力

交付物：

- `WindowClient`
- `DeviceClient`
- `WorkspaceClient`
- `ProjectClient`
- `FileClient`
- `BrowserClient`
- 必要时补 `TabClient` 或 window runtime adapter
- 清理 `App.vue`、`AppBar.vue`、`WelcomePage.vue`、`NewThreadPage.vue`、workspace / browser / project 相关 stores 与组件

退出条件：

- `windowPresenter`、`devicePresenter`、`workspacePresenter`、`projectPresenter`、`filePresenter`、`yoBrowserPresenter`、`tabPresenter`
  不再出现在业务代码
- `src/renderer/src/**` 不再 direct 使用 window/window-tab 相关 raw IPC

### P4: Session Residual / MCP / Skill / Misc Family

目标：

- 收掉剩余 presenter family
- 把“已经有 typed session/chat 主路径，但残余动作还走 presenter”这种半迁移状态补齐

交付物：

- 扩展 `SessionClient` 覆盖 rename / delete / export / session settings / pending input 等残余动作
- `SkillClient`
- `McpClient`
- `SyncClient`
- `UpgradeClient`
- `DialogClient`
- 其他低频 capability 的 typed route / typed event
- 清理 `skillsStore`、`mcp.ts`、`mcpSampling.ts`、`sync.ts`、`upgrade.ts`、`dialog.ts`、`ollamaStore` 及相关组件

退出条件：

- `agentSessionPresenter`、`skillPresenter`、`mcpPresenter`、`syncPresenter`、`upgradePresenter`、
  `dialogPresenter`、`toolPresenter` 等残余业务层调用清零

### P5: Retirement, Docs, Merge Gate

目标：

- 从“迁移进行中”切换到“规则落地完成”

交付物：

- `usePresenter()` internal-only 或完全删除
- `window.electron` / `window.api` 只存在于文档明确列出的 bridge / runtime wrapper
- 刷新基线、任务状态、代码导航和 onboarding 文档
- 最终 merge gate checklist

退出条件：

- 业务层 single-track 达成
- quarantine 范围可审计且足够小，或已经清零
- reviewer 可以不靠口头说明，只看文档和 guard 就判定合规性

## Verification Strategy

所有 phase 都同步执行：

- guard 校验
- baseline 报告刷新
- typed client / typed event 单测
- 关键 store / page 回归测试
- 迁移 slice 的 smoke 验证

重点不是“迁了多少文件”，而是：

- 有没有把错误入口真正封死
- 有没有把业务层 transport 真的收成一条

## Final Merge Gate

该分支进入主线前，至少满足：

1. `src/renderer/src/**` direct `usePresenter` import = `0`
2. `src/renderer/src/**` direct `window.electron` access = `0`
3. `src/renderer/src/**` direct `window.api` access = `0`
4. `useIpcQuery` / `useIpcMutation` 不再依赖 presenter reflection
5. active docs 已经把 typed client / typed event 写成默认路径
6. `architecture-guard` 可以稳定阻止回退

## Risk Notes

- 最大风险不是迁不完，而是“表面建了 client，业务层还是继续碰 legacy transport”。
- 第二类风险是把 single-track 做成“把 86 个点一个个改名”，却没有建立 quarantine 和 merge gate。
- 第三类风险是过于强调一次性清零，反而不先建立 guard，导致迁移中途继续长新 legacy 点。

因此，本计划的顺序是：

1. 先锁规则
2. 再锁 transport helper
3. 再按 family 清理
4. 最后再 merge
