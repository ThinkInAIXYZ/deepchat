# Chat 展示模型边界收敛

## 背景

`DisplayMessage`、其 block/usage 契约，以及 assistant block 的可渲染性策略目前定义在
`src/renderer/src/components/chat/messageListItems.ts`。但记录到展示消息的转换、流式尾部拼装、
是否显示空 assistant 消息的决策都由 `features/chat-page` 持有。feature 因而反向依赖 UI 目录以
取得自己的领域展示模型，模型所有权与实际业务所有权不一致。

这些契约同时被 chat list、message block 组件、message store、chat-only composable 与测试使用。
它们不是可复用通用 UI 的模型，而是 chat-page feature 的输入/输出契约。

## 目标

1. 将 `DisplayMessage` 家族、`MessageListItem` 与 assistant block 可渲染性策略迁入
   `src/renderer/src/features/chat-page/model/`。
2. 所有消费者直接引用 feature model，不保留 `components/chat/messageListItems.ts` 作为第二个
   定义或兼容 re-export。
3. 保持类型形状、过滤条件与 compaction 判定完全不变；这是纯模块边界调整。
4. 记录 chat 组件可以依赖该 feature 的**纯 model contract**：model 只依赖 shared types，
   不依赖 Vue、Pinia、IPC、component 或 composable，且不得反向导入消费者。

## 非目标

- 不调整消息转换、流式缓存、虚拟化或 Markdown 渲染逻辑。
- 不变更 `MessageList` / `MessageListRow` 的 props、events 或 template。
- 不迁移通用 renderer foundation，也不改变 IPC/store 数据格式。
- 不在本切片拆分 `ChatStatusBar` 或继续提取 ChatPage viewport 生命周期。

## 验收标准

1. `components/chat/messageListItems.ts` 不再存在，且 renderer 与测试中没有对其的 import。
2. 所有原有导出的 type 和 helper 在 feature model 有同名导出，运行行为保持一致。
3. feature model 不导入 Vue、Pinia、renderer store、renderer API 或 component。
4. `pnpm run format`、`pnpm run i18n`、`pnpm run lint` 和相关 renderer type/test 校验通过。
