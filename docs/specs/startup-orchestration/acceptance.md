# Startup Orchestration 验收方案

## 验收目标

本轮验收聚焦五件事：

1. 主窗口首个可交互是否以 `agent ready` 为准
2. session sidebar 是否按 `skeleton -> first page -> append pages` 渐进出现
3. active chat 恢复后的 `providerId/modelId/projectDir` 是否完整
4. provider/model warmup 是否退出首屏主路径
5. `sessions.updated` 是否按实体增量 merge

## 必备观测点

验收前日志中必须出现：

1. `startup.bootstrap.ready`
2. `startup.session.first-page.ready`
3. `startup.session.page.appended`
4. `startup.provider.warmup.deferred`
5. `ChatTabView interactive ready`

## 通过条件

### P0 首屏可交互

- 冷启动时主窗口内容区在 session 首批返回前已经可交互
- agent icons / new-thread agent cards 在首屏即可见
- `ChatTabView interactive ready` 早于 `startup.session.first-page.ready`

### P0 Session Staged Loading

- session sidebar 在首批返回前展示 skeleton
- 首批返回后显示真实列表或 empty state
- 下一页只在滚动接近底部时触发
- 翻页过程中列表只 append，不清空、不闪烁

### P0 Active Session Restore

- 有 active session 时，首屏路由直接进入 chat
- active session row 存在于首批 sidebar 数据中
- `sessions.restore()` 返回后，`providerId/modelId/projectDir` 正确回填到 active summary

### P0 Deferred Warmup Priority

- `modelStore.initialize()` / `ollamaStore.initialize()` 在 startup deferred queue 中执行
- provider/model warmup 日志出现在 `startup.session.first-page.ready` 之后
- session 首批与滚动翻页期间没有重新引入全量 `sessions.list`

### P1 增量一致性

- `created/updated/deleted/activated/deactivated` 不触发整表 reload
- 事件回流后列表无重复项、无丢项、无顺序抖动
- active session、selected agent、scroll position 保持稳定

## 场景矩阵

| 场景 | 数据条件 | 预期结果 | 证据 |
| --- | --- | --- | --- |
| 冷启动，无 active session | 默认配置 | 主窗口直接进入 new thread；agent 先可用；sidebar 先 skeleton 后首批 | renderer logs + 录屏 |
| 冷启动，有 active session | 最近一次绑定有效 | 首屏直接进入 chat；active row 在首批页内；active summary 完整 | logs + route state |
| 大量历史 session | `>= 500` sessions | 首批只请求一页 lightweight data；滚动后再补下一页 | main logs + renderer logs |
| 多 provider | `>= 10` enabled providers | agent ready 先于 provider warmup；provider warmup 记录在 deferred 阶段 | logs |
| session 事件回流 | 启动后发生 create/update/delete | 列表局部 upsert/remove，界面稳定 | logs + 录屏 |

## 手工验收步骤

### 1. 冷启动，无 active session

1. 清空当前窗口活跃绑定
2. 启动应用
3. 观察顺序：
   - 主内容区出现
   - agent icons 可点
   - session sidebar 展示 skeleton
   - skeleton 被首批列表替换

### 2. 冷启动，有 active session

1. 保留一个最近活跃的 regular session
2. 启动应用
3. 检查：
   - 路由直接进入 `chat`
   - sidebar 首批包含 active session
   - `ChatStatusBar` 显示正确 provider/model

### 3. 大量 session 翻页

1. 准备 `>= 500` sessions
2. 启动应用，确认首批只出现约 `30` 条
3. 滚动到底部
4. 检查：
   - 出现 `startup.session.page.appended`
   - 新数据 append 到现有列表尾部
   - 已有条目不清空

### 4. Deferred Warmup 优先级

1. 启用多个 provider
2. 启动应用
3. 检查日志先后顺序：
   - `startup.bootstrap.ready`
   - `ChatTabView interactive ready`
   - `startup.session.first-page.ready`
   - `startup.provider.warmup.deferred`

### 5. 增量事件回流

1. 启动后创建 session
2. 重命名 / pin / 删除 session
3. 检查：
   - `sessions.updated` 携带具体 `sessionIds`
   - renderer 走 `refreshSessionsByIds` 或 `removeSessions`
   - 列表保持稳定排序

## 自动化校验

每轮收口至少执行：

1. `pnpm run format`
2. `pnpm run i18n`
3. `pnpm run lint`
4. `pnpm run typecheck`

## 不通过条件

以下任一条件触发即判定不通过：

1. agent icons 需要等待 session 首批后才可见
2. sidebar 首批返回前出现误导性的 empty state
3. `sessions.restore()` 后 active summary 缺少 `providerId/modelId/projectDir`
4. 滚动翻页时列表发生清空或重排闪烁
5. `created/updated/deleted` 事件回流重新触发整表重载
