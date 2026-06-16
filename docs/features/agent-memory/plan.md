# Agent Memory & Persona — Implementation Plan

> SDD 阶段 2：Plan。架构决策、数据模型、事件流、IPC 面、C-1 落地、测试策略、兼容/迁移。
> 行号基于 2026-06-12 核查（见 §10 集成点核查表，可能随代码漂移，实现前以实际为准）。
> 关联：[spec.md](./spec.md) 的 D1–D8。

---

## 1. 架构总览

新增一个 `MemoryPresenter`（`src/main/presenter/memoryPresenter/`），职责：写入 / 检索 / 衰减 / 反思 / 人格演化。
它**编排** SQLite（权威记忆行）+ DuckDB（向量，复用 `duckdbPresenter` 模式）+ `embeddingManager`（向量计算）。

```
                          ┌──────────────────────────────┐
   compactionService ────▶│        MemoryPresenter         │◀──── SESSION_EVENTS.DEACTIVATED
   (独立抽取,通路①)        │  write/recall/decay/reflect    │      (兜底抽取,通路②)
   agentRuntime.index ───▶│  evolvePersona                 │◀──── memory_* MCP 工具(通路工具)
   (Layer4注入,通路④)      └──┬───────────────┬─────────────┘
                              │ SQLite        │ DuckDB(异步向量)
                     agent_memory 表      vector 表(status机)
                              │
                     tape anchor(memory/* persona/*)  ← 审计(通路③,非重建)
```

数据流向严格单向：tape/会话事实 → 记忆层；记忆层 → tape 仅写惰性 anchor。

---

## 2. 数据模型

### 2.1 新表 `agent_memory`（SQLite）

```sql
CREATE TABLE IF NOT EXISTS agent_memory (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  user_scope      TEXT,                              -- V3 多用户;本期写固定值
  kind            TEXT NOT NULL,                     -- episodic|semantic|reflection|persona
  content         TEXT NOT NULL,
  importance      REAL NOT NULL DEFAULT 0.5,
  status          TEXT NOT NULL DEFAULT 'pending_embedding', -- pending_embedding|embedded|error|fts_only
  embedding_id    TEXT,                              -- 关联 DuckDB vector.id
  embedding_dim   INTEGER,                           -- 记录维度,换模型可识别失配
  source_session  TEXT,
  provenance_key  TEXT,                              -- 幂等去重:hash(agent_id+kind+normalized_content)
  is_anchor       INTEGER NOT NULL DEFAULT 0,        -- 1=核心锚点,不可被 supersede
  superseded_by   TEXT,                              -- persona/事实演化链
  created_at      INTEGER NOT NULL,
  last_accessed   INTEGER,
  access_count    INTEGER NOT NULL DEFAULT 0,
  decay_score     REAL
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_kind ON agent_memory(agent_id, kind, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_provenance
  ON agent_memory(agent_id, provenance_key) WHERE provenance_key IS NOT NULL;
```

注册（§10 第6项）：① `tables/agentMemory.ts`（继承 BaseTable）② `schemaCatalog.ts` 导入 + 加入 `CATALOG_DEFINITIONS`，登记 `repairableColumns`/`typeCheckedColumns` ③ `SQLitePresenter` index 初始化并暴露。全文检索（实现现状 2026-06-15）：MVP 采用 `AgentMemoryTable.search()` 的 SQL `LIKE` 关键词匹配（满足 AC-4.2 的 FTS-only 降级语义），**未引入** FTS5 虚拟表；FTS5（`agent_memory_fts`）作为召回质量/性能的后续优化项，不阻塞 MVP。

### 2.2 `deepchat_sessions` 加列

```sql
ALTER TABLE deepchat_sessions ADD COLUMN memory_cursor_order_seq INTEGER;
```
通过 `schemaCatalog` 的 `repairableColumns` 完成（与 `summary_cursor_order_seq` 同机制）。

### 2.3 DuckDB 记忆向量

复用 `duckdbPresenter` 的 vector 表范式。**决策**：记忆向量与知识库向量**库分离**（独立 `.duckdb` 或独立表），避免维度/语义混淆。表结构同现有 `vector(id, embedding FLOAT[dim], ...)`，HNSW(cosine)。

### 2.4 Agent 配置扩展（`DeepChatAgentConfig`，§10 第7项）

`src/shared/types/agent-interface.d.ts` 追加可选字段（向后兼容）：
```typescript
memoryEnabled?: boolean                  // D6, 默认 false
memoryEmbedding?: {                       // D7 独立配置
  providerId: string
  modelId: string
} | null
memoryRetrieval?: {                       // 可调参数, 见 §6
  topK?: number
  weights?: { similarity: number; recency: number; importance: number }
} | null
```
读写复用 `getDeepChatAgentConfig` / `resolveDeepChatAgentConfig` / `updateDeepChatAgent`（浅合并），持久化在 `agents.config_json`。**不动 `systemPrompt` 字段**（D5）。

