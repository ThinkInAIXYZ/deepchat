# Hooks 与通知（兼容 Claude Code Hooks）

## 背景

DeepChat 当前已具备基础通知能力（renderer toast + main 系统通知），但缺少一个“可配置、可路由、可复用生态脚本”的通知/自动化层。

Claude Code 的 Hooks 机制提供了一套成熟的生命周期钩子：在关键阶段触发脚本（stdin JSON + stdout/exit code 决策），社区已有大量现成脚本可直接复用（如：自动跑测试、推送 Telegram/Discord、审计日志）。

本规格目标是把 DeepChat 的内部生命周期抽象成 Claude Hooks 兼容的事件面，并在此基础上提供“开箱即用”的 Telegram/Discord 通知路由。

## 目标

- Claude Code Hooks **配置结构与执行契约兼容**，优先完整支持 `type: "command"` hooks（含 `timeout` / `async` / `description` / `matcher`）。
- 在 DeepChat 的关键生命周期点触发 hooks（覆盖“用户提交 → 生成 → 工具调用/权限 → 完成/停止”的主链路）。
- 兼容 Telegram / Discord 两种常用平台：
  - 用户只需填 token/webhook 等信息 + 勾选事件，即可把指定消息推送到对应 bot。
  - 提供“Test”按钮验证配置可用性。
- 安全与隐私默认更保守：
  - 外发通知默认不包含完整用户输入/模型输出，只发摘要（可在 UI 里提升细节级别）。
  - 项目级 hooks 默认不执行，需显式信任当前 workdir。
- 可靠性：发送队列、平台长度限制截断、失败重试/退避、可观测日志。

## 非目标（v1）

- 不实现 Claude 的 `type: "prompt"` / `type: "agent"` hooks（可解析并在 UI 标注“不支持”，但不执行）。
- 不实现 Claude 插件 hooks、skill/agent frontmatter hooks、组织策略 hooks 的完整兼容（保留扩展点）。
- 不支持 hooks “阻止/中止”语义：即使 hook 返回 `permissionDecision: "deny"` 或 exit code `2`，v1 也仅记录与通知，不影响 DeepChat 的工具执行、权限流转与生成流程。
- 不强行补齐 DeepChat 目前不存在的语义：`TeammateIdle`、`PreCompact` 等事件允许配置但默认不会触发。
- 不提供复杂模板语言（v1：预设模板 + 简单变量插值；高级模板后续迭代）。

## 术语

- Hook event：生命周期触发点（如 `PreToolUse`）。
- Matcher group：在某个 hook event 下，对“何时触发”做过滤的规则块（Claude 术语）。
- Hook handler：被触发执行的单元（v1 仅 command handler）。
- Notifier：通知通道（System / Telegram / Discord）。

## Claude Code Hooks 兼容范围

兼容目标聚焦在 **settings 配置结构** 与 **command hooks 的执行契约**，以便最大化复用现有脚本生态；但 DeepChat 会保留自身会话/事件模型，不保证 Claude `transcript_path` 文件格式完全一致（见下文）。

### Hooks 配置来源（locations）

Claude Code Hooks 文档定义了多种来源。DeepChat v1 建议支持以下三种 JSON 文件读取（可在 UI 中开关）：

- `[User]`：`~/.claude/settings.json`（全局）
- `[Project]`：`<workdir>/.claude/settings.json`（可提交到仓库）
- `[Project Local]`：`<workdir>/.claude/settings.local.json`（建议 gitignore）

DeepChat 自身还需要一个“UI 管理的配置”存储（Electron Store），用于：
- 保存 Telegram/Discord 配置（敏感信息）
- 保存 DeepChat 的路由偏好与隐私选项
- （可选）保存一份“内置 hooks 配置”（如果用户不想依赖 `.claude/` 文件）

### Hook 配置结构（schema）

