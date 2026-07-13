# displayMessages streaming hot path

## Issue

`displayMessages` 在流式更新时全量遍历 `messageStore.messages`。长会话持续生成时，主线程负担升高，输入响应、滚动 FPS、工具栏悬停可能变钝。

## Impact

- 长会话（数百条消息）流式 token 到达时主线程工作放大为 O(n)
- 与虚拟窗口、测量、Markdown 渲染叠加后体感卡顿

## Suspected root cause / location

- `src/renderer/src/pages/ChatPage.vue`
  - `displayMessages` computed：每次依赖变化遍历全部消息并 `toDisplayMessage`
  - `toDisplayMessage` 虽有 `displayMessageCache`，但流式中仍会逐条做缓存键比对
  - 流式路径通常只有末尾 assistant 高频变化，但计算模型仍检查全部消息
- `messageStore.applyStreamingBlocksToMessage` 就地更新 cache，触发 `messages` 重算

## Fix plan

1. 将稳定历史与流式消息分离：
   - `stableDisplayMessages`：依赖 messageIds / 非流式记录 revision，不因 `streamRevision` 全量重建
   - `streamingDisplayMessage`：仅由当前流式 message id + 内容/revision 驱动
2. `displayMessages` = 稳定列表 +（可选）流式/pending 尾项，保持单轨渲染语义
3. 流式结束后将末尾条目并入稳定路径（现有 cache + persisted revision 即可）
4. 保留 `useMessageWindow` 虚拟窗口；避免在窗口计算前重建全量展示对象

## Task checklist

- [x] 拆分 stable / streaming 展示列表构建
- [x] 确保 pending placeholder、rate-limit ephemeral、无 inline target 的 fallback 仍正确
- [x] 保持 stream-end 同 id 节点复用（无 completion flash）
- [x] 补充或调整 ChatPage / message 相关测试
- [x] format / i18n / lint / 聚焦测试

## Validation

- 长会话 mock 下流式更新时 `displayMessages` 不因仅末尾变化而重建全部缓存条目
- 现有 ChatPage 流式占位、stream-start 稳定 key 行为不回归
- 虚拟窗口裁剪结果与修复前一致（可见窗口消息 id 集合）

## Linked GitHub issue

（未同步；需开发者明确要求后再创建）
