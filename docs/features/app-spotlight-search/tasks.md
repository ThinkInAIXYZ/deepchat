# App Spotlight Search Tasks

## T0 规格与设计

- [x] 完成 `docs/features/app-spotlight-search/spec.md`
- [x] 完成 `docs/features/app-spotlight-search/plan.md`
- [x] 完成 `docs/features/app-spotlight-search/tasks.md`

## T1 快捷键与事件

- [x] 新增快捷键配置项 `QuickSearch`
- [x] 默认值设为 `CommandOrControl+P`
- [x] 新增 `SHORTCUT_EVENTS.TOGGLE_SPOTLIGHT`
- [x] `ShortcutPresenter` 注册 / 重注册 Spotlight 快捷键
- [x] 快捷键设置页展示并允许修改 `QuickSearch`

## T2 历史搜索服务

- [x] 抽离"消息可见文本抽取"公共逻辑
- [x] 新增 `deepchat_search_documents` 普通表
- [x] 新增 `deepchat_search_documents_fts` FTS5 虚表
- [x] 实现首次回填 / schema rebuild
- [x] 实现会话创建 / 重命名 / 删除的索引同步
- [x] 实现消息写入 / 编辑 / 删除的索引同步
- [x] 实现 FTS 失败回退到 `LIKE`

## T3 Presenter 与共享类型

- [x] 新增 `HistorySearchOptions`
- [x] 新增 `HistorySearchHit / SessionHit / MessageHit`
- [x] `IAgentSessionPresenter` 增加 `searchHistory(query, options?)`
- [x] 补充共享类型导出

## T4 设置导航 registry

- [x] 抽取设置页共享 registry
- [x] 字段包含 `routeName / titleKey / icon / keywords[]`
- [x] 设置窗口侧栏复用该 registry
- [x] Spotlight setting items 复用该 registry

## T5 Spotlight Renderer 状态

- [x] 新增 `spotlight store`
- [x] 管理 `open/query/results/activeIndex/loading/requestSeq/pendingMessageJump`
- [x] 输入 80ms debounce
- [x] 按 requestSeq 丢弃过期响应
- [x] 结果截断到 12 条

## T6 Spotlight UI

- [x] 新增主聊天窗口顶层 Spotlight overlay
- [x] 沿用 `rounded-2xl + border + bg-card/40 + backdrop-blur` 视觉样式
- [x] 左侧 rail 增加 Spotlight 入口
- [x] 空查询展示 `Recent Sessions + Agents + Actions`
- [x] 查询态展示单一混排结果列表
- [x] 增加 `kind pill`
- [x] 支持 `Esc / ↑ / ↓ / Home / End / Enter / hover / click`
- [ ] 尊重 `prefers-reduced-motion`

## T7 执行行为

- [x] `session` 命中切会话
- [x] `message` 命中写入 `pendingMessageJump`
- [x] `ChatPage` 在消息加载完成后滚动并高亮目标消息
- [x] `agent` 命中复用现有侧栏切换逻辑
- [x] `setting` 命中打开 / 聚焦设置窗口并导航
- [x] `action` 命中只执行非破坏性动作

## T8 测试

- [x] main tests：排序、回填、增量同步、降级查询
- [x] renderer tests：打开关闭、自动聚焦、键盘链路
- [x] renderer tests：混排与去重
- [x] renderer tests：message jump + scroll highlight
- [x] renderer tests：agent / setting / action 执行
- [ ] 验收场景：sidebar 收起、空查询、设置窗口聚焦

## T9 质量检查

- [x] `pnpm run format`
- [x] `pnpm run i18n`
- [x] `pnpm run lint`
- [x] `pnpm run typecheck`
- [x] 运行相关 main / renderer 测试
