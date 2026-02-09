# Hooks 与 Webhook 通知（DeepChat）

## 背景

DeepChat 目前已有系统通知（OS Notification）与 UI 内提示，但缺少一套“可配置、可复用、可路由”的通知能力：

- 用户希望在关键生命周期点触发通知（例如：开始/结束、工具调用前后、权限请求等）。
- 用户希望用 **一个命令输入框** 快速接入任意 webhook（例如 `curl`/`node` 脚本），并在 Settings 里一键测试。
- 同时提供 **内置 Telegram / Discord / Confirmo** 常用通道，简单配置参数后勾选要推送的事件即可。

本功能只做“通知/观测”，不改变 DeepChat 的执行语义。

## 目标

- 在 Settings 中提供三类能力（均可启用/禁用，默认关闭）：
  - **Telegram 通知**：全局配置（token/chatId/threadId）+ 事件勾选 + Test
  - **Discord 通知**：全局配置（webhookUrl）+ 事件勾选 + Test
  - **Confirmo 通知**：检测本地 hook 文件存在后可启用 + Test（默认全部事件）
  - **Hooks Commands**：每个生命周期事件一个 command 输入框（右侧 Test）+ 每事件启用/禁用
- Hooks command 执行契约：
  - 每次触发将事件 payload 以 **stdin JSON** 传入命令
  - 捕获 stdout/stderr/exit code，仅用于诊断与日志（不阻断主流程）
- Telegram/Discord 采用 outbound HTTP 请求（webhook/API），不做交互式组件、不接收回调。
- Confirmo 采用本地 hook 执行（stdin payload），不做交互式组件。
- 不读取/合并任何外部配置文件；所有配置仅由 DeepChat Settings 管理。

## 非目标（v1）

- 不提供双向 bot 交互（按钮、指令、回调、鉴权登录）。
- 不提供复杂模板系统（仅提供固定内置消息格式；高级自定义由 command hooks 覆盖）。
- 不提供“阻止/中止/改写”的 hooks 能力（exit code/输出不会影响工具与权限流程）。
- 不提供按事件分别配置 Telegram/Discord 参数（仅全局配置 + 事件勾选）。

## 用户体验（Settings）

### 入口

在 Settings 增加一个页面或 section：`Notifications & Hooks`（建议独立页面，避免塞进现有 DisplaySettings）。

### 页面布局（从上到下）

1. Telegram 卡片（顶部）
2. Discord 卡片
3. Confirmo 卡片
4. Hooks Commands 卡片（生命周期列表）

卡片交互参考知识库配置的模式：外层卡片 + Switch 启用/禁用 + 可折叠内容区域。

### Telegram 卡片

- Enable（Switch）
- Bot Token（password input，可 reveal）
- Chat ID（text input）
- Thread ID（可选，text/number input，对应 `message_thread_id`）
- Events（多选勾选要推送的生命周期事件；默认建议勾选“重要事件”）
- Test（按钮）：发送一条测试消息，不依赖真实会话

### Discord 卡片

- Enable（Switch）
- Webhook URL（password input，可 reveal）
- Events（多选勾选要推送的生命周期事件）
- Test（按钮）：发送一条测试消息

### Confirmo 卡片

- Enable（Switch；仅在检测到 hook 文件后可用）
- 默认发送全部事件，无需配置事件类型
- Test（按钮）：触发一次测试通知
- 若未检测到 `~/.confirmo/hooks/confirmo-hook.js`，整卡片不可用并提示路径

### Hooks Commands 卡片

- Enable Hooks Commands（Switch）
- 生命周期事件列表（每行）：
  - 事件名（label）
  - Enable（Switch，便于保留 command 但临时停用）
  - Command（单行 input；留空视为未配置）
  - Test（按钮，位于输入框右侧）：触发一次“模拟事件”，执行该 command

Test 结果展示（每行/每通道均需要）：

- success/failed
- 耗时（ms）
- exit code（command）
- stdout/stderr 摘要（最多 N 字符，避免 UI 卡顿）
- 错误信息（HTTP status、429 退避信息、网络错误等）

## 生命周期事件（Hook Events）

> 事件名为 DeepChat 内部稳定 API（建议保持 PascalCase 以便脚本易读）。

| Event | 触发时机（主链路） | 关键字段（payload） |
| --- | --- | --- |
| `SessionStart` | 一次生成链路开始（准备调用 LLM 前） | `conversationId`、`workdir`、`providerId`、`modelId` |
| `UserPromptSubmit` | 用户提交消息后、调用 LLM 前 | `promptPreview`、`messageId` |
| `PreToolUse` | 工具调用执行前 | `tool.name`、`tool.callId`、`tool.paramsPreview` |
| `PostToolUse` | 工具调用成功后 | `tool.name`、`tool.callId`、`tool.responsePreview` |
| `PostToolUseFailure` | 工具调用失败后 | `tool.name`、`tool.callId`、`tool.error` |
| `PermissionRequest` | 出现权限请求时 | `permission.*`（tool/permissionType/description/options） |
| `Stop` | 生成停止（用户停止/完成/错误） | `stop.reason`、`stop.userStop` |
| `SessionEnd` | 一次生成链路结束（finalize） | `usage?`、`error?`、`stop?` |

说明：

- 以上事件是 v1 必须落地的最小集合；后续可增量增加更多事件，但不能修改既有事件语义与字段含义。
- Telegram/Discord 的 “Events 多选” 与 Hooks Commands 的事件列表保持同一集合，便于用户理解；Confirmo 默认全部事件。

