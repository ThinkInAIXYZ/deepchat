# ACP v1 Reliability Specification

Last reviewed: 2026-06-02

## 背景

DeepChat 已经具备 ACP agent 的基本启动、初始化、`session/new`、`session/load`、`session/prompt`、文件系统、终端、模式、模型和部分 session update 映射能力。但按 ACP v1 官方协议逐项核对后，当前实现仍有几个影响可靠性的缺口：认证流程未产品化，session lifecycle 不完整，部分通知会丢，Prompt 会重复发送历史，Terminal 输出截断方向不符合规范，部分状态更新没有进入 DeepChat 状态层。

本目标是把 DeepChat 的 ACP 能力修到“全功能可靠”的 v1 版本：按 agent 初始化返回的 capability 精准启用功能，能稳定接入 registry agent、本地 DimCode、Claude Code ACP 和 Codex ACP，且所有协议行为都有测试或手工矩阵覆盖。

会话数据事实源以 DeepChat records 为准。远端 ACP agent 返回的 session 是外部资源目录，DeepChat 只做 workspace 维度的导入、同步和绑定；导入后必须转换成 DeepChat 自己的消息格式并持久化。同步不得反复重复导入，也不得把远端 metadata 直接覆盖用户在 DeepChat 内手工维护的会话数据。

## 资料来源

