# Architecture Simplification Plan

## Workstreams

### 1. Quality Baseline

- 添加 `scripts/generate-architecture-baseline.mjs`，把依赖环、零入边候选、归档引用报告落到 `docs/architecture/baselines/`。
- 维护一份失败测试分组文档，区分真实行为回归、测试陈旧、环境问题。
- 把这批基线纳入文档入口，后续每轮治理都基于同一套报告更新。

### 2. Main Composition / Lifecycle

- 新增 `ConfigQueryPort`、`SessionRuntimePort`、`WindowRoutingPort` 等窄接口。
- 让 `Presenter` 只在 composition root 组装 port；`agentSessionPresenter`、`agentRuntimePresenter` 只依赖 port。
- 首批迁移目标：
  - 会话 UI 刷新
  - 权限批准 / 清理
  - model catalog 查询

### 3. Renderer Transport / State

- 增加 window context helper，避免各处各自读 `window.api`。
- 增加 IPC subscription helper，把 `App.vue`、`stores/ui/session.ts`、`stores/ui/message.ts` 的监听注册收口。
- 把流式状态拆到独立 `stream` store，消息缓存仍保留在 `message` store。

### 4. Archive / Docs

- 首先把开发者导航从历史源码快照切到稳定历史文档。
- 在文档脱钩和 guard 到位后删除历史源码实体。

## Validation

- `pnpm run format`
- `pnpm run i18n`
- `pnpm run lint`
- `pnpm run typecheck`
- 针对本次改动的主链路测试与 composable/store 测试
