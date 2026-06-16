# DeepChat 记忆层 & 人格衍生 — 调研报告

> 目标：为 DeepChat 的 agent 设计一个**真正的记忆层**，使其能够跨会话记忆，并在此基础上**衍生出可演化的人格**。
>
> 调研日期：2026-06-12 ｜ 状态：调研（pre-spec）
>
> **相关文档**：tape（会话状态账本）与本记忆层的上下游对接设计见 [tape-memory-integration.md](./tape-memory-integration.md)。

> **已锁定的关键决策**（详见对接文档）：
> 1. **存储所有权**：`agent_memory` 表为权威源（跨会话、agent 维度）；tape 仅落非重建审计 anchor（`memory/*`、`persona/*`）。
> 2. **抽取触发**：compaction 之后的独立廉价 LLM 调用（不改摘要契约）+ 会话结束后台兜底（廉价模型、游标门控）。
>    > 注（2026-06-15）：本调研期曾设想「搭同一次 LLM 调用、结构化输出」，最终实现改为解耦的独立调用（见 spec AC-2.1）。
> 3. **人格落点**：演化自我模型作为 Layer 4 叠加注入，**绝不覆盖**用户手写的 `systemPrompt`，supersede 链可回滚。

---

## 一、核心判断（先说结论）

**"真的有记忆"和"真的衍生人格"是两件事，但共用一套底座。**

- **记忆 ≠ RAG**。把历史消息塞进向量库再检索，只是"可搜索的日志"。真正的记忆需要四个动作闭环：
  **写入决策（什么值得记）→ 巩固/遗忘（consolidation / decay）→ 检索（recall）→ 反思（reflection，从事实里长出洞察）**。
  DeepChat 目前只有第三步的雏形（知识库 RAG + 会话摘要）。
- **人格 ≠ system prompt 里写一段设定**。静态人设是"贴标签"，会被对话冲淡。真正能"衍生"的人格，是从记忆里**涌现**出来的：
  一个持续被反思更新的**自我模型（self-model）+ 价值偏好 + 对特定用户的关系记忆**。
  这正是斯坦福 Generative Agents（小镇 NPC）和 Letta / MemGPT 的关键差异点。

好消息：DeepChat 的地基出乎意料地好，**约 70% 的基础设施已经存在**，主要缺的是"记忆的认知层"和注入时机。

---

## 二、DeepChat 现状盘点（可复用的地基）

| 能力 | 现状 | 文件位置 | 对记忆层的价值 |
|---|---|---|---|
| 向量库 | ✅ DuckDB + VSS，HNSW 索引（cosine/l2/ip） | `knowledgePresenter/database/duckdbPresenter.ts` | 直接做语义记忆检索，**不用引第三方** |
| Embedding | ✅ 已接 AI SDK，支持 OpenAI / ollama embedding | `package.json` (`ai`, `@ai-sdk/*`) | 记忆向量化现成 |
| 会话摘要 | ✅ 已有 `summary_text` + 游标 + 锚点 | `deepchat_sessions` 表、`agentRuntimePresenter/compactionService.ts` | **情景记忆压缩**的原型 |
| System prompt 三层注入 | ✅ base + summary + 重建锚点 | `agentRuntimePresenter/index.ts:782` | 加"第四层 = 记忆层"的天然插槽 |
| 内置 MCP 工具 | ✅ in-memory server 机制 | `mcpPresenter/inMemoryServers/builder.ts` | 用工具暴露 `remember/recall/forget` |
| Persona / Agent | ✅ `agents` 表 + `DeepChatAgentConfig.systemPrompt` | `agentRepository/index.ts` | 人格落地的载体（但目前是静态的） |
| 全文检索 | ✅ SQLite FTS5 | `deepchat_search_documents` | 与向量检索做混合召回 |
| 加密��储 | ✅ `better-sqlite3-multiple-ciphers` | `sqlitePresenter/` | 长期记忆的隐私保护现成 |

**关键缺口**：
1. 没有"跨会话、属于这个 agent / 用户"的长期记忆表（现有 RAG 是按知识库 / 文件维度，不是按 agent 人格维度）；
2. 没有反思机制；
3. persona 是静态写死的，不会随交互演化。

---

## 三、记忆层架构设计（认知分层 → 落地）

借鉴认知科学的记忆分类，映射到 DeepChat：

