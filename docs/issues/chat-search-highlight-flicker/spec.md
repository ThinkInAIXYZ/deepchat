# Chat search highlight flicker

## Issue

聊天搜索开启后滚动聊天记录时，文本可能短暂消失、重绘或高亮闪烁。

## Impact

- 搜索浏览历史时可读性差
- 虚拟列表挂载/卸载与 DOM 高亮 mutation 叠加加重闪动

## Suspected root cause / location

- `src/renderer/src/pages/ChatPage.vue`
  - `watch([visibleDisplayMessages, chatSearchResults])` → `scheduleChatSearchHighlights`
  - `refreshChatSearchHighlights` → `applyChatSearchHighlights`
- `src/renderer/src/lib/chatSearch.ts`
  - `applyChatSearchHighlights` 先 `clearChatSearchHighlights`（拆掉全部 `<mark>`）再遍历文本节点重建
  - 可见窗口变化时查询词未变也会全量 clear + rebuild

## Fix plan

1. 查询词未变化时不要先全量清除再重建：
   - 仅对尚未高亮的新挂载文本节点增量应用
   - 已有 match 节点跳过
2. 查询词变化时再 clear + full apply
3. 「当前命中项」激活（active class）与「匹配 mark 生成」拆开；窗口滚动只补齐 mark，不强制重置 active 以外的 DOM
4. 中长期（本 issue 非目标）：Markdown 层受控渲染搜索词，避免直接操作 Vue 管理的 DOM

## Task checklist

- [x] `applyChatSearchHighlights` 支持同 query 增量应用
- [x] 查询变化时仍正确 clear / rebuild
- [x] ChatPage 刷新路径兼容
- [x] 更新 `chatSearch` 单元测试
- [x] format / i18n / lint / 聚焦测试

## Validation

- 同 query 下重复 `apply` 不清除已有 mark，仅补充新文本节点
- 改 query 后旧 mark 清除并按新词高亮
- 现有 active match / clear 行为保持

## Linked GitHub issue

（未同步；需开发者明确要求后再创建）