---

## 3. 通路①：compaction 之后抽取（已解耦，见下方现状框）

> **实现现状（2026-06-15，以 spec AC-2.1 决策为准）**：本节原设计「改 `generateRollingSummary()` 为结构化输出、同一次 LLM 调用产出 summary+memories」**未采用**。最终实现遵循 spec 的解耦决策：
> - **不修改** `generateRollingSummary()` / `summarizeBlocks` 的 prompt 与输出契约（零摘要回归）。
> - 抽取是 **compaction 之后的一次独立廉价 LLM 调用**（`MemoryPresenter.extractAndStore()` 内 `generateText`），落点在 `agentRuntimePresenter` compaction 完成回调 + 会话生成完成兜底。
> - 抽取失败返回 `{ ok: false }` 且**不推进 `memory_cursor`**，下次重试；成功（含抽到 0 条）才推进。
>
> 下方 §3「改造点」「为何零额外调用」描述的是被否决的旧方案，保留以记录决策演进；当前代码请以本现状框 + spec §AC-2.1 为准。

**改造点**（§10 第1项，**已否决，见上方现状框**）`compactionService.ts` `generateRollingSummary()`：
- 当前 `Promise<string>`（summary）→ 改为返回 `{ summary: string; memories: MemoryCandidate[] }`。
- 仅当本 Agent `memoryEnabled` 时，在 `buildSummaryPrompt()` 追加"同时抽取值得长期记忆的稳定事实/事件"指令 + 输出格式（结构化 JSON 段）。未开启则**完全走旧路径**（输出纯 summary），零行为变化。
- 解析：summary 段照旧；memories 段解析为 `MemoryCandidate[] = { kind, content, importance }`。解析失败 → 容错为 `memories: []`（不破坏摘要主流程）。

```ts
type MemoryCandidate = { kind: 'episodic'|'semantic'; content: string; importance: number }
```

**为何零额外调用**：`generateRollingSummary` 内部唯一 LLM 调用 `llmProviderPresenter.generateText(...)`（§10 第1项 985 行）保持一次，只是 prompt 多要一段输出 → 满足 AC-2.1。

---

## 4. 通路②：会话结束兜底抽取

监听 `SESSION_EVENTS.DEACTIVATED`（§10 第8项），在 `MemoryPresenter` 内异步处理（不阻塞，满足 AC-2.3）：
```
门控:
  if !agent.memoryEnabled            -> return
  if memory_cursor >= tail order_seq -> return            // AC-2.2 零调用
  if (tail - memory_cursor) < 阈值(N条 或 M token) -> return
否则:
  取 [memory_cursor, tail] 增量消息(经 effective tape view)
  用廉价模型(memoryEmbedding 无关; 用小 summary 模型或 agent 助手模型的便宜档) 抽取 MemoryCandidate[]
  走 §5 写入流程, 推进 memory_cursor (仅推进 memory_cursor, 不动 summary_cursor)
```

---

## 5. 通路 C-1：两阶段解耦写入（D4 方案 A）

> **实现现状（2026-06-15）**：因抽取已解耦为 compaction 之后的独立调用（见 §3 现状框），阶段1**不再与 summary CAS 共用同一事务**。当前顺序为：① compaction 完成（summary CAS 照旧，独立完成）→ ② 独立抽取调用 → ③ 抽取成功后单独 `updateMemoryCursorOrderSeq()` 推进 `memory_cursor` 并写 `memory/extract` anchor。原「记忆行与摘要同事务原子」降级为「解耦后分步」：抽取失败不推进 cursor（可重试），记忆行靠 `provenance_key` 幂等去重，故无重复/丢失风险。下方代码块为旧的同事务设计，保留以记录演进。

```
阶段1 (旧设计, 已解耦 — 见上方现状框):
  - 搭车 compaction 时: 复用 compareAndSetSummaryState() 的同一事务(§10 第2项, sessionStore.ts:203-235)
      · summary CAS 照旧
      · INSERT agent_memory 行 (status='pending_embedding', provenance_key 去重)
      · 推进 memory_cursor (= summary 推进点, 满足 D8: memory_cursor ≤ summary_cursor)
      · 写 tape anchor 'memory/extract' (复用 tapeAnchor 入参, 非重建名)
  - 兜底抽取时: 独立 SQLite 事务做上述(无 summary CAS), 仅推进 memory_cursor
  → 原子: 记忆行与游标/摘要同生共死

阶段2 (异步, 队列):
  - 取 status='pending_embedding' 行 -> embeddingManager.getEmbeddings(providerId, modelId, [content])
      (providerId/modelId 来自 agent.memoryEmbedding; 无配置 -> 跳过, status='fts_only')
  - 写 DuckDB vector, 回填 agent_memory.status='embedded' + embedding_id/embedding_dim
  - 失败 -> status='error', 可重试 (复用知识库 status 状态机思路, §10 第4项)
检索 (§7): 向量召回仅认 status='embedded'; FTS 召回认 embedded|fts_only|error (只要有 content)
```

