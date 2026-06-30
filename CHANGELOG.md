# Changelog

## v1.0.8-beta.2 (2026-06-30)
- Added agent-scoped plugin extension controls for skills, MCP servers, and tools
- Added Agent Memory health snapshots and audit details in settings
- Fixed settings window sizing, sidebar chat actions, manual memory category handling, skill conflict popup layout, and provider 302 domain
- Migrated commit hooks to commitlint and refreshed electron-builder plus provider and ACP registry data
- 新增 Agent 级插件扩展控制，可按 Agent 限制 skills、MCP servers 和 tools
- 新增 Agent Memory health snapshot 与设置页审计详情
- 修复设置窗口尺寸、侧边栏会话操作、手动添加 memory category、技能冲突弹窗布局和 provider 302 domain
- 迁移 commit hooks 到 commitlint，并刷新 electron-builder、Provider 与 ACP registry 数据

## v1.0.8-beta.1 (2026-06-29)
- Added the main-window Plugins Hub plus Feishu/Lark install authentication and streaming card delivery for remote control
- Upgraded the provider/runtime stack with AI SDK v7, Zod v4 schemas, Electron 40.10.5, DuckDB 1.5.4, and refreshed toolchains
- Fixed New API responses handling and endpoint debug selection, memory first-turn stalls, context-overflow auto-handoff, message-scoped skill activation, and request preview editor layout
- 新增主窗口插件中心，并支持飞书/Lark 安装认证与远程控制流式卡片推送
- 升级 provider/runtime 栈到 AI SDK v7、Zod v4 schema、Electron 40.10.5、DuckDB 1.5.4，并刷新工具链
- 修复 New API responses 处理与 endpoint debug 选择、memory 首轮卡顿、context overflow 自动 handoff、按消息激活 skill，以及请求预览编辑器布局

## v1.0.7 (2026-06-25)
- Added the default chat workspace, task-aware Agent Memory, and persistent agent plan blocks in chat history
- Improved Computer Use helper runtime isolation, packaging, shutdown cleanup, and refreshed bundled dependencies and resources
- Fixed fresh SQLite schema bootstrap, stale Tape FTS search hits, New API responses endpoint configuration, sidebar history pagination, and locked skill reinstall handling
- 新增默认聊天工作区、任务感知 Agent Memory，并支持在聊天历史中持久化 Agent plan blocks
- 优化 Computer Use helper runtime 的隔离、打包和退出清理，并刷新内置依赖与资源
- 修复首次 SQLite schema 初始化、陈旧 Tape FTS 搜索命中、New API responses endpoint 配置、侧边栏历史分页和技能重装锁定目录处理

## v1.0.7-beta.2 (2026-06-25)
- Fixed fresh SQLite schema bootstrap so new installations initialize reliably
- Fixed New API responses endpoint configuration so it stays separate from other endpoint options
- 修复首次 SQLite schema 初始化，提升新安装启动可靠性
- 修复 New API responses endpoint 配置，避免与其他 endpoint 选项混用

## v1.0.7-beta.1 (2026-06-24)
- Added the default chat workspace so new chats start with prepared workspace context
- Added task-aware Agent Memory with improved maintenance scheduling and management controls
- Improved Computer Use helper runtime isolation, packaging, and shutdown cleanup
- Fixed sidebar history pagination, locked skill reinstall handling, and refreshed Markstream Vue
- 新增默认聊天工作区，让新聊天具备预设工作区上下文
- 新增任务感知 Agent Memory，并改进维护调度与管理控制
- 优化 Computer Use helper runtime 的隔离、打包和退出清理
- 修复侧边栏历史分页、技能重装锁定目录处理，并刷新 Markstream Vue

## v1.0.6 (2026-06-22)
- Added S3-compatible cloud backup sync, OpenDAL-based backup storage, and workspace environment management
- Added Agent Memory, Tape view manifests, replay lineage details, and focused workspace file inspection
- Added OpenAI Codex runtime support, built-in API key providers, AWS Bedrock profile authentication, MiniMax M3 handling, and drag-and-drop skill installation
- Added cross-platform Computer Use runtime packaging and improved agent runtime discovery, watcher reliability, and provider/ACP registry freshness
- Fixed packaged cloud sync startup, Codex login behavior, memory followups, MCP server cleanup, steer abort queue handling, sidebar pagination, markdown scrollbar jitter, and settings save payloads
- 新增 S3 兼容云备份同步、基于 OpenDAL 的备份存储，以及工作区环境管理
- 新增 Agent Memory、Tape view manifests、replay lineage 详情，以及聚焦式工作区文件检查
- 新增 OpenAI Codex runtime、内置 API key providers、AWS Bedrock profile 认证、MiniMax M3 处理和技能拖放安装
- 新增跨平台 Computer Use runtime 打包，并改进 Agent runtime 发现、工作区监听可靠性和 Provider/ACP registry 更新
- 修复打包版云同步启动、Codex 登录行为、memory followups、MCP server 清理、steer abort queue 处理、侧边栏分页、Markdown 滚动条抖动和设置保存 payload 问题

## v1.0.6-beta.8 (2026-06-20)
- Added OpenAI Codex runtime support with OAuth authentication and provider-specific request handling
- Added built-in API key providers and provider registry metadata for easier model setup
- Added environment management for workspace sessions and improved directory state persistence
- Fixed steer abort queue handling so pending chat input pauses and resumes more reliably
- Updated Markstream Vue and refreshed bundled provider/model and ACP registry data
- 新增 OpenAI Codex runtime 支持，包含 OAuth 认证与 Provider 专属请求处理
- 新增内置 API key providers 和 Provider registry metadata，简化模型配置
- 新增工作区会话的环境管理，并改进目录状态持久化
- 修复 steer abort queue 处理，让待处理聊天输入的暂停和恢复更可靠
- 更新 Markstream Vue，并刷新内置 Provider/模型与 ACP registry 数据

