# Tape ↔ 记忆层 对接设计

> 目标：定义 DeepChat 内部 **tape**（会话状态账本）与新增**记忆层**（agent_memory）之间的上下游关系，
> 做到职责清晰、不与现有 compaction/上下文重建架构冲突。
>
> 日期：2026-06-12 ｜ 状态：设计（pre-spec）｜ 上游文档：[research.md](./research.md)

---

## 〇、一句话定位

> **tape 当账本，记忆层当大脑。**
> tape 是 append-only 的会话事实流（session 维度）；记忆层是从事实里蒸馏出的跨会话认知（agent 维度）。
> 数据**单向上行**：tape → 抽取 → 记忆层。记忆层只往 tape 回写**审计面包屑**（非重建 anchor），不参与上下文重建。

```
                       ┌──────────────────────────────────────────┐
   权威源(authoritative)│  agent_memory 表 (SQLite, agent 维度)      │
                       │   ├─ kind: episodic|semantic|reflection|persona │
                       │   ├─ 跨会话、可向量检索 (DuckDB)            │
                       │   └─ superseded_by 演化链 (可回滚)          │
                       └────────────▲──────────────┬───────────────┘
                          ① 抽取/反思 │              │ ④ Layer4 注入
                          (上行,单向)  │              ▼  (recall → system prompt)
                       ┌────────────┴──────────────────────────────┐
   事实账本(source)     │  deepchat_tape_entries (SQLite, session 维度) │
                       │   ├─ message/tool_call/tool_result (事实)   │
                       │   ├─ anchor: compaction/* summary/* (重建)  │ ← 现有,不动
                       │   └─ anchor: memory/* persona/* (审计面包屑)│ ← 新增,非重建
                       └────────────────────────────────────────────┘
                          ② compaction 后抽取     ③ 审计回写
```

---

## 一、为什么是"上下游"而不是"二选一"

tape 和记忆层**理念同源**（都把会话变成结构化、可恢复的日志），上次对话已确认两者是**互补**关系：

| 维度 | tape | 记忆层 |
|---|---|---|
| 分区 | **session_id**（每会话一条带子） | **agent_id**（跨会话） |
| 形态 | append-only 原始事实 | 蒸馏后的认知（事实/洞察/人格） |
| 生命周期 | 跟随会话 | 长期、可衰减遗忘 |
| 检索 | 按 session 顺序/anchor | 向量 + FTS 混合召回 top-K |
| 服务于 | compaction / 上下文重建 / 分支 / 交接 | 跨会话人格、关系记忆 |

→ tape 是记忆层**天然的、已去重的原料带**（`buildEffectiveTapeView()` 已处理撤回/替换/工具去重）；记忆层是 tape 的**反思蒸馏层**。两者不竞争。

---

## 二、四条数据通路（核心设计）

### ① 抽取（tape → 记忆层，上行）—— compaction 之后的独立廉价调用

> **实现现状（2026-06-15，以 spec AC-2.1 为准）**：下方「扩展 `generateRollingSummary()` 为结构化输出、同一次调用产出 summary+memories」的决策**已被推翻**。最终实现：摘要契约保持不变，抽取是 compaction 完成之后的**一次独立廉价 LLM 调用**（`MemoryPresenter.extractAndStore()`），失败不推进 `memory_cursor`、可重试。保留下文以记录决策演进。

**原决策（已否决）**：不新增独立 LLM 调用，**扩展 compaction 已有的那一次** `generateRollingSummary()` 调用为结构化输出，一次产出两样东西：

```
compactionService.applyCompaction()
  └─ generateRollingSummary()  [现有的唯一一次 LLM 调用]
        输入: previousSummary + summaryBlocks(即将被摘要/丢弃的消息)
        输出(结构化): {
          summary:  string,           // ← 现有:滚动摘要,照常写 tape anchor + sessions 表
          memories: MemoryCandidate[] // ← 新增:从这批消息抽取的"值得记的事件/事实"
        }
```

`MemoryCandidate` 形如：
```ts
{ kind: 'episodic'|'semantic', content: string, importance: number /*0-1*/ }
```

> **为什么放这里**：compaction 即将摘要/丢弃的那批消息，正是"短期 → 长期"巩固的最佳时机（认知科学上的 consolidation）。消息已经在 prompt 里了，只多输出几十个 token，**不额外加一次调用**。

### ② 会话结束兜底（覆盖从不触发 compaction 的短会话）

