# Plan: Hooks 与 Webhook 通知（DeepChat）

## 范围与原则

- **仅通知**：不会阻断/中止 DeepChat 的生成、工具与权限流程（hook 失败也不影响主链路）。
- **仅 Settings 配置**：所有配置都由 Settings 管理，不读取/合并任何外部配置文件。
- **Webhook-only**：Telegram/Discord 只做向外发送消息（HTTP 请求），不做双向交互/按钮/回调；Confirmo 走本地 hook。

## 交付拆分（建议）

为降低回归与 UI 复杂度，分两步交付：

- **Step 1（可用）**：Settings 页面 + 配置模型 + Test（Telegram/Discord/Confirmo/每个事件 command test）+ 基础日志
- **Step 2（完整）**：生命周期事件注入 + 真实触发 + 队列/限流/截断/脱敏 + 单元/集成测试

## Step 1：Settings + Test 能力（不接入真实生命周期）

1. 定义数据模型与校验
   - 新增 shared types：`HookEventName`、settings config、event payload、执行/发送结果
   - 用 `zod` 做 settings schema 校验（容错：未知字段忽略，但记录 warning）
2. 配置存储与读取（main）
   - 在现有 config store 中新增 `hooksNotifications` 配置树（默认全关闭）
   - 提供 getter/setter + IPC 通道（renderer 仅通过 IPC 读写，避免在 renderer 暴露 secret）
3. Settings UI（renderer）
   - 新增设置页面（或新增一个 section），布局要求：
     - 顶部：Telegram 卡片（Enable + 参数 + Test + 事件勾选）
     - 其次：Discord 卡片（Enable + 参数 + Test + 事件勾选）
     - 其次：Confirmo 卡片（Enable + Test；默认全部事件；需检测 hook 文件存在）
     - 下方：Hooks Commands 卡片（Enable + 每个生命周期：Switch + 单个 command 输入框 + 右侧 Test）
   - UI 风格参考知识库配置：卡片/折叠 + Switch 控制启用
4. Test 逻辑（main）
   - `testTelegram()`：发送一条 `type="test"` 的通知文本到配置目标
   - `testDiscord()`：同上
   - `testConfirmo()`：执行本地 Confirmo hook（stdin JSON）
   - `testHookCommand(eventName)`：构造一个最小模拟 payload，通过 stdin JSON 执行对应 command
   - Test 结果返回 renderer：success/错误信息 + 状态码 + 用时 + stdout/stderr 摘要
5. i18n
   - 新增 settings 文案 key（zh-CN/en-US），不硬编码中文

## Step 2：接入生命周期 + 可靠性

1. 生命周期事件注入（main）
   - `SessionStart`/`SessionEnd`：每次一次完整生成链路开始/结束
   - `UserPromptSubmit`：用户提交消息后、调用 LLM 前
   - `PreToolUse`：工具调用实际执行前（含 tool name/id/params）
   - `PostToolUse`：工具调用成功返回后
   - `PostToolUseFailure`：工具调用失败（error）
   - `PermissionRequest`：触发权限请求时（含 tool/permission meta）
   - `Stop`：生成停止（含 stop_reason、userStop）
2. Dispatcher（非阻塞）
   - 根据配置把事件分发到：
     - command hook runner（按 event 的 switch+command）
     - Telegram notifier（按 channel enabled + event 勾选）
     - Discord notifier（同上）
     - Confirmo hook runner（同上）
   - 所有分发均异步执行、不可阻断主流程；失败仅记录日志与 diagnostics
3. 队列/限流/截断/脱敏
   - per-channel 串行队列，保持顺序并降低触发限流概率
   - 自动截断：Telegram `sendMessage` 文本 4096；Discord webhook `content` 2000
   - 处理 429：按 `Retry-After`/`retry_after` 等信息退避重试（上限次数）
   - 脱敏：复用 main 侧 `redact.ts`（token、webhook URL、Authorization、apiKey 等）
4. Tests
   - payload builder、截断、脱敏、队列顺序、429 退避、配置 schema
   - 可选：本地 mock server 验证 Telegram/Discord 200/429/500 行为

## 里程碑验收（Definition of Done）

- Settings 可配置 Telegram/Discord（启用/禁用 + 参数 + 事件勾选）并能 Test 成功/失败可见
- Settings 可配置 Confirmo（检测 hook 可用性 + 事件勾选）并能 Test 成功/失败可见
- 每个生命周期事件均可配置单个 command（启用/禁用）并能 Test 执行（展示 exit code/stdout/stderr 摘要）
- 生命周期触发后可按配置向 Telegram/Discord/Confirmo 发送消息（失败不影响主流程，日志可追踪）
- 不读取任何外部配置文件；默认关闭；不影响现有系统通知与聊天主流程