## v1.0.6-beta.7 (2026-06-17)
- Added Tape manifest integrity and lineage details so replay traces can be audited more reliably
- Added a workspace single item viewer for focused file inspection from the workspace panel
- Added cross-platform CUA runtime packaging and plugin runtime build improvements
- Fixed deterministic Tape view hashing and trace sequence handling
- 新增 Tape manifest 完整性与 lineage 详情，让 replay trace 审计更可靠
- 新增工作区单项查看器，方便从工作区面板聚焦检查文件
- 支持了 Windows 和 Linux 平台的 Computer Use 能力
- 修复 Tape view hash 与 trace sequence 的确定性处理

## v1.0.6-beta.6 (2026-06-16)
- Added Agent Memory so agents can extract, manage, and reuse persistent memory in agent workflows
- Added DeepChat Tape view manifests and richer trace inspection for replay and context provenance
- Added drag-and-drop skill installation, MiniMax M3 handling, and refreshed provider/model and ACP registry data
- Improved workspace watching with a Parcel watcher utility host for large workspace reliability
- Fixed markdown code block scrollbar jitter, sidebar history pagination stalls, and cloned settings save payloads
- 新增 Agent Memory，让 Agent 工作流可以提取、管理并复用持久记忆
- 新增 DeepChat Tape view manifest 与更完整的 trace 检查，支持 replay 和上下文来源追踪
- 新增技能拖放安装、MiniMax M3 处理，并刷新 Provider/模型与 ACP registry 数据
- 使用 Parcel watcher utility host 改进工作区监听，提升大型工作区可靠性
- 修复 Markdown 代码块滚动条抖动、侧边栏历史分页卡住，以及设置保存 payload clone 问题

## v1.0.6-beta.5 (2026-06-11)
- Fixed packaged app startup by bundling the OpenDAL native binding needed by cloud sync
- 修复打包应用启动问题，补齐云同步所需的 OpenDAL native binding

## v1.0.6-beta.4 (2026-06-11)
- Migrated cloud sync to OpenDAL and improved R2 setup for more reliable S3-compatible backups
- Fixed agent runtime FFF loading from unpacked app builds and cleaned up logging, skill IO, and status bar behavior
- 将云同步迁移到 OpenDAL，并优化 R2 设置，让 S3 兼容备份更可靠
- 修复 Agent 运行时在 unpacked app 构建中的 FFF 加载，并清理日志、skill IO 与状态栏行为

## v1.0.6-beta.3 (2026-06-10)
- Added AWS Bedrock profile authentication support for easier account and credential switching
- Improved agent runtime node discovery with FFF search and refreshed AI SDK packages plus bundled resources
- Fixed Anthropic reasoning controls so supported thinking settings stay available after provider data refreshes
- Fixed AWS provider styling consistency in the provider configuration UI
- 新增 AWS Bedrock profile 认证支持，方便切换账号与凭据
- 改进 Agent 运行时节点发现，使用 FFF 搜索，并刷新 AI SDK 依赖与内置资源
- 修复 Anthropic 推理控制，让支持的 thinking 设置在 Provider 数据刷新后仍保持可用
- 修复 AWS Provider 配置界面的样式一致性

## v1.0.6-beta.2 (2026-06-08)
- Fixed release CI tooltip module resolution so macOS release builds can complete reliably
- 修复发布 CI 中 tooltip 模块解析问题，让 macOS 发布构建可稳定完成

## v1.0.6-beta.1 (2026-06-08)
- Added S3-compatible cloud backup sync for more flexible cross-device data backup
- Improved Dify knowledge import compatibility with the latest `retrieval_model` schema
- Refreshed bundled provider and ACP registry data for current model and agent availability
- 新增 S3 兼容云备份同步，让跨设备数据备份更灵活
- 优化 Dify 知识库导入兼容性，适配最新 `retrieval_model` schema
- 刷新内置 Provider 与 ACP registry 数据，更新模型和 Agent 可用性

## v1.0.5 (2026-06-05)
- Added scheduled tasks, agent progress todos, session transfer, session tape memory, and remote `/agent` commands for more persistent agent workflows
- Added OpenAI-compatible video generation, tool result image previews, remote image delivery, and richer TTS model routing controls
- Added provider configuration import for CC Switch and external tools, plus refreshed bundled provider data to 142 providers and 6,964 models
- Added encrypted SQLite database storage and a safer settings Danger Zone reset flow
- Added the workspace file tree sidebar, richer Git diff rendering, sidebar theme and chat shortcut controls, and a cleaner new-thread input transition
- Improved chat readability and performance with automatic activity collapsing, merged activity groups, content-visibility message windowing, and smoother streaming
- Improved ACP v1 and remote-control reliability with stronger session handling, diagnostics, alias resolution, media delivery, and working-directory errors
- Fixed macOS foreground identity, provider capability handling, browser recovery errors, startup warning noise, floating button persistence, and session list behavior
- 新增定时任务、Agent 进度 todo、会话转移、Session Tape Memory 和远程 `/agent` 命令，让 Agent 工作流更持久可控
- 新增 OpenAI 兼容视频生成、工具结果图片预览、远程图片投递和更完整的 TTS 模型路由控制
- 新增 CC Switch 与外部工具的 Provider 配置导入，并刷新内置 Provider 数据至 142 个 Provider、6,964 个模型
- 新增 SQLite 数据库加密存储，并让设置里的 Danger Zone 重置流程更安全
- 新增工作区文件树侧栏、更丰富的 Git diff 渲染、侧栏主题与聊天快捷键控制，以及更清爽的新会话输入框过渡
- 通过活动自动折叠、活动组合并、content-visibility 消息窗口和更平滑的流式渲染，提升聊天可读性与性能
- 提升 ACP v1 与远程控制可靠性，强化会话处理、诊断、别名解析、媒体投递和工作目录错误处理
- 修复 macOS 前台身份、Provider 能力处理、浏览器恢复错误、启动告警噪声、浮动按钮位置持久化和会话列表行为