## Hook Command 执行契约

### 输入（stdin）

触发时将 payload JSON 写入 stdin，一次性写入并关闭 stdin。

建议 payload 结构（v1）：

```jsonc
{
  "payloadVersion": 1,
  "event": "PreToolUse",
  "time": "2026-02-09T18:00:00.000Z",
  "isTest": false,
  "app": {
    "version": "0.5.7",
    "platform": "win32"
  },
  "session": {
    "conversationId": "conv_xxx",
    "agentId": "agent_xxx",
    "workdir": "C:\\repo\\project"
  },
  "user": {
    "messageId": "msg_xxx",
    "promptPreview": "Summarize the diff..."
  },
  "tool": {
    "callId": "toolcall_xxx",
    "name": "execute_command",
    "paramsPreview": "{\"command\":\"pnpm test\"}"
  },
  "permission": null,
  "stop": null,
  "error": null
}
```

字段策略：

- `*Preview` 字段默认应为“截断后的摘要”，避免把完整敏感内容外发；如需完整内容，推荐用户用 command hooks 自己读取上下文（或未来新增显式开关）。
- Telegram/Discord 使用简洁卡片文本，不发送原始 payload；原始 payload 仅用于 Hooks Commands / Confirmo。
- `isTest=true` 用于区分 Settings 的 Test 触发，脚本可据此避免产生副作用。

### 进程与环境

- 使用 `child_process.spawn` 执行 `command`（建议 `shell: true` 以支持用户常见的 `&&`/管道）。
- `cwd`：优先使用当前会话的 `workdir`；若不可得，则回落到应用记录的最近 workdir；再回落到 `process.cwd()`。
- `timeout`：v1 可用固定默认（例如 30s），后续再支持可配置。
- env：可附加少量只读变量，便于脚本快速取用（可选）：
  - `DEEPCHAT_HOOK_EVENT`
  - `DEEPCHAT_CONVERSATION_ID`
  - `DEEPCHAT_WORKDIR`

### 输出（stdout/stderr/exit code）

- stdout/stderr：仅记录与展示摘要（Diagnostics），不做结构化解析要求。
- exit code：仅用于标记成功/失败（Diagnostics），不影响 DeepChat 主链路。

## 内置通道：Telegram

### 配置

- `enabled: boolean`
- `botToken: string`（secret）
- `chatId: string`
- `threadId?: string`（可选，映射到 `message_thread_id`）
- `events: HookEventName[]`

### 发送

- Endpoint：`POST https://api.telegram.org/bot{token}/sendMessage`
- Body（JSON）：`chat_id`、`text`、可选 `message_thread_id` 等
- 文本长度限制：`text` 1-4096 字符（超出需截断）

### 建议默认消息格式

卡片式文本，字段简洁，突出事件与时间即可。

## 内置通道：Discord（Incoming Webhook）

### 配置

- `enabled: boolean`
- `webhookUrl: string`（secret）
- `events: HookEventName[]`

### 发送

- `POST webhookUrl`
- Body（JSON）：`embeds`（卡片）+ `allowed_mentions: { parse: [] }`（避免误 @），`content` 可选
- 采用 embeds 形成卡片式消息（符合 Discord message object 结构）

## 内置通道：Confirmo（Local Hook）

### 配置

- `enabled: boolean`
- `events: HookEventName[]`（固定为全部事件，Settings 不提供选择）
- 可用性：仅当 `~/.confirmo/hooks/confirmo-hook.js` 存在时可启用

### 执行

- 使用内置 Node（如存在）执行 `confirmo-hook.js`，否则调用系统 `node`
- 通过 stdin 写入 payload JSON（与 Hooks Commands 相同）

## 触发与分发策略（运行时）

当事件发生时，异步分发到以下目标（互不影响）：

1. Hooks Commands：若该事件启用且 command 非空，则执行
2. Telegram：若 enabled 且该事件在 events 列表中，则发送
3. Discord：同上
4. Confirmo：若 enabled 且该事件在 events 列表中，则执行

要求：所有分发均为 **best-effort**，不得阻塞 LLM/工具调用主流程。

## 可靠性与保护

- **串行队列**：Telegram/Discord 分别串行发送，保持顺序并降低限流概率。
- **429 退避**：遇到限流按平台返回的等待时间进行重试（上限次数），最终失败写日志即可。
- **截断**：按平台长度限制截断并在末尾加 `…(truncated)`。
- **脱敏**：对日志与 diagnostics 做脱敏（token、webhookUrl、Authorization 等）。

## 依赖与实现建议

尽量复用现有依赖，避免引入新包：

- Schema：`zod`（已在 dependencies）
- HTTP：优先用 Node `fetch`（Node 20）或复用现有 `axios`
- Command：`child_process`（必要时复用 `cross-spawn`）
- 日志：`electron-log`（已存在）

## 外部参考（实现用）

```text
Telegram Bot API sendMessage:
https://core.telegram.org/bots/api#sendmessage

Discord webhook rate limit note (Safety Center, for reference):
https://discord.com/safety/using-webhooks-and-embeds
```

## 已确认决策（来自需求）

1. 仅仅通知（不阻断流程）。
2. 按 DeepChat 设计，不要求完全照抄任何外部实现。
3. webhook 就够（Telegram/Discord 仅 outbound；无交互），Confirmo 走本地 hook。
4. 所有配置都在 Settings 完成；Telegram/Discord/Confirmo 置顶且全局配置；生命周期事件每个只提供一个 command 输入框 + 右侧 Test。
