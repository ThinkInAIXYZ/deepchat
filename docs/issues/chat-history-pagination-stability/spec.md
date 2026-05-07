# 会话历史分页稳定性

## 背景

当前未提交改动为会话恢复增加了分页能力，但在 renderer store 和主进程分页实现里引入了三个回归：

1. `loadOlderMessages()` 在异步请求返回后没有校验当前活跃会话，切换线程时可能把旧线程历史写进新线程。
2. `loadMessages()` 每次刷新都只恢复最近 100 条消息，会把用户已经向上加载出来的历史重新截断。
3. 主进程分页通过 `limit + 1` 判断 `hasMore`，但底层 SQL helper 把请求再次限制到 500，导致 `limit=500` 时无法正确探测下一页。

## 目标

- 历史分页请求只能更新发起它的会话，不得污染当前活跃会话。
- 会话刷新应保留用户已经加载出来的历史窗口，避免流结束、重试、删除、工具交互后出现历史截断。
- 保持分页接口现有契约不变，同时修复 `limit=500` 时的 `hasMore` 误判。
- 修复不能让滚动加载、流式渲染或会话切换变卡顿。

## 非目标

- 不重做聊天页的滚动 UI 或消息渲染结构。
- 不修改 `sessions.restore` / `sessions.listMessagesPage` 的对外输入输出结构。
- 不改变消息排序、分页方向或现有默认页大小（100）。

## 约束

- 遵循 typed route / typed client / store 现有边界。
- renderer 继续使用 Vue 3 Composition API 和 Pinia store 模式。
- 保持已有流式事件刷新逻辑可用，避免破坏 `chat.stream.*` 的行为。

## 验收标准

- 当用户在顶部加载旧历史期间切换会话，旧请求返回后不会改写新会话的 `messages`、`nextCursor`、`hasMoreHistory`、`isLoadingHistory`。
- 对同一会话执行刷新时，若用户此前已加载超过 100 条历史，刷新后保留相同数量级的已加载窗口，不回退到最近 100 条。
- `limit=500` 的分页请求在仍有更旧消息时返回 `hasMore=true` 且提供可继续翻页的 `nextCursor`。
- 为上述场景补齐 renderer/main 单测。
