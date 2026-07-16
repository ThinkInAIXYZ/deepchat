# main 进程架构整理：实施计划

> 状态：已完成，等待用户验证
> 书写规则：说明使用直白中文；代码标识、文件路径和命令保持原文。
> 实施规则：先删除旧代码和旧引用，再写唯一的新路径；不保留兼容层、双轨或 fallback。

## 实施目标

这次整理不重写产品和 Agent 算法，只调整职责、生命周期和依赖方向。最终结构必须满足：

1. App 只有一个局部 composition root，不向业务代码公开模块列表。
2. Desktop、Remote、Scheduler、deeplink 和 subagent 共用 Session 规则。
3. Session 拥有长期数据和生命周期；Desktop 只拥有 renderer binding。
4. `DeepChat` 和 `ACP` 保持两套独立运行实现。
5. Provider、Tool、MCP、Skill、Plugin、Memory、Knowledge、Workspace 各自负责自己的状态。
6. Config、SQLite、route 和 event 不再充当业务总入口。
7. 每项运行资源只有一个停止方；database import、reset、sync 和加密由 App 管理维护状态。

## 已完成的实施顺序

### 1. Session 和 Agent

- 删除旧 `SessionPresenter`、`AgentSessionPresenter` 和聚合 facade。
- 把 Session lifecycle、turn、assignment、query、deletion 和 data 放入 `src/main/session/`。
- 把 renderer binding 移到 Desktop。
- 建立 `AgentManager` 和两个 typed backend，分开管理 `DeepChat` 与 `ACP`。
- 让 Agent runtime 通过窄接口使用 Session data、Provider、Tool、Skill、Memory 和 renderer 通知。

### 2. App 生命周期

- 删除 `LifecycleManager`、phase、priority 和通用 lifecycle hook。
- 删除全局 `Presenter`、`presenter`、`getInstance()` 和模块查找入口。
- 在 `src/main/app/composition.ts` 直接创建模块、连接依赖、注册 route 和排定停止顺序。
- 让 `startMainProcess()` 只返回 `MainProcessControl`。
- 让 Sync、Database Security、数据重置和 restart 通过 App 的维护或停止流程执行。

### 3. 业务模块归位

- 把 Desktop、Provider、Tool、MCP、Skill、Plugin、Memory、Knowledge、Workspace、File、Remote、
  Scheduler、Deeplink、Hook、Sync、Upgrade、Exporter、Device 和 Project 移出旧 Presenter 目录。
- 同一批删除旧 class、shared interface、测试路径和转发文件。
- 把具体配置和业务 table 交给负责模块，不再通过通用 Config 或 `MainDatabase` 聚合。

### 4. 通信边界

- 各模块通过自己的 `routes.ts` 注册 typed route map。
- App 统一注册 route map，并在注册时拒绝重名。
- 删除全局 `EventBus`、`sendToMain()` 和用 event 发业务命令的路径。
- 发给 renderer 的 typed event 由 App 注入，不让业务模块反向依赖 Routes 或 Desktop。

### 5. 防回归

- 架构检查禁止恢复旧 Presenter 入口、全局查找、全局 EventBus 和 retired shared 类型。
- 架构检查禁止 Agent、Session 反向导入 Desktop、Remote、Scheduler、Routes 和 App。
- 每个模块迁移后运行对应 unit/integration test，并按模块单独提交。

## 最终验收

最终验收按下面顺序执行：

1. 搜索旧路径、全局入口、兼容分支和反向依赖。
2. 运行 `pnpm run lint:architecture` 和架构检查测试。
3. 生成最终依赖基线，确认旧 Presenter 指标为 `0`，并记录仍存在的模块内部循环。
4. 运行 main、renderer 和相关 E2E 测试。
5. 运行 `pnpm run format`、`pnpm run i18n`、`pnpm run lint` 和 `pnpm run typecheck`。
6. 更新 [当前架构](../../ARCHITECTURE.md)、[当前流程](../../FLOWS.md) 和本目录任务状态。

最终结果：P0 到 P5 全部通过，旧 Presenter 和 renderer 兼容入口指标均为 `0`。main 当前有
605 个文件、1836 条内部依赖和 10 个循环；这些循环都位于 Agent、Hook、Memory、Desktop、
Tool 或 Skill 模块内部，没有跨顶层模块循环。

## 验收限制

- `output/` 是本地分析结果，不提交。
- canonical dependency baseline 只能由当前可运行的生成脚本产生，不能手写结果掩盖生成失败。
- 如果用户正在修改同一份脚本或文档，验收先完成其他项目，再等待该文件可以安全合并。

## 撤销办法

每个实施批次是一个完整 commit。需要撤销时回退整个 commit，不增加兼容层、可选依赖、双读、
双写或新旧分支。