```
┌─────────────────────────────────────────────────────────┐
│ 工作记忆 (Working)   = 当前上下文窗口                       │  ✅ 已有 (contextBuilder)
├─────────────────────────────────────────────────────────┤
│ 情景记忆 (Episodic)  = "什么时候发生了什么"的具体事件         │  ⚠️ 有摘要,缺跨会话提取
│   └─ 来源:每轮对话结束后异步抽取"值得记的事件"               │
├─────────────────────────────────────────────────────────┤
│ 语义记忆 (Semantic)  = 关于用户/世界的稳定事实               │  ❌ 需新建
│   └─ "用户是 Electron 开发者""偏好国内镜像""讨厌冗长回答"     │
├─────────────────────────────────────────────────────────┤
│ 反思记忆 (Reflective)= 从上面长出的高层洞察 / 自我认知        │  ❌ 需新建 ← 人格的核心
├─────────────────────────────────────────────────────────┤
│ 程序记忆 (Procedural)= 怎么做事的习惯/技能                  │  ~ 部分对应 skills
└─────────────────────────────────────────────────────────┘
```

### 新增一张核心表（建议放 SQLite，向量同步进 DuckDB）

```sql
CREATE TABLE agent_memory (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,        -- 绑定到人格/Agent，而非知识库
  user_scope    TEXT,                 -- 关系记忆:针对哪个用户
  kind          TEXT NOT NULL,        -- episodic|semantic|reflection|persona
  content       TEXT NOT NULL,        -- 记忆正文(自然语言)
  importance    REAL DEFAULT 0.5,     -- 重要性评分(0-1) ← 决定保留/注入优先级
  embedding_id  TEXT,                 -- 关联 DuckDB 向量
  source_session TEXT,                -- 溯源:从哪个会话提取
  created_at    INTEGER,
  last_accessed INTEGER,              -- 用于 recency 衰减
  access_count  INTEGER DEFAULT 0,
  decay_score   REAL,                 -- recency × importance × frequency
  superseded_by TEXT                  -- 被哪条新记忆覆盖(软删除,保留演化轨迹)
);
```

### 检索打分（Generative Agents 的经典公式）

```
retrieval_score = α·相似度(query) + β·recency(指数衰减) + γ·importance
```

注入前取 top-K，**不是塞全部**——这是记忆 vs 日志的本质区别。

---

## 四、人格如何"真的衍生"（问题的核心）

人格不能写死，要让它从记忆里长出来。三个机制：

### 1. 反思循环（Reflection）— 把事实蒸馏成认知
异步任务，触发条件：累计 importance 超阈值 / 每 N 轮 / 会话结束。
让一个 LLM 调用回答：**"基于最近这些记忆，关于用户和我自己，能得出哪 3 条更高层的判断？"**
产出写回 `kind=reflection`。这就是"小镇 NPC"看起来有性格的原因——它们会反思。

### 2. 自我模型（Self-Model / Persona 文档）— 可演化的"我是谁"
维护一份**会随时间被反思更新**的 persona 文本（存 `kind=persona`，单条、不断 supersede）。
它不同于 `DeepChatAgentConfig.systemPrompt` 的静态人设：

```
静态人设(现状):  "你是一个有帮助的助手"        ← 永远不变
自我模型(目标):  "我倾向于直接、技术化地回答。
                我和这位用户合作过 Electron 项目,
                他重视简洁,我学会了先给结论再展开。" ← 每天演化
```

### 3. 注入时机 — 加 system prompt "第四层"
在现有三层注入（`agentRuntimePresenter/index.ts:782`）后追加 `appendMemorySection()`：

```
Layer 1: base (用户prompt + skills)        [已有]
Layer 2: + 会话摘要                         [已有]
Layer 3: + 工具状态锚点                     [已有]
Layer 4: + 【自我模型】+【top-K 相关长期记忆】 [新增] ← 人格在这里"生效"
```

**护栏（防止人格漂移失控）**：自我模型更新要有"惯性"——新反思只能小幅修正，importance 低的记忆会衰减遗忘，关键人格锚点（核心价值观）设为不可被 supersede。否则 agent 会被几句话带跑、人格崩坏。

---

## 五、在 DeepChat 的具体落地点（文件级改动）

| 步骤 | 改动 | 文件 |
|---|---|---|
| 1. 建表 | 新增 `agent_memory` 表定义 | `sqlitePresenter/tables/agentMemory.ts` + `schemaCatalog.ts` 注册 |
| 2. 记忆服务 | 新建 `MemoryPresenter`：写入/检索/衰减/反思 | `src/main/presenter/memoryPresenter/`（参考 `knowledgePresenter` 结构） |
| 3. 向量复用 | 复用 DuckDB 做记忆向量检索 | 复用 `duckdbPresenter.similarityQuery()` |
| 4. 注入 | 加第四层 `appendMemorySection()` | `agentRuntimePresenter/index.ts` 注入链 + `compactionService.ts` |
| 5. 工具 | 内置 MCP server 暴露 `remember/recall/forget/reflect` | `inMemoryServers/memoryServer.ts` + `builder.ts` + `mcpConfHelper.ts` |
| 6. 反思 | 会话结束/定时触发异步反思 | 监听 `CONVERSATION_EVENTS` / `SESSION_EVENTS`（`events.ts`） |
| 7. 绑定人格 | 记忆按 `agent_id` 隔离，self-model 写回 persona | `agentRepository` |

