# ACP v1 Reliability Implementation Plan

## 总体策略

本次不重写 ACP 子系统，而是在现有模块上补齐协议边界和状态闭环：

- `acpProcessManager.ts` 负责 launch、initialize、client method dispatch、capability snapshot、debug log、session update buffer。
- `acpSessionManager.ts` 负责 `new/load/resume/close/list` 的选择、持久化、listener 注册和 terminal/session cleanup。
- `acpProvider.ts` 负责 chat turn、debug action、renderer 状态事件和 DeepChat stream event 输出。
- `acpMessageFormatter.ts`、`acpContentMapper.ts`、`acpTerminalManager.ts`、`acpFsHandler.ts` 分别收口 prompt、update、terminal、fs 规范。
- shared contracts / presenter types 只增加必要字段，不新增并行的 ACP 框架。

推荐分 5 个可 review 增量落地：capabilities/auth、session lifecycle、prompt/content/update、terminal/fs、UI diagnostics + E2E matrix。

数据所有权原则：DeepChat conversation/message records 是事实源。ACP agent session 是外部 session catalog 和运行时上下文，进入 DeepChat 后必须先形成本地 link，再转换、去重、持久化为 DeepChat 自己的消息和 metadata。

## Runtime Flow

```text
Registry/Local command
        |
        v
Launch subprocess + JSON-RPC stdio
        |
        v
initialize(protocolVersion, clientCapabilities, clientInfo)
        |
        +--> auth required? --> authenticate/logout/debug/UI
        |
        v
resolve DeepChat conversation:
  existing AcpSessionLink -> resume/load remote context
  imported remote session -> attach link + optional load import
  new local conversation -> session/new remote context
        |
        v
bind listener + flush buffered session/update
        |
        v
session/prompt(current user content blocks)
        |
        v
session/update -> mapper -> stream events + state + debug log
        |
        v
cancel/detach/explicit remote close/release terminals/process cleanup
```

## Data Ownership and Sync Model

DeepChat 不把远端 agent session 当作本地数据库的事实源。远端 session 只提供三类信息：

- catalog：`session/list` 返回的 sessionId、cwd、title、updatedAt、`_meta`。
- replay：`session/load` 可能重放历史 update，用于导入远端历史。
- runtime context：`session/resume` 或 `session/new` 后承接新的 prompt turn。

本地用一个 link 记录 DeepChat conversation 与远端 ACP session 的关系：

```typescript
interface AcpSessionLink {
  conversationId: string
  agentId: string
  canonicalWorkdir: string
  remoteSessionId: string
  remoteTitle?: string
  remoteUpdatedAt?: string
  lastImportedRemoteUpdatedAt?: string
  lastImportFingerprint?: string
  importedMessageFingerprints: string[]
  syncState: 'cataloged' | 'imported' | 'attached' | 'stale' | 'error'
}
```

约束：

- 稳定去重 key 是 `agentId + canonicalWorkdir + remoteSessionId`。
- `session/list` 只更新 catalog/link metadata，不创建重复 DeepChat conversation。
- 用户选择导入时，如果 link 已存在，打开/更新已有 DeepChat conversation；如果不存在，创建本地 conversation 并写 link。
- `session/load` 重放内容先进入 staging buffer；转换为 DeepChat message/block 后，再按 message fingerprint 落库。
- fingerprint 使用远端 session id、update type、role/channel、规范化 content、tool id、turn boundary 等字段生成；没有足够字段时仍要在同一次 import 内去重。
- `session_info_update` 只更新 link metadata；本地会话标题只有在“自动标题”状态下才可被建议更新。
- 本地删除或关闭 conversation 默认只 detach link，不调用远端 `session/close`。
- 默认只有两种情况写远端 session：用户在已绑定 conversation 中继续发送 prompt；用户显式选择 `Close Remote Session`。
- 普通 app shutdown、conversation close、process cleanup 只释放本地 handle/listener/terminal，不自动调用远端 `session/close`。

## Protocol 对接设计

### 1. Transports and Registry Launch

- 保持 registry launch spec 为首选：binary > npx > uvx 的现有顺序不变。
- 在 diagnostics 中显示实际 command、args count、distribution type、registry version、local/global version hint。
- 每个初始化、认证、list/resume/close probe 都必须带 timeout；timeout 后清理子进程和其子进程树。
- MCP transport 继续按 `mcpCapabilities` 过滤：`stdio` 默认可用，`http`/`sse` 仅 agent 声明后启用。
- 对 Claude/Codex 这种可能拉起二级 CLI 的 wrapper，E2E probe 需要固定短超时和 cleanup 审计，避免残留进程。

