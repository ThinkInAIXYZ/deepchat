# Main Kernel Refactor Tasks

## Program Kickoff

- [x] 建立 `docs/specs/main-kernel-refactor/` 目录
- [x] 编写 `spec.md`
- [x] 编写 `plan.md`
- [x] 编写 `tasks.md`
- [x] 编写 `acceptance.md`
- [x] 编写 `test-plan.md`
- [x] 编写 `migration-governance.md`
- [x] 在 `docs/README.md` 增加入口

## Migration Governance

- [ ] 建立 bridge register，并在每个迁移 PR 中维护
- [ ] 建立 migration scoreboard，并在每个阶段结束时更新
- [ ] 明确每个 slice 的唯一 active owner
- [ ] 为超期 bridge 建立 fail-fast 处理规则
- [ ] 将 review checklist 纳入实施标准
- [ ] 将“最多 1 个 phase 寿命”的 bridge 规则作为默认纪律

## Build vs Buy

- [x] 明确 build-vs-buy 默认策略
- [ ] 引入 `dependency-cruiser` 并接入架构检查
- [ ] 保持 `Scope` 为仓库内自写实现，不引入重型 DI 容器
- [ ] 保持 `EventBus` 为仓库内自写语义模型
- [ ] 为 `EventBus` 记录可借鉴 `Emittery` 的风格边界，但不作为第一批运行时依赖
- [ ] 在 `Scheduler.retry` 接口化落地时接入 `p-retry`
- [ ] 只在 provider/tool/MCP 并发治理需求明确时评估 `p-queue`
- [ ] 将 `neverthrow` 标记为后续可选项，而不是第一批基础设施

## Phase 0: Guardrails & Baseline

- [ ] 扩展 `scripts/architecture-guard.mjs`，阻止新增 `usePresenter()` 调用点
- [ ] 扩展 `scripts/architecture-guard.mjs`，阻止新增 `window.electron.ipcRenderer.*` 监听
- [ ] 扩展 `scripts/architecture-guard.mjs`，阻止新增 renderer -> `electron` import
- [ ] 扩展 `scripts/architecture-guard.mjs`，阻止在组件/store 中新增裸 channel 字符串
- [ ] 扩展 `scripts/architecture-guard.mjs`，阻止 `window.deepchat` 出现 presenter/repository/sqlite 等内部实现名
- [ ] 扩展 `scripts/architecture-guard.mjs`，阻止新增业务层裸 timer
- [ ] 为新规则补充例外清单与 owner 说明，避免长期匿名豁免
- [ ] 扩展 baseline 脚本，增加 presenter/import/IPC/timer 的趋势指标
- [ ] 扩展 baseline 脚本，增加 bridge 分组与 route 数量趋势指标
- [ ] 在 `docs/architecture/baselines/` 落一次本项目初始重构基线
- [ ] 确认每条基线都能重复生成，并写明执行命令
- [ ] 将 `dependency-cruiser` 规则纳入 `Phase 0` 的基础 guardrail

## Phase 1: Typed Contracts & Preload Bridge

- [ ] 新建 `src/shared/contracts/` 目录
- [ ] 定义 `shared/contracts/routes.ts` 作为跨进程 API 唯一事实源
- [ ] 为首批 route group 补充 input/output schema
- [ ] 定义 `window.deepchat` capability 分组和命名规则
- [ ] 新建 `src/preload/createBridge.ts`
- [ ] 在 `src/preload/index.ts` 中建立 generated typed facade
- [ ] 新建 `src/renderer/api/ChatClient.ts`
- [ ] 新建 `src/renderer/api/SessionClient.ts`
- [ ] 新建 `src/renderer/api/SettingsClient.ts`
- [ ] 迁移首批 renderer 调用入口到 client，而不是 `usePresenter()` 或直接碰 bridge
- [ ] 为 route registry、preload bridge builder、renderer client 补测试
- [ ] 停止为旧 bridge 增加新 API

## Phase 2: Main Kernel & Scoped DI