## v1.0.5-beta.8 (2026-06-02)
- Added a collapsible workspace file tree sidebar and an animated theme toggle in the app sidebar
- Added automatic chat activity collapsing so completed reasoning and tool-call work stays easier to scan
- Improved ACP v1 reliability with stronger capability handling, session persistence, terminal behavior, diagnostics, and protocol coverage
- Fixed model capability handling for temperature controls and provider database budget sentinels
- 新增可折叠的工作区文件树侧栏和应用侧栏动态主题切换按钮
- 新增聊天活动自动折叠，让完成后的思考和工具调用内容更易扫读
- 提升 ACP v1 可靠性，完善能力处理、会话持久化、终端行为、诊断和协议覆盖
- 修复温度控制和 Provider 数据库预算特殊值的模型能力处理

## v1.0.5-beta.7 (2026-06-01)
- Added agent session transfer so chats can be preserved or moved when changing agent ownership
- Added a richer workspace Git diff panel rendering experience
- Improved NewAPI routing, AI SDK system prompt handling, image-capable model switching, and plan model styling
- Fixed workspace file reference insertion, floating button position persistence, and collapsed sidebar agent expansion
- 新增 Agent 会话转移能力，让切换 Agent 归属时可以保留或移动聊天
- 新增更完整的工作区 Git diff 面板渲染体验
- 优化 NewAPI 路由、AI SDK system prompt 处理、图片能力模型切回聊天和计划模型样式
- 修复工作区文件引用插入、浮动按钮位置持久化和折叠侧边栏 Agent 展开问题

## v1.0.5-beta.6 (2026-05-29)
- Added `/agent` commands across remote-control channels so remote conversations can switch agents more easily
- Added tool result image previews and remote image delivery for richer agent output
- Added skill draft confirmation cards with view, install, and discard actions, plus Top P generation controls
- Improved ACP agent alias resolution and remote workdir error handling
- Fixed agent exec utility host startup failures, prerelease upgrade channel handling, startup warning noise, and inline stream auto-follow jitter
- 新增远程控制渠道的 `/agent` 命令，让远程会话更方便地切换 Agent
- 新增工具结果图片预览与远程图片投递，完善 Agent 输出展示
- 新增带查看、安装、丢弃操作的 Skill 草稿确认卡，并加入 Top P 生成设置
- 优化 ACP Agent 别名解析和远程工作目录错误处理
- 修复 Agent exec utility host 启动失败、预发布渠道升级、防降级、启动告警噪声和流式输出底部抖动问题

## v1.0.5-beta.5 (2026-05-27)
- Added scheduled tasks for recurring agent work
- Added high-priority language support and completed missing locale keys for broader localization coverage
- Simplified the data settings Danger Zone entry so reset choices stay inside the confirmation dialog
- Fixed MiMo Pro TTS routing so it uses chat-compatible provider behavior
- Preserved paired Feishu users across remote-control state updates
- 新增定时任务能力，支持周期性的 Agent 工作
- 新增高优先级语言支持，并补齐缺失的本地化 keys，扩大多语言覆盖
- 简化数据设置中的 Danger Zone 入口，将具体重置选项收进确认弹窗
- 修复 MiMo Pro 的 TTS 路由，使其使用兼容聊天的 Provider 行为
- 修复飞书远程控制状态更新时配对用户被丢失的问题

## v1.0.5-beta.4 (2026-05-25)
- Added session tape memory to persist and compress agent conversation history more reliably
- Synced CUA driver to v0.2.0 with diagnostic tools and improved app launching
- Telegram replies now render Markdown as HTML for proper formatting
- Improved agent steer execution responsiveness
- Updated AI SDK packages and refreshed bundled provider registry data
- 新增 Session Tape Memory，更可靠地持久化和压缩 Agent 会话历史
- 同步 CUA driver 至 v0.2.0，新增诊断工具并改进应用启动能力
- Telegram 回复现在将 Markdown 渲染为 HTML，格式展示更准确
- 提升 Agent steer 执行的响应性
- 更新 AI SDK 依赖并刷新内置 Provider registry 数据

## v1.0.5-beta.3 (2026-05-22)
- Added encrypted SQLite database storage to strengthen local data protection
- Improved onboarding guide handoff by refreshing state after setup transitions
- Refined onboarding spotlight rendering with SVG paths and fixed panel stacking and hover performance issues
- 新增 SQLite 数据库加密存储，增强本地数据保护
- 优化引导流程交接，在设置切换后刷新状态
- 优化引导高亮的 SVG path 渲染，并修复面板层级与 hover 性能问题

## v1.0.5-beta.2 (2026-05-21)
- Added provider configuration import with preview, validation, conflict handling, and localized settings UI
- Added CC Switch configuration import and broader provider import path discovery for smoother migration from external tools
- Added a hero transition for the chat input on new threads and refined chat overlay/sidebar styling for a cleaner first-run flow
- Improved session list behavior with stable alphabetical ordering and more predictable pinning
- Added Feishu thing reactions and tightened Feishu remote-control runtime handling
- 新增 Provider 配置导入，支持预览、校验、冲突处理和本地化设置界面
- 新增 CC Switch 配置导入，并扩展 Provider 导入路径发现，方便从外部工具迁移
- 新增新会话聊天输入框的 hero 过渡，并优化聊天浮层与侧边栏样式，让首次使用流程更清爽
- 优化会话列表行为，保持稳定的字母排序和更可预期的置顶表现
- 新增飞书 thing 表情互动，并加强飞书远程控制运行时处理

