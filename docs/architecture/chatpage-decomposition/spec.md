# ChatPage 分解与竞态治理

## 背景

`src/renderer/src/pages/ChatPage.vue` 已膨胀到 3050 行，单个 `<script setup>` 承载 10+ 个关注点：
会话恢复、消息记录转换、虚拟窗口、测量批处理、手势/滚动、占位符状态机、Plan 快照生命周期、
会话内搜索、语音输入、发送/排队/steer、消息操作。竞态治理靠散落的手写令牌
（`sessionRestoreRequestId`、`voiceInputConfigToken`、`attachmentFilterToken`、
`chatScrollSessionEpoch`、`pendingAssistantPlaceholderSeq`）和大量模块级 `let`，理解成本极高。

## 现状边界（已良好分层，不动）

滚动仲裁已是成熟架构，本次仅把 ChatPage 内的胶水调用归拢，不改其内部时序：

- `useChatScrollController` — 独占滚动通道、状态机驱动、rAF commit/verify。
- `chatScrollState` — 纯 reducer 状态机（mode/userOwned/nearBottom/activeGesture）。
- `chatScrollOperationArbiter` — 物理滚动条独占所有权 + 优先级抢占。
- `chatScrollRequestQueue` — 单槽优先级队列。
- `useMessageWindow` — 虚拟列表布局、测量高度、快照捕获/恢复。
- `recentMessageMeasurementCache` — 最近会话测量 LRU 缓存。

## 目标

1. 主文件收缩到 ~400 行，只做装配 + 模板。
2. 每类竞态由一个自持 epoch/token 的 composable 独立治理，边界清晰。
3. 删除确认的死代码。
4. 行为零漂移：每抽一个 composable 即 typecheck；最终 lint/test/真实应用验证。

## 死代码（确认零引用）

- `composables/message/useMessageScroll.ts`（339 行）— 全项目零引用，旧 vue-virtual-scroller 实现。
- `composables/message/types.ts` 中的 `ScrollInfo` 接口 — 仅被上文件引用（`CaptureOptions` 仍在用，保留）。

## 分解目标（8 个关注点 → 7 个 composable）

| composable | 职责 | 收编的状态/竞态 |
|---|---|---|
| `useSessionRestore` | 会话切换、令牌 gate、恢复 | `sessionRestoreRequestId`、`canWriteSessionView`、启动延迟恢复调度 |
| `useDisplayMessages` | 记录→DisplayMessage、稳定/流式分离、缓存；**并含占位符四态机** | `displayMessageCache`、`assistantRenderKeyByMessageId`、`pendingAssistantPlaceholder` 全套 |
| `useMessageVirtualization` | 窗口范围、测量批处理、锚点补偿、几何观测 | `pendingMeasureQueue`、rAF flush |
| `useListGestures` | wheel/touch/pointer/键盘手势 → 控制器 | ~15 handler、`isListScrolling` |
| `usePlanFloatLifecycle` | Plan 快照跨会话生命周期 + 延迟清除 | `planSnapshotClearTimers`、3 lifecycleKey |
| `useChatSearch` | 会话内搜索（包 `lib/chatSearch`） | 搜索 rAF、highlight 调度 |
| `useComposerSubmit` | 发送/排队/steer/命令/compaction | 统一 gate 后的提交路径、`attachmentFilterToken` |

> 决策记录：原计划独立的 `useAssistantPlaceholder` 并入 `useDisplayMessages`。占位符的
> renderKey 交接直接写入消息转换缓存读取的 `assistantRenderKeyByMessageId`，显隐判定依赖
> `hasFirstStreamingContent` / `ephemeralRateLimitBlock`，占位符行本身注入流式尾部组装；
> 强拆会造成两个 composable 双向共享三份可变状态，不如单一所有者边界清晰。

## 约束

- 每个 composable 自持一个防竞态 epoch/token，替代散落的模块级令牌。
- 不改 `useChatScrollController` 及其协作模块的对外时序契约。
- 优先 shadcn-vue / VueUse（`useEventListener`、`useRafFn` 等）替代手写 rAF/监听器。
- i18n key 不新增；用户可见字符串沿用现有 key。

## 模块位置决策

7 个 composable 放在 `pages/chat-page/` 而非全局 `lib/` / `components/`，是有意的
feature-local 布局：它们是 `ChatPage.vue` 独占的私有逻辑，强耦合页面 props 与页面级
store 组合，不面向复用。就近放置能让读者一眼看出归属、避免误当作通用工具被其他页面引用。
`lint:architecture` guard 通过（未对该布局设硬约束）。若后续有第二个页面需要复用其中某个
composable，再将其上提到 `lib/` 并补通用化改造。
