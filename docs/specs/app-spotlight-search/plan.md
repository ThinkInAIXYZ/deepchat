# App Spotlight Search 实施计划

## 1. 当前实现基线

### 1.1 已有搜索能力

1. 当前 PR 已在 `ChatPage.vue` 中实现会话内 inline 搜索，支持：
   - `Cmd/Ctrl+F`
   - 当前消息正文高亮
   - Enter / Shift+Enter 导航
   - Esc 关闭
2. 消息正文 DOM 已统一暴露 `data-message-content="true"`，可作为会话内搜索与消息跳转高亮的稳定边界。
3. 左侧 `WindowSideBar.vue` 已支持会话标题过滤与局部高亮，但范围仅限当前会话列表。

### 1.2 快捷键现状

1. `src/main/presenter/configPresenter/shortcutKeySettings.ts` 已维护 renderer/system 级默认快捷键。
2. `ShortcutPresenter` 负责主进程注册与重注册快捷键。
3. `SHORTCUT_EVENTS` 已经承载 main -> renderer 的快捷键分发。

### 1.3 设置导航现状

1. 设置窗口独立于主聊天窗口。
2. `src/renderer/settings/main.ts` 已维护设置页路由，并在 `meta` 中提供 `titleKey`、`icon`、`position`。
3. `SETTINGS_EVENTS.NAVIGATE` 已支持主进程打开/聚焦设置窗口后导航到某个设置页。

### 1.4 历史数据现状

1. 会话和消息已经持久化在 SQLite 相关链路中。
2. 当前没有统一给 UI 使用的“历史全文搜索”主进程服务。
3. 当前 PR 的会话内搜索主要基于 renderer DOM，而非历史索引。

## 2. 设计决策

### 2.1 功能边界

Spotlight 作为 follow-up feature 分两层：

1. **主进程历史搜索**
   - 只负责会话 / 历史消息检索
   - 输出结构化命中结果
2. **渲染层统一混排**
   - 将历史搜索结果与 `agent / setting / action` 本地条目合并
   - 统一排序、裁剪、active item 管理与执行行为

这样可以避免把 Agent / Setting / Action 这些天然本地导航项也塞进数据库索引。

### 2.2 默认快捷键

最终采用：

- `QuickSearch = CommandOrControl+P`

原因：

1. 当前会话内搜索已经使用 `Cmd/Ctrl+F`
2. Spotlight 是“全局跳转器”，语义更接近 `Cmd/Ctrl+P`
3. 避免同一个快捷键在 inline search 与 Spotlight 之间抢焦点

### 2.3 搜索索引表

新增两张表：

1. `deepchat_search_documents`
   - `entity_kind`
   - `entity_id`
   - `session_id`
   - `title`
   - `body`
   - `role`
   - `updated_at`
2. `deepchat_search_documents_fts`
   - 对 `title/body` 做 FTS5 全文索引

用途分离：

1. 普通表作为真实数据表与降级查询源
2. FTS 表只负责全文索引与匹配性能

### 2.4 索引数据来源

#### 会话文档

- `entity_kind = 'session'`
- `entity_id = session.id`
- `session_id = session.id`
- `title = session.title`
- `body = ''`

#### 消息文档

- `entity_kind = 'message'`
- `entity_id = message.id`
- `session_id = message.sessionId`
- `title = session.title`（冗余存储，便于结果展示和排序）
- `body = 可见文本`
- `role = user | assistant`

### 2.5 可见文本抽取规则

需要抽离一个可复用的“消息可见文本抽取”模块，供：

1. Spotlight 历史搜索
2. 未来 MCP history search
3. 可能的导出 / snippet 生成复用

抽取规则：

1. 用户消息：
   - 优先取结构化 `content[].type === 'text'`
   - 回退到 `text`
2. 助手消息：
   - 只收集 `content` 类型可见文本
   - 收集 `error` block 文本
   - 可选收集 `plan` 可见文本
3. 忽略：
   - tool call 原始 JSON
   - image/audio 元数据
   - search result raw payload
   - streaming 中但未落库内容

### 2.6 查询与降级

查询顺序：

1. 优先 FTS5
2. 若 FTS 执行失败，或 query 被 tokenizer 拒绝，则回退到 `LIKE`

降级目标：

1. 任何输入都尽量返回可用结果
2. 避免特殊字符 query 直接“零结果 + 无解释”

### 2.7 结果类型与共享接口

新增共享类型：

1. `HistorySearchOptions`
2. `HistorySearchSessionHit`
3. `HistorySearchMessageHit`
4. `HistorySearchHit`

新增 Presenter 接口：