## v1.0.5-beta.1 (2026-05-19)
- Added an agent progress todo tool with floating progress UI and plan message rendering so long-running agent work is easier to track
- Added OpenAI-compatible video generation with model settings, generated video message rendering, and provider runtime support
- Improved TTS routing and Gemini TTS behavior with unified model settings, provider metadata, and stronger runtime coverage
- Improved Feishu plugin packaging with platform bundles, release workflow support, and updated packaging documentation
- Updated TypeScript native preview, vue-tsgo, provider registry, and ACP registry data for current tooling and runtime compatibility
- Fixed image-route chat budget handling so generated image requests avoid unnecessary context budget failures
- 新增 Agent 进度 todo 工具、浮动进度界面和计划消息渲染，让长时间 Agent 工作更容易跟踪
- 新增 OpenAI 兼容的视频生成能力，包含模型设置、生成视频消息渲染和 Provider 运行时支持
- 优化 TTS 路由和 Gemini TTS 表现，补齐统一模型设置、Provider 元数据和更强的运行时覆盖
- 优化飞书插件打包，支持平台 bundle、发布 workflow，并更新插件打包文档
- 更新 TypeScript native preview、vue-tsgo、Provider registry 和 ACP registry 数据，提升当前工具链与运行时兼容性
- 修复图片路线的聊天预算处理，让生成图片请求避免不必要的上下文预算失败

## v1.0.4 (2026-05-15)
- Added guided onboarding, voice input transcription, and a redesigned settings control center to make first setup and daily configuration easier
- Added agent image generation, OpenAI image settings, Mac computer use, manual compaction, and side panel fullscreen controls for more capable agent workflows
- Added Mistral, Xiaomi Token Plan regions, refreshed provider data, and improved model capability controls for broader model access
- Improved remote control across Feishu, Weixin, Discord, QQ Bot, Telegram, and WeChat iLink with richer media delivery and steadier streamed replies
- Improved ACP and agent runtime reliability with safer working-directory handling, context budgeting, session routing, tool output limits, and persisted turn metadata
- Improved chat and workspace responsiveness with smoother Markdown streaming, older-message pagination, YoBrowser activity feedback, and more native desktop interactions
- Hardened plugin MCP isolation, SVG and external-link handling, provider verification, config import compatibility, and SQLite upgrade recovery
- Updated bundled runtimes, AI SDK patch versions, Markstream rendering, provider registry data, and release packaging support for stable builds
- 新增引导式上手、语音输入转写和重新设计的设置控制中心，让首次配置与日常设置更顺手
- 新增 Agent 图片生成、OpenAI 图片设置、Mac 电脑使用、手动压缩和侧边栏全屏控制，提升 Agent 工作流能力
- 新增 Mistral、小米 Token Plan 多区域支持，刷新 Provider 数据，并优化模型能力控制，扩展模型接入范围
- 优化飞书、微信、Discord、QQ Bot、Telegram 与 WeChat iLink 远程控制，支持更丰富的媒体投递和更稳定的流式回复
- 优化 ACP 与 Agent 运行时可靠性，包括工作目录保护、上下文预算、会话路由、工具输出限制和 turn 元数据持久化
- 优化聊天与工作区响应表现，改进 Markdown 流式渲染、历史消息分页、YoBrowser 活动反馈和更原生的桌面交互
- 加强 Plugin MCP 隔离、SVG 与外部链接处理、Provider 验证、配置导入兼容性和 SQLite 升级恢复
- 更新内置运行时、AI SDK patch 版本、Markstream 渲染、Provider registry 数据与发布打包支持，面向稳定构建

## v1.0.4-beta.8 (2026-05-12)
- Added a redesigned settings control center with overview cards, grouped navigation, settings activity, and refined MCP, provider, and data panels
- Added a fullscreen toggle for the side panel and improved layout responsiveness across side panel and workspace views
- Added an isolated Feishu plugin settings surface with credential management, MCP presets, and plugin-owned MCP servers hidden from global MCP settings
- ACP client runtime now has clearer connection and session routing, debug logging, path guarding, and persisted turn metadata for steadier ACP sessions
- Weixin remote control now delivers generated images and avoids leaving silent pending interactions behind
- Feishu remote replies now send post payloads with the expected message shape
- Agent failed-message context is preserved more consistently after compaction and context-pressure errors
- Updated AI SDK patch versions and refreshed bundled provider and ACP registry data for fresher runtime compatibility
- 设置页升级为控制中心，新增概览卡片、分组导航、设置活动记录，并优化 MCP、Provider 与数据设置面板
- 新增侧边栏全屏切换，并优化侧边栏与工作区视图的布局响应表现
- 新增隔离的飞书插件设置页，支持凭证管理、MCP 预设，并从全局 MCP 设置中隐藏插件自有 MCP server
- ACP client runtime 现在具备更清晰的连接与会话路由、调试日志、路径保护和 turn 元数据持久化，让 ACP 会话更稳定
- 微信远程控制现在可以发送生成图片，并避免留下静默的 pending 交互
- 飞书远程回复现在会按预期消息结构发送 post payload
- Agent 在上下文压缩和上下文压力错误后，会更稳定地保留失败消息上下文
- 更新 AI SDK patch 版本，并刷新内置 Provider 与 ACP registry 数据，提升运行时兼容性新鲜度

