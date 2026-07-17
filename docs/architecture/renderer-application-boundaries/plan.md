# 实施计划

## Phase 0：建立可验证边界与修复启动时序

### 1. 保持 entry 稳定，先记录而不搬迁

保留 [`electron.vite.config.ts`](../../../electron.vite.config.ts) 当前的 HTML entry 和每个 `main.ts`。审计 `browser` 与 `browser-overlay` 的实际消费者、alias 与 TypeScript include 后，再单独删除遗留配置或补齐覆盖范围；不能依据目录名直接重命名或移动 entry。

新分层目录只在需要实际迁移代码时创建到 `src/renderer/src/`：`apps/`、`features/`、`platform/`、`foundation/`。不在 Phase 0 创建空目录或大规模改 import。

### 2. 明确启动 owner，保留并行性

`App.vue` 保留 main app shell 的 listener、图标、UI settings/provider 等工作，但移除其 session prefetch。`ChatTabView.vue` 作为 bootstrap snapshot、shell hydration、route init 和 session 首屏加载的唯一 owner：

1. 请求 bootstrap snapshot。
2. 成功路径应用 active session/project/agent shell snapshot，再初始化 route。
3. fallback 路径先依据现有 session state 初始化 route。
4. 在两条路径都形成确定 shell/route 后，只调用一次 `sessionStore.fetchSessions()`；该请求不阻塞 `isReady`。
5. agent/project/model/ollama 继续 route init 后并行运行，deferred task 继续等待其 settle。

这让 `fetchSessions()` 读取到 `applyBootstrapShell()` 已写入的 active session，同时保留现有首屏并行加载。

### 3. 测试优先

在改启动流程前新增/调整以下测试：

- `App + ChatTabView` 组合只请求一次 session 首屏数据。
- bootstrap active session 先写入，再构建 `listLightweight` 的 `prioritizeSessionId`。
- bootstrap 成功与失败 fallback 均初始化正确 route 并进入 interactive。
- main runtime listener 与 MCP deeplink 的注册/cleanup 保持完整；settings listener 保持 setup 注册。
- ChatPage session keyed remount 的最近测量缓存恢复不回退。
- settings 使用独立 Pinia/启动/readiness 的既有覆盖继续通过。

### 4. 可观察基线与守卫

扩展或新增专用 renderer architecture baseline，至少输出：

- 五个 renderer app 的 entry、HTML entry、别名/TypeScript 覆盖状态；
- `browser` 与 `browser-overlay` 的实际关系；
- settings → `src/renderer/src` 的 direct import 清单及数量；
- 新增跨 app import 的比较基线。

现有 `generate-architecture-baseline.mjs` 主要面向 main-kernel migration；若直接扩展会混淆责任，优先新增 renderer 专用脚本并以 CI/lint hook 明确执行。Phase 0 先确保其可生成可审阅报告；当基线格式稳定后再把“禁止新增”作为 hard failure。

### 5. Phase 1：迁移 chat-main composition root

将现有主窗口 composition implementation 从根目录 `App.vue` 移至 `src/renderer/src/apps/chat-main/ChatMainApp.vue`。根目录 `App.vue` 保留为只渲染 `ChatMainApp` 的兼容 facade；`src/renderer/src/main.ts` 与 `src/renderer/index.html` 不改变，继续作为稳定 entry shim。

本切片保留 `src/renderer/src/router/index.ts` 与 `src/renderer/src/views/ChatTabView.vue` 的路径、路由契约和启动职责：

- `ChatMainApp` 继续承载主窗口的全局 chrome、runtime listener、MCP deeplink、welcome/onboarding 路由协调与 cleanup；
- `ChatTabView` 继续独占 bootstrap snapshot、shell hydration、route init、首屏 session request 与 deferred hydration；
- 不移动 ChatPage 或 feature-local 页面，不新增 IPC facade，也不改变 settings 的独立启动。

验证通过根 `App.vue` 的既有 startup suite 覆盖 compatibility facade，同时运行 `ChatTabView` suite 以确认 bootstrap/session owner 未漂移。

### 6. 后续迁移切片

1. 已将 ChatPage 与现有 page-private composable 原样迁至 `features/chat-page/`；后续逐个继续提取
   页面私有逻辑，并维持 `messageIpc.ts` stream gate 单一 owner。
2. 为 settings 与 chat 真正共享的实现定义小而稳定的 contract，替换历史直接 import。
3. 仅在存在真实跨 feature 编排重复时，提取 application service；不为 IPC client 建转发 facade。

## 兼容性与回滚

- 不改变 IPC channel、client 签名或持久化格式。
- 不更改 Vite HTML entry 路径，因此可直接回滚启动 owner 调整。
- session 单飞语义保留；改动只确保第一个 fetch 的输入在 snapshot 后已就绪。
- fallback 仍在 bootstrap 失败时可用，避免把 startup outage 变为白屏。

## 验证命令

实施完成后执行：

```bash
pnpm exec vitest --config vitest.config.renderer.ts test/renderer/components/App.startup.test.ts
pnpm run test:renderer
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
```

若新 architecture baseline 有脚本，也要在上述命令前后执行并审阅输出。