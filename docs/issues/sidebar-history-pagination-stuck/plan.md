# 实施计划：侧边栏历史会话分页加载卡死

## 目标

修复 #1762：让侧边栏能持续加载并展示全部 regular 历史会话。核心两改 + 一项次要增强。

## 方案概述

### 改动 1 — 分页不再携带子代理会话（页槽修正）

**文件**：`src/renderer/src/stores/ui/session.ts`

将 `loadSessionPage` 中两处分页请求的 `includeSubagents: true` 改为 `false`
（`:512` 首屏、`:551` 翻页）。

- 后端 `newSessions.ts:240` 在 `includeSubagents !== true` 时自动加
  `WHERE session_kind = 'regular'`，使一页 30 条全部为 regular 会话。
- `nextCursor` / `hasMore`（`sessionManager.ts:107-113`、`newSessions.ts:262`）随之只基于
  regular 会话计算，语义与显示层一致。
- 影响面已核实安全（见 spec「影响面评估」）。

### 改动 2 — 加载后自动填充视口（根治"无滚动条→不加载"）

**文件**：`src/renderer/src/components/WindowSideBar.vue`

新增 `ensureSessionListFilled()`：在首屏加载完成、列表渲染更新（`nextTick`）后，检测
`scrollHeight <= clientHeight && sessionStore.hasMore && !sessionStore.loadingMore`，
若成立则 `await sessionStore.loadNextPage()` 并循环复检，直到视口被填满或 `hasMore = false`。

触发时机：
- `onMounted` 首屏 `fetchSessions` 之后；
- `watch(filteredGroups / pinnedSessions)` 或 `watch(sessionStore.sessions.length)` 变化后
  （会话列表内容变化、agent 切换过滤后内容变矮时复检）。

防护：
- 用一个 `isFilling` 本地标志避免并发重入；
- 设置最大循环轮数上限（如 `hasMore` 为真但连续加载无新增时退出）防止异常死循环；
- 复用现有 `performSessionListScrollCheck` 的 96px 阈值常量，逻辑保持一致。

### 改动 3（次要）— 侧边栏搜索接入后端 FTS

**文件**：`src/renderer/src/components/WindowSideBar.vue`（+ 可能 `session.ts` / `SessionClient`）

当前 `matchesSessionSearch` 仅前端过滤。增强为：搜索关键词非空时，调用已有
`sessionClient.searchHistory(query)`（FTS 直查 DB），将命中的历史会话合并进可显示集合。

- 优先复用 `spotlight.ts:305` 已验证的 `searchHistory` 调用方式。
- 加 debounce，避免逐字符请求。
- 若本增强工作量偏大，可拆为独立后续 PR，先合入改动 1+2 即可让"滚动加载"恢复正常。

## 涉及模块

| 层 | 文件 | 改动 |
|---|---|---|
| Renderer Store | `src/renderer/src/stores/ui/session.ts` | `includeSubagents: false` ×2 |
| Renderer 组件 | `src/renderer/src/components/WindowSideBar.vue` | 视口自动填充；（次要）搜索接 FTS |
| Renderer Client | `src/renderer/api/SessionClient.ts` | （次要）如需暴露 searchHistory |

主进程 / DB / 契约层**无需改动**（透传逻辑已正确）。

## 测试策略

- `test/renderer/stores/sessionStore.test.ts`
  - 断言 `loadSessionPage` 发出的请求 `includeSubagents === false`。
  - 断言翻页 cursor 推进、`hasMore` 收敛、`sessions` 累积去重。
- `test/renderer/components/WindowSideBar.test.ts`
  - 模拟 `scrollHeight <= clientHeight && hasMore` 场景，断言 `loadNextPage` 被自动调用
    直到 `hasMore = false`。
  - 模拟首屏已填满视口（`scrollHeight > clientHeight`）时，不应额外自动加载。
- 回归：`pnpm test:renderer` 全绿。

## 兼容性 / 风险

- 分页协议、存储数据、契约类型均不变，无数据迁移。
- 风险点：自动填充循环若与 cursor 异常叠加可能多拉数据 → 用 `isFilling` 标志 + 轮数上限兜底。
- 性能：改动 1 减少传输的无关子代理会话，整体更优。

## 质量门禁

实现后执行：`pnpm run format && pnpm run i18n && pnpm run lint && pnpm run typecheck && pnpm test:renderer`