幂等：`provenance_key` 唯一索引保证同一事实重复抽取不产生重复行（满足"去重/冲突"最小要求）。

---

## 6. 通路④：Layer 4 注入

**改造点**（§10 第3项）`agentRuntimePresenter/index.ts:782-785` 注入链末尾追加：
```ts
const systemPrompt = appendMemorySection(
  appendReconstructionAnchorStateSection(
    appendSummarySection(baseSystemPrompt, summaryState.summaryText),
    this.sessionStore.getReconstructionAnchorPromptState(sessionId)
  ),
  await this.memoryPresenter.buildInjection(agentId, { query: latestUserText })
)
```
- `appendMemorySection(systemPrompt, payload)` 新增于 `memoryPresenter`（或 compactionService 同款工具文件），格式 `## Self-Model` + `## Relevant Memories`。
- 仅 `memoryEnabled` 时非空；否则返回原串（零变化）。
- `buildInjection`：常驻 self-model（最新未被 supersede 的 `kind=persona`）+ 召回 top-K。

**检索打分**（默认值，可被 `memoryRetrieval` 覆盖）：
```
score = 0.6·similarity + 0.25·recency + 0.15·importance
recency = exp(-Δt / 半衰期);  半衰期默认 14 天
topK 默认 6;  相似度阈值默认 0.2
兜底增量阈值: N=6 条 或 M=1500 token
importance: 优先用 LLM 抽取时给的值, 缺省 0.5
```

---

## 7. 检索（混合召回）

```
recall(agentId, query):
  vec  = duckdb.similarityQuery(embed(query), {agentId, topK*2})   // 仅 embedded
  fts  = agent_memory_fts.search(query, {agentId, topK*2})
  merge = 去重(vec ∪ fts) -> 按 §6 score 排序 -> top-K
  更新 last_accessed/access_count (异步, 不阻塞注入)
无 embedding 配置: 跳过 vec, 纯 fts (AC-4.2 降级)
```

---

## 8. 人格演化（D5）

- `evolvePersona(agentId)`：会话结束轻量反思——读最近 reflection/semantic 记忆，产出新 self-model 文本。
- 写新 `kind=persona` 行；旧行 `superseded_by = 新id`。`is_anchor=1` 的核心锚点跳过。
- tape 落 `persona/evolve` anchor（版本信息）。
- **永不触碰** `DeepChatAgentConfig.systemPrompt`（AC-3.1）。回滚 = 把目标历史行的 `superseded_by` 清空并使其后续失效（实现时定义为"指定某历史版本为 active"）。

---

## 9. 事件流 / IPC 面

- **事件（实现现状 2026-06-15）**：按当前 typed 事件契约体系实现，而非旧式 `src/main/events.ts` 常量。新增 `shared/contracts/events/memory.events.ts` 的 `memoryUpdatedEvent`（`name: 'memory.updated'`，payload `{ agentId, reason, version }`，reason ∈ extract/delete/clear/persona-evolve/persona-rollback），加入 `DEEPCHAT_EVENT_CATALOG`；主进程经 `publishDeepchatEvent('memory.updated', …)` 广播（`MemoryPresenter` 注入可选 `onMemoryChanged` 回调发射），renderer 经 `MemoryClient.onUpdated()` 订阅刷新。
- **IPC**：新增 `shared/contracts/memory*` + `renderer/api/MemoryClient`（typed，遵循新范式，不用 `useLegacyPresenter`）。方法：`listMemories(agentId)` / `deleteMemory(id)` / `clearMemories(agentId)` / `listPersonaVersions(agentId)` / `rollbackPersona(agentId, versionId)` / `getMemoryStatus(agentId)`。
- **内置 MCP 工具**（`inMemoryServers/memoryServer.ts` + `builder.ts` + `mcpConfHelper.ts`，仅 `agentType='deepchat'` 且 `memoryEnabled`）：`memory_remember` / `memory_recall` / `memory_forget`。

---

## 10. 集成点核查表（2026-06-12 实测）