### 2. Initialization and Capability Snapshot

新增一个轻量 snapshot 类型，挂在现有 process handle 上，不新增独立 manager：

```typescript
interface AcpCapabilitySnapshot {
  protocolVersion: number
  agentInfo?: schema.AgentInfo
  agentCapabilities?: schema.AgentCapabilities
  sessionCapabilities?: schema.SessionCapabilities
  promptCapabilities?: schema.PromptCapabilities
  authMethods: schema.AuthMethod[]
  mcpCapabilities?: schema.McpCapabilities
  supports: {
    loadSession: boolean
    sessionList: boolean
    sessionResume: boolean
    sessionClose: boolean
    sessionFork: boolean
    authLogout: boolean
  }
}
```

- `buildClientCapabilities` 只声明 DeepChat 已真实支持的能力。
- 首轮实现中，`fs`、`terminal` 继续声明；`auth.terminal` 只能在 terminal auth flow 完成后声明。
- 初始化失败分三类展示：protocol version mismatch、process exited、timeout。
- 初始化返回的 `models`、`modes`、`configOptions` 统一走 `normalizeAcpConfigState`，并发布 ready event。

### 3. Authentication and Logout

认证入口分三层：

- Presenter/debug：`authenticate(agentId, methodId, workdir?)`、`logout(agentId, workdir?)`。
- Settings/diagnostics UI：展示 auth methods，并提供 Authenticate 按钮。
- Chat flow：遇到 ACP auth required 错误时，停止当前 turn，展示可操作的 auth state。

各 auth method 处理方式：

| Auth type | 对接方式 |
| --- | --- |
| `agent` 或默认类型 | 直接调用 `connection.authenticate({ methodId })`，成功后刷新 status；失败保留错误详情 |
| `env_var` | 在 agent settings 中标出必需 env var；缺失时不启动 prompt；设置后重启 agent 并重新 initialize |
| `terminal` | 在 DeepChat 控制的 terminal/auth runner 中执行 agent 指定流程；完成后重新 initialize；只有该能力完成后才声明 `auth.terminal=true` |

`logout` 只在 `agentCapabilities.auth.logout` 存在时启用。logout 成功后关闭或失效当前 ACP session handle，避免继续使用旧认证上下文。

### 4. Session Lifecycle and Import

`acpSessionManager` 增加 capability-gated lifecycle：

- `listSessions(agentId, cwd?, cursor?)`：循环读取分页，按 workspace 同步 external catalog。
- `importSession(agentId, remoteSessionId, cwd)`：创建或复用 DeepChat conversation，写入 `AcpSessionLink`。
- `resumeSession(agentId, remoteSessionId, cwd)`：仅用于已绑定 conversation 的运行时上下文恢复。
- `detachSessionLink(conversationId)`：解除本地 link，不写远端。
- `closeRemoteSession(agentId, remoteSessionId)`：仅用户显式操作或活跃 runtime cleanup 时调用。
- `loadSession(agentId, remoteSessionId, cwd)`：用于远端历史重放导入。
- `newSession(agentId, cwd, mcpServers)`：只在新的 DeepChat conversation 需要远端上下文时调用。

本地 conversation 打开后的远端上下文恢复优先级固定为：

```text
existing AcpSessionLink + supports.sessionResume -> session/resume
existing AcpSessionLink + supports.loadSession    -> session/load for import/replay, then attach
no AcpSessionLink                                 -> session/new
```

清理策略：

- 用户停止当前生成：只调用 `session/cancel`。
- 用户关闭本地 conversation：默认 detach link，不调用远端 close。
- 用户显式关闭远端 session：若支持 `session/close`，调用 close；然后 release terminal/listener；最后更新 link state。
- agent process 异常退出：标记 handle unhealthy，清理 listener/terminal，不删除用户可恢复的 session id。
- `sessionCapabilities.fork` 先做 debug-only，只有 capability 存在时开放，不进入主聊天流程。

导入策略：

- `session/list` 结果只写 external catalog，不直接生成 messages。
- `session/load` 重放用于导入历史；导入过程先汇总成 DeepChat turn，再落库。
- 已导入过的远端 session 再次同步时，先比较 `remoteUpdatedAt` 和 `lastImportedRemoteUpdatedAt`；未变化则跳过。
- 即使 `updatedAt` 变化，也必须用 message fingerprint 去重，避免重复导入相同 replay 内容。
- 新 prompt turn 由 DeepChat 产生并持久化；agent response 通过 mapper 转换后追加到同一个本地 conversation。

