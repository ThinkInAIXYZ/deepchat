# Chat stream scroll feedback loop

## Issue

流式回复且自动跟随底部时，消息列表可能出现微小上下跳动；输入法与滚动手感受影响。

根因是程序化 `scrollTop` 写入、行高测量（ResizeObserver）、虚拟窗口与锚点恢复（anchor restore）可能在同一帧序列中互相触发，形成反馈环。

## Impact

- 自动跟随时列表抖动，长流式输出时更明显
- 用户上滑阅读时可能被误判或与程序化滚动冲突
- 主线程 Layout / scroll / ResizeObserver 密度升高

## Suspected root cause / location

- `src/renderer/src/pages/ChatPage.vue`
  - `scrollToBottom` / `scrollDomToBottom`：流式内容变更反复写 `scrollTop`
  - `scheduleViewportAnchorRestore`：测量高度变化后的锚点恢复写 `scrollTop`
  - `applyMessageMeasure`：auto-follow 路径再次 `scrollToBottom`
  - `streamRevision` watcher：再一次 `scrollToBottom`
  - 非 `force` 的 auto-follow 路径未统一 `markProgrammaticScroll`
- `src/renderer/src/components/chat/MessageListRow.vue`
  - 滚动中 `content-visibility: auto` 与固有尺寸切换触发 ResizeObserver → measure
- CSS：`.message-list-container.dc-list-scrolling .message-list-row { content-visibility: auto }`

## Fix plan

1. 将「自动跟随到底部」与「阅读锚点恢复」明确互斥：
   - bottom-following（`initial-bottom` / `auto-follow` 且 `shouldAutoFollow`）时不调度 anchor restore
   - 仅在 anchored-reading / manual-jump 时启用 restore
2. 所有程序化写 `scrollTop` 走统一短时状态（`markProgrammaticScroll`），含 auto-follow 非 force 路径
3. auto-follow 的到底部滚动合并为单帧 rAF，避免 measure + stream watcher 双写
4. measure 在 bottom-following 时只更新高度图；到底部滚动由统一 auto-follow 调度负责（或单次 rAF 合并）
5. 保持现有用户上滑意图（`markUserScrollAwayIntent`）语义

## Task checklist

- [x] 统一 programmatic scroll 标记（含 auto-follow）
- [x] bottom-following 跳过 anchor restore
- [x] 合并 auto-follow `scrollToBottom` 为 nextTick 单次写入
- [x] measure 与 stream watcher 共用 coalesced `scrollToBottom`
- [x] 补充/调整相关单元测试（ChatPage 现有滚动用例）
- [x] `pnpm run format` / `i18n` / `lint` 与聚焦测试

## Validation

- 手动：长流式回复、自动跟随开启时列表无持续微抖
- 手动：上滑阅读后不再被拉回底部；回到底部后恢复跟随
- 测试：`ChatPage` / `MessageListRow` / `useMessageWindow` 相关现有用例仍通过
- 可选：Performance 面板观察 streaming 时 Layout / ResizeObserver / scroll 事件密度下降

## Linked GitHub issue

（未同步；需开发者明确要求后再创建）
