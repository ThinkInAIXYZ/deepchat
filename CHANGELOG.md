# Changelog

## v1.0.3-beta.3 (2026-04-17)
- Added Anthropic temperature support in model capability controls
- Added `none` and `xhigh` reasoning effort options for supported models
- Improved sidebar session pin feedback and stabilized session group identity handling
- Refined app update installation by cleaning up floating windows before relaunch
- 为模型能力配置补充 Anthropic temperature 支持
- 为受支持模型新增 `none` 与 `xhigh` reasoning effort 选项
- 优化侧栏会话 pin 反馈，并稳定会话分组标识处理
- 在应用更新安装前清理悬浮窗口，提升升级流程稳定性

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
