# App Spotlight Search 规格

## 概述

新增一个单实例、App 级、Raycast 风格的 Spotlight 搜索面板，用于统一搜索：

1. 会话标题
2. 历史消息
3. Agent
4. 设置页面
5. 少量非破坏性动作

该面板作为当前“会话内搜索”的上层能力补充：

- 当前会话内搜索继续保留轻量 inline 体验
- Spotlight 负责全局检索与快速跳转
- 两者不共享 UI，但允许复用消息文本抽取与跳转高亮能力

## 背景与动机

1. 当前 PR 已经补齐“当前会话内搜索 + 侧边栏标题过滤”，但还缺少“跨历史 / 跨导航项”的统一入口。
2. 用户希望通过一个全局面板快速跳到会话、历史消息、Agent、设置页，而不是分别在不同区域查找。
3. DeepChat 现有左侧 rail、欢迎页和浮层组件已经具备克制、柔和、半透明的视觉语言，Spotlight 应沿用这套风格，而不是引入一个新系统。
4. 该功能会跨越主进程快捷键、历史索引、设置导航和会话跳转，适合先走 SDD，把产品与技术边界先固定下来。

## 关键决策

### 1. 快捷键默认值

为避免与已经落地的“当前会话 inline 搜索（`Cmd/Ctrl+F`）”冲突，Spotlight v1 默认快捷键定为：

- `QuickSearch = CommandOrControl+P`

同时：

- 保留 `Cmd/Ctrl+F` 作为“当前会话内搜索”
- `QuickSearch` 进入现有快捷键设置页，允许用户自定义

### 2. UI 定位

Spotlight 是：

- 单实例
- 主聊天窗口顶层 modal overlay
- 不在设置窗口再做第二套面板

### 3. 搜索范围

Spotlight 搜索默认忽略当前 sidebar 的 agent 过滤，始终面向“全量历史 + 全量导航项”。

### 4. 设置项粒度

v1 只搜索“设置页面”，不下钻到单个开关或表单项。

### 5. 动作范围

v1 只包含非破坏性动作：

- New Chat
- Open Settings
- 跳到 Providers / Agents / MCP / Shortcuts / Remote 等设置页

## 用户故事

### US-1：全局快速唤起

作为用户，我希望在主聊天窗口内按 `Cmd/Ctrl+P` 就能呼出统一搜索面板，而不必先决定去侧边栏、设置页还是聊天正文里找。

### US-2：统一搜索结果列表

作为用户，我希望在一个稳定的列表里同时看到 session / message / agent / setting / action 结果，并通过键盘连续浏览，不被多段分组打断。

### US-3：消息级跳转

作为用户，我希望命中某条历史消息后，应用能自动切到对应会话、等待消息加载完成、滚动到目标消息并做短暂高亮，而不是只打开会话顶部。

### US-4：快速导航

作为用户，我希望 Spotlight 能直接跳到 Agent、设置页和少量常用动作，从而减少点击层级。

### US-5：空查询可用

作为用户，我希望即使不输入关键词，也能看到最近会话、常用 Agent 和常用动作，从而把 Spotlight 当成轻量启动器使用。

## 功能需求

### A. 唤起与关闭

- [ ] 新增快捷键配置项 `QuickSearch`
- [ ] `QuickSearch` 默认值为 `CommandOrControl+P`
- [ ] 主进程注册并分发 `SHORTCUT_EVENTS.TOGGLE_SPOTLIGHT`
- [ ] 左侧 rail 增加常驻 Spotlight 入口
- [ ] 面板打开时自动聚焦输入框
- [ ] `Esc` 关闭面板

### B. 键盘与鼠标交互

- [ ] `↑/↓` 切换 active item
- [ ] `Home/End` 跳首尾
- [ ] `Enter` 执行 active item
- [ ] 鼠标 hover 会同步 active item
- [ ] 鼠标 click 执行当前项
- [ ] 键盘 active item 与 hover 状态不得互相打架

### C. 结果形态

- [ ] 空查询展示 `Recent Sessions + Agents + Actions`
- [ ] 有查询时展示单一混排结果列表
- [ ] 每个结果都有 `kind pill`，仅使用：
  - [ ] `Session`
  - [ ] `Message`
  - [ ] `Agent`
  - [ ] `Setting`
  - [ ] `Action`
- [ ] 单次请求最多渲染 12 条结果

### D. 命中行为

- [ ] `session` 命中切到目标会话
- [ ] `message` 命中切到目标会话，并在消息加载完成后滚动到目标消息并高亮约 2 秒
- [ ] `agent` 命中复用现有侧边栏切换逻辑
- [ ] `setting` 命中打开/聚焦设置窗口并导航到页面
- [ ] `action` 命中只执行非破坏性动作

### E. 历史索引

- [ ] 主进程提供统一的历史搜索入口
- [ ] 默认使用 SQLite FTS5 做全文索引
- [ ] FTS 失败或 query 不适配 tokenizer 时自动降级到 `LIKE`
- [ ] 首次启动或 schema 变更时支持全量回填
- [ ] 会话与消息变更路径支持增量同步

### F. 索引内容边界

- [ ] 会话索引包含用户可见标题
- [ ] 用户消息只索引可见文本
- [ ] 助手消息只索引可见内容块与错误文本
- [ ] 不索引工具调用原始 JSON
- [ ] 不索引图片元数据
- [ ] 不索引尚未持久化的 streaming 临时内容

### G. 排序

- [ ] 标题前缀命中优先于名称前缀命中
- [ ] 名称前缀命中优先于正文命中
- [ ] `session` 结果略高于 `message`
- [ ] 同层级结果叠加轻量 recency boost

## 验收标准

- [ ] 在主聊天窗口按 `Cmd/Ctrl+P` 可打开 Spotlight；按 `Esc` 可关闭
- [ ] 空查询时能看到 Recent Sessions、Agents、Actions
- [ ] 输入关键词后，结果列表混排展示 `Session / Message / Agent / Setting / Action`
- [ ] 命中会话可直接切换；命中消息会切到会话并滚动到目标消息
- [ ] 命中 Agent 时可复用现有 agent 切换流程
- [ ] 命中设置页时会聚焦或打开设置窗口并导航到正确页面
- [ ] FTS 查询失败时仍能通过降级查询返回结果
- [ ] Spotlight 在 sidebar 收起状态下仍可用

## 非目标

1. v1 不做 prefix scopes（如 `> / @ / #`）。
2. v1 不做设置项级搜索，仅支持设置页面级导航。
3. v1 不提供 destructive actions。
4. v1 不覆盖设置窗口内部的独立 Spotlight UI。
5. v1 不索引未持久化的 streaming 消息。

## 约束

1. 保持现有 Presenter + EventBus + preload IPC 架构。
2. 所有用户可见文案必须走 i18n。
3. 视觉风格沿用现有侧边栏 / 欢迎页的半透明卡片样式：`rounded-2xl + border + bg-card/40 + backdrop-blur`。
4. 动效保持轻量，并尊重 `prefers-reduced-motion`。
5. Spotlight 与当前 inline chat search 不能互相抢占默认快捷键。

## 开放问题

无。
