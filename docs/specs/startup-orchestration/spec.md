# Startup Orchestration 规格

## 概述

本轮启动重排把主窗口首个可交互门槛收敛到两件事：

1. `route seed`
2. `agent bootstrap`

`session list` 退出首屏 critical path，改成 `lightweight + paged + on-scroll`。主窗口内容区和 agent 图标先可用，session sidebar 先展示 skeleton，再渐进填充首批和后续分页数据。

## 当前决策

本规格以 2026-04-21 的 V2 决策为准：

1. `agent first interactive`
2. `session staged`
3. `active session` 与 `session sidebar` 解耦
4. `provider/model warmup` 延后，优先级低于 session 首批和滚动翻页
5. `sessions.updated` 改成增量 merge，避免整表 reload

## 背景

上一轮启动优化已经把部分任务后移，主问题依然集中在两个方向：

1. main 进程启动后仍持续处理 provider model store、session list hydration 等重任务。
2. renderer 首屏把多路初始化耦合在一起，session 与 agent 任何一路变慢都会拖慢可交互时间。

实际观测说明：

1. agent 首屏可用比 session 全量就绪更重要。
2. session list 为 sidebar 服务，适合改成轻量分页链路。
3. active chat 恢复依赖的 `providerId/modelId/projectDir` 可以由 `sessions.restore()` 回填。

## 目标体验

```text
Splash
+ route seed
+ agent bootstrap

Main Window
+ agent icons ready
+ content area ready
+ session sidebar skeleton

User scrolls sidebar
-> load next session page
-> append without clearing
```

## 用户故事

### US-1：主窗口先可交互

作为用户，我希望主窗口出现后可以立即进入 new thread 或 active chat，并立刻看到 agent icons。

### US-2：session 列表渐进出现

作为用户，我希望 session sidebar 先给明确 skeleton，再逐步出现首批会话和后续分页，滚动时稳定 append。

### US-3：活动会话恢复完整元数据

作为用户，我希望 active chat 恢复后，状态栏和会话页拿到正确的 `providerId/modelId/projectDir`，列表轻量化不会影响当前会话的真实上下文。

### US-4：后台 warmup 不抢主路径

作为用户，我希望 provider/model、Ollama、project 等后台 warmup 在主窗口可交互后继续运行，session 首批与翻页优先完成。

## 功能范围

本次范围覆盖：

1. 新增 `startup.getBootstrap`，提供首屏 bootstrap shell。
2. `ChatTabView` 改成 `critical bootstrap` + `staged session hydration` 两段。
3. `sessions.listLightweight` / `sessions.getLightweightByIds` 轻量分页与定向拉取。
4. `sessionStore` 拆出 `SessionListItem` 与 `ActiveSessionSummary` 两层形态。
5. `WindowSideBar` 增加首批 skeleton 和滚动翻页。
6. `sessions.updated` 改成按 `sessionIds` 增量合并。
7. `modelStore.initialize()` / `ollamaStore.initialize()` 与 provider warmup 延后执行。

## 功能要求

### A. Startup Bootstrap Shell

- 新增 `startup.getBootstrap` route。
- `StartupBootstrapShell` 包含：
  - `startupRunId`
  - `activeSessionId`
  - `activeSession?`
  - `agents`
  - `defaultProjectPath`
- bootstrap shell 只携带首屏 UI 必需字段。
- `agent` bootstrap 字段限制在 `id/name/type/enabled/avatar/icon/description/source/protected`。

### B. 主窗口 Critical Path

- `ChatTabView` critical path 只执行：
  - 读取 bootstrap shell
  - 应用 `sessionStore.applyBootstrapShell(...)`
  - 应用 `agentStore.applyBootstrapAgents(...)`
  - 应用 `projectStore.applyBootstrapDefaultProjectPath(...)`
  - 调用 `pageRouter.initialize({ activeSessionId })`
- `sessionStore.fetchSessions()` 不进入首屏 critical path。
- 主窗口 first interactive ready 以 `agent bootstrap ready` 为准。

### C. Session Sidebar Staged Loading

- 首批 session 数据通过 `sessions.listLightweight` 拉取。
- 默认 page size 固定为 `30`。
- 排序固定为 `updated_at DESC, id DESC`。
- 首批未返回前，sidebar 展示 skeleton。
- 首批返回后再决定展示真实列表或 empty state。
- 后续分页在 sidebar 滚动接近底部时触发。
- 翻页行为只允许 append，禁止清空已有列表。

### D. Session Lightweight Contract

- `SessionListItem` 只服务 sidebar / grouping / search。
- lightweight list path 直接基于 `new_sessions` 行构造列表项。
- lightweight list path 禁止：
  - 逐条 `resolveAgentImplementation`
  - 逐条 `agent.getSessionState()`
  - 恢复 generation settings
- 默认 `status = idle`，renderer 映射为 sidebar 的 `none` 状态。
- 如 runtime 已知某会话状态，可用内存快照 overlay 轻量列表状态。
- `prioritizeSessionId` 需要保证 active session 首批可见；如果它不在 top 30，需要单独插入并去重。

### E. Active Session Summary Overlay

- `active session` 元数据与 sidebar list 解耦。
- `sessionStore.activeSession` 由两层数据组合得出：
  - `SessionListItem`
  - `ActiveSessionSummary`
- `messageStore.loadMessages()` 在调用 `sessions.restore()` 后返回 `session`。
- `ChatPage` 消费 restore 返回的 `session` 并回填 `ActiveSessionSummary`。
- `providerId/modelId/projectDir` 以 restore 返回的真实 session 为准。

### F. Deferred Warmups

- `modelStore.initialize()` 与 `ollamaStore.initialize()` 通过 startup deferred queue 延后执行。
- provider full warmup 记录 `startup.provider.warmup.deferred` 日志。
- session 首批与滚动翻页优先于 provider/model warmup。
- `active thread restore`、`ACP` draft/bootstrap、`ACP` config warmup 继续留在 post-interactive deferred queue。

### G. 增量事件回流

- `sessions.updated` 事件使用 `sessionIds` 驱动增量刷新。
- `created` / `updated` / `list-refreshed`:
  - 有 `sessionIds` 时走 `sessions.getLightweightByIds`
  - 空 `sessionIds` 时回落到首批轻量页刷新
- `deleted`: 本地 remove，对被删 active session 清理路由与流式状态
- `activated` / `deactivated`: 只更新 active session 绑定
- merge 规则固定：
  - `id` 为实体主键
  - 已存在实体保留本地 UI state
  - 新数据覆盖 `title / pin / updatedAt / status / projectDir`
  - 排序固定为 `updatedAt DESC, id DESC`

### H. 可观测性

- 启动链路需要输出以下日志：
  - `startup.bootstrap.ready`
  - `startup.session.first-page.ready`
  - `startup.session.page.appended`
  - `startup.provider.warmup.deferred`
- 日志需要能回答三个问题：
  - 主窗口何时进入可交互
  - session 首批何时返回
  - provider/model warmup 是否让位给 session staged loading

## 非目标

1. 本轮不做 session list virtualization。
2. 本轮不做全局 session 搜索接口，sidebar 搜索只在已加载页内生效。
3. 本轮不重写 provider store 整体架构。
4. 本轮不引入新的 legacy IPC 通道。

## 约束

1. 保持 typed route / typed event 方向一致。
2. 保持现有 `sessions.restore()` contract 稳定。
3. 列表轻量化与数据一致性同时成立。
4. 主窗口 first interactive 和 session staged loading 需要在日志里明确分界。
