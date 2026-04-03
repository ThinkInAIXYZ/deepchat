# Test Failure Groups

Baseline captured on `2026-04-03`.

## 真实行为回归 / 契约漂移

- `test/main/presenter/newAgentPresenter/integration.test.ts`
  - `configPresenter.getAgentType()` mock 契约缺失暴露了会话编排对配置查询的硬依赖。
- `test/main/presenter/floatingButtonPresenter/*.test.ts`
  - 布局断言和当前窗口吸边行为不一致。
- `test/main/presenter/skillSyncPresenter/*.test.ts`
  - Cursor format / conversion warnings 的行为与测试契约漂移。
- `test/renderer/stores/sessionStore.test.ts`
  - sidebar group 逻辑对 `sessionKind` 缺省值不兼容。
- `test/renderer/composables/useModelCapabilities.test.ts`
  - search capability 返回值未对齐测试预期。

## 测试陈旧 / 遗留测试未跟上实现

- `test/main/presenter/mcpClient.test.ts`
  - 仍然断言旧的 runtime command translation 细节。
- `test/main/presenter/newAgentPresenter/messageManager.test.ts`
  - 仍然调用已不再暴露的方法。
- `test/renderer/composables/useSearchConfig.test.ts`
  - 测试存在，但实现文件缺失。
- `test/renderer/components/MermaidArtifact.test.ts`
  - 组件结构与测试查询方式不再匹配。
- 多个 renderer store test 的 `pinia` mock
  - 当前 mock 方式污染 `setActivePinia/createPinia`。

## 环境问题

- `test/main/presenter/SyncPresenter.test.ts`
  - `better-sqlite3-multiple-ciphers` 二进制与当前 Node ABI 不匹配。
- `test/main/presenter/llmProviderPresenter.test.ts`
  - 用例依赖超时 / 网络模拟不稳定。
- 若干 renderer test 中的 `jsdom` navigation not implemented
  - 不是业务行为错误，而是测试环境能力限制。
