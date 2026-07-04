# Spec: 助手 pending 占位与真实助手消息瞬时重复

## 用户需要

用户在发送消息后看到过一瞬间出现两条助手消息，随后又恢复为一条。发送后首 token 慢时仍需要 pending assistant 占位，但当真实助手消息已经进入列表时，占位不应继续参与渲染。

## 目标

- 保留发送后立即显示 pending assistant 的反馈。
- 当同一会话中出现新的真实 assistant message record 时，同帧隐藏/清理 pending assistant 占位。
- 避免 pending 占位与真实 assistant row 或 streaming row 短暂并存。

## 验收标准

- 发送后、stream 未开始且无真实助手消息时，仍显示 pending assistant row。
- 如果 stream 开始，pending assistant row 不显示。
- 如果 stream 尚未开始但新的真实 assistant message 已进入 `messageStore.messages`，pending assistant row 不显示。
- 现有 ChatPage 消息渲染测试通过，并新增覆盖真实 assistant 先于 streaming flag materialize 的回归测试。

## 约束

- 不改变消息持久化协议或 IPC 事件结构。
- 不弱化现有 optimistic user message 行为。
- 不引入新的用户可见字符串。

## 非目标

- 不重构整体 streaming 渲染链路。
- 不实现依赖真实 provider 的 E2E 发送测试。

## Open questions

无。