## v1.0.4-beta.7 (2026-05-11)
- Added Mistral as a built-in provider, including model icons, provider catalog support, and deeplink handling
- Agent runs now budget tool schemas and tool output more defensively, reducing oversized context failures and follow-up stalls
- Context-window overflow errors now include budget diagnostics and try pressure recovery before failing oversized requests
- Feishu remote control replies now use optimized Markdown posts for headings, tables, lists, code blocks, and streamed updates
- Markdown streaming now stays smooth while messages are loading without leaving completed content in a streaming state
- Upgraded markstream-vue to 0.0.14-beta.8 for improved Markdown rendering behavior
- Agent terminal execution is steadier when shells, working directories, or context compaction need fallback handling
- Disabled providers no longer trigger verification requests from settings screens
- Plugin MCP servers now keep their lifecycle more isolated, improving start/stop behavior and built-in plugin visibility
- 新增 Mistral 内置 Provider，补齐模型图标、Provider 目录与 deeplink 支持
- Agent 运行会更谨慎地预算工具 schema 与工具输出，减少上下文过大和后续执行卡住的问题
- 上下文窗口溢出错误现在会带上预算诊断，并在失败前尝试恢复上下文压力
- 飞书远程控制回复改用优化后的 Markdown post，改善标题、表格、列表、代码块和流式更新
- Markdown 流式渲染只在消息加载中保持平滑，完成后的内容不会继续停留在流式状态
- markstream-vue 升级到 0.0.14-beta.8，改善 Markdown 渲染表现
- 当 shell、工作目录或上下文压缩需要 fallback 时，Agent 终端执行更稳定
- 设置页不会再对已禁用的 Provider 发起验证请求
- Plugin MCP server 的生命周期隔离更清晰，启动、停止和内置插件展示更可靠

## v1.0.4-beta.6 (2026-05-09)
- Agents can now generate images right inside chat, with OpenAI image settings available when you want more control
- Image previews and image actions feel smoother, especially around generated results and tool output
- Long conversations should feel lighter when you scroll back through older messages
- Sync and import are more forgiving when settings come from a different app version
- Mac computer use got a couple of driver updates, so window handling, clicking, and app control should be steadier
- Fixed a handful of everyday annoyances around Ollama, provider search, Windows command output, search docs, and empty computer-use settings messages
- Agent 现在可以直接在聊天里生成图片；需要细调时，也能设置 OpenAI 图片生成选项
- 图片预览和图片操作更顺了一些，生成结果和工具输出里的图片都更好处理
- 长对话回看历史时会轻快一点，旧消息加载不再那么吃劲
- 设置同步和导入更宽容了，从不同版本带来的备份也更稳
- Mac 电脑使用能力升级了几轮驱动，窗口处理、点击和控制应用会更稳
- 修了一批日常小毛病，包括 Ollama、模型服务商搜索、Windows 命令输出、搜索文档和电脑使用设置里的空提示

## v1.0.4-beta.5 (2026-05-04)
- Added Mac computer use capability for enhanced desktop automation
- Added launch at login and access controls for better app startup management
- Enhanced agent capabilities with improved model source derivation
- Upgraded markstream-vue for better stream rendering performance
- Fixed disabled provider models still appearing in model selection
- Fixed DeepSeek empty reasoning content handling
- Fixed file join failures in chat flows
- 新增 Mac 电脑使用功能，增强桌面自动化能力
- 新增开机启动与访问控制，优化应用启动管理
- 增强 Agent 功能，优化模型源选择逻辑
- 升级 markstream-vue，提升流式渲染性能
- 修复已禁用供应商模型仍在模型选择中显示的问题
- 修复 DeepSeek 空推理内容处理
- 修复聊天流程中的文件连接失败问题

## v1.0.4-beta.4 (2026-04-29)
- Added model fetching fallbacks for Anthropic and Gemini so provider model lists recover more reliably
- Added Xiaomi Token Plan providers for CN, SGP, and AMS regions
- Enhanced DeepSeek V4 compatibility across provider and model workflows
- Improved active chat input routing and tool-call image previews for clearer chat workflows
- Fixed agent and ACP workspace propagation, interleaved tool streams, and context budgeting for tool schemas
- 新增 Anthropic 与 Gemini 模型拉取 fallback，提升 Provider 模型列表恢复稳定性
- 新增小米 Token Plan 的 CN、SGP 与 AMS 区域 Provider
- 增强 DeepSeek V4 在 Provider 与模型流程中的兼容性
- 优化当前聊天输入路由与工具调用图片预览，让聊天流程更清晰
- 修复 Agent 与 ACP 工作区传递、交错工具流以及工具 schema 上下文预算处理

## v1.0.4-beta.3 (2026-04-27)
- Fixed attachment date metadata transfer across IPC payloads so attachment records stay valid in chat flows
- 修复附件日期元数据在 IPC 载荷中的传递，确保聊天流程中的附件记录保持有效

## v1.0.4-beta.2 (2026-04-27)
- Preserved interleaved reasoning output so mixed reasoning and answer streams stay in the correct order
- Updated the Markstream renderer to the stable 0.0.13 release for more reliable Markdown streaming
- Improved chat message transitions, sidebar updates, and side panel rendering performance
- Fixed RTK and built-in knowledge configuration status handling across MCP tool setup flows
- 保留交错 reasoning 输出顺序，确保 reasoning 与正文混合流式内容按预期展示
- 将 Markstream 渲染器更新到稳定版 0.0.13，提升 Markdown 流式渲染可靠性
- 优化聊天消息动效、侧边栏更新与侧边面板渲染性能
- 修复 RTK 与内置知识库配置状态处理，完善 MCP 工具配置流程

