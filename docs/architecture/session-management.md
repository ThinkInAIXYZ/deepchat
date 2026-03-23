# 会话管理架构详解

retirement 之后，会话管理被明确拆成两层：

- 活跃聊天层：`newAgentPresenter` + `NewSessionManager`
- 兼容数据层：`SessionPresenter`

## 当前职责边界

| 组件 | 位置 | 当前职责 |
| --- | --- | --- |
| `NewAgentPresenter` | `src/main/presenter/newAgentPresenter/index.ts` | renderer 唯一 session 入口 |
| `NewSessionManager` | `src/main/presenter/newAgentPresenter/sessionManager.ts` | `new_sessions` 记录、窗口绑定、session CRUD |
| `NewMessageManager` | `src/main/presenter/newAgentPresenter/messageManager.ts` | 新会话消息读取与 agent routing |
| `DeepChatSessionStore` | `src/main/presenter/deepchatAgentPresenter/sessionStore.ts` | 活跃 runtime 状态 |
| `DeepChatMessageStore` | `src/main/presenter/deepchatAgentPresenter/messageStore.ts` | 新消息持久化 |
| `SessionPresenter` | `src/main/presenter/sessionPresenter/index.ts` | legacy conversation/thread/export 兼容层 |
| `sessionPresenter/messageFormatter.ts` | `src/main/presenter/sessionPresenter/messageFormatter.ts` | 用户消息上下文格式化与 exporter 复用 |

## 主链路中的 session 生命周期

```mermaid
sequenceDiagram
    participant R as Renderer
    participant N as NewAgentPresenter
    participant S as NewSessionManager
    participant D as DeepChatAgentPresenter

    R->>N: createSession()
    N->>S: create()
    N->>D: initSession()
    N->>S: bindWindow()
    R->>N: sendMessage()
    R->>N: activateSession()
    N->>S: bindWindow(webContentsId, sessionId)
    R->>N: deleteSession()
    N->>D: destroySession()
    N->>S: delete()
```

## `SessionPresenter` 现在做什么

`SessionPresenter` 仍然保留，但只在 main 内部承担这些事情：

- 旧 `conversations/messages` 数据访问
- 旧线程列表广播
- 旧 conversation 导出
- tab 关闭时的兼容清理挂钩
- 旧消息格式化 helper 复用

它不再承担：

- renderer 主聊天入口
- 旧 runtime session memory
- `AgentPresenter` stream/loop 协调

## 清理后的关键变化

- `SessionPresenter.toSession()` 不再依赖 legacy runtime 内存态。
- 旧 `cleanupLegacyConversationRuntime()` 已收口为中性内部清理方法。
- renderer IPC 不再公开 `sessionPresenter`。

## 什么时候还需要看 `SessionPresenter`

只有在以下场景才需要继续进入 `src/main/presenter/sessionPresenter/`：

- 维护旧 conversation 导出
- 调整 legacy import 后的兼容读取
- 排查 thread list 广播与窗口清理
- 维护 exporter 使用的用户消息归一化

如果是当前聊天会话创建、发送消息、取消生成、tool interaction，请直接从
`newAgentPresenter` 和 `deepchatAgentPresenter` 开始读。