### 5. Session Update Buffer

当前风险是 `session/new` 返回前后，agent 已经发送 `session/update`，但 DeepChat listener 尚未注册，导致 commands/modes/config 早期状态丢失。

修复方式：

- `dispatchSessionUpdate` 找不到 listener 时，不立即 drop；按 `sessionId` 写入短期 buffer。
- buffer 带 TTL 和最大条数，例如 30 秒、每 session 100 条，避免异常 agent 无限占内存。
- `registerSessionListener(sessionId, ...)` 后立即 flush buffer，并保留原始顺序。
- 如果 TTL 过期仍无 listener，再写 debug warning 并丢弃。

### 6. Prompt Turn and Content Mapping

`acpMessageFormatter` 改成当前 turn only：

- 从 DeepChat messages 中提取最后一个 user message。
- 不再把完整历史拼成 `USER:`/`ASSISTANT:` 文本。
- 不再把 temperature、maxTokens 注入 prompt 文本。
- 若 DeepChat session 有 system prompt，只在本地 conversation 首次绑定远端 runtime 时作为 context text 发送一次。
- 每个 content block 先判断 agent `promptCapabilities`，不支持则降级。

输入映射策略：

| DeepChat content | ACP content |
| --- | --- |
| text | `text` |
| local/remote URL attachment | `resource_link` |
| base64 image + image supported | `image` |
| image unsupported | `resource_link` 或文本 fallback |
| audio + audio supported | `audio` |
| audio unsupported | 文本 fallback |
| embedded file/context + embeddedContext supported | `resource` 或 text context |

输出映射策略：

- `agent_message_chunk` -> text stream + content block。
- `agent_thought_chunk` -> reasoning stream + reasoning block。
- image/audio/resource/resource_link 尽量保留结构；UI 暂不支持的类型转可读文本，不丢 debug payload。
- `usage_update` -> turn metadata + debug log；后续可在状态栏展示。
- `session_info_update` -> `AcpSessionLink` metadata；自动标题可以更新，用户手工标题不覆盖。

### 7. Tool Calls and Permission

工具调用保持现有 mapper，但修正语义：

- `tool_call` 表示工具生命周期，不默认当作权限请求。
- 只有 ACP `session/request_permission` 才进入 DeepChat permission overlay。
- `tool_call_update.content` 中的 `terminal`、`diff`、`content`、`locations`、raw input/output 都保留到 block extra/debug。
- permission resolver 增加 timeout 默认 outcome，用户取消或窗口关闭时返回 cancelled。
- remote control 侧沿用现有 permission/question 交互模型。

### 8. File System

`acpFsHandler` 当前方向正确，计划以测试加固为主：

- read/write 继续要求 session workdir 已注册。
- 路径必须在允许 workspace 内；跨 workspace 写入拒绝。
- line number 按 1-based 处理。
- binary file、超大文件、无权限路径给结构化错误。
- `clientCapabilities.fs` 只有 handler 可用时声明；handler 初始化失败时不声明。

### 9. Terminals

`acpTerminalManager` 需要改协议细节：

- `terminal/create` 用 `params.command` + `params.args` 直接 spawn，不拼接 shell 字符串。
- Windows 不默认包 `powershell.exe -Command`；只有 agent 明确要求 shell 时，command 本身就是 shell。
- `params.cwd` 必须 resolve 到允许 workspace 或明确的 fallback；fallback 只能用于无 cwd 的 agent 兼容，并写 warning。
- `outputByteLimit` 超限时从 buffer 开头裁掉，保留最新输出；裁剪必须在 UTF-8 字符边界。
- `terminal/output` 返回当前 buffer、`truncated`、`exitStatus`。
- `kill` 幂等；`release` 释放 PTY 资源但不删除已进入 chat block/debug log 的输出。

### 10. Plan, Modes, Config Options, Slash Commands

- `plan` update 每次替换当前 plan entries，避免重复追加。
- `current_mode_update` 同步 ChatStatusBar 当前 mode。
- `session/set_mode` 继续作为 legacy mode 能力；若 agent 用 config options 暴露 mode，UI 统一展示在 config options 区。
- `config_option_update` 要覆盖 initialize/new/load/resume 后的所有路径。
- `available_commands_update` 进入 active session state；输入框 slash suggestions 使用该 state。
- 用户输入 `/command arg` 仍走普通 `session/prompt`，不新增 agent-specific command RPC。

