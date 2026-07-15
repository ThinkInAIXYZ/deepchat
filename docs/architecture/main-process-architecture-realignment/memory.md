# Memory 模块边界

> 状态：已确认，可以实施
> 范围：长期记忆数据、检索、写入、向量索引、后台维护和 Session 写入触发

## 先说结论

Memory 是进程级能力模块。它负责长期记忆的完整生命周期：记录、检索、写入判断、向量索引、
persona、冲突、维护、健康状态和管理操作。

每个 Session 何时触发提取，以及同一 Session 的任务怎样排队和停止，属于 Agent 运行过程中的
Memory 接入点。这部分继续由 `MemoryRuntimeCoordinator` 负责。它只能通过明确接口调用 Memory，
不能拥有长期记忆数据、向量库或维护任务。

Memory 对外只有一个 `MemoryService` 实例，但内部的 domain、core、services 和 infra 继续保留。
这些是一个模块内的职责分工，不是新的公开架构层，也不能被 App 逐个组装。

## 负责的状态和资源

| 内容 | 类型 | 负责方 | 结束时间 |
| --- | --- | --- | --- |
| `agent_memory`、FTS 和 audit rows | 长期数据 | Memory | 用户删除、归档或清空 |
| 每个 Agent 的 DuckDB vector sidecar | 长期索引文件 | Memory | 重建、Agent 删除或清空 |
| working memory、persona、conflict 和 lifecycle | 长期 Memory 数据 | Memory | 对应 Memory 操作 |
| vector store 连接、lease、LRU 和 cooldown | 进程内状态/外部资源 | Memory | 过期、重建或 App 退出 |
| embedding、reindex 和 provider-bound work | 后台任务 | Memory | 完成、取消或 App 退出 |
| maintenance timer 和每个 Agent 的维护状态 | 后台资源 | Memory | 配置关闭、Agent 删除或 App 退出 |
| 每个 Session 的提取队列、epoch 和 ingestion admission | Agent 运行状态 | `MemoryRuntimeCoordinator` | Session 销毁或 App 退出 |
| Memory cursor 和 ingestion projection | Session 长期数据 | Session 数据模块 | Session 删除 |
| prompt injection manifest | 当前 Run 的结果 | Agent Run/Tape | 当前 Run 结束后保留为 Tape 事实 |

SQLite connection 仍由数据存储模块负责。Memory 接收只包含 Memory 表操作的 repository port，不直接
控制整个数据库，也不增加通用 repository 层。

## 生命周期

### 创建

App 创建一个 `MemoryService`，传入：

- Memory repository 和 audit repository；
- Agent Memory 配置与默认模型查询；
- provider text/embedding 调用；
- vector store 创建、重建和 quarantine 操作；
- Memory 已变化的通知函数；
- 性能记录接口。

`MemoryService` 在内部一次性创建 runtime context、services 和 infra。App、Routes 和 Agent 不得到
这些内部对象。

Agent 运行模块创建唯一的 `MemoryRuntimeCoordinator`，传入 Session cursor/projection/Tape 接口和
`MemoryService` 的窄接口。每个 `DeepChatAgentInstance` 只保存稳定的 Session handle。

### 启动

1. App 恢复被 quarantine 的 vector sidecar；
2. 创建 `MemoryService` 和 `MemoryRuntimeCoordinator`；
3. Memory 未启用时仍保留同一个必需接口，由 `isEnabled()` 返回 false，不移除依赖；
4. App 完成关键启动后调用 `startBackgroundMaintenance()`；
5. maintenance 根据每个 Agent 的最终有效配置决定是否调度，不在 App 复制判断。

### 读取和写入