按 Claude 文档，hooks 配置在 settings 文件中通常形如：

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "write_file",
        "hooks": [
          {
            "type": "command",
            "command": "node scripts/notify.js",
            "timeout": 60000,
            "async": false,
            "description": "Notify on file writes"
          }
        ]
      }
    ]
  }
}
```

DeepChat v1 支持：
- Hook event（对象 key）与 matcher group 的结构
- handler `type: "command"` + `command` / `timeout` / `async` / `description`
- matcher 的通配（见“Matcher 语义”）

DeepChat v1 不支持（但应在 UI 中显式提示）：
- `type: "prompt"` / `type: "agent"`
- 插件/skills/组织策略来源

### 执行契约（stdin / env / stdout / exit code）

#### 输入（stdin JSON）

command hook 从 stdin 接收一个 JSON 对象，至少包含 Claude 文档的公共字段：

- `session_id`
- `transcript_path`
- `cwd`
- `hook_event_name`

以及各事件的特定字段（例如工具类事件含 `tool_name` / `tool_input`）。

DeepChat 需要保证字段命名与 Claude 一致；DeepChat 自己的额外信息建议放入命名空间字段，避免与 Claude 字段冲突：

```jsonc
{
  "session_id": "assistantMessageId",
  "transcript_path": "C:\\Users\\...\\.deepchat\\sessions\\<conversationId>\\hooks\\hook_<assistantMessageId>.jsonl",
  "cwd": "C:\\repo",
  "hook_event_name": "PreToolUse",
  "tool_name": "write_file",
  "tool_input": { "...": "..." },
  "deepchat": {
    "conversation_id": "xxx",
    "provider_id": "openai",
    "model_id": "gpt-4.1",
    "tab_id": 1
  }
}
```

`transcript_path` 指向 DeepChat 生成的 hooks 记录文件（建议 JSONL：每行一个事件/结果），用于调试与脚本按需读取；其字段结构以 DeepChat 为准，不需要与 Claude 完全一致。

#### 环境变量（env vars）

为兼容现有脚本，DeepChat 在执行 command hook 时应设置与 Claude 相同的环境变量（至少）：

- `CLAUDE_PROJECT_DIR`：当前 workdir（绝对路径）
- `CLAUDE_SESSION_ID`
- `CLAUDE_TRANSCRIPT_PATH`
- `CLAUDE_HOOK_EVENT_NAME`
- `CLAUDE_HOOK_MATCHER`
- `CLAUDE_HOOK_DESCRIPTION`
- （工具类事件）`CLAUDE_TOOL_NAME` / `CLAUDE_TOOL_INPUT`（JSON 字符串）
- （通知事件）`CLAUDE_NOTIFICATION_TYPE`

此外，Claude 允许在 `SessionStart` hooks 中通过 `CLAUDE_ENV_FILE` 持久化后续 hooks 的环境变量：
- DeepChat 需要在每个 hook session 生成一个 `CLAUDE_ENV_FILE` 路径（位于该 session 的临时目录/会话目录），并注入到 SessionStart hook 的 env。
- SessionStart 执行结束后，DeepChat 解析该文件中的 `export KEY=VALUE` 语句（简单子集即可），把变量合并到当前 hook session 的“额外 env”，并在后续 hook handler 执行时一并注入。

#### 输出（stdout JSON 或文本）

对齐 Claude 行为：
- 若 stdout 能解析为 JSON，并包含 Claude 文档定义的决策字段，则作为“结构化输出”处理。
- 否则把 stdout 当作“附加上下文”（additional context）：
  - 对 Claude 而言：会被注入到模型上下文。
  - 对 DeepChat 而言：v1 **不注入**到模型上下文，仅记录日志（减少 prompt 注入与数据泄露风险）。

#### 退出码（exit code）

DeepChat v1 仅用于诊断与通知：
- 记录 hook 的退出码与 stderr（用于 UI Diagnostics + 日志）。
- 若 hook 返回 exit code `2` 或结构化输出包含 `permissionDecision: "deny"`，v1 仍 **不会阻止/中止** 任何 DeepChat 行为（仅记录“deny”结果）。

### Matcher 语义（v1 建议）

Claude hooks 的 matcher 是“按事件不同，匹配不同字段”的过滤器。DeepChat v1 建议实现：

- `matcher` 为空：总是匹配
- `matcher` 为字符串：支持 `*` 通配（minimatch 风格的最小子集即可）
- 匹配目标（按事件）：
  - `SessionStart`：匹配 `source`（如 `startup` / `resume` / `clear`）
  - `Notification`：匹配 `notification_type`
  - `PreToolUse` / `PermissionRequest` / `PostToolUse` / `PostToolUseFailure`：匹配 `tool_name`
  - `Stop`：可匹配 stop reason（若 DeepChat 能提供），否则仅支持 `*`

## DeepChat 生命周期映射（Claude Hook Events）

DeepChat 需要在 main 进程定义一套“Hook Session”概念：一次用户提交到一次助手回复结束（含工具循环）为一个 session。

建议 mapping（v1）：

| Claude Hook Event | DeepChat 触发点 | 说明 |
|---|---|---|
| `SessionStart` | 每次开始生成 assistant 回复前（stream 启动前） | `session_id = assistantMessageId`；`cwd = workdir`；`source` 以 `startup/resume/clear` best-effort 推断 |
| `UserPromptSubmit` | 用户消息落库后、调用 LLM 前 | 可用于审计/通知；v1 仅通知，不支持阻止 prompt |
| `PreToolUse` | 工具调用执行前（ToolCallProcessor 调用 MCP/agent 工具前） | 标准 provider 路径可完整支持；ACP 模式仅能 best-effort（收到 tool_call_start 时触发） |
| `PermissionRequest` | 需要用户授权时（permission-required 产生时） | 与 DeepChat 现有 Permission UI 对齐 |
| `PostToolUse` | 工具成功返回后 | 可用于记录 tool_output 摘要 |
| `PostToolUseFailure` | 工具抛错/失败后 | tool_error 建议截断 |
| `Stop` | 本次生成正常结束（provider stop） | v1 仅通知，不支持阻止 stop（避免无限循环） |
| `Notification` | DeepChat 产生“需要用户注意”的系统事件时 | 如：权限请求、工具失败、更新提示等；`notification_type` 由 DeepChat 定义并文档化 |
| `SessionEnd` | 本次生成结束（success/error/userStop） | `reason` 建议取 `success` / `error` / `user_stop` |

其余 Claude 事件（`SubagentStart/Stop`、`TaskCompleted`、`TeammateIdle`、`PreCompact`）在 DeepChat v1：
- 允许在配置中出现，但默认不触发（UI 需提示“当前版本不支持/不会触发”）
- 若未来引入“子代理/任务系统/压缩”语义，再补齐映射

## Telegram / Discord 通知设计

### 通道与路由（Routing）

DeepChat v1 不要求用户写脚本；提供一套“事件 → 通道”的路由配置：

- 每个通道（Telegram / Discord）可勾选订阅的事件（上表的 hook events 子集）
- 每个事件可选“过滤器”（matcher，默认 `*`）：
  - 常见用法：只对 `PermissionRequest` 或只对 `execute_command` 失败发通知
- 每个通道可配置“细节级别”（默认摘要）：
  - `minimal`：仅事件名 + 会话标题 + 状态
  - `normal`：追加 tool_name / 错误摘要
  - `verbose`：追加 prompt/tool_input 预览（强提示：可能泄露敏感信息）

该路由系统与 Claude hooks 可并行存在：用户既可以复用现成 `.claude` hooks 脚本，也可以只用内置 Telegram/Discord。

### Telegram（Bot API）

推荐方案：直接调用 Telegram Bot API 的 `sendMessage`（无需额外依赖库）。

建议 UI 配置项：
- `enabled`
- `botToken`（secret）
- `chatId`（支持数字 chat id 或 `@channelusername`）
- `messageThreadId`（可选，Topics）
- `parseMode`：`None | MarkdownV2 | HTML`（默认 None，避免转义复杂）
- `disableNotification`（可选）

实现要点：
- `POST https://api.telegram.org/bot<TOKEN>/sendMessage`
- `text` 长度限制：1-4096（需要截断）
- 失败处理：尊重 `429` 的 `retry_after`（如返回），并队列退避重试