### 11. Extensibility

- 所有 official update type 必须有已知处理或显式 ignored reason。
- `_meta` 保留在 diagnostics/session metadata 中，不随意解析成业务字段。
- 自定义 extension method/notification 继续走现有 ext debug action；名称必须保持下划线前缀约束。
- 未知 custom update 不打断 turn，只进入 debug log。

## Shared Types and IPC Surface

优先扩展已有 shared presenter/debug 类型：

- `AcpDebugActionType` 增加 `authenticate`、`logout`、`sessionList`、`sessionImport`、`sessionResume`、`sessionDetach`、`sessionCloseRemote`、`sessionFork`。
- 增加 renderer-safe status payload：`authMethods`、`authRequired`、`capabilities`、`externalSessions`、`sessionLinks`、`lastUsage`、`lastSessionInfo`。
- 新 typed route/client 用于 Settings/diagnostics 查询 ACP status 和执行 auth/session debug action；legacy presenter 只保留兼容。
- 所有用户可见 label/error 走 `src/renderer/src/i18n`。

## UI/UX

Settings 中 ACP agent 详情页增加一个紧凑 diagnostics 区，不做独立大页面：

```text
ACP Agent Detail
+--------------------------------------------------+
| DimCode                              Ready  v1    |
| Auth: Not required   FS: on  Terminal: on         |
| Sessions: list/resume/close   Prompt: image       |
+--------------------------------------------------+
| [Authenticate] [Sync Sessions] [Run Diagnostics] |
+--------------------------------------------------+
| Workspace sessions                                |
|  New Session          2026-06-02 10:10 [Import]  |
|  Refactor Thread      linked            [Open]   |
+--------------------------------------------------+
| Last update                                        |
|  available_commands_update: /web, /init           |
+--------------------------------------------------+
```

ChatStatusBar 保持紧凑：

```text
+--------------------------------------------------+
| ACP: DimCode | Mode: Agent | Model: MiMo | / cmds |
+--------------------------------------------------+
```

错误态：

```text
+--------------------------------------------------+
| ACP auth required: Claude Login                  |
| [Authenticate] [Open Diagnostics]                |
+--------------------------------------------------+
```

## Test Strategy

Unit tests:

- capability snapshot parser：完整/缺失/未知字段。
- initialize client capabilities：auth terminal 声明受实现开关控制。
- session lifecycle gate：无 capability 不调用；有 capability 调正确 RPC。
- session import sync：同一 `agentId + workdir + remoteSessionId` 不重复创建 conversation。
- replay idempotency：重复 `session/load` 不重复落 message/block。
- update buffer：`session/update` 早到、listener 后到、TTL 过期。
- prompt formatter：只发送最后 user message；system prompt only once；image/audio/resource fallback。
- content mapper：usage/session info/tool terminal/diff/plan/mode/config/slash commands。
- terminal manager：tail truncation、UTF-8 boundary、args 不拼接 shell。
- fs handler：workspace guard、1-based line、binary/large file error。
- permission resolver：approve/deny/cancel/timeout。

Integration/manual matrix:

- DimCode：init -> list -> new -> commands -> close -> resume -> prompt。
- Claude Code ACP：init -> auth required -> authenticate flow -> cleanup。
- Codex ACP：registry launch spec -> version drift diagnostics -> auth methods。
- Regression：普通 non-ACP chat、MCP permission、DeepChat internal agent 不受影响。

Quality gates:

```bash
pnpm run format
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm test -- test/main/presenter/llmProviderPresenter
pnpm test -- test/main/presenter/acpProvider.test.ts
```

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| 不同 ACP wrapper 对 auth method 字段解释不一致 | diagnostics 显示 raw auth method；未知字段保留 `_meta`；只按官方 required 字段做控制流 |
| Claude/Codex wrapper 拉起子进程后 probe 卡住 | 所有 real-agent probe 必须 timeout + process tree cleanup |
| resume/load/new 语义混用导致历史重复 | DeepChat conversation 为事实源；远端 replay 先 staging 再 fingerprint 去重；prompt formatter current-turn-only |
| terminal command 兼容性变化 | 直接 spawn 是协议正确行为；若 agent 要 shell，agent 应把 shell 作为 command |
| session title 更新覆盖用户标题 | 只更新 ACP metadata；DeepChat 用户手工标题优先 |
