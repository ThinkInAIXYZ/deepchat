# 修复 F1：SQLite 启动关键路径收缩与诊断去重

## 目标
缩短 DeepChat 主进程启动关键路径中的 SQLite 阻塞时间，但不改变当前数据库初始化的正确性边界：
- 关键路径仍保留数据库打开、最小连接验证、建表、版本表初始化、迁移与必要的启动期 schema 处理。
- 保留启动期自动 repair 所需的 schema 诊断，不再额外注册重复的观察性后台诊断。
- 先补齐分阶段 duration 日志，把启动耗时拆解为可观测的 `open / initTables / migrate / diagnose / repair` 五段。
- 将“非关键表延迟建表”降级为可选后续优化，不作为本修复的必做项。

## 定位
- 启动链路中，`databaseInitHook` 会同步执行 `DatabaseInitializer.initialize()`，随后再调用 `DatabaseInitializer.migrate()`，见 [src/main/presenter/lifecyclePresenter/hooks/init/databaseInitHook.ts#L45-L53](../../../src/main/presenter/lifecyclePresenter/hooks/init/databaseInitHook.ts#L45-L53)。
- `DatabaseInitializer.initialize()` 当前会在启动关键路径内：
  1. `new SQLitePresenter(...)`
  2. `validateConnection()`
  3. `diagnoseStartupSchema()`
  4. 必要时执行 `repairSQLiteDatabaseFile(...)`
  见 [src/main/presenter/lifecyclePresenter/DatabaseInitializer.ts#L42-L123](../../../src/main/presenter/lifecyclePresenter/DatabaseInitializer.ts#L42-L123)。
- `DatabaseInitializer.migrate()` 目前只是日志占位，真实迁移已在 `SQLitePresenter` 初始化阶段完成，见 [src/main/presenter/lifecyclePresenter/DatabaseInitializer.ts#L125-L142](../../../src/main/presenter/lifecyclePresenter/DatabaseInitializer.ts#L125-L142)。
- `SQLitePresenter` 构造函数会同步调用 `initializeDatabase()`，见 [src/main/presenter/sqlitePresenter/index.ts#L255-L263](../../../src/main/presenter/sqlitePresenter/index.ts#L255-L263)。
- `initializeDatabase()` 当前同步执行 `openSQLiteDatabase`、`SELECT 1`、`initTables()`、`initVersionTable()`、`migrate()`，见 [src/main/presenter/sqlitePresenter/index.ts#L322-L329](../../../src/main/presenter/sqlitePresenter/index.ts#L322-L329)。
- `initTables()` 当前一次性实例化并创建 27 张活跃表，且与 `getMigrationTables()` 返回值和大量实例属性强耦合，见 [src/main/presenter/sqlitePresenter/index.ts#L406-L466](../../../src/main/presenter/sqlitePresenter/index.ts#L406-L466) 与 [src/main/presenter/sqlitePresenter/index.ts#L483-L512](../../../src/main/presenter/sqlitePresenter/index.ts#L483-L512)。
- `migrate()` 在 presenter 内部同步执行版本迁移，见 [src/main/presenter/sqlitePresenter/index.ts#L514-L571](../../../src/main/presenter/sqlitePresenter/index.ts#L514-L571)。
- `StartupWorkloadCoordinator.scheduleTask()` 的任务参数强制要求 `target`，且 `target` 类型来自 `StartupWorkloadTargetSchema`，见 [src/main/presenter/startupWorkloadCoordinator/index.ts#L26-L36](../../../src/main/presenter/startupWorkloadCoordinator/index.ts#L26-L36) 与 [src/shared/contracts/common.ts#L268-L268](../../../src/shared/contracts/common.ts#L268-L268)。当前合法取值只有 `'main'` 与 `'settings'`。
- 现有启动任务示例均使用 `target: 'main'`，例如 `main:mcp-init`，见 [src/main/presenter/index.ts#L744-L835](../../../src/main/presenter/index.ts#L744-L835)。
- 经代码搜索，`SQLitePresenter` 仅在一处被实例化：`DatabaseInitializer.ts:50`，不存在“多处 new SQLitePresenter”这一现状。对应搜索结果见 [src/main/presenter/lifecyclePresenter/DatabaseInitializer.ts#L50-L50](../../../src/main/presenter/lifecyclePresenter/DatabaseInitializer.ts#L50-L50)。

## 修复方案
1. **不再注册重复后台诊断**
   - 当前同步 `diagnoseStartupSchema()` 仍承担 repair 前置判定职责，不能直接后移。
   - 成功路径不再注册第二次 `main:sqlite-schema-diagnosis`，避免 `scheduleTask()` 立即 pump 后在 INIT 阶段同步执行第二次诊断。
   - `SQLitePresenter` 继续只负责数据库能力，不直接依赖启动编排层。

2. **合法 target 必须来自现有 schema**
   - `scheduleTask()` 必须显式传 `target`，且取值受 `StartupWorkloadTargetSchema` 限制，目前只有 `'main'` 和 `'settings'` 两个合法值，来源见 [src/shared/contracts/common.ts#L268-L268](../../../src/shared/contracts/common.ts#L268-L268)。
   - 本修复所处链路是主进程主启动流程，因此若接入现有启动 run，应使用现有主流程 target：`'main'`。
   - 文档和示例中不要使用不存在的 `'app'` 值；若需复用当前启动 run，应由上层把 `createRun('main')` 生成的 `runId` 一并传入。

3. **关键路径与后台任务重新分界**
   - 保持关键路径：
     - `new SQLitePresenter(...)`
     - `validateConnection()`
     - 启动成功前必须完成的建表与迁移
     - 对“启动即应修复”的 schema 问题做一次同步修复尝试（当前行为在 `DatabaseInitializer.initialize()` 中）
   - 不再重复执行：
     - 成功启动后仅用于观察/告警的第二次 schema 诊断
     - 由第二次诊断产生的重复 repair/manual issue 摘要日志
     - 若后续增加更温和的补充检查，必须保证不会在 `initialize()` 返回前同步运行
   - 若保留当前“同步 diagnose 后决定 repair”的行为，则本修复第一阶段至少应先补充日志，不应在没有替代保障前贸然移除同步诊断。

4. **阶段耗时日志覆盖五阶段**
   - 必须分别记录以下五段 duration，而不是只记总时长：
     - `open`：围绕 `openSQLiteDatabase` + `SELECT 1`
     - `initTables`：围绕 `initTables()`
     - `migrate`：围绕 `migrate()`
     - `diagnose`：围绕 `diagnoseStartupSchema()` / `database.diagnoseSchema(...)`
     - `repair`：围绕 `repairSQLiteDatabaseFile(...)`
   - 建议统一使用 `performance.now()`，并采用稳定日志格式，例如：
     - `DatabaseInitializer: phase=diagnose duration=...ms`
     - `DatabaseInitializer: phase=repair duration=...ms`
     - `SQLitePresenter: phase=open duration=...ms`
     - `SQLitePresenter: phase=initTables duration=...ms`
     - `SQLitePresenter: phase=migrate duration=...ms`

5. **后续补充诊断的接入约束**
   - 如果未来重新引入观察性诊断，必须由持有 coordinator 的层调度，并保证任务体第一段不会同步阻塞 `DatabaseInitializer.initialize()`。
   - 任何补充诊断只能记录日志或健康状态，不能改变本次启动的 repair/continue 决策。

## 步骤拆分
1. **先补 observability**
   - 在 `SQLitePresenter.initializeDatabase()` 中补 `open / initTables / migrate` 三段 `performance.now()` 日志。
   - 在 `DatabaseInitializer.initialize()` / `diagnoseStartupSchema()` 的调用链中补 `diagnose / repair` 两段 `performance.now()` 日志。

2. **去掉重复观察性诊断**
   - `DatabaseInitializer.initialize()` 成功路径只依赖一次 startup diagnosis。
   - 不再向 `DatabaseInitializer` 注入 `startupWorkloadCoordinator` / `runId` / `target`，因为当前没有需要额外调度的补充诊断。
   - 保留同步 diagnose 的 repair 判定链路，避免丢失启动期自动修复入口。

4. **非关键表延迟建表列为可选后续项**
   - 不把拆分 `initTables()` 作为 F1 必做交付。
   - 若后续继续推进，应单列子任务验证首次访问守卫、迁移表清单、表实例生命周期与测试覆盖。

## 验证
- 文档一致性：确认方案中不再声称 `SQLitePresenter` 直接调度 coordinator，也不再使用非法 target 值 `'app'`。
- 代码落地后应验证：
  - 五段日志 `open / initTables / migrate / diagnose / repair` 均能输出。
  - 健康启动只执行一次 startup schema diagnosis。
  - `SQLitePresenter` 实例化点仍只有 [src/main/presenter/lifecyclePresenter/DatabaseInitializer.ts#L50-L50](../../../src/main/presenter/lifecyclePresenter/DatabaseInitializer.ts#L50-L50) 这一处，除非后续设计明确新增构造点。
- 静态/常规检查按仓库规范执行：`pnpm run format`、`pnpm run i18n`、`pnpm run lint`。

## 风险
- **同步 diagnose 当前承担 repair 前置判定职责**：`DatabaseInitializer.initialize()` 现在会依据诊断结果决定是否调用 `repairSQLiteDatabaseFile(...)`，若直接把 diagnose 后移，可能丢失启动期自动修复入口。
- **`initTables()` 拆分风险高于文档初版假设**：当前 27 张表的实例化、`createTable()` 调用、`getMigrationTables()` 返回值和公开属性之间高度耦合，见 [src/main/presenter/sqlitePresenter/index.ts#L406-L466](../../../src/main/presenter/sqlitePresenter/index.ts#L406-L466) 与 [src/main/presenter/sqlitePresenter/index.ts#L483-L512](../../../src/main/presenter/sqlitePresenter/index.ts#L483-L512)。贸然拆成“核心/非核心表”可能破坏迁移顺序、属性可用性或首次访问假设。
- **延迟建表只能作为可选优化**：若后续要延迟非关键表建表，必须补齐首次使用前的存在性守卫，并验证所有读取路径不会提前访问这些表。
- **重复诊断会伪装成后台任务**：`StartupWorkloadCoordinator.scheduleTask()` 会立即 pump；若任务体第一段仍是同步 SQLite 诊断，就会在 `initialize()` 返回前完成，反而增加关键路径耗时。
- **repair 仍包含同步文件 IO**：即使后续把部分诊断转入后台，`repairSQLiteDatabaseFile(...)` 涉及文件级操作，仍需谨慎控制触发时机，避免与其他数据库访问竞争。