### Discord（Webhook 优先）

推荐方案：优先支持 Incoming Webhook（配置最简单、无需 bot token）。

建议 UI 配置项（Webhook 模式）：
- `enabled`
- `webhookUrl`（secret）
- `threadId`（可选，用于 forum/media channel）
- `username` / `avatarUrl`（可选）
- `suppressMentions`（默认开启：发送时附带 `allowed_mentions: { parse: [] }`）

实现要点：
- `POST /webhooks/{webhook.id}/{webhook.token}`
- 至少提供 `content`/`embeds`/`files` 之一；v1 仅发 `content`（可选 embed）
- `content` 限制：2000 字符（需要截断）
- 失败处理：尊重 Discord `429`（`retry_after`/`Retry-After`）并退避

说明：v1 仅支持 Incoming Webhook，不提供 bot token 模式，也不发送交互式组件（`components`）。

## UI 设计（Settings 窗口）

### 导航入口

在设置窗口新增一个页面（建议路由名：`settings-notifications`，路径：`/notifications`，position：13）。

### 页面布局（草图）

```
Notifications & Hooks
-------------------------------------------------------
[Claude Hooks Compatible]
  ( ) Enable hooks engine
  [ ] Load ~/.claude/settings.json
  [ ] Load <workdir>/.claude/settings.json   (Trust required)
  [ ] Load <workdir>/.claude/settings.local.json (Trust required)
  [View detected hooks] [Open workdir/.claude] [Validate]
  - Unsupported handlers: prompt/agent (count)

[Telegram]
  ( ) Enable
  Bot Token:  [************]  (Reveal) (Test)
  Chat ID:    [          ]
  Thread ID:  [          ] (optional)
  Detail:     minimal | normal | verbose
  Events:     [x] PermissionRequest [x] PostToolUseFailure [ ] SessionEnd ...

[Discord]
  Webhook URL: [************] (Reveal) (Test)
  Thread ID:   [          ] (optional)
  Detail:      minimal | normal | verbose
  Events:      ...

[Privacy & Limits]
  [ ] Include user prompt preview
  [ ] Include tool input preview
  [ ] Include tool output preview
  Max chars per message: [2000/4096 auto]
  Redaction: [x] redact tokens/keys (default)

[Diagnostics]
  Last send status (per channel)
  Open logs
```