**写入决策放哪**：两种流派可二选一或组合——
- **隐式**：每轮对话后由后台 LLM 自动抽取（像 Mem0 / ChatGPT memory，用户无感）。
- **显式**：给 LLM `remember` 工具，让它主动决定"这条要记"（像 Letta，可解释性强）。

建议 **MVP 用显式工具**（改动小、可控、可观测），成熟后加隐式抽取。

---

## 六、业界对照（验证方案方向）

| 方案 | 记忆机制 | 人格机制 | 对 DeepChat 的借鉴 |
|---|---|---|---|
| **Generative Agents**（斯坦福小镇） | 情景流 + recency/importance/相似度打分 | **反思树**（核心！） | 检索打分公式、反思循环直接借鉴 |
| **MemGPT / Letta** | 分层：core memory(常驻) + archival(向量) + 自管理工具 | core memory 里的 persona block 可被 agent 自己改写 | 分层 + 工具自管理 + 可演化 persona |
| **Mem0** | 自动抽取事实 + 去重/更新/冲突消解 | 弱 | 隐式写入、冲突消解（supersede）逻辑 |
| **ChatGPT Memory** | 隐式抽取用户事实 | 弱（仅个性化） | 用户无感的体验基线 |
| **Claude Projects / CLAUDE.md** | 静态文档 | 静态 | 现在的 `systemPrompt` 就是这一档，要超越它 |

**结论**：要"真人格"，对标的是 **Generative Agents 的反思 + Letta 的可演化 core memory**，而不是 ChatGPT 的事实记忆。
后者只让 agent "记得你"，前者才让 agent "成为它自己"。

---

## 七、风险与取舍

1. **成本**：每轮抽取 + 反思 = 额外 LLM 调用。→ 用便宜模型（haiku / 小模型）做记忆抽取，按 importance / token 阈值触发，别每轮都跑。
2. **人格漂移**：无约束的自我更新会崩坏。→ 核心锚点不可变 + 新反思小步修正 + 衰减遗忘。
3. **隐私**：长期记忆是敏感数据。→ 复用 DeepChat 已有的 `better-sqlite3-multiple-ciphers`（加密）；提供 `forget` 与记忆可视化/删除入口。
4. **召回噪声**：注入无关记忆会污染回答。→ top-K + 相似度阈值 + 让 self-model 常驻、episodic 按需召回。
5. **评测难**：怎么证明"它真有记忆/人格"？→ 设计探针测试：隔多轮后问偏好、跨会话指代、人格一致性问卷。

---

## 八、建议路径（分阶段）

- **MVP（1-2 周可验证人格雏形）**：`agent_memory` 表 + `remember/recall` 内置工具 + system prompt 第四层注入 + 一份可演化 self-model。复用 DuckDB，零新依赖。
- **V2**：加反思循环 + recency/importance 衰减 + 隐式抽取。
- **V3**：关系记忆（多用户隔离）、记忆可视化 UI、人格一致性评测。

---

## 附录：关键文件速查

| 功能 | 文件路径 |
|---|---|
| Agent loop 主流程 | `src/main/presenter/agentRuntimePresenter/index.ts` (`processMessage` :639) |
| System prompt 三层注入 | `src/main/presenter/agentRuntimePresenter/index.ts:782` |
| 上下文/历史组装 | `src/main/presenter/agentRuntimePresenter/contextBuilder.ts` (`buildContext`) |
| 会话压缩/摘要 | `src/main/presenter/agentRuntimePresenter/compactionService.ts` |
| 向量库 | `src/main/presenter/knowledgePresenter/database/duckdbPresenter.ts` (`similarityQuery`) |
| 会话/消息 schema | `src/main/presenter/sqlitePresenter/schemaCatalog.ts`、`tables/deepchatSessions.ts` |
| 内置 MCP 工厂 | `src/main/presenter/mcpPresenter/inMemoryServers/builder.ts` |
| Agent / persona 仓库 | `src/main/presenter/agentRepository/index.ts` |
| 默认系统提示词 | `src/main/presenter/configPresenter/systemPromptHelper.ts` |
| 事件定义 | `src/main/events.ts` |
