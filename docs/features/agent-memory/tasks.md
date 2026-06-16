# Agent Memory & Persona — Task Breakdown

> SDD 阶段 3：Tasks。小步、有序、可独立评审，映射到 commit/PR。
> 原则：**先无害基建，后改 compaction 主路**，降低回归风险。每个任务标注依赖与测试。
> 关联：[spec.md](./spec.md)、[plan.md](./plan.md)。

提交规范：Conventional commits（`feat(memory): ...`），base 分支 `dev`，PR 含 spec 链接，过 lint/typecheck/test。

---

## 阶段 A：无害基建（不触碰 compaction 主路）

### T1 — 数据层：`agent_memory` 表 + 列迁移
- `tables/agentMemory.ts`（BaseTable，建表 SQL + CRUD）；`agent_memory_fts` 虚拟表。
- `schemaCatalog.ts` 注册（导入 + `CATALOG_DEFINITIONS` + repairable/typeChecked）。
- `deepchat_sessions` 加 `memory_cursor_order_seq`（repairableColumns）。
- `SQLitePresenter` index 初始化并暴露。
- **测试**：建表/CRUD/唯一索引去重（provenance）。
- **依赖**：无。**PR-1**。

### T2 — 共享类型 + Agent 配置扩展
- `shared/types/agent-interface.d.ts` 加 `memoryEnabled` / `memoryEmbedding` / `memoryRetrieval`。
- 确认 `getDeepChatAgentConfig`/`resolveDeepChatAgentConfig`/`updateDeepChatAgent` 浅合并兼容。
- **测试**：config 读写默认值；老配置无字段时安全。
- **依赖**：无。**PR-1**（可与 T1 同 PR）。

### T3 — DuckDB 记忆向量存储（独立库/表）
- 复用 `duckdbPresenter` 范式，建记忆向量库/表（HNSW cosine）。
- `insertVectors` / `similarityQuery` 记忆版封装。
- **测试**：插入 + 相似度查询 + 维度失配处理。
- **依赖**：无。**PR-2**。

### T4 — `MemoryPresenter` 骨架 + 写入/检索（不接 compaction）
- `src/main/presenter/memoryPresenter/`：`writeMemories()`（阶段1 SQLite 事务，status=pending_embedding）、异步 `embedWorker`（阶段2，回填 embedded/error/fts_only）、`recall()`（向量+FTS 混合，§7）、`buildInjection()`。
- embedding 取 `agent.memoryEmbedding`；无配置 → fts_only。
- **测试**：T2(C-1)两阶段、幂等、降级 FTS、打分排序（plan T2/T3/T7）。
- **依赖**：T1、T2、T3。**PR-2**。

---

## 阶段 B：接入主路与召回

### T5 — Layer 4 注入
- `appendMemorySection()`；`agentRuntimePresenter/index.ts:785` 后接入。
- 仅 `memoryEnabled` 非空，否则原串。
- **测试**：开启/关闭/降级（plan T3）；**回归：anchor 不干扰重建（plan T5）**。
- **依赖**：T4。**PR-3**。

### T6 — 会话结束兜底抽取（通路②）→ 移入 PR-4
- 监听会话结束；门控（cursor≥tail / 低增量跳过）；廉价模型抽取 → `writeMemories` → 推进 memory_cursor。
- tape 落 `memory/extract` anchor。
- **测试**：门控零调用（plan T6）；后台不阻塞。
- **依赖**：T4 + `memory_cursor` 列。**改 PR-4**（见下方实现说明）。

> **实现重排（2026-06-12）**：T6 原计划随 T5 进 PR-3，但核查发现：
> 1. `SESSION_EVENTS.DEACTIVATED` 的 payload 只有 `webContentsId`，**不含 sessionId**——它是 UI 窗口解绑事件，不是“某会话结束”的可靠信号，不适合直接作兜底触发器。
> 2. 兜底的成本门控依赖 `memory_cursor_order_seq` 列，而该列已（按 PR-1 决策）推迟到 PR-4。
>
> 因此 T6 并入 **PR-4**：与 compaction 搭车抽取共用 `memory_cursor` 与抽取管线，触发点改为“会话生成完成 / compaction 之后”这一在 `AgentRuntimePresenter` 内、能拿到 `sessionId` 的可靠位置（具体落点 PR-4 plan 细化）。PR-3 仅交付 T5。

### T7 — compaction 之后抽取（通路①）✅
> 实现现状（2026-06-15）：原「改 `generateRollingSummary → {summary, memories[]}` + 同事务双游标」方案**已否决**（见 spec AC-2.1 / plan §3）。当前实现：摘要契约零改动，抽取为 compaction 完成之后的**独立廉价调用**（`MemoryPresenter.extractAndStore()`），成功才推进 `memory_cursor` 并写 `memory/extract` anchor，失败不推进以便重试。
- **测试**：抽取成功才推进游标（失败可重试）、未开启时摘要路径与现状一致、解析失败容错。
- **依赖**：T4、T6。**PR-4**。

---

## 阶段 C：人格与工具

### T8 — 人格演化 + 回滚
- `evolvePersona()`（会话结束轻量反思）；supersede 链；`is_anchor` 保护；`persona/evolve` anchor。
- **测试**：不覆盖 systemPrompt、supersede、回滚、锚点保护（plan T4）。
- **依赖**：T4、T6。**PR-5**。

