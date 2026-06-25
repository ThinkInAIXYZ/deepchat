# Agent Memory & Persona — Specification

> SDD 阶段 1：Specification。保留已落地 Agent Memory 的维护契约。
> 日期：2026-06-12 ｜ 状态：已实现，保留为维护契约 ｜ 关联：[research.md](./research.md)、[tape-memory-integration.md](./tape-memory-integration.md)、[README.md](./README.md)

---

## 1. 业务价值（Why）

DeepChat 的 agent 当前**没有跨会话记忆**：每开一个新会话，agent 对用户一无所知；人格只能靠用户在 `systemPrompt` 里写死，会被对话冲淡。

本功能让 agent：
1. **跨会话记住用户**（偏好、事实、协作历史）——下次对话不必从零开始。
2. **衍生可演化的人格**——从积累的记忆中长出"自我模型"，在交互中持续微调，而非静态人设。

差异化：对标 Generative Agents 的反思 + Letta 的可演化 core memory，而非 ChatGPT 仅"记得你"的事实记忆。

---

## 2. 范围（首个增量 = 完整 MVP）

**In scope（本增量）**：
- 新增 `agent_memory` 跨会话记忆表（按 `agent_id` 维度）。
- 记忆抽取：compaction 之后的独立廉价 LLM 调用（不改摘要契约）+ 会话结束后台兜底。
- 记忆检索：向量（DuckDB）+ 关键词混合召回 top-K；未配置 embedding 时降级为纯关键词。
  > 实现现状（2026-06-15）：MVP 关键词召回用 SQL `LIKE`（满足 FTS-only 降级语义）；FTS5 虚拟表（`agent_memory_fts` + `MATCH`）列为后续召回质量优化，不在本增量。
- system prompt **Layer 4** 注入：自我模型 + 召回记忆。
- 可演化自我模型（`kind=persona`），supersede 链可回滚，**绝不覆盖**用户 `systemPrompt`。
- 内置 MCP 工具：`memory_remember` / `memory_recall` / `memory_forget`。
- tape 审计面包屑 anchor：`memory/extract`、`persona/evolve`（非重建，零干扰现有逻辑）。
- 逐 Agent **opt-in** 开关 + 记忆层**独立 embedding 配置**（Agent 设置内）。
- 记忆管理最小 UI：查看 / 删除 / 清空、人格演化时间线与回滚。

**Non-goals（本增量不做，留待 V2/V3）**：
- 多用户关系记忆隔离（`user_scope` 字段先建、暂不分流）。
- 复杂反思树 / 多级反思调度（先做"会话结束轻量反思"一种）。
- 记忆跨 agent 共享 / 导出导入。
- 记忆的自动冲突消解高级策略（先做基于内容+provenance 的幂等去重）。
- 隐式"每轮"抽取（仅 compaction 之后 + 会话结束，避免每轮烧钱）。

---

## 3. 用户故事与验收标准

### US-1：跨会话记忆
**作为**长期使用某 Agent 的用户，**我希望** agent 记住我在以往会话里透露的稳定偏好，**以便**不必每次重复。

验收（可测）：
- AC-1.1 在会话 A 告知偏好（如"回答尽量简洁、用中文"），结束会话；在**全新会话 B** 中，Layer 4 注入包含该偏好记忆。
- AC-1.2 记忆按 `agent_id` 隔离：Agent X 的记忆不出现在 Agent Y 的注入中。
- AC-1.3 关闭记忆开关的 Agent，**不抽取、不注入、不写库**。

### US-2：记忆抽取不显著影响性能
**作为**用户，**我希望**记忆功能不让对话变慢、不额外烧钱。

验收：
- AC-2.1 摘要逻辑零改动（零回归）：记忆抽取**不修改** `summarizeBlocks`/`generateSummaryText` 的 prompt 与输出契约。抽取作为 compaction 之后的**一次独立廉价模型调用**，且**仅在 compaction 触发时**进行（非每轮对话）。
  > 决策更新（2026-06-12）：原 AC-2.1 设想“搭同一次 LLM 调用”，但 `summarizeBlocks` 在大会话下会分块多次调用、且改摘要输出格式有回归风险，故改为**解耦的独立廉价调用**。compaction 本身不频繁（仅上下文压力时触发），额外成本可控。
- AC-2.2 兜底抽取：当 `memory_cursor >= 会话末尾 order_seq` 时**跳过、零调用**；增量低于阈值（N 条 / M token）时跳过。
- AC-2.3 抽取在后台异步执行，不阻塞用户当前交互（不卡 UI、不延迟下一条消息）。

### US-3：人格衍生且可控
**作为**用户，**我希望** agent 逐渐形成稳定风格，但我手写的设定永远说了算。

验收：
- AC-3.1 用户手写的 `DeepChatAgentConfig.systemPrompt` 在任何情况下**不被改写/覆盖**（Layer 1 不可变）。
- AC-3.2 自我模型每次更新生成新 `kind=persona` 记录，旧记录 `superseded_by` 指向新记录，UI 可查看历史并**回滚**到任一历史版本。
- AC-3.3 人格漂移护栏：核心锚点记录不可被 supersede；单次更新为"小步修正"（plan 定义具体约束）。