- `INewAgentPresenter.searchHistory(query, options?)`

说明：

1. Presenter 只返回 `session | message` 命中
2. `agent | setting | action` 在 renderer 本地组装为 `SpotlightItem`

### 2.8 设置导航 registry

为避免把设置搜索逻辑散落在 Spotlight 组件中，新增一个共享 registry：

- `routeName`
- `titleKey`
- `icon`
- `keywords[]`

数据来源优先复用 `src/renderer/settings/main.ts` 路由元信息，必要时抽成共享常量，让：

1. 设置窗口侧栏
2. Spotlight setting items

消费同一份元数据，避免标题 / icon 漂移。

### 2.9 Renderer 状态与执行流

新增 `spotlight store`，最少维护：

1. `open`
2. `query`
3. `results`
4. `activeIndex`
5. `loading`
6. `requestSeq`
7. `pendingMessageJump`

执行流程：

1. 打开面板 -> 聚焦输入框
2. 输入 80ms debounce
3. 发起历史搜索请求
4. 本地合并 `agent / setting / action`
5. renderer 做统一排序和截断
6. Enter / click 执行目标

### 2.10 消息跳转串联

`message` 结果执行后：

1. 先写入 `pendingMessageJump = { sessionId, messageId }`
2. 切换会话
3. Chat 页在消息加载完成后消费 `pendingMessageJump`
4. 找到目标消息 DOM
5. 滚动到目标
6. 高亮约 2 秒
7. 清空 `pendingMessageJump`

这样可以避免在会话尚未激活、消息尚未加载完成时提前滚动失败。

## 3. 事件流

### 3.1 快捷键打开

1. `ShortcutPresenter` 注册 `QuickSearch`
2. 触发时发 `SHORTCUT_EVENTS.TOGGLE_SPOTLIGHT`
3. 主聊天 renderer 的 `App.vue` 或 Spotlight host 监听该事件
4. 切换 Spotlight open 状态

### 3.2 设置命中跳转

1. renderer 执行 setting item
2. 调用主进程打开/聚焦设置窗口
3. 发送 `SETTINGS_EVENTS.NAVIGATE`
4. 设置窗口跳到对应页面

### 3.3 Message 命中跳转

1. renderer 执行 message item
2. 写入 `pendingMessageJump`
3. 调用现有 session 选择逻辑
4. `ChatPage` 在消息加载完成后消费跳转

## 4. 测试策略

### 4.1 Main

1. session title hit 与 message hit 的排序基础正确
2. 会话重命名后索引更新
3. 消息编辑 / 删除后索引更新
4. legacy import / schema rebuild 后全量回填可用
5. FTS 查询失败时自动降级到 `LIKE`

### 4.2 Renderer

1. `Cmd/Ctrl+P` 打开 / `Esc` 关闭
2. 输入框自动聚焦
3. `↑/↓/Home/End/Enter` 全链路
4. 混排列表稳定，不因 hover 破坏 active item
5. `message` 结果切会话后成功滚动并高亮
6. `agent / setting / action` 执行正确
7. 空查询 recent/agents/actions 可见

### 4.3 验收场景

1. sidebar 收起时 Spotlight 仍可用
2. 有查询时最多显示 12 条结果
3. 结果 hover 与 click 行为自然
4. 设置窗口已有焦点时，从主聊天窗口触发 Spotlight 仍只打开主聊天窗口里的唯一实例

## 5. 风险与缓解

### 风险 1：FTS 索引同步遗漏

如果消息编辑 / 删除 / 导入路径漏掉同步，搜索结果会漂移。

缓解：

1. 把索引同步集中到统一服务
2. 对 create/update/delete/import 分别补 main tests

### 风险 2：Spotlight 与 inline chat search 快捷键冲突

缓解：

1. Spotlight 默认改为 `Cmd/Ctrl+P`
2. 保留 inline chat search 的 `Cmd/Ctrl+F`
3. 在快捷键设置页显式展示两者

### 风险 3：设置页 metadata 分散

缓解：

1. 抽共享 registry
2. 让设置窗口与 Spotlight 共同消费

### 风险 4：消息跳转时序不稳定

缓解：

1. 用 `pendingMessageJump` 记录目标
2. 只在会话激活 + 消息加载完成后消费

### 风险 5：大库搜索性能抖动

缓解：

1. 历史查询只请求 `session | message`
2. renderer 最多渲染 12 条
3. 使用 debounce + requestSeq 丢弃过期结果

## 6. 质量门槛

1. `pnpm run format`
2. `pnpm run i18n`
3. `pnpm run lint`
4. `pnpm run typecheck`
5. 相关 main / renderer 测试通过
