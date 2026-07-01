# Message Delete Confirmation Specification

## 背景

消息 toolbar 的 trash 按钮当前会直接删除消息。截图里的按钮 tooltip 是“删除消息”，点击后通过
`MessageToolbar -> MessageItemUser/Assistant -> MessageListRow -> MessageList -> ChatPage.onMessageDelete()`
一路冒泡，最后调用 `SessionClient.deleteMessage()` 和 main route `sessions.deleteMessage`。

这个路径缺少二次确认，误点会直接删除消息；删除后当前没有 undo。

## 用户需求

作为用户，我点击消息上的删除按钮时，需要先看到确认弹窗。只有我明确确认后，DeepChat 才删除该消息。

## 目标

给消息 toolbar 的删除动作增加二次确认。确认前不得调用删除 API。

Before:

```text
message toolbar
  [copy] [image] [retry] [trace] [branch] [trash]
                                      click -> delete immediately
```

After:

```text
message toolbar
  [copy] [image] [retry] [trace] [branch] [trash]
                                      click
                                        |
                                        v
        +----------------------------------------------+
        | Delete this message?                         |
        | This action cannot be undone.                |
        |                                              |
        |                         [Cancel] [Delete]    |
        +----------------------------------------------+
                                      |
                                      v
                                  confirm -> delete
```

## Acceptance Criteria

1. 点击用户消息或助手消息 toolbar 的 trash 按钮时，只打开确认弹窗，不立即删除。
2. 点击确认按钮后，才调用现有 `sessionClient.deleteMessage(sessionId, messageId)`。
3. 点击取消、按 Escape、关闭弹窗或切换会话时，不删除消息。
4. 只允许同时存在一个待删除消息；再次点击其他消息删除按钮时，待删除目标更新为最新消息。
5. `isReadOnlySession` 为 true 时仍不展示删除入口，也不能触发确认。
6. 确认期间如果 `messageId` 为空、会话变为只读或 session id 变化，确认动作 no-op 并关闭弹窗。
7. 删除成功后继续执行现有 `clearStreamingState()` 和 `loadMessagesAndRehydrate()` 流程。
8. 删除失败时保持现有 console error 行为；弹窗关闭，消息列表以实际数据为准。
9. 用户可见文案走 i18n，不硬编码在组件中。
10. Alert dialog 满足键盘和焦点基础行为：初始焦点、Escape 关闭、取消/确认按钮可 Tab 到达。

## UI 文案

建议新增 keys：

```json
{
  "dialog": {
    "deleteMessage": {
      "title": "Delete this message?",
      "description": "This action cannot be undone.",
      "confirm": "Delete"
    }
  }
}
```

中文：

```json
{
  "dialog": {
    "deleteMessage": {
      "title": "删除这条消息？",
      "description": "此操作无法撤销。",
      "confirm": "删除"
    }
  }
}
```

## 非目标

- 不实现撤销、回收站或软删除。
- 不改变 main process 删除语义。
- 不改变删除单条消息时是否连带后续消息的现有 runtime 行为。
- 不新增全局确认服务。
- 不改变消息 toolbar 的按钮布局。

## Open Questions

Resolved: 使用现有 shadcn `AlertDialog` 做本地确认弹窗，确认后复用现有删除 API。
