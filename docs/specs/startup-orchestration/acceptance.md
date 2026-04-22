# Startup Orchestration 验收方案

## 验收目标

本轮验收聚焦六件事：

1. 主窗口 interactive 是否先于 provider/model background warmup
2. settings 是否先显示 shell + summaries，再按 section 渐进完成
3. workload 是否具备 target 级取消与状态回推
4. `providers.listSummaries` / `models.getProviderCatalog` 是否走新的轻量与内存路径
5. skills discover / sync scan 是否已离开 main
6. 打包后 worker 路径是否仍然可用

## 必备观测点

日志或事件中至少应能观察到：

1. `startup.bootstrap.ready`
2. `startup.session.first-page.ready`
3. `startup.provider.warmup.deferred`
4. `startup.workload.changed`
5. settings heavy section 的 skeleton -> ready 过渡

## P0 通过条件

### P0-1 主窗口首屏响应

- 冷启动时主窗口在 session 首批返回前已经可交互
- interactive 后不会立刻自动扫所有 provider models
- provider/model 相关区域按需或 idle 后再补齐

### P0-2 Settings staged hydration

- 打开 settings 时先出现 shell/nav/provider summaries
- `modelStore.initialize()` / `ollamaStore.initialize()` 不在 settings-open 默认链路上
- 进入 provider / skills / MCP / remote 前，不会提前触发对应 heavy hydration
- heavy 页面在 ready 前展示 section skeleton，而不是空白页或整窗冻结

### P0-3 Workload cancellation

- settings window 关闭后，`target = settings` 的 pending/running task 被取消
- 再次打开 settings 时可以 replay 可见 workload 状态

### P0-4 Main hotspot control

- `providers.listSummaries` 不返回模型数组
- `models.getProviderCatalog` route 重复命中时以内存快照为主路径
- `ModelStatusHelper` 首次构建 snapshot 后，批量查询不再重复打持久层读取

### P0-5 Off-main workers

- skills discover / sync scan 正常返回结果
- worker 抛错时自动回退主线程路径，应用仍可用

### P0-6 Packaging compatibility

- `electron-vite build` 可以产出包含 worker 逻辑的 main bundle
- `electron-builder --dir` 可以产出 unpacked 包
- worker 在 asar 环境下不依赖 `process.cwd()` 解析第三方依赖

## 手工验收步骤

### 1. 冷启动主窗口

1. 冷启动应用
2. 观察：
   - shell / new thread 可交互
   - session sidebar 先 skeleton 再首批
   - provider/model 相关 UI 不会在 interactive 后立刻卡住 main

### 2. 冷启动后立刻打开 settings

1. 冷启动后马上打开 settings
2. 观察：
   - shell/nav 先出现
   - provider list 先出现 summaries
   - 不出现整窗白屏或冻结

### 3. 进入 heavy settings routes

1. 依次进入 provider / skills / MCP / remote
2. 观察：
   - 进入前不提前拉起对应数据
   - 进入后先 skeleton，再 section-ready

### 4. 关闭 settings 中断任务

1. 打开 settings 后迅速切到 heavy 页面
2. 在加载过程中关闭 settings
3. 观察：
   - settings 任务取消
   - main 窗口继续保持响应

### 5. 大量 provider / models / skills

1. 准备多 provider、多 models、多 skills 数据
2. 冷启动应用并操作主窗口输入、切换 settings
3. 观察：
   - main 输入与窗口交互保持响应
   - skills discover / sync scan 不再明显阻塞 main

## 自动化校验

每轮收口至少执行：

1. `pnpm run format`
2. `pnpm run i18n`
3. `pnpm run lint`
4. `pnpm run typecheck`
5. 关键 vitest：
   - coordinator
   - provider summaries route
   - model status snapshot
   - settings startup
   - worker direct tests
   - worker fallback tests

## 不通过条件

以下任一条件触发即判定不通过：

1. 主窗口 interactive 后立即无条件扫所有 provider/models
2. settings 打开时仍拉起全量 model / ollama warmup
3. settings heavy route ready 前出现空白页或整窗卡住
4. `ModelStatusHelper` 批量查询仍重复命中持久层
5. worker 在打包产物环境下因依赖解析失败不可用
