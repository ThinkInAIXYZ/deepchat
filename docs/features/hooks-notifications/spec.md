# Hooks Commands V2

## 背景

旧版 Hooks 同时承担了三类职责：

- Telegram / Discord webhook 通知
- Confirmo 本地 hook
- 单事件单命令的 command hooks

当前产品方向已经变化：

- Telegram 和 Discord 都已经转向 full-duplex remote control
- Confirmo 不再保留
- Hooks 只需要承担“在生命周期事件上执行自定义命令”这一件事

因此，本规格将 Hooks 重构为单一能力的 command hooks。

## 目标

- `Hooks` 页面只保留 `Hooks Commands`
- 支持配置多组 hooks
- 每组 hook 独立配置：
  - `name`
  - `enabled`
  - `command`
  - `events`
- 每组 hook 都可单独测试
- 运行时按事件异步触发命令，不阻断主流程

## 非目标

- 不保留 Telegram hooks 通知
- 不保留 Discord hooks 通知
- 不保留 Confirmo
- 不做模板系统
- 不做旧 hooks 配置迁移
- 不提供阻断、改写、审批式 hooks

## 配置模型

```ts
interface HookCommandItem {
  id: string
  name: string
  enabled: boolean
  command: string
  events: HookEventName[]
}

interface HooksNotificationsSettings {
  hooks: HookCommandItem[]
}
```

约束：

- `id` 为稳定主键
- `command` 为空时视为未配置
- `events` 为空时，不会在真实事件流里触发
- 测试时若 `events` 为空，默认使用 `SessionStart`

## 生命周期事件

保留原有事件集合：

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PermissionRequest`
- `Stop`
- `SessionEnd`

## 执行契约

### 输入

触发时将 payload JSON 写入 stdin，一次性写入并关闭 stdin。

```jsonc
{
  "payloadVersion": 1,
  "event": "PreToolUse",
  "time": "2026-04-13T12:00:00.000Z",
  "isTest": false,
  "app": {
    "version": "1.0.3-beta.1",
    "platform": "win32"
  },
  "session": {
    "conversationId": "conv_xxx",
    "agentId": "agent_xxx",
    "workdir": "C:\\repo\\project",
    "providerId": "deepchat",
    "modelId": "gpt-5.4"
  }
}
```

### 执行规则

- 使用 `child_process.spawn`
- `shell: true`
- `cwd` 优先取当前会话 `workdir`，否则回退到 `process.cwd()`
- 写入环境变量（当前实现与 `src/main/presenter/hooksNotifications/index.ts` 保持一致）：
  - `DEEPCHAT_HOOK_EVENT`
  - `DEEPCHAT_HOOK_TIME`
  - `DEEPCHAT_HOOK_IS_TEST`
  - `DEEPCHAT_CONVERSATION_ID`
  - `DEEPCHAT_WORKDIR`
  - `DEEPCHAT_AGENT_ID`
  - `DEEPCHAT_PROVIDER_ID`
  - `DEEPCHAT_MODEL_ID`
  - `DEEPCHAT_MESSAGE_ID`
  - `DEEPCHAT_TOOL_NAME`
  - `DEEPCHAT_TOOL_CALL_ID`
  - 如未来实现调整注入变量，以 `src/main/presenter/hooksNotifications/index.ts` 为准
- 固定超时 30 秒

### 输出

- 记录并展示：
  - `success`
  - `durationMs`
  - `exitCode`
  - `stdout`
  - `stderr`
  - `error`
- `stdout/stderr` 只展示截断后的摘要
- 结果只用于诊断，不影响主流程

## Settings 行为

页面结构：

1. 页面标题与说明
2. Hooks Commands 卡片
3. 多组 hook 列表
4. `New Hook` 按钮

每组 hook 提供：

- 名称输入框
- 命令输入框
- 启用开关
- 事件勾选
- Test 按钮
- Delete 按钮

默认新建值：

- `name = Hook N`
- `enabled = false`
- `command = ''`
- `events = DEFAULT_IMPORTANT_HOOK_EVENTS`

## 兼容策略

- 读取到旧版 `telegram / discord / confirmo / commands` 结构时，直接重置为新版默认值：

```ts
{ hooks: [] }
```

- 不迁移旧配置
- 不保留隐藏兼容逻辑

## Remote 侧约束

- Telegram remote 与 hooks 完全解耦
- Discord remote 与 hooks 完全解耦
- Telegram / Discord 只保留 remote control 能力
- Telegram bot token 只存于 remote-control 配置，不再借道 hooks 配置