### i18n

所有面向用户的文案需新增 i18n key（`src/renderer/src/i18n/**/settings.json` 或对应文件），不要硬编码中文。

## 依赖库建议

- Claude hooks matcher：
  - 推荐：`minimatch`（若用于运行时，需从 devDependencies 移到 dependencies）；
  - 备选：实现最小通配（仅 `*`），先满足主流脚本。
- command 执行：
  - 推荐：Node `child_process.spawn` + `cross-spawn`（项目已依赖 `cross-spawn`），支持 `timeout` + `async`。
- HTTP：
  - 推荐：`undici`（项目已依赖）或直接用 Node 20 `fetch`（由 undici 提供实现）。
- 模板/插值：
  - v1 可不加依赖，做 `{{path.to.field}}` 的最小插值；
  - 若要更强：`mustache`/`handlebars`（后续再评估体积与安全）。

## 安全与隐私

- 默认关闭：hooks engine 与 Telegram/Discord 通道默认不启用。
- 项目级 hooks 信任：
  - 仅在 Settings 页面提供“信任当前 workdir 并启用 project hooks”的显式开关/按钮；未信任时 project hooks 不执行并提示原因（不弹窗打断正常流程）。
- 外发脱敏：
  - 复用 main 侧的 `src/main/lib/redact.ts` 逻辑，对 payload/文本做 token/key 脱敏（尤其是 webhook URL / bot token、Authorization、apiKey 等）。
- 内容最小化：
  - 默认仅发送摘要，不发送原始 prompt/tool_output；verbose 需要用户额外确认。

## 可观测性与故障处理

- 发送队列：每个通道串行发送，避免触发平台限流；支持合并/去重（例如同一 tool_call 失败只通知一次）。
- 重试策略：
  - Telegram：处理 `429` 并按 `retry_after` 等待；其他错误指数退避（上限次数）。
  - Discord：处理 `429`；尊重 `Retry-After` 或 body 中的 `retry_after`。
- 日志：
  - 使用 `electron-log` 记录：触发事件、匹配到的路由、发送结果、错误码与重试信息。

## 测试策略（实现阶段）

- 单元测试：
  - matcher 匹配（`*`/精确匹配/空 matcher）
  - 事件 payload 生成（PreToolUse/PermissionRequest/PostToolUseFailure）
  - 平台长度截断与脱敏
- 集成测试（可选）：
  - 使用本地 mock server 模拟 Telegram/Discord 200/429/500 响应，验证退避与重试。

## 已确认决策

1. 仅做通知：v1 不支持 hooks 阻止/中止语义。
2. `transcript_path` 不需要完全照抄 Claude：按 DeepChat 的 hooks 记录格式设计即可。
3. Discord webhook-only：不支持 bot token；消息不需要交互式组件。
4. Trust/启用流程放在 Settings：不做额外交互弹窗。