- prompt 构建通过 `MemoryPromptContributor` 调用 recall 和 injection；
- Turn 或 compaction 正常结束后，`MemoryIngestionObserver` 按固定条件提交提取任务；
- `MemoryRuntimeCoordinator` 为同一 Session 串行任务，并用 epoch 阻止过期任务提交；
- `MemoryService` 完成提取、去重、决策、SQLite 写入、embedding 和 vector 更新；
- Tool 和 Routes 直接调用 Memory 的 remember、recall、forget 和管理操作；
- Memory 写入完成后发布已经发生的 `memory.updated` 通知，不用 event 发起写入。

现有的提取、打分、决策、预算、隐私清理、向量恢复和维护算法不在这次目录迁移中重写。

### 配置变化和 Agent 删除

- Config 直接调用 Memory 的配置变化操作；
- 最终有效 execution identity 变化时，只让受影响的 Agent 失效或重建；
- Agent 删除时，App 直接调用 `cleanupDeletedAgentResources()`，由 Memory 清理 rows、vector sidecar、
  timer、lease 和缓存；
- 调用方不分别删除 Memory 内部资源。

### App 退出和数据库维护

App 退出固定顺序：

1. 启动 `MemoryIngestionObserver.drainAndFence()`，先同步拒绝新提取，但暂不等待结果；
2. `MemoryService.dispose()` 标记 disposed、取消 provider work、停止 maintenance 并关闭 vector store；
3. 再等待 ingestion drain 结果，避免 provider work 阻塞退出；
4. 再停止 Provider 和关闭 SQLite。

database import/reset/sync 进入维护状态时使用同一套 fence、dispose 和 resume 顺序。恢复后由 App 明确
调用 `resumeIngestion()` 和 `startBackgroundMaintenance()`，不在 Memory 内增加自动重连 fallback。

## 允许的依赖

```text
App ─────────────────────> Memory lifecycle
Routes / Tool ───────────> Memory query and management
Agent Memory runtime ────> Memory recall and write
Config ──────────────────> Memory config change
Memory ──────────────────> Memory repository / provider / vector store
Memory runtime ──────────> Session cursor / projection / Tape
```

禁止的方向：

- Memory 不导入 App、Routes、Tool、Config 或 Agent manager；
- Memory 不拥有 Session ingestion queue、cursor 或 Tape；
- `MemoryRuntimeCoordinator` 不直接读写 Memory rows 或 vector store；
- services 和 infra 不互相导入具体实现，只使用已声明的窄接口；
- `context` 不提供 repository、provider 或 vector store 的通用查找入口；
- 不新增另一个 facade、manager 或兼容入口。

## 实施批次

1. 删除旧 Memory Presenter 目录和对应旧测试路径；
2. 把实现与测试移到 `src/main/memory/` 和 `test/main/memory/`，保留现有内部目录；
3. 把公开入口改为 `MemoryService`、`MemoryServicePort` 和 `MemoryServiceDeps`，删除旧名字和测试 adapter；
4. App、Routes、Tool、Agent runtime、测试、性能范围和架构检查全部改用新路径；
5. 保持 `MemoryRuntimeCoordinator` 在 Agent 运行目录，只把它依赖的接口改成 Memory 新入口；
6. 更新现有 Memory 架构文档中的真实路径，不改算法和数据格式；
7. 运行 Memory portable、Native、eval、性能边界、Routes、Tool 和 Agent runtime 的相关验证。

每批先删除旧路径和旧引用，再写新路径；不建立 re-export 转发、旧类别名、可选注入或双轨 adapter。

## 完成条件

- 旧 Memory Presenter 目录、类名、变量名和测试 adapter 已删除；
- Memory rows、FTS、audit、vector sidecar、cursor 和现有配置不迁移、不改含义；
- ingestion queue 仍只有 `MemoryRuntimeCoordinator` 一份，Memory 长期状态仍只有 `MemoryService` 一份；
- shutdown 和 database maintenance 的 fence、取消、等待和关闭顺序保持；
- services/infra/context 的架构检查继续通过，并增加旧路径检查；
- 现有 Memory contract、correctness、privacy、Native、eval 和性能边界验证通过。