## v1.0.4-beta.1 (2026-04-25)
- Improved remote control media delivery across Discord, Feishu, QQ Bot, Telegram, and WeChat iLink, including block streaming and file handling
- Fixed ACP working directory propagation for remote executions so agent commands run in the intended workspace
- Added batch model status updates to reduce provider model list churn and keep model management more responsive
- Hardened renderer model capability detection, external URL opening, and SVG sanitization against stale state and unsafe links
- Fixed RTK runtime startup when the expected hook is missing, improving agent runtime resilience on affected installs
- 优化 Discord、飞书、QQ Bot、Telegram 与微信 iLink 的远程控制媒体投递，完善块流式输出与文件处理
- 修复远程执行中的 ACP 工作目录传递，确保 agent 命令在预期工作区运行
- 新增模型状态批量更新，减少 Provider 模型列表抖动并提升模型管理响应速度
- 加强渲染端模型能力检测、外部链接打开与 SVG 清理，避免过期状态和不安全链接
- 修复缺少预期 hook 时 RTK runtime 启动失败的问题，提升受影响安装环境下的 agent runtime 韧性

## v1.0.3 (2026-04-24)
- Added DeepSeek V4 series model support and refreshed provider model data for more complete default model availability
- Migrated model requests to the AI SDK runtime for more consistent provider behavior, streaming, prompt cache, and tool calling
- Expanded remote control into a unified multi-channel setup with Discord, QQ Bot, and WeChat iLink support
- Added project workspace directories, privacy mode, inline chat session renaming, long user message collapse, and improved new chat entry behavior
- Added NewAPI and Astraflow (ModelVerse) provider support, richer model capability controls, request timeout settings, and more reliable model list management
- Improved desktop security, startup responsiveness, embedded browser resizing, image paste submission, Gemini compatibility, and SQLite upgrade recovery
- Added Sharp native package hoisting to keep image processing dependencies available in release builds
- 新增 DeepSeek V4 系列模型支持，并刷新 Provider 模型数据，提升默认模型可用性覆盖
- 将模型请求迁移到 AI SDK 运行时，提升 Provider 行为、流式输出、Prompt Cache 与工具调用一致性
- 远程控制升级为统一多渠道配置，新增 Discord、QQ Bot 与微信 iLink 支持
- 新增项目工作区目录、隐私模式、会话内联重命名、长用户消息折叠，并优化新建会话入口体验
- 新增 NewAPI 与 Astraflow（ModelVerse）Provider，补充模型能力控制、请求超时配置与更稳定的模型列表管理
- 提升桌面端安全性、启动响应、内嵌浏览器尺寸调整、图片粘贴提交、Gemini 兼容性与 SQLite 升级恢复稳定性
- 增加 Sharp 原生包 hoist 配置，确保图片处理依赖在 release 构建中可用

## v1.0.3-beta.6 (2026-04-22)
- Added model initialization in settings so ModelSelect respects the current chat mode and restores default model controls more reliably
- Added ACP registry icon request handling in the floating widget to improve agent icon rendering and related session visuals
- Simplified YoBrowser host readiness handling to keep the embedded browser lifecycle more predictable
- 新增设置页模型初始化流程，使 ModelSelect 更准确地遵循当前聊天模式，并提升默认模型配置恢复稳定性
- 新增悬浮组件中的 ACP registry 图标请求处理，优化 Agent 图标渲染与相关会话视觉表现
- 精简 YoBrowser host readiness 处理逻辑，提升内嵌浏览器生命周期的可预测性

## v1.0.3-beta.5 (2026-04-22)
- Added privacy mode and inline chat session renaming to improve workspace discretion and session organization
- Added request timeout controls with a higher default range, and refined Kimi fixed-temperature plus Gemini v1beta compatibility handling
- Improved startup and runtime responsiveness through asynchronous icon loading, store initialization cleanup, and more stable navigation payload normalization
- Hardened desktop security by enabling Electron context isolation and disabling node integration for embedded web contents
- Fixed several workflow regressions across trackpad scrolling, new thread entry visibility, project clearing, timeout propagation, and upgraded SQLite/provider recovery
- 新增隐私模式与会话内联重命名，提升工作区信息保护和会话整理效率
- 新增请求超时配置并扩展默认范围，同时优化 Kimi 固定温度策略与 Gemini v1beta 兼容处理
- 通过异步图标加载、store 初始化清理与导航载荷规范化，改善启动速度和运行时响应性
- 强化桌面端安全基线，为内嵌 Web 内容启用 Electron context isolation 并关闭 node integration
- 修复触控板滚动、新建会话入口显隐、项目清空选择、超时参数传递，以及升级后 SQLite/provider 恢复等多项流程问题

## v1.0.3-beta.4 (2026-04-19)
- Recovered missing SQLite `deepchat_sessions` columns on upgraded installs to restore stable session persistence
- 修复升级安装后 SQLite `deepchat_sessions` 缺失列的问题，恢复会话持久化稳定性

## v1.0.3-beta.3 (2026-04-18)
- Added Anthropic temperature support in model capability controls
- Added `none` and `xhigh` reasoning effort options for supported models
- Improved sidebar session pin feedback and stabilized session group identity handling
- Refined app update installation by cleaning up floating windows before relaunch
- Added Astraflow (ModelVerse) provider support and removed the deprecated Laoshi provider
- Added project-based workspace directories with drag-and-drop setup support
- Enhanced the floating agent widget to support all agents with more stable session handling
- Improved Anthropic reasoning routing and capped derived max token defaults for safer model setup
- 为模型能力配置补充 Anthropic temperature 支持
- 为受支持模型新增 `none` 与 `xhigh` reasoning effort 选项
- 优化侧栏会话 pin 反馈，并稳定会话分组标识处理
- 在应用更新安装前清理悬浮窗口，提升升级流程稳定性
- 新增 Astraflow（ModelVerse）Provider 支持，并移除已废弃的 Laoshi Provider
- 新增基于项目目录的工作区管理能力，并支持拖拽接入工作区
- 增强悬浮 Agent 按钮，支持全部 Agent 并提升会话管理稳定性
- 优化 Anthropic reasoning 路由，并限制推导出的默认 max tokens，降低模型配置风险

