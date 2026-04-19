# Main Kernel Refactor Tasks

## Program Reset

- [x] 保留 `docs/specs/main-kernel-refactor/` 目录作为本轮主规格入口
- [x] 将原“大而全 kernel 重构”收敛为“边界稳定 + 热路径减耦 + 可测试性提升”方案
- [x] 重写 `spec.md`
- [x] 重写 `plan.md`
- [x] 重写 `acceptance.md`
- [x] 重写 `tasks.md`
- [x] 重写 `test-plan.md`
- [x] 重写 `migration-governance.md`
- [x] 重写 `build-vs-buy.md`
- [x] 重写 `ports-and-scheduler.md`
- [x] 重写 `route-schema-catalog.md`
- [x] 重写 `eventbus-migration.md`
- [x] 更新 `docs/README.md` 中对本计划的描述

## Phase 0: Guardrails & Baseline

- [x] 扩展 `scripts/architecture-guard.mjs`，阻止新增 `usePresenter()` 调用点
- [x] 扩展 `scripts/architecture-guard.mjs`，阻止新增 `window.electron.ipcRenderer.*` 监听
- [x] 扩展 `scripts/architecture-guard.mjs`，阻止在 migrated path 中新增 raw channel 字符串
- [x] 为 hot path direct dependency 增加趋势检查
- [x] 扩展 baseline 脚本，输出 `usePresenter` / `window.electron` / `window.api` / raw timer / bridge 数量
- [x] 建立 bridge register
- [x] 建立轻量 migration scoreboard

## Phase 1: Typed Boundary Foundation

- [x] 新建或收敛 `src/shared/contracts/` 目录
- [x] 定义 route registry，覆盖 settings 与 chat/session 首批入口
- [x] 定义 typed event catalog，覆盖 `settings.changed`、`sessions.updated`、`chat.stream.*`
- [x] 新建 `src/preload/createBridge.ts` 或统一 bridge builder
- [x] 新建 `src/renderer/api/SettingsClient.ts`
- [x] 新建 `src/renderer/api/SessionClient.ts`
- [x] 新建 `src/renderer/api/ChatClient.ts`
- [x] 约束后续新增 renderer-main 能力必须先落 route registry

## Phase 2: Settings Pilot Slice

- [x] 设计 settings contract / handler / adapter
- [x] 将 settings renderer/store 迁移到 `SettingsClient`
- [x] 清理 settings 主路径上的 `usePresenter()` / raw IPC 依赖
- [x] 补齐 settings 单测、集成测试和 smoke
- [x] 删除 settings 迁移过程中的临时桥接

## Phase 3: Chat & Session Hot Path

- [x] 设计 `ChatService` 或等价 orchestration 层
- [x] 设计 `SessionService` 或等价 session orchestration 层
- [x] 抽出最小必要 port：`SessionRepository`、`MessageRepository`、`ProviderExecutionPort`
- [x] 抽出最小必要 port：`ProviderCatalogPort`、`SessionPermissionPort`、`WindowEventPort`
- [x] 引入 `Scheduler` 接口并承接 cancel / timeout / retry
- [x] 迁移发送消息、停止流、恢复会话主链路
- [x] 清理 `AgentSessionPresenter -> AgentRuntimePresenter` 在 migrated path 上的主 owner 角色
- [x] 补齐 chat/session 主路径测试

## Phase 4: Provider / Tool Boundary

- [ ] 明确 provider query / execution / session 配置的边界
- [ ] 将 migrated path 上 presenter 对 provider 的直接调用改为 port / adapter
- [ ] 收口 permission response、tool response 的 contract
- [ ] 如确有需要，再补 `ProviderSessionPort`
- [ ] 为 provider / permission / tool 关键交互补测试
- [ ] 删除本阶段引入的临时兼容桥

## Phase 5: Consolidation & Re-evaluation

- [ ] 删除本轮仍存活的 bridge
- [ ] 重跑 baseline 并更新 scoreboard
- [ ] 更新 active docs 和实现说明
- [ ] 记录最终 smoke 结果
- [ ] 形成“是否继续推进更彻底 kernel 重构”的结论

## Phase Exit Discipline

- [x] 每个阶段完成时更新本文件状态
- [x] 每个阶段完成时更新 `acceptance.md`
- [x] 每个阶段完成时更新 `test-plan.md`
- [x] 每个阶段完成时更新 `docs/architecture/baselines/*`
- [x] 每个阶段完成时更新 bridge register 与 scoreboard
- [x] 每个阶段完成时确认 legacy 指标净下降
