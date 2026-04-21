# Startup Orchestration 任务拆分

## T0 文档与基线

- [x] 创建 `docs/specs/startup-orchestration/spec.md`
- [x] 创建 `docs/specs/startup-orchestration/plan.md`
- [x] 创建 `docs/specs/startup-orchestration/tasks.md`
- [x] 创建 `docs/specs/startup-orchestration/acceptance.md`
- [x] 记录当前启动基线日志与主路径耗时样本

## T1 启动编排器与 Splash 接管

- [ ] 引入统一 `StartupOrchestrator`
- [ ] 为 startup run 定义 phase、task、去重 key、超时策略
- [ ] 将关键启动任务迁移到 orchestrator 管理
- [ ] 保持现有 splash 延迟显示策略
- [ ] splash 展示关键 phase/progress/error 状态
- [ ] 主窗口显示时机切换到 `critical-startup ready`

## T2 启动事件语义收口

- [ ] 重新梳理 startup/window/tab 相关事件语义
- [ ] 区分“首个 tab 建立完成”和“真实 BrowserWindow ready-to-show”
- [ ] 移除 `Presenter.init()` 的重复触发入口
- [ ] 为 startup 关键事件补统一命名和日志

## T3 Provider 启动治理

- [ ] 拆分 `provider summary snapshot` 与 `provider full warmup`
- [ ] 移除 provider constructor 内的 startup 关键路径副作用
- [ ] 收敛 `LLMProviderPresenter` 启动入口
- [ ] 为 provider warmup 增加单次去重与并发限制
- [ ] 把 provider full model refresh 移出首屏关键路径

## T4 Session / Agent 轻量快照

- [ ] 为 `sessions list` 定义 lightweight snapshot 读取路径
- [ ] 让冷启动历史 session 默认使用持久化快照态
- [ ] 让活动 runtime 状态覆盖持久化 snapshot
- [ ] 为 `agent list` 定义 lightweight snapshot 读取路径
- [ ] 为 snapshot 增加版本号或时间戳
- [ ] 明确 snapshot 与后台刷新结果的 merge 规则

## T5 Renderer 首屏瘦身

- [ ] 新增 bootstrap snapshot 读取与应用流程
- [ ] `pageRouter`、`sessionStore`、`agentStore` 支持先应用 snapshot
- [x] 收敛 `ChatTabView` ready 关键路径
- [x] 把 `projectStore.fetchProjects()` 移到后台
- [x] 为 renderer 增加 post-interactive deferred task gate
- [x] 把 active thread restore 移到 post-interactive deferred queue
- [x] 把 `ACP` draft/bootstrap 与 config warmup 移到 post-interactive deferred queue
- [ ] 把 `providerStore/modelStore` 全量初始化移到后台或按需
- [ ] 去掉重复的 `getActive()` 首屏读取

## T6 Background Warmups

- [ ] 明确 deferred 任务清单
- [ ] 把 `MCP` auto-start、skill scan、remote control、usage backfill、legacy import、ACP env warmup 放入 deferred queue
- [ ] 为 deferred queue 增加并发上限和失败隔离
- [ ] 保证 deferred 任务不会阻塞关键 IPC 热路径

## T7 观测与验收

- [ ] 新增 startup run / phase / task 日志
- [ ] 新增关键时间点 trace
- [ ] 补 main / integration 测试
- [x] 补 renderer 启动 defer 测试
- [x] 运行 `pnpm run format`
- [x] 运行 `pnpm run i18n`
- [x] 运行 `pnpm run lint`
- [x] 运行 `pnpm run typecheck`