### T9 — 内置 MCP 工具
- `inMemoryServers/memoryServer.ts`：`memory_remember/recall/forget`；`builder.ts` + `mcpConfHelper.ts` 注册；仅 deepchat agent + memoryEnabled。
- **测试**：工具调用读写、权限门控。
- **依赖**：T4。**PR-5**。

---

## 阶段 D：UI 与事件

### T10 — 事件 + IPC 契约
- `MEMORY_EVENTS.UPDATED`；`shared/contracts/memory*` + `renderer/api/MemoryClient`（typed）。
- 方法：list/delete/clear/listPersonaVersions/rollbackPersona/getMemoryStatus。
- **依赖**：T4、T8。**PR-6**。

### T11 — Agent 设置：记忆开关 + 独立 embedding 配置
- Vue 3 组件；opt-in 开关 + 说明文案；embedding provider/model 选择；i18n。
- **测试**：renderer 关键交互。
- **依赖**：T2、T10。**PR-6**。

### T12 — 记忆管理 UI ✅
- 列表/删除/清空；人格演化时间线 + 回滚；空/加载/错误/降级态；i18n。
- 实现：`settings/components/MemoryManagerDialog.vue`（Dialog + Tabs[记忆/人格] + Table/ScrollArea/AlertDialog），由 `DeepChatAgentsSettings.vue` 记忆段「管理记忆」按钮触发（draft agent 隐藏）。
- 事件：新增 typed `memoryUpdatedEvent`（`memory.updated`），`MemoryClient.onUpdated()` 订阅自动刷新。i18n 全 20 语言。
- **依赖**：T10。**PR-7**。

---

## 收尾

### T13 — 文档归档与质量门
- 按 SDD 保留策略：MVP 落地后将本目录决策折入 `ARCHITECTURE.md`/`FLOWS.md`/`guides/*`，清理 active 目录。
- 全量 `pnpm run format && pnpm run i18n && pnpm run lint && pnpm run typecheck && pnpm test`。
- **依赖**：全部。

---

## PR 依赖图

```
PR-1 (T1,T2)✅ ─┬─▶ PR-2 (T3,T4)✅ ─┬─▶ PR-3 (T5)✅ ─▶ PR-4 (T7+T6)✅
                │                    ├─▶ PR-5 (T8,T9)✅
                │                    └─▶ PR-6 (T10,T11)✅ ─▶ PR-7 (T12)✅
                └──────────────────────────────────────────────────▶ PR-8 (T13)◑
```

进度（2026-06-15 更新，单次实现，未提交）：
- ✅ **PR-1** 表 `agent_memory` + 配置字段
- ✅ **PR-2** DuckDB 记忆向量库 + `MemoryPresenter`（两阶段写入/混合召回/注入）
- ✅ **PR-3** DI + Layer4 注入（`appendMemorySection`，禁用零变化）
- ✅ **PR-4** `memory_cursor` 列 + 解耦抽取（compaction 通路① + 会话兜底通路②，游标门控）
- ✅ **T8** 人格反思演化（节流 + supersede + 回滚 + 锚点保护）
- ✅ **T9** 内置 MCP 工具 `memory_remember/recall/forget`
- ✅ **T10** IPC 路由 6 条 + `MemoryClient`
- ✅ **T11** Agent 设置「长期记忆」开关（opt-in，i18n 全 20 语言）
- ✅ **T12** 记忆管理 UI（`MemoryManagerDialog.vue`：list/删除/清空 + 人格时间线/回滚 + 加载/空/错误/降级态），挂载于 Agent 设置记忆段「管理记忆」按钮；i18n 全 20 语言。
- ✅ **事件** typed `memoryUpdatedEvent`（`memory.updated`，reason ∈ extract/delete/clear/persona-evolve/persona-rollback）：`MemoryPresenter` 经可选 `onMemoryChanged` dep → `publishDeepchatEvent` 广播，`MemoryClient.onUpdated()` 订阅刷新。
- ◑ **T13** 质量门全绿（format/lint/i18n/typecheck node+web/单测，零净回归）；SDD 归档待功能整体合入后处理。

> FTS5 说明：MVP 采用 `AgentMemoryTable.search()` 的 SQL `LIKE` 关键词匹配实现 AC-4.2 的 FTS-only 降级语义；FTS5 虚拟表（`agent_memory_fts`）列为后续召回质量优化，不在本增量。

**验证基线**：主进程单测零净回归；记忆相关新增单测全绿；typecheck node+web exit 0。
> 2026-06-15 修复：`DEEPCHAT_ROUTE_CATALOG` 的 TS7056（推断类型超序列化上限）已通过把 catalog 拆为多个导出子块 + 交叉 `typeof` 合并类型 + 显式注解解决，stock `tsc --project tsconfig.node.json` 现亦 exit 0，逐路由精确输入/输出类型保持不变。同时修复 `deepchatSessionsTable.test.ts` 随 `memory_cursor` 迁移（schema v30→v31）的版本预期。

## 建议的最小可演示里程碑
**PR-1 → PR-2 → PR-3** 完成即可演示"跨会话记忆 + Layer4 注入"（显式工具/兜底抽取路径），不依赖最敏感的 T7 主路改造。T7 可在体验验证后再上，进一步降风险。