**决策（已确认）**：后台、廉价模型、游标门控、增量阈值。**不阻塞交互**（用户已离开会话）。

触发：监听 `CONVERSATION_EVENTS` / `SESSION_EVENTS`（会话失活/关闭）。
门控逻辑（关键，决定性能）：
```
若 memory_cursor_order_seq >= 会话末尾 order_seq → 跳过(0 调用)   # compaction 已覆盖到底
若 (末尾 - memory_cursor) 增量 < N 条 / < M token → 跳过           # 不值得
否则 → 用 haiku/小模型 对 [memory_cursor, 末尾] 这段增量抽取一次
```

净效果：**长会话靠①（0 额外调用）；短会话仅结束时一次廉价小调用，且常被游标判为"无新内容"而跳过。**

### ③ 审计回写（记忆层 → tape，下行，仅面包屑）

**决策（已确认）**：记忆写入 / 人格更新时，在**当前 session 的 tape** 上落一个 **非重建 anchor**：

| anchor name | 何时落 | payload |
|---|---|---|
| `memory/extract` | ①②抽取出新记忆后 | `{ memoryIds: [...], count, source: 'compaction'|'session_end' }` |
| `persona/evolve` | 自我模型被反思更新后 | `{ memoryId, fromVersion, toVersion, diffSummary }` |

> **关键安全性（已验证）**：这些名字**不在** `RECONSTRUCTION_ANCHOR_NAMES`（= `SUMMARY_ANCHOR_NAMES` + `handoff/*` + `auto_handoff/*`）里，所以 `contextBuilder` / `compactionService` 的重建逻辑**完全无视它们**。它们是惰性面包屑，不会劫持上下文重建或摘要游标。**零冲突。**

回写用途：可视化"这次会话产生/演化了哪些记忆"、人格演化时间线、回滚定位。

### ④ 注入（记忆层 → system prompt Layer 4，recall）

在现有三层注入后追加 `appendMemorySection()`（详见 research.md 第四节）：
```
Layer 1: base(用户 systemPrompt + skills)   [已有, 不可变锚点]
Layer 2: + 会话摘要                          [已有]
Layer 3: + 工具状态锚点                      [已有]
Layer 4: + 自我模型(persona) + top-K 相关记忆 [新增] ← recall 在这里生效
```
检索：`retrieval_score = α·相似度 + β·recency + γ·importance`，取 top-K。

---

## 三、人格落点（已确认：绝不覆盖）

**决策（已确认）**：演化出的自我模型**只作为 Layer 4 叠加注入，绝不回写/覆盖用户手写的 `DeepChatAgentConfig.systemPrompt`。**

```
用户手写 systemPrompt  →  不可变锚点, AI 永不改写       (Layer 1)
演化自我模型(kind=persona) →  独立记录, supersede 链可回滚  (Layer 4)
```

- 自我模型是 `agent_memory` 里 `kind='persona'` 的单条记录，每次反思更新 = 新增一条并 `superseded_by` 指向旧条（保留完整演化轨迹，可一键回滚到任意历史版本）。
- 用户随时能在 UI 看到/编辑/清空演化人格，但**他手写的 prompt 永远原样保留**。
- 护栏：核心锚点不可被 supersede；新反思只能小步修正；低 importance 记忆衰减遗忘。

---

## 四、游标协调（设计决策，需你知晓）

记忆层引入 `memory_cursor_order_seq`（仿现有 `summary_cursor_order_seq`），与 compaction 游标存在耦合。

**采用的默认规则**：
1. `memory_cursor_order_seq` **始终 ≤** `summary_cursor_order_seq`。
2. **compaction 之后（通路①，实现现状 2026-06-15）**：抽取已与 summary CAS **解耦**——summary CAS 独立完成后，抽取作为独立调用进行，**成功**（含抽到 0 条）才单独推进 `memory_cursor`，**失败不推进**以便重试。原「同一次 CAS 原子推进」方案已否决（见 §① 现状框）。
3. **会话结束兜底时（通路②）**：只推进 `memory_cursor`，不碰 `summary_cursor`。

→ 解耦后仍不重复消费：抽取靠 `provenance_key` 幂等去重，cursor 仅在抽取成功时推进。

---

## 五、⚠️ 需要你确认的冲突点

### 冲突 C-1：跨存储原子性（SQLite 事务管不到 DuckDB）