## v1.0.3-beta.2 (2026-04-15)
- Expanded remote control into a unified multi-channel setup with Discord, QQ Bot, and WeChat iLink support
- Added default collapsing for long user messages so dense chats stay readable while attachments remain fully visible
- Polished the new conversation entry flow with a persistent collapsed-sidebar `+` action and a shorter default input box
- Improved streaming responsiveness by reducing renderer reflow and translate popup overhead during live updates
- Fixed ACP terminal permission approval bridging so streamed permission requests stay intact during execution
- 远程控制升级为统一多渠道配置流程，新增 Discord、QQ Bot 与微信 iLink 支持
- 为超长用户消息加入默认折叠，保留附件完整展示，提升长会话可读性
- 打磨新建会话入口体验，在折叠侧栏下保留常驻 `+` 按钮，并缩短默认输入框高度
- 降低流式更新期间的渲染回流与翻译弹窗开销，提升消息流动顺滑度
- 修复 ACP 终端权限审批桥接流程，保证执行期间的流式权限请求信息完整传递

## v1.0.3-beta.1 (2026-04-11)
- Migrated model requests to the AI SDK runtime, improving prompt cache behavior, provider consistency, and streaming stability
- Added NewAPI provider support and refined compatible endpoint configuration
- Improved model management with more stable provider toggles and synchronized Ollama selectable model status
- Added `skill_view` draft flow and automatic tool activation after skill previews to smooth skill setup
- Enhanced Markdown and workspace link navigation, added sidebar panel toggle hotkeys, and fixed artifact viewer sizing in the side panel
- 将模型请求迁移到 AI SDK 运行时，进一步改善 Prompt Cache 表现、Provider 一致性与流式稳定性
- 新增 NewAPI Provider 支持，并完善兼容端点配置体验
- 改进模型管理，修复 Provider 模型开关稳定性并同步 Ollama 可选模型状态
- 新增 `skill_view` 草稿流，并在技能预览后自动激活工具，减少技能接入摩擦
- 优化 Markdown 与工作区链接跳转体验，新增侧栏面板切换快捷键，并修复侧边栏制品预览高度问题

## v1.0.2 (2026-04-08)
- Added provider model list filtering and sorting, and now remembers the sidebar session grouping mode
- Added ACP Agent uninstall support and refined provider prompt cache configuration
- Improved remote delivery ordering for Telegram and Feishu, and fixed db-backed model list sync stability
- Refined dashboard and settings responsiveness, and fixed auto compact settings persistence
- 新增 Provider 模型列表筛选排序能力，并记住侧边栏会话分组方式
- 新增 ACP Agent 卸载支持，并完善 Provider Prompt Cache 配置体验
- 优化 Telegram 与 Feishu 远程消息投递顺序，修复数据库驱动模型列表同步稳定性
- 改进仪表盘与设置页响应式布局，并修复自动压缩设置保存问题

## v1.0.1 (2026-04-02)
- Added in-chat search and Spotlight global search for faster access to messages and app entry points
- Improved the provider database refresh flow and added manual model config refresh
- Updated the Markdown renderer preprocessing flow to improve rendering stability
- Fixed rate limit handling to reduce failures and degraded request experience
- 新增会话内搜索与 Spotlight 全局搜索，方便快速定位历史消息与应用入口
- 优化 Provider 数据库刷新流程，支持手动刷新模型配置
- 更新 Markdown 渲染器预处理逻辑，提升消息渲染稳定性
- 修复速率限制处理问题，减少请求受限时的异常体验

## v1.0.0 (2026-03-31)
- DeepChat 1.0 正式发布：完成全新 Agent 架构切换，统一 DeepChat Agent 与 ACP Agent 主流程，并内置 DimCode Agent
- 新增远程控制能力矩阵：支持 Telegram、Feishu 与 ACP Agent Remote，补齐权限消息、流式块渲染与工作目录选择
- 强化工作流与工具链：支持 RTK 工具调用、Environments、Provider Deeplink 导入、Workspace 拖拽引用与 DeepChat Sub Agent 协作
- 持续打磨桌面端体验：新增浮动窗口、用户仪表盘、自动压缩控制，并优化侧边栏、悬浮按钮、状态栏与工具调用交互
- 完成正式版稳定性收敛：修复 HTML 预览、主题同步、消息标题选择、会话工作目录、MCP 生命周期与历史序列化等问题

## v1.0.0-beta.7 (2026-03-27)
- 新增 Novita AI LLM 提供商接入
- 新增 Provider 配置导入能力（Deeplink 导入）
- 新增 Feishu Bot 远端接入能力
- 改进悬浮窗与侧边栏交互体验：SessionItem 由右键菜单切换为 hover/浮层交互，浮动按钮 hover 与透明度细节优化
- 修复消息标题选择与 MCP 生命周期相关稳定性问题，并清理已过期 MCP Server

