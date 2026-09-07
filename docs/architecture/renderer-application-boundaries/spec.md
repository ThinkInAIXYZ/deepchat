# Renderer 应用边界与启动治理

## 背景

Renderer 当前由五个独立 HTML/Vite entry 驱动：主窗口、settings、floating、splash、browser-overlay。它们各自创建 Vue 应用、Pinia、i18n 与启动流程，不能假设共享单例或统一生命周期。

主窗口的启动职责分散在 [`App.vue`](../../../src/renderer/src/App.vue) 与 [`ChatTabView.vue`](../../../src/renderer/src/views/ChatTabView.vue)：前者启动 shell 级 store、runtime listener、provider/model/session 预加载；后者取得 bootstrap snapshot、应用 route shell、启动 agent/project/model/ollama 的交互阶段加载。`sessionStore.fetchSessions()` 已以 `sessionFetchPromise` 保证单飞，但它可能在 bootstrap snapshot 写入 active session 前发起，进而以空的 `prioritizeSessionId` 请求首屏数据。

settings 目前直接依赖主窗口实现模块；该现实需要被明确记录并冻结增量，而不是在没有等价契约前机械拆开。IPC transport 已由 [`renderer/api/core.ts`](../../../src/renderer/api/core.ts) 统一封装，35 个 typed `*Client` adapter 已被主窗口和 settings 大量直接使用；再建立按 feature 聚合的 bridge facade 只会增加第二个 transport 边界。

## 目标

1. 为每个 renderer app 明确运行时所有权、入口与独立性约束。
2. 将新的 renderer 分层目录定位在 `src/renderer/src/` 下，兼容现有 `@` alias 和 TypeScript 覆盖范围。
3. 为主窗口 bootstrap 定义显式状态与每项启动工作的唯一 owner，修复首屏 session 优先级时序，不降低当前并行加载策略。
4. 保留 `renderer/api/*Client` 作为唯一 IPC transport adapter；禁止新增 feature-aggregate bridge facade。
5. 把当前 settings → chat-app 的跨 app 依赖作为可观察基线，并禁止新增依赖。
6. 为启动、listener 生命周期、route fallback、会话优先级和 keyed ChatPage 恢复补回归测试。

## Phase 1：chat-main composition root

Phase 1 将主窗口的 composition root 实现迁移到 `src/renderer/src/apps/chat-main/ChatMainApp.vue`。稳定 Vite/HTML entry 继续是 `src/renderer/src/main.ts` 与 `src/renderer/index.html`，根目录 `App.vue` 仅作为兼容 facade 组合 `ChatMainApp`。

本切片不移动 `ChatTabView.vue`、route contract 或 feature-local 页面逻辑。`ChatTabView` 继续是 bootstrap snapshot、route init 和首屏 session fetch 的唯一 owner；迁移不得改变 Phase 0 已验证的启动时序。

## 非目标

- 不变更 main/preload IPC contract、权限模型或 `window.deepchat` 暴露面。
- 不移动五个 HTML entry 或强制五个应用共用同一个 bootstrap composable。
- 不在 Phase 0 重写既有 `*Client`、Store 或 ChatPage。
- 不把不同 webContents 的 Pinia、Vue Query/Colada 或 store 实例共享到进程级。
- 不在本阶段消除既有 settings → chat-app 依赖；仅冻结其增长并规划后续迁移。
- 不更改 stream event ownership；`messageIpc.ts` 继续作为 stream tombstone/generation gate 的唯一 owner。

## 已确认约束

- `@` 指向 `src/renderer/src`；`apps/`、`features/`、`platform/` 和 `foundation/` 必须放在该目录内，才能使用 `@/apps/*` 等导入并被当前 TypeScript 范围覆盖。
- 保留五个现有 `main.ts` 作为稳定 Vite/HTML entry shim。不同 app 可以拥有不同 readiness 与 listener 注册时机。
- settings 的 MCP deeplink listener 必须在 `setup` 阶段注册，不能等待 `onMounted` 或 provider 初始化，否则可能丢失早到 IPC。
- `modelStore.initialize()` 代表 interactive parallel load，不是 shell-blocking critical load。
- `sessionFetchPromise` 单飞的输入在首个请求创建时固定；bootstrap shell 写入前不能开始首屏 session fetch。
- 任何 directory 名称不得使用 renderer `shared`，以免与根目录 `src/shared` 的跨进程 contracts/utilities 混淆；使用 `foundation`。

