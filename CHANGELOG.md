# Changelog

## Unreleased
- 新增 OpenCode 作为内置 ACP Agent，支持开源 AI 编码代理
- Added OpenCode as builtin ACP agent, supporting open-source AI coding agent

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