### US-4：召回相关、可解释
**作为**用户，**我希望**注入的是相关记忆而非全部，且可追溯来源。

验收：
- AC-4.1 注入走 `retrieval_score = α·相似度 + β·recency + γ·importance` 排序取 top-K（K 默认值见 plan）。
- AC-4.2 未配置 embedding 模型时自动降级 FTS-only 检索，功能仍可用。
- AC-4.3 每条记忆可溯源 `source_session`；UI 可查看。

### US-5：隐私与掌控
**作为**用户，**我希望**能看到、删除 agent 记了什么。

验收：
- AC-5.1 记忆默认**关闭**（opt-in），开启入口在 Agent 设置，含说明文案。
- AC-5.2 用户可在 UI 查看本 Agent 全部记忆、单条删除、一键清空。
- AC-5.3 `memory_forget` 工具 / UI 删除后，该记忆不再被召回注入。
- AC-5.4 记忆随 DeepChat 现有 SQLite 加密存储（`better-sqlite3-multiple-ciphers`），不新增明文落盘。

### US-6：tape 审计可见
**作为**关心可解释性的用户/维护者，**我希望**能看到"这次会话产生/演化了哪些记忆"。

验收：
- AC-6.1 抽取产生记忆后，当前 session tape 落 `memory/extract` anchor，含 `memoryIds`/`count`/`source`。
- AC-6.2 自我模型更新时落 `persona/evolve` anchor，含版本信息。
- AC-6.3 这些 anchor **不影响** compaction 与上下文重建（回归测试覆盖：开启记忆前后，重建出的上下文一致）。

---

## 4. 已锁定的关键决策（驱动 plan）

| # | 决策 | 取值 |
|---|---|---|
| D1 | 首增量范围 | **完整 MVP**（含 compaction 之后抽取 + 向量） |
| D2 | 存储所有权 | `agent_memory` 表为权威源；tape 仅落非重建审计 anchor |
| D3 | 抽取触发 | compaction 之后的**独立廉价调用**（不改摘要契约）+ 会话结束后台兜底 |
| D4 | 跨存储原子性 C-1 | 记忆行 `status=pending_embedding` 写 SQLite，向量异步入 DuckDB 回填 `embedded`，检索只认 `embedded`。**抽取已解耦**：不与摘要同事务，靠 provenance 幂等 + 失败不推进 cursor 保证不重不漏 |
| D5 | 人格落点 | Layer 4 叠加，**绝不覆盖** `systemPrompt`，supersede 可回滚 |
| D6 | 默认开关 | 逐 Agent **opt-in**（默认关闭） |
| D7 | embedding 配置 | 记忆层**独立** embedding 配置（与知识库分开） |
| D8 | 游标协调 | `memory_cursor_order_seq ≤ summary_cursor_order_seq`；抽取成功才推进 `memory_cursor`（解耦，非同一次 CAS） |

> 决策更新（2026-06-15）：D1/D3/D4/D8 原表述（compaction 搭车 / 结构化输出 / 同事务 / 同一次 CAS）已随 AC-2.1 的解耦决策修订为上表，与当前实现一致。

---

## 5. 约束（Constraints）

- **架构一致性**：Presenter 模式（新增 `MemoryPresenter`）；EventBus + 事件常量；typed route/client + `shared/contracts`；shared 类型入 `src/shared`。
- **最小复杂度**：复用 DuckDB（向量）、`embeddingManager`、知识库的 status 状态机、tape 的 anchor 机制，**不引入新依赖**。
- **兼容/迁移**：新表 + Agent config 加可选字段，向后兼容；老会话无记忆即空注入；记忆默认关闭，对现有用户零行为变化。
- **i18n**：所有用户可见字符串走 vue-i18n。
- **测试**：关键路径用 Vitest（抽取游标、CAS 双游标原子性、Layer 4 注入、降级 FTS、人格不覆盖、anchor 不干扰重建）。

---

## 6. 关键 UX 状态

- **空态**：新 Agent 无记忆 → 注入为空，行为同现状。
- **加载态**：记忆刚抽取、向量计算中（`pending_embedding`）→ 暂以 FTS 召回，不阻塞。
- **错误态**：embedding 失败 → 记忆保留、标 `error`、可重试；检索退化为 FTS。
- **降级态**：未配置 embedding → 全程 FTS-only，UI 提示"未启用语义检索"。

---

## 7. Open Questions

> 实现前需澄清的剩余项。无 `[NEEDS CLARIFICATION]` 阻塞项即可进入 plan。

- [已解决] C-1 原子性 → D4 方案 A。
- [已解决] 默认开关 → D6 opt-in。
- [已解决] embedding 配置 → D7 独立。
- [假设，plan 定默认值] 检索 top-K、α/β/γ 权重、recency 衰减半衰期、兜底增量阈值（N 条/M token）、importance 评分来源（LLM 输出 vs 启发式）。这些为可调参数，先给保守默认，不阻塞实现。
- [假设] 会话结束事件以 `SESSION_EVENTS.DEACTIVATED` 为准（备选 `STATUS_CHANGED`），plan 确认 emit 语义。
