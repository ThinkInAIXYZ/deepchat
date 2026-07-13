# Plan: 助手 pending 占位去重

## 实现方案

1. 扩展 `ChatPage.vue` 的 pending assistant placeholder 状态，创建时记录当前已存在的 assistant message ids。
2. 增加 computed 判断：如果 pending 创建后出现新的 assistant message id，则认为真实助手消息已 materialize，pending 不再渲染。
3. `shouldShowPendingAssistantPlaceholder` 加入该判断，确保 computed 渲染同帧互斥，而不是只依赖异步 watcher 清理。
4. 复用现有 watcher：当 `isStreaming` 为 true 或真实 assistant 已 materialize 时清理 pending placeholder。

## 影响范围

- `src/renderer/src/pages/ChatPage.vue`
- `test/renderer/components/ChatPage.test.ts`
- SDD 文档：`docs/issues/assistant-pending-duplicate/*`

## 兼容性

- 旧 pending 行为保留：无真实 assistant 且未 streaming 时仍显示占位。
- 若历史 assistant 已存在，不会误清理，因为 placeholder 创建时记录 baseline assistant ids。

## 测试策略

- 增加 ChatPage component regression test：发送后先显示 pending；随后注入新的 assistant record，但不设置 `isStreaming`，断言 pending 被隐藏且真实助手保留。
- 跑 `test/renderer/components/ChatPage.test.ts`。
- 跑 `pnpm run typecheck:web`、`pnpm run format`、`pnpm run i18n`、`pnpm run lint`。
- 补跑 `01-launch` E2E，验证基础启动/关闭路径无回归。