# App Spotlight Search Tasks

## T0 规格与设计

- [x] 完成 `docs/specs/app-spotlight-search/spec.md`
- [x] 完成 `docs/specs/app-spotlight-search/plan.md`
- [x] 完成 `docs/specs/app-spotlight-search/tasks.md`

## T1 快捷键与事件

- [ ] 新增快捷键配置项 `QuickSearch`
- [ ] 默认值设为 `CommandOrControl+P`
- [ ] 新增 `SHORTCUT_EVENTS.TOGGLE_SPOTLIGHT`
- [ ] `ShortcutPresenter` 注册 / 重注册 Spotlight 快捷键
- [ ] 快捷键设置页展示并允许修改 `QuickSearch`

## T2 历史搜索服务

- [ ] 抽离“消息可见文本抽取”公共逻辑
- [ ] 新增 `deepchat_search_documents` 普通表
- [ ] 新增 `deepchat_search_documents_fts` FTS5 虚表
- [ ] 实现首次回填 / schema rebuild
- [ ] 实现会话创建 / 重命名 / 删除的索引同步
- [ ] 实现消息写入 / 编辑 / 删除的索引同步
- [ ] 实现 FTS 失败回退到 `LIKE`

## T3 Presenter 与共享类型

- [ ] 新增 `HistorySearchOptions`
- [ ] 新增 `HistorySearchHit / SessionHit / MessageHit`
- [ ] `INewAgentPresenter` 增加 `searchHistory(query, options?)`
- [ ] 补充共享类型导出

## T4 设置导航 registry

- [ ] 抽取设置页共享 registry
- [ ] 字段包含 `routeName / titleKey / icon / keywords[]`
- [ ] 设置窗口侧栏复用该 registry
- [ ] Spotlight setting items 复用该 registry

## T5 Spotlight Renderer 状态

- [ ] 新增 `spotlight store`
- [ ] 管理 `open/query/results/activeIndex/loading/requestSeq/pendingMessageJump`
- [ ] 输入 80ms debounce
- [ ] 按 requestSeq 丢弃过期响应
- [ ] 结果截断到 12 条

## T6 Spotlight UI

- [ ] 新增主聊天窗口顶层 Spotlight overlay
- [ ] 沿用 `rounded-2xl + border + bg-card/40 + backdrop-blur` 视觉样式
- [ ] 左侧 rail 增加 Spotlight 入口
- [ ] 空查询展示 `Recent Sessions + Agents + Actions`
- [ ] 查询态展示单一混排结果列表
- [ ] 增加 `kind pill`
- [ ] 支持 `Esc / ↑ / ↓ / Home / End / Enter / hover / click`
- [ ] 尊重 `prefers-reduced-motion`

## T7 执行行为

- [ ] `session` 命中切会话
- [ ] `message` 命中写入 `pendingMessageJump`
- [ ] `ChatPage` 在消息加载完成后滚动并高亮目标消息
- [ ] `agent` 命中复用现有侧栏切换逻辑
- [ ] `setting` 命中打开 / 聚焦设置窗口并导航
- [ ] `action` 命中只执行非破坏性动作

## T8 测试

- [ ] main tests：排序、回填、增量同步、降级查询
- [ ] renderer tests：打开关闭、自动聚焦、键盘链路
- [ ] renderer tests：混排与去重
- [ ] renderer tests：message jump + scroll highlight
- [ ] renderer tests：agent / setting / action 执行
- [ ] 验收场景：sidebar 收起、空查询、设置窗口聚焦

## T9 质量检查

- [ ] `pnpm run format`
- [ ] `pnpm run i18n`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] 运行相关 main / renderer 测试
