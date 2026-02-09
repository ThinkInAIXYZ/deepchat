# Plan: Hooks 与通知（兼容 Claude Code Hooks）

## 交付拆分（建议）

为降低风险，分两步交付：

- **Step 1（核心）**：Claude command hooks 引擎 + 生命周期事件映射 + 基础 UI（启用/来源/信任/校验）+ 日志
- **Step 2（体验）**：Telegram/Discord 内置通道 + 事件路由 UI + Test + 退避重试与脱敏

## Step 1：Claude command hooks 引擎

1. 定义数据模型与校验
   - 新增 shared types（hooks config、event payload、执行结果）
   - 用 `zod` 做 settings JSON 的 schema 校验（容错：未知字段忽略但记录 warning）
2. 配置加载与合并
   - 支持读取 `~/.claude/settings.json`
   - 支持读取 `<workdir>/.claude/settings.json` 与 `.claude/settings.local.json`
   - 增加 project hooks 信任列表（allowlist），未信任时不执行并在 UI 提示
3. HookSession 管理
   - 为每次生成创建 session context：`session_id`、`cwd`、`transcript_path`、额外 env、`CLAUDE_ENV_FILE` 路径
   - 解析 `CLAUDE_ENV_FILE`（最小子集：`export KEY=VALUE`）并合并到后续 hooks env
4. CommandRunner（跨平台）
   - `spawn` 执行 `command`（`cwd`=workdir；超时=timeout；支持 async）
   - stdin 写入事件 JSON；收集 stdout/stderr；解析 JSON 输出（仅用于日志/诊断；v1 不执行阻止/中止语义）
5. 生命周期事件注入（main）
   - `SessionStart`/`SessionEnd`：在 stream 启动/结束处触发
   - `UserPromptSubmit`：在用户消息写入后、调用 LLM 前触发
   - `PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`PermissionRequest`：在 ToolCallProcessor 周边触发；ACP 模式 best-effort
6. Diagnostics
   - electron-log：记录每次事件触发、命中的 matcher、handler 运行耗时与退出码
   - UI 显示“检测到的 hooks 来源 + 不支持 handler 数量 + 最近错误”

## Step 2：Telegram / Discord 内置通知通道

1. NotifierEngine
   - 定义 channel 配置（enabled、secret、detail level、events+matcher）
   - per-channel 串行队列 + 截断（Telegram 4096 / Discord 2000）+ 脱敏（复用 `redact.ts`）
2. TelegramClient
   - `sendMessage`（token/chatId/threadId/disable_notification）
   - 处理 429（retry_after）与指数退避
3. DiscordClient（Webhook）
   - `Execute Webhook`（content + allowed_mentions）
   - 处理 429（Retry-After/retry_after）
4. Settings UI
   - 新增 `settings-notifications` 页面与路由（`src/renderer/settings/main.ts`）
   - 表单：Telegram/Discord 配置 + 事件订阅 + 细节级别 + Test 按钮
   - Trust flow：启用 project hooks 时提示并写入 allowlist
5. i18n
   - 增加 settings 文案 key（多语言最少 zh-CN/en-US）
6. Tests
   - matcher、截断、脱敏、429 退避、路由选择逻辑

## 里程碑验收（Definition of Done）

- hooks engine 可读取 `.claude/settings*.json` 并在 `PreToolUse/PermissionRequest` 等事件触发 command hook
- Telegram/Discord 可通过 UI 配置并测试发送成功
- 未信任 workdir 时不会执行 project hooks，且 UI/日志可见原因
- 不影响现有系统通知与聊天/工具调用主流程（默认关闭）