**问题**：通路①里，compaction 的摘要更新是 **SQLite 上的事务 + CAS**。但记忆抽取的产物要落两个存储：
- (a) `agent_memory` 行 → **SQLite**
- (b) 记忆向量 → **DuckDB**（独立数据库，无法纳入同一个 SQLite 事务）

如果要求"摘要和记忆同生共死"，做不到——**SQLite 事务无法跨到 DuckDB**。

**我推荐的解法（与现有知识库模式一致，建议采纳）**：
**两阶段、解耦提交**，照搬 `knowledgePresenter` 现成的"异步 embedding + status 字段"模式：
> 实现现状（2026-06-15）：下方第 1、2 步的「同一次 LLM 输出 {summary, memories}、与 summary CAS 同事务」已否决（见 §① 现状框）。当前为：摘要独立完成后，抽取作为独立调用写 `agent_memory`（status='pending_embedding'），成功才推进 cursor；第 3 步异步向量化照旧。
```
1. (旧设计) LLM 一次输出 {summary, memories}
2. (旧设计) SQLite 事务: 写 summary CAS + 写 agent_memory 行(status='pending_embedding')  ← 同事务,原子
3. (CAS 成功后) 异步: 算 embedding → 写 DuckDB 向量 → 回填 status='embedded'
   - 失败可重试; 检索时只认 status='embedded' 的记忆
   - memories 抽取与 summary 解耦: 即便 CAS 因并发失败重跑, LLM 输出仍有效, 记忆按 provenance/内容去重幂等
```
理由：DuckDB 本来就是异步写向量（chunk 有 pending→embedded 状态机），记忆层复用同一套，**不引入新范式、与现有架构零冲突**。

**→ 需要你拍板**：
- **(A) 采纳推荐**：两阶段解耦，记忆行同事务落 SQLite、向量异步入 DuckDB（与知识库一致）。
- **(B) 最简**：记忆完全 best-effort，摘要提交后再尽力写记忆，失败就丢（更简单，但极端情况会漏记忆）。
- **(C) 其他**：你有别的偏好。

> 除此之外，第二节的 anchor 命名（C-1 之外）、第四节游标协调均已用与现有架构兼容的默认方案解决，**未引入新冲突**。如对游标默认规则有异议也请一并指出。

---

## 六、落地改动清单（在 research.md 第五节基础上的增量）

| # | 改动 | 文件 | 与 tape 的关系 |
|---|---|---|---|
| A | `agent_memory` 表 + `memory_cursor_order_seq` 字段 | `sqlitePresenter/tables/agentMemory.ts`、`deepchatSessions.ts`、`schemaCatalog.ts` | 新表;游标仿 summary |
| B | **独立抽取调用**（不改 `generateRollingSummary` 契约）`MemoryPresenter.extractAndStore()` | `memoryPresenter/`、`agentRuntimePresenter/index.ts` | **通路①** compaction 之后抽取（原「改结构化输出」已否决） |
| C | 抽取成功才推进 `memory_cursor`（解耦，非同 CAS） | `agentRuntimePresenter/index.ts` | **第四节** 游标协调 |
| D | 会话生成完成兜底抽取(后台/廉价/门控) | `agentRuntimePresenter` 内（拿得到 sessionId） | **通路②** |
| E | 审计 anchor `memory/*` `persona/*` | 复用 `tapeService` 写 anchor（新名,非重建） | **通路③** 面包屑 |
| F | `appendMemorySection()` Layer4 注入 | `agentRuntimePresenter/index.ts` 注入链 | **通路④** recall |
| G | `MemoryPresenter`(写/检索/衰减/反思) + DuckDB 异步向量 | `src/main/presenter/memoryPresenter/` | 复用 `duckdbPresenter` |
| H | persona supersede 链 + Layer4 叠加(不覆盖 systemPrompt) | `memoryPresenter`、`agentRepository` | **第三节** |

---

## 七、对接小结

1. **方向单向**：事实 tape → 蒸馏记忆层；记忆层只往 tape 回写惰性审计 anchor。
2. **零重建冲突**：审计 anchor 用新名字，不在重建白名单内，现有 compaction/上下文逻辑完全无视。
3. **零额外调用（长会话）**：抽取搭 compaction 的车；短会话靠廉价兜底 + 游标门控。
4. **人格安全**：Layer4 叠加，永不覆盖用户 systemPrompt，supersede 可回滚。
5. **唯一待确认**：跨存储原子性（第五节 C-1），推荐采纳与知识库一致的两阶段异步方案。