## Renderer app ownership

| app | 稳定 entry | bootstrap 所有者 | 独立性要求 |
| --- | --- | --- | --- |
| chat main | `src/renderer/src/main.ts` | app shell + `ChatTabView` route host | 自己的 Pinia/i18n；shell snapshot 与交互数据分阶段启动 |
| settings | `src/renderer/settings/main.ts` | settings `App.vue` | listener 早注册；不得依赖 chat app 已启动 |
| floating | `src/renderer/floating/main.ts` | floating app | 不复用 chat main 的实例或 readiness |
| splash | `src/renderer/splash/main.ts` | splash app | 仅保持其最小窗口职责 |
| browser overlay | `src/renderer/browser-overlay/main.ts` | overlay app | 在 Phase 0 审计其与遗留 `browser` 配置的关系后再变更 |

## 主窗口启动状态与 owner

状态为 `uninitialized → snapshot-loading → shell-hydrated → interactive → deferred-settled`；任何失败可转入 `degraded`，仍应产生可用 fallback route。

| 工作 | 唯一 owner | 时机 | 是否阻塞 interactive |
| --- | --- | --- | --- |
| app runtime / MCP deeplink listener | main app shell | setup/onMounted 前后保持现有无 race 时序 | 否 |
| bootstrap snapshot | `ChatTabView` route host | `snapshot-loading` | 是 |
| shell snapshot application + route initialization | `ChatTabView` route host | `shell-hydrated` | 是 |
| first session page | `ChatTabView` route host | shell snapshot 后；fallback 也必须选择 route 后 | 否 |
| UI settings/provider initialization | main app shell | 与 snapshot 并行 | 否 |
| agents/projects/models/ollama | `ChatTabView` route host | route 初始化后并行 | 否 |
| icon loading | main app shell | app mount | 否 |
| deferred hydration | `ChatTabView` route host | interactive 后 | 否 |

## 依赖规则

目标目录（逐步迁移，不要求 Phase 0 一次完成）：

```text
src/renderer/src/
  apps/          # 每个 renderer app 的 composition root / entry-adjacent assembly
  features/      # feature-local views, composables, state composition
  platform/      # browser/runtime infrastructure, app lifecycle helpers
  foundation/    # renderer-only pure utilities、types、tokens
```

- `apps` 可以组合 `features`、`platform`、`foundation` 与 `api`。
- `features` 可以依赖 `api`、跨进程 contracts、`platform` 与 `foundation`，不得 import 另一个 app 的 composition root。
- `platform` 不得 import feature UI；`foundation` 不得 import Vue、Pinia、IPC 或 feature/app 模块。
- `renderer/api/*Client` 是唯一 transport adapter；不得新增 `platform/bridge/*` 或按业务领域转发所有 client 的 facade。
- `src/renderer/services/*` 仅承载两个及以上 renderer app 真正共享的 renderer-only
  implementation；必须通过窄 alias 暴露，且不得反向 import 任一 app root、store、feature
  或 composition runtime。每个 webContents 仍创建自己的模块实例，不共享运行时单例。
- 每个 app 创建自己的 Pinia/plugin 实例。可共享 store 定义、types 与 pure utilities，不可共享运行中的 store 实例。
- settings → chat-app 的既有直接 import 是批准的历史基线；Phase 0 后不得新增，后续仅能减少或用明确 contract 替换。

## 验收标准

1. SDD 明确记录上述 ownership、状态、目录与依赖约束，且没有 `[NEEDS CLARIFICATION]`。
2. 主窗口 session 首屏请求只由 route host 在 bootstrap shell 写入后触发；完整 app + route host 组合中只产生一次首屏 session request。
3. bootstrap 成功和失败 fallback 都能得到确定 route，且不会阻塞 interactive readiness。
4. runtime/deeplink listener 的注册与 cleanup 有测试；settings 保持 setup 阶段早注册。
5. ChatPage keyed remount 仍恢复最近测量缓存。
6. architecture baseline 记录五个 app、`browser`/`browser-overlay` 状态，以及 settings → chat-app import 数；增量校验会拒绝新增该跨 app import。
7. 相关测试、format、i18n、lint 与类型检查通过。