## v1.0.0-beta.6 (2026-03-24)
- 新增 Telegram Remote Control，可通过 Telegram 远程查看与驱动会话，远程控制配置也已接入设置页
- 统一 DeepChat Agent 与 ACP Agent 的 Agent 能力和入口，补齐欢迎页、本地化文案与默认配置，整体使用路径更一致
- 优化会话默认工作目录传递，修复 Agent / ACP / Skills 在 session workdir 继承上的问题
- 强化启动与工具输出稳定性，修复 Splash 窗口显示时机，并为大体量工具输出增加保护与批处理适配
- 移除过时 MCP UI 支持，修复 OpenAI Responses 历史序列化问题，同时继续打磨状态同步与路由细节

## v1.0.0-beta.5 (2026-03-22)
- 优化启动 Splash 窗口与 ACP 配置加载提示，启动过程更直观
- 支持 ACP Registry 搜索安装与 ACP 模型选择，ACP Agent 配置体验继续完善
- 新增会话 steer / queue 能力，支持待发送消息排队、转向与恢复处理
- 打磨工具调用卡片、状态栏控制与更新入口，整体交互更顺手
- 修复 OpenAI Compatible MCP 工具、interleaved thinking，以及队列与 stop 状态同步等问题

## v1.0.0-beta.4 (2026-03-18)
- 新增浮动窗口，全新效果一目了然
- 增加用户仪表盘，token使用一目了然
- 重构内建工具链，支持 RTK 工具调用，控制和性能都有提升
- 新增 Environments 设置，方便为不同场景管理独立运行配置
- 修复全新安装时 SQLite 迁移冲突问题，提升首次启动稳定性

## v1.0.0-beta.3 (2026-03-18, withdrawn)
- 新增浮动窗口，全新效果一目了然
- 增加用户仪表盘，token使用一目了然
- 重构内建工具链，支持 RTK 工具调用，控制和性能都有提升
- 统一 Workspace 生命周期刷新，清理旧代码，提升整体稳定性

## v1.0.0-beta.2 (2026-03-13)
- 新增自动压缩控制，可在设置中配置会话摘要压缩行为
- 优化 Yo Browser 生命周期与迁移流程，提升稳定性
- 强化 Skills 运行时执行安全，并补齐欢迎页自定义能力
- 修复多项界面问题，包括 Agent 文案对齐、语音输入按钮显示与悬浮按钮细节

## v1.0.0-beta.1 (2026-03-09)
- 全新 Agent 架构：重构 Agent UI 与 Agent Loop，模块化流处理，统一代码路径
- 移除 Chat 模式：简化模式选择，仅保留 Agent 和 ACP Agent 两种模式
- 默认模型配置系统：新增默认模型与默认视觉模型全局设置
- 内置 DimCode Agent：预置 ACP Agent，开箱即用的代码助手

## v0.5.8 (2026-02-09)
- OpenAI 默认改为 Responses API
- 支持了 Telegram/Discord/Confirmo 通知
- 支持任务生命周期 hooks
- 修复少量 Bug

## v0.5.7 (2026-02-05)
- 完善 Skills 支持
- Agent 现在可以生成可交互的提问信息
- 增加 Voice.ai 为新供应商
- 修复大量 Bug

## v0.5.6-beta.5 (2025-01-16)
- 全新 Skills 管理系统，支持技能安装、同步与多平台适配
- 新增 o3.fan 提供商、优化工具调用（大型调用卸载、差异块展示、权限管理）、性能提升（消息列表虚拟滚动、流式事件批处理调度）
- 修复多项问题：Ollama 错误处理、滚动定位、聊天输入高度、macOS 全屏等
- All-new Skills management system with installation, sync, and multi-platform adapters
- Added o3.fan provider, enhanced tool calls (offloading, diff blocks, permissions), performance boost (message list virtual scrolling, batched stream scheduling)
- Fixed multiple issues: Ollama error handling, scroll positioning, chat input height, macOS fullscreen, etc.

## v0.5.6-beta.4 (2025-12-30)
- 全面重构 Agent 与会话架构：拆分 agent/session/loop/tool/persistence，替换 Thread Presenter 为 Session Presenter，强化消息压缩、工具调用、持久化与导出
- 增强搜索体验：新增 Search Presenter 与搜索提示模板，完善搜索助手与搜索引擎配置流程
- 加固权限与数据：新增命令权限缓存/服务，更新模型与提供商数据库，并补充多语言 i18n 文案
- Agent and session architecture refactor (agent/session/loop/tool/persistence) with Session Presenter replacing Thread Presenter to improve compression, tool calls, persistence, and exports
- Better search experience via new Search Presenter and prompt templates, refining the search assistant and engine setup
- Hardened permissions and data updates with command permission cache/service, refreshed provider/model DB, and broader i18n coverage

## v0.5.6-beta.3 (2025-12-27)
- 全新 Agent Mode，支持 RipGrep 等数十项新特性
- 全新子会话概念，随时针对会话中任意消息单独讨论
- 修复一些已知问题
- ACP Agent 可以直接使用软件里面配置的 MCP
- All-new Agent Mode with dozens of new features, including RipGrep
- New sub-session concept: discuss any message in a conversation at any time
- Fixed some known issues
- ACP Agent can directly use the MCP configured in the app

## v0.5.6-beta.1 (2025-12-23)
- Markdown 优化，修复列表元素异常
- 修复 Ollama 视觉模型图片格式
- Improved Markdown rendering, fixed list element issues
- Fixed Ollama vision model image format

## v0.5.5 (2025-12-19)
- 全新 Yo Browser 功能，让你的模型畅游网络
- All-new Yo Browser lets your model roam the web

## v0.5.3 (2025-12-13)
- 优化 ACP 体验,增加 ACP 调试能力
- 增加了自定义软件字体能力
- add acp process warmup and debug panel
- add font settings
- add Hebrew (he-IL) Translation
