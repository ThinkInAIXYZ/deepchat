# Startup Orchestration 任务拆分

## Phase 1

### T1 Coordinator / Contract

- [x] 新增 `StartupWorkloadCoordinator`
- [x] 固定 phase 优先级为 `interactive / deferred / background`
- [x] 固定资源并发为 `cpu = 1 / io = 2`
- [x] 支持 target run 创建、复用、取消、replay
- [x] 新增 typed event `startup.workload.changed`
- [x] 固定 shared startup task ids

### T2 Presenter / Window Wiring

- [x] `Presenter.init()` 改成 coordinator 注册 startup task
- [x] floating button 接入 coordinator
- [x] skills init 接入 coordinator
- [x] skill sync background scan 接入 coordinator
- [x] MCP init 接入 coordinator
- [x] remote runtime init 接入 coordinator
- [x] settings window create / ready / close 接入 run create / replay / cancel

### T3 Main Window Hydration

- [x] 保持 `startup.getBootstrap` + staged session path
- [x] 去掉 interactive 后立刻无条件 provider/model warmup
- [x] `ChatStatusBar` 改为 likely-provider on-demand warmup
- [x] `NewThreadPage` 改为 likely-provider on-demand warmup
- [x] coordinator idle 后增加低优先级 provider snapshot backfill

### T4 Settings Hydration

- [x] settings `onMounted` 只做 cheap init + router ready + `providers.listSummaries`
- [x] 移除 settings open 时的 eager `modelStore.initialize()`
- [x] 移除 settings open 时的 eager `ollamaStore.initialize()`
- [x] `settings-provider` 路由进入后再 `ensureProviderModelsReady(providerId)`
- [x] Ollama 仅在命中对应 provider detail 时加载
- [x] skills / MCP / remote 页面进入后再各自 hydration
- [x] heavy settings section 增加 skeleton

### T5 Summary Route / Memory Snapshot

- [x] 新增 `providers.listSummaries`
- [x] settings 首屏改走 provider summaries
- [x] `models.getProviderCatalog` 改成 memory-snapshot-first
- [x] `ModelStatusHelper` 改为 snapshot-first
- [x] `setModelStatus/deleteModelStatus` 同步更新 snapshot + persistent store

### T6 Route-level Tracking / Tests

- [x] route runtime 接入 workload task tracking
- [x] coordinator 优先级 / 并发 / 取消单测
- [x] `providers.listSummaries` route 单测
- [x] `ModelStatusHelper` snapshot 单测
- [x] renderer 侧去 eager warmup 的测试更新

## Phase 2

### T7 Worker: Skill Discovery

- [x] 新增 inline JSON worker runner
- [x] `SkillPresenter` discover / parse 迁到 worker
- [x] worker warning logging
- [x] worker failure fallback 到主线程路径
- [x] direct worker 单测
- [x] presenter fallback 单测

### T8 Worker: Skill Sync

- [x] `SkillSyncPresenter` scan / compare 迁到 worker
- [x] worker failure fallback 到主线程路径
- [x] direct worker 单测
- [x] presenter fallback 单测
- [x] worker dependency resolution 固定锚到 bundle path，而不是 `process.cwd()`

## 文档同步

- [x] 更新 `spec.md`
- [x] 更新 `plan.md`
- [x] 更新 `tasks.md`
- [x] 更新 `acceptance.md`

## 最终校验

- [x] `pnpm run format`
- [x] `pnpm run i18n`
- [x] `pnpm run lint`
- [x] `pnpm run typecheck`
- [x] 处理与本轮无关的自动拉新资源变更

## 后续 Follow-up

以下不算本轮 blocker，但保留给下一轮：

- [ ] main / splash 统一 startup trace
- [ ] `utilityProcess` 在 long-lived runtime 上的替换评估
- [ ] 更完整的 heavy settings route skeleton 自动化测试