- [ ] 新建 `src/main/bootstrap/`
- [ ] 新建 `src/main/di/serviceIds.ts`
- [ ] 新建 `src/main/di/Scope.ts`
- [ ] 定义 `app/window/session` scope 语义
- [ ] 把 logger、event bus、scheduler、repositories 收口到 app scope
- [ ] 把 BrowserWindow / WebContents 收口到 window scope
- [ ] 设计 session scope 的 owner、销毁时机与 cancellation 语义
- [ ] 为 scope dispose 顺序补测试
- [ ] 让新 service 获取依赖不再经过全局 presenter locator
- [ ] 明确本阶段不引入 `Awilix` / `tsyringe`

## Phase 3: Settings Pilot Slice

- [ ] 设计 `SettingsService` 与相关 use case
- [ ] 抽出 `SettingsRepository` port
- [ ] 提供现有存储实现对应的 infra adapter
- [ ] 定义 settings contract 和 route
- [ ] 将 settings renderer 调用迁移到 `SettingsClient`
- [ ] 清理对应 settings presenter 主路径依赖
- [ ] 补齐 settings 单测、集成测试和 smoke case
- [ ] 删除该 slice 上不再需要的桥接代码

## Phase 4: Sessions & Event Store

- [ ] 设计 `SessionService`
- [ ] 设计 `CreateSessionUseCase`
- [ ] 设计 `RestoreSessionUseCase`
- [ ] 设计 `SessionEventStore` 事件模型
- [ ] 实现 session list/create/restore 的 contract 与 route
- [ ] 迁移 renderer 会话页面与 store 到 `SessionClient`
- [ ] 为 session restore、resume、archive 补测试
- [ ] 明确 legacy 数据边界的只读兼容策略
- [ ] 删除该阶段替换完成后的旧会话桥接

## Phase 5: Chat Runtime Cutover

- [ ] 设计 `ChatService`
- [ ] 设计 `SendMessageUseCase`
- [ ] 设计 `StreamAssistantReplyUseCase`
- [ ] 引入 `Scheduler` port，承接 timeout/retry/sleep
- [ ] 在 `Scheduler.retry` 内部接入 `p-retry`
- [ ] 为 stream chunk、stream done、stream cancel 定义 typed contract
- [ ] 迁移发送消息主链路到 `ChatClient` + 新 service
- [ ] 迁移停止流、重试、异常回传主链路到新 service
- [ ] 补齐 chat runtime 单测与集成测试
- [ ] 删除 `agentRuntimePresenter` 在主执行链路上的 owner 角色

## Phase 6: Providers & Tools Boundary

- [ ] 设计 `ProviderService` / `ProviderRegistry`
- [ ] 设计 `ToolService` / `ToolExecutor`
- [ ] 提取 provider/tool 相关 ports
- [ ] 收口 provider 配置与运行时查询边界
- [ ] 收口 tool execution、permission、rate limit 边界
- [ ] 若出现明确并发/背压需求，评估 `p-queue`
- [ ] 为 MCP/tool/provider 关键路径补测试
- [ ] 迁移对应 renderer/store 调用到 typed bridge
- [ ] 删除该 slice 上不再需要的 presenter 协调逻辑

## Phase 7: Legacy Removal & Final Cleanup

- [ ] 删除活跃 `src/main/presenter` 运行时依赖
- [ ] 删除 renderer 主链路中的 `usePresenter()`
- [ ] 删除 `window.electron` 旧入口
- [ ] 删除 `window.api` 旧入口
- [ ] 删除散落字符串 IPC channel 常量
- [ ] 删除业务层裸 timer
- [ ] 更新 active architecture docs 到新结构
- [ ] 重跑基线并确认指标达标
- [ ] 完成最终 smoke、回归与发布前检查

## Phase Exit Discipline

- [ ] 每个阶段完成时更新本文件状态
- [ ] 每个阶段完成时更新 `docs/architecture/baselines/*`
- [ ] 每个阶段完成时同步更新 `acceptance.md`
- [ ] 每个阶段完成时同步更新 `test-plan.md` 的实际通过情况
- [ ] 每个阶段完成时更新 bridge register 与 migration scoreboard
- [ ] 每个阶段完成时确认 `window.deepchat` 没有泄漏新的内部实现名
- [ ] 每个阶段完成时确认对应 slice 只剩一个 active owner
- [ ] 每个阶段完成时确认没有超期 bridge