| # | 文件 | 行 | 现状签名 | 改动 |
|---|---|---|---|---|
| 1 | `agentRuntimePresenter/compactionService.ts` | 751；LLM 调用 985；prompt 939 | `generateRollingSummary(): Promise<string>` | **已否决**（见 §3 现状框）：摘要契约保持不变，抽取改为独立调用 `MemoryPresenter.extractAndStore()` |
| 2 | `agentRuntimePresenter/sessionStore.ts` | 203–235 | `compareAndSetSummaryState(...)`，事务内 CAS | **已解耦**（见 §5 现状框）：summary CAS 独立完成；记忆写入与 `memory_cursor` 推进在 compaction 之后分步进行 |
| 3 | `agentRuntimePresenter/index.ts` | 782–785；base 699；import 92 | `appendReconstructionAnchorStateSection(appendSummarySection(base, sum), anchor)` | 外层包 `appendMemorySection(...)` |
| 4 | `knowledgePresenter/database/duckdbPresenter.ts` | `insertVectors` 381；`similarityQuery` 398；chunk.status 740 | 批量向量 INSERT（事务）；相似度查询；status 状态机 | 复用范式给记忆向量（独立库/表） |
| 5 | `llmProviderPresenter/managers/embeddingManager.ts` | `getEmbeddings` 11；`getDimensions` 29 | `getEmbeddings(providerId, modelId, texts): Promise<number[][]>` | 记忆层调用，配置取自 `agent.memoryEmbedding`（D7） |
| 6 | `sqlitePresenter/schemaCatalog.ts` | `CATALOG_DEFINITIONS` 43 | `{name, createTable, repairableColumns?, typeCheckedColumns?}` | 注册 `agent_memory`；`deepchat_sessions` 加 `memory_cursor_order_seq` |
| 7 | `shared/types/agent-interface.d.ts` 629；`agentRepository/index.ts` 读 207/216、写 163 | `DeepChatAgentConfig`；config_json 持久化（浅合并） | 加 `memoryEnabled` / `memoryEmbedding` / `memoryRetrieval` |
| 8 | `shared/contracts/events/memory.events.ts`（新增）；`events.ts` catalog | — | 新增 typed `memoryUpdatedEvent`（见上方事件现状）；兜底抽取触发点改为 `agentRuntimePresenter` 内会话生成完成/compaction 之后（能拿到 sessionId），非 `SESSION_EVENTS.DEACTIVATED` |

---

## 11. 兼容性 / 迁移

- **新增即兼容**：新表 + 可选 config 字段 + 加列（repairableColumns）。老用户 `memoryEnabled` 默认 false → **零行为变化**（AC-1.3）。
- **compaction 改造安全**：抽取已解耦（不改 `generateRollingSummary` 契约），未开启记忆时摘要路径与现状完全一致；开启时摘要逻辑亦零改动，抽取为之后的独立调用（回归测试保障）。
- **anchor 安全**：`memory/*`、`persona/*` 不在 `RECONSTRUCTION_ANCHOR_NAMES`，不参与重建（AC-6.3 回归测试）。
- **回滚**：功能关闭即停用；表与列可保留（无害）。删表/列需走 down 迁移（本期不强制）。

---

## 12. 测试策略（关键路径，Vitest）

> 实现现状（2026-06-15）：测试落在 `test/main/presenter/memory*.test.ts`（非 `test/main/memory/`）。下列 T1/T2 的「同一 CAS 原子」表述对应旧设计；当前为解耦实现，相应断言改为：抽取失败 `{ok:false}` 不推进 `memory_cursor`（可重试）、成功才推进、`provenance_key` 幂等去重。

`test/main/presenter/memory*.test.ts`：
- T1 抽取游标：抽取成功（含 0 条）才推进 `memory_cursor`；失败不推进以便重试。
- T2 两阶段：阶段1 写入幂等去重（provenance）；阶段2 失败 → status=error 不影响摘要；抽取与摘要解耦。
- T3 Layer4 注入：开启含 self-model+top-K；关闭为原串；降级 FTS-only。
- T4 人格不覆盖：演化不改 `systemPrompt`；supersede 链；回滚；锚点不可 supersede。
- T5 anchor 不干扰重建：开启记忆前后 `buildContext` 输出一致（回归）。
- T6 性能门控：兜底在 cursor≥tail / 低增量时零调用。
- T7 检索打分：score 排序、recency 衰减、阈值过滤。

---

## 13. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 改 compaction 主路引回归 | 未开启走旧分支；T5 回归；小步提交（tasks 分离"无害基建"与"主路改造"） |
| 跨存储不一致 | D4 方案 A：SQLite 事务保权威，向量异步可重试，检索只认 embedded |
| 人格漂移 | is_anchor 不可变 + 小步修正 + decay + 可回滚 |
| 注入污染 | top-K + 阈值 + self-model 常驻/episodic 按需 |
| 抽取成本 | compaction 后一次独立廉价调用 + 兜底游标门控 + 廉价模型 |
| 隐私 | opt-in + 加密存储 + forget/清空 + 溯源 |