- ACP v1 官方入口：[Overview](https://agentclientprotocol.com/protocol/v1/overview)
- 关键协议页：[Initialization](https://agentclientprotocol.com/protocol/v1/initialization)、[Authentication](https://agentclientprotocol.com/protocol/v1/authentication)、[Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup)、[Session List](https://agentclientprotocol.com/protocol/v1/session-list)、[Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- 客户端能力页：[Content](https://agentclientprotocol.com/protocol/v1/content)、[Tool Calls](https://agentclientprotocol.com/protocol/v1/tool-calls)、[File System](https://agentclientprotocol.com/protocol/v1/file-system)、[Terminals](https://agentclientprotocol.com/protocol/v1/terminals)
- 状态增强页：[Agent Plan](https://agentclientprotocol.com/protocol/v1/agent-plan)、[Session Modes](https://agentclientprotocol.com/protocol/v1/session-modes)、[Session Config Options](https://agentclientprotocol.com/protocol/v1/session-config-options)、[Slash Commands](https://agentclientprotocol.com/protocol/v1/slash-commands)、[Extensibility](https://agentclientprotocol.com/protocol/v1/extensibility)、[Transports](https://agentclientprotocol.com/protocol/v1/transports)
- 本仓库 registry snapshot：`resources/acp-registry/registry.json`
- 现有 ACP 入口：`src/main/presenter/llmProviderPresenter/acp/*`、`src/main/presenter/llmProviderPresenter/providers/acpProvider.ts`

## 用户故事

- 作为 DeepChat 用户，我可以从 ACP registry 或本地命令启动 agent，并清楚看到该 agent 支持哪些 ACP v1 能力。
- 作为使用 Claude Code ACP 或 Codex ACP 的用户，我可以在 DeepChat 内完成 agent 暴露的认证流程，而不是只看到失败或需要手工猜测环境变量。
- 作为使用 DimCode 的用户，我可以按 workspace 看到远端已有 session，把需要的 session 导入或绑定到 DeepChat 会话，并持续收到 slash commands、模式、配置项和标题更新。
- 作为开发者，我可以通过 ACP diagnostics/debug action 复现每个协议方法，定位 agent、registry、认证、session 或 terminal 问题。
- 作为 reviewer，我可以用固定测试矩阵判断 ACP 是否符合 v1 协议，而不是只依赖单 agent 的 happy path。

## 成功标准

- `initialize` 会声明 DeepChat 实际支持的 client capabilities，并保存 agent 返回的完整 capabilities、auth methods、agent info。
- 所有可选协议方法都按 capability gate 调用；没有 capability 时不调用、不误报。
- `authenticate`、`logout`、`session/list`、`session/resume`、`session/close` 有可复用 presenter/debug 入口。
- `session/update` 不会因为 listener 注册时序丢失早期通知，尤其是 DimCode 的 `available_commands_update`。
- `session/prompt` 只发送当前用户 turn，按 prompt capabilities 发送 text/image/audio/resource/resource_link。
- `terminal/create/output/wait_for_exit/kill/release` 符合 output byte limit 和 command args 语义。
- `usage_update`、`session_info_update`、plan、mode、config options、slash commands 都能进入 DeepChat 状态或 debug log。
- DeepChat conversation 是最终持久化事实源；远端 session list/load/resume 只建立或更新 `AcpSessionLink`，不会重复创建同一远端 session 的本地会话。
- 远端历史消息导入会先转换为 DeepChat message/block 格式，再按稳定 fingerprint 去重持久化。
- 完成后运行 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`、`pnpm run typecheck` 和 ACP 相关 Vitest。

## 本地 agent 样本

| Agent | Registry/local observation | 需要覆盖的关键路径 |
| --- | --- | --- |
| DimCode | registry `dimcode@0.0.75`，本地 `dimcode 0.0.75`；`loadSession=true`；`sessionCapabilities.list/resume/close`；`promptCapabilities.image=true`、`embeddedContext=true`；`mcpCapabilities.http=true`、`sse=false` | `session/list`、`session/new`、早期 `available_commands_update`、`session/close`、`session/resume`、config options、slash commands |
| Claude Code ACP | registry `@agentclientprotocol/claude-agent-acp@0.39.0`；本地存在 `claude` 和 global `@zed-industries/claude-code-acp@0.11.0`；有 `claude-login` auth method | initialization、auth required、authenticate、process cleanup、HTTP/SSE MCP filtering |
| Codex ACP | registry `@zed-industries/codex-acp@0.15.0`，global wrapper 观察到旧版本 `0.6.0`；auth methods 包含 ChatGPT/API key 类 | registry 优先、版本漂移诊断、auth methods、no session list fallback |
| acpx | 本机 PATH 未发现名为 `acpx` 的可执行命令 | 不阻塞本目标；若后续提供准确命令名或路径，加入同一 diagnostics matrix |

## Protocol 覆盖矩阵

| Protocol | ACP v1 期望 | DeepChat 当前状态 | 修复/对接目标 |
| --- | --- | --- | --- |
| Transports | ACP 使用 JSON-RPC 2.0；常见 client 以 agent subprocess + stdio 通信；MCP stdio 必须支持，HTTP/SSE 按 agent capability 过滤 | 已有 subprocess/stdout/stderr 连接、registry launch spec、MCP transport filter；需要加强版本漂移和进程树清理 | registry launch spec 仍为首选；global/local 命令只做 fallback/diagnostics；初始化、认证、E2E probe 都有 timeout 和 process tree cleanup |
| Initialization | Client 调 `initialize`，发送 `protocolVersion`、`clientCapabilities`、`clientInfo`；Agent 返回 `agentCapabilities`、`authMethods`、`agentInfo` | 已发送 `fs`、`terminal`；未声明/实现 auth capability；只解析部分 capability | 解析并保存完整 capability snapshot；不支持协议版本时关闭连接并展示错误；只声明已实现 client capabilities |
| Authentication | Agent 用 `authMethods` 暴露方法；Client 调 `authenticate({ methodId })`；`logout` 只能在 `agentCapabilities.auth.logout` 存在时调用 | 有 auth method 日志字段，但没有产品化 authenticate/logout 入口 | 增加 authenticate/logout presenter/debug/UI 入口；处理 `agent`、`env_var`、`terminal` 类型；auth required 错误转成可操作状态 |
| Session Setup: `session/new` | 创建新 session，传 `cwd` 和 MCP servers，返回 `sessionId`，可带初始 modes/models/config options | 已支持；但 listener 通常在返回后注册，早期 update 可能丢 | 新 DeepChat 会话首次使用 ACP agent 时才创建远端 session；返回后写入本地 `AcpSessionLink`；缓冲并 flush 早期 update |
| Session Setup: `session/load` | 仅 `loadSession=true` 时调用；agent 会重放历史 update，再响应 load 完成 | 已支持并在 load 前注册 listener | 用作远端 session 历史导入/重放；进入 staging buffer，转换为 DeepChat message/block 后按 fingerprint 幂等落库 |
| Session Setup: `session/resume` | 仅 `sessionCapabilities.resume` 存在时调用；不重放历史，恢复上下文后返回 | 未接入 | 用于已绑定 DeepChat conversation 的继续对话；不把远端 session 当事实源覆盖本地消息 |
| Session Setup: `session/close` | 仅 `sessionCapabilities.close` 存在时调用；agent 取消该 session 活动并释放资源 | 当前 clearSession 主要 cancel/unbind/clear persistence，没有 close 协议 | 默认本地关闭/删除只 detach link；只有用户显式选择 close remote 时才调用 `session/close` |
| Session Setup: additional directories | 仅 `sessionCapabilities.additionalDirectories` 存在时发送；必须为绝对路径 | 当前主要使用单 `cwd` | 首版保留单 `cwd`；后续若 workspace 多根目录可从能力 gate 接入，不默认发送 |
| Session List | 仅 `sessionCapabilities.list` 存在时调用；支持 `cwd` filter、cursor pagination；`session_info_update` 同步标题/更新时间 | 未接入 list；`session_info_update` 被忽略 | 按 workspace 同步远端 session catalog；用 `agentId + canonicalWorkdir + remoteSessionId` 去重；只更新 link metadata，不直接覆盖 DeepChat conversation |
| Prompt Turn | `session/prompt` 发送当前用户 message 的 ContentBlock[]；`session/cancel` 中断当前 turn；prompt content 必须受 capabilities 限制 | 已 prompt/cancel；formatter 会拼温度、maxTokens 和历史 USER/ASSISTANT 文本，容易重复上下文 | formatter 改为当前 turn only；system prompt 只作为首次 session context；cancel 只针对活跃 turn |
| Content | Baseline 支持 text/resource_link；image/audio/resource 由 `promptCapabilities` 决定 | 输入侧 image 多数降级为 resource_link；输出侧 image 可转为 image block，audio/resource 偏文本化 | 输入侧按 capability 发送 image/audio/resource/resource_link/text；输出侧保留结构，不能显示的内容给清晰文本 fallback |
| Tool Calls | Agent 通过 `tool_call`、`tool_call_update` 汇报工具状态、内容、locations、raw input/output；可嵌入 terminal/diff/content | 已映射 tool_call/update，但把部分状态当 permission block；terminal/diff/locations/raw 字段展示不完整 | 保留工具 call 生命周期；补 terminal/diff/location 展示和 raw metadata；不要把普通 tool progress 误标为权限 |
| Client Permission | Client baseline method `session/request_permission` 用于工具权限确认 | 主进程已有 resolver 分发底座；需要 UI/超时/debug/test 闭环 | 复用现有 DeepChat permission overlay；补 timeout/cancel 默认 outcome；debug log 记录 permission request/result |
| File System | `fs/read_text_file`、`fs/write_text_file` 只在 client capability 声明后可用；路径绝对；line 为 1-based | 已有 handler，包含 workspace guard、二进制/大小控制 | 保持安全边界；补 1-based、越界、二进制、跨 workspace 写入测试；声明能力与真实 handler 绑定 |
| Terminals | `terminal/create` 用 `command` + `args` + `env` + `cwd`；`outputByteLimit` 超限时从开头截断，保留最新输出且字符边界有效 | 已有 terminal manager；当前把 command/args 拼进 shell，输出超限时保留开头 | 改为直接 spawn command + args；仅显式 shell 场景使用 shell；输出 buffer 保留尾部；release 后仍允许已渲染内容留在 tool call |
| Agent Plan | `plan` update 每次发送完整 entries，client 应替换当前 plan | 已映射为 plan block | 保持替换语义，补测试；plan update 不追加成重复计划 |
| Session Modes | Session 返回 modes；client 可调 `session/set_mode`；agent 可发 `current_mode_update`；官方建议逐步转向 config options | 已支持 mode 初始状态、set mode、mode update | 保持兼容；当 config options 提供 mode 等价项时，UI 优先统一展示 config options，legacy mode 继续可用 |
| Session Config Options | Session 返回 `configOptions`；client 可设置配置；agent 可发 `config_option_update` | 已有 normalize 和 state update | 补初始化/new/load/resume 全路径同步；debug action 覆盖设置失败和状态回滚 |
| Slash Commands | Agent 用 `available_commands_update` 发布命令；用户执行时作为普通 prompt 文本如 `/web query` | 已解析 available commands；早期通知可能丢 | 通过 update buffer 保证 commands 到达；UI 输入框命令候选来自 session state；执行仍走普通 prompt |
| Usage Update | Agent 可发 usage/cost/token 类状态 | 当前 mapper 明确忽略 | 增加 metadata/event/state 映射，至少在 debug 和 turn metadata 可见；后续 UI 可展示 token/cost |
| Session Info Update | Agent 可发 title、updatedAt、`_meta` 更新 session metadata | 当前 mapper 明确忽略 | 更新 `AcpSessionLink` metadata；只在本地标题仍为自动标题时建议更新，不覆盖用户手工标题 |
| Extensibility | `_meta` 可携带自定义数据；自定义 method 以前缀 `_` 命名；未知字段应兼容 | 已有 ext debug action 和部分 passthrough；未知 update 多为 warn | 保留 `_meta` 到 debug/state；未知 official update 不崩溃；未知 custom update 记录 diagnostics |
| Experimental schema fields | SDK 可能出现官网主流程未文档化的字段，例如 `sessionCapabilities.fork` | 未接入 | 只在 capability 存在时提供 debug-only 支持；不作为主 chat flow 前置条件 |

## 非目标

- 不在本目标内实现 ACP v2 或未发布协议。
- 不为某个单独 agent 写硬编码行为；DimCode、Claude Code ACP、Codex ACP 只作为兼容样本。
- 不改变非 ACP provider 的现有 prompt、MCP、权限或 terminal 行为。
- 不默认扩大文件系统权限；ACP fs/terminal 继续受 session workdir 和 DeepChat 安全策略约束。
- 不做远端 session 的主动批量写入或双向同步；远端 session catalog 是可导入资源，DeepChat conversation 才是本地事实源。

## 约束

- 新 renderer-main 能力优先走 typed route / typed event / renderer API client，不复制新的 `useLegacyPresenter()` 调用模式。
- 用户可见字符串必须加 i18n。
- UI 改动需要保持 ChatStatusBar/Settings 现有视觉密度，不做大面积营销式页面。
- 代码、注释、类型名、commit message 使用英文；面向 reviewer 的 SDD 文档使用中文。
