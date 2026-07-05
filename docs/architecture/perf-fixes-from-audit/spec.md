# 性能审计修复实施

## User Need

`docs/issues/performance-audit-report/` 完成了一次覆盖 17 个性能点（F1–F16 + V1）的性能审计，每个点都已通过代码审计 + 构建/E2E 运行验证，结论记录在 `report.md` 第 9 节汇总表。用户现在要求：

1. 把**边际效应**和**风险真实但不值得修**的项标记为「不修复」。
2. 剩余项按**实施难度从易到难**排序，拆分任务与步骤，列出**详细修复方案**，落成可执行的实施文档。

## Goal

产出一组 SDD 实施文档（本 `spec.md` + `plan.md` + `tasks.md`），明确：

- 哪些审计项「不修复」及理由。
- 哪些审计项「修复」，按实施难度排序。
- 每个修复项的：目标、代码位置、详细方案、步骤拆分、验收方式、风险。

## 决策分类

### 不修复（5 项）

依据 `report.md` 第 9 节的「修复必要」与「修复收益」判定：边际收益 / 结构性护栏 / 已有缓解机制 / 受 Vite 分块影响成本小。

| 编号 | 发现 | 不修复理由 |
| --- | --- | --- |
| F2 | ACP registry migration 在窗口创建前 | `critical:false` + try/catch，只延迟不阻塞；稳定库走 fast-path，仅迁移场景有几十 ms，后移增加复杂度且回归数据库解锁路径风险。收益边际。 |
| F4 | Presenter 构造同步聚合 | 当前构造函数只做引用装配，不热；是结构性/潜在风险。价值是护栏而非可测收益，靠 code review 规范约束即可，无需代码改动。 |
| F7 | Splash window 无条件创建 | 已有 `suppressSplashShow`/`closeHiddenSplashWindow` 机制抑制可见性；延迟创建 BrowserWindow 增加复杂度并可能回归数据库解锁强制显示路径。收益边际。 |
| F10 | i18n 全量同步导入 | 实际成本受 Vite 分块影响，`out/renderer/assets` 未能归属到单一 locale bundle，可能已内联/共享，运行时成本未必大；locale JSON 体量本身不大。收益小于 F9/F11，且需改 vue-i18n 加载方式，风险收益比低。 |
| F14 | Session sidebar fingerprint/watch | 已有 rAF coalescing（L1040-1048）去重帧内请求，布局读取频率已被限制；revision counter 只省字符串分配，对极大列表才有感。收益边际。 |

> 这 5 项不在本轮修复范围。`report.md` 第 9 节已记录其状态为「边际」，保留为后续可选优化。

### 修复（12 项，按实施难度从易到难）

详见 `plan.md`。难度评估综合：改动文件数、是否跨进程、是否需大数据量验证、回归风险。

## Acceptance Criteria

- `spec.md` / `plan.md` / `tasks.md` 三件套齐全且无 `[NEEDS CLARIFICATION]`。
- 每个修复项的 `plan.md` 节包含：目标、代码位置（文件:行号）、详细方案、步骤拆分、验收方式、风险。
- `tasks.md` 按难度排序，每个任务可映射到一次提交或评审切片。
- 不修复项有明确理由，且与 `report.md` 第 9 节结论一致。
- 实施完成后，相关 E2E（`01-launch`、修复后的 `04-settings-navigation`）通过；`pnpm run typecheck`、`pnpm run lint`、`pnpm run format`、`pnpm run i18n` 干净。

## Constraints

- 不破坏现有 E2E 默认行为：临时 `DEEPCHAT_E2E_USER_DATA_DIR`，不碰用户真实数据。
- 不记录/导出/暴露密钥、token、凭据。
- 遵循仓库现有约定：Presenter 边界、typed `shared/contracts/*`、renderer `api/*Client`、Vue 3 Composition API + i18n。
- 每个修复项独立可提交、可回滚；不在一个 commit 混多个不相关修复。
- 构建刷新的 `resources/model-db/providers.json` / `resources/acp-registry/registry.json` 属正常维护，按仓库约定保留。

## Non-Goals

- 不引入长期 profiling 基础设施（report.md 第 8 节的性能门禁是后续独立工作）。
- 不重构未列入修复项的代码。
- 不声称量化到 ms 的收益（无 profiler 采样，收益以「消除某类卡顿/包体下降」定性描述 + 构建体积对比）。

## Open Questions

- 无。所有修复点的代码位置与方案已在审计阶段确认到行号。
