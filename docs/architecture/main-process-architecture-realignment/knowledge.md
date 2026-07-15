# Knowledge 模块边界

> 状态：设计通过，等待实施
> 规则：先删除旧路径和旧名字，再写唯一的新实现；不保留转发文件、类别名或双轨调用。

## 这个模块负责什么

Knowledge 负责内置知识库从文件进入索引，再被检索出来的完整过程：

- 按知识库配置创建、打开、更新、关闭和删除本地存储；
- 校验并读取用户选择的文件；
- 把文件切成片段，并为片段生成 embedding；
- 保存文件、片段、向量和处理状态；
- 控制片段任务的并发、取消、暂停和恢复；
- 按知识库配置执行相似度检索；
- 发布文件状态和处理进度通知；
- 在退出前提示仍有任务，并在退出时停止任务、关闭全部 DuckDB 连接。

Knowledge 不负责：

- 知识库配置的长期保存，配置仍由 Config 负责；
- 通用文件解析规则，文件读取和格式支持仍由 File 负责；
- Provider 实例和模型目录，只使用传入的 embedding 能力；
- MCP server 生命周期，MCP 只调用 Knowledge 的检索接口；
- Session、Agent、Memory、Workspace 或 Desktop 生命周期；
- renderer route 分发和窗口发送。

`NowledgeMem` 是会话导出和外部 HTTP 提交，不是内置知识库索引。它继续属于 Exporter 相关流程，
本批不把它并入 Knowledge。

## 当前问题

当前 `presenter/knowledgePresenter` 同时承担总入口、每个知识库实例、全局任务队列和 DuckDB，名字不能
说明各自的生命周期。`KnowledgeStorePresenter` 还直接导入 route publisher，导致能力模块反向依赖通信层。
共享类型里同时存在 `IKnowledgePresenter`、`IKnowledgeTaskPresenter` 和
`IVectorDatabasePresenter`，把内部实现细节暴露成了全局 Presenter 合同。

这次只整理所有权、名字、依赖方向和目录，不重写切片、embedding、向量距离、数据库表或用户操作含义。

## 最终结构

```text
src/main/knowledge/
  index.ts                    KnowledgeService，公开入口和知识库实例生命周期
  knowledgeBase.ts            单个知识库的文件、片段、检索和进度
  taskQueue.ts                全进程共享的片段任务队列
  ports.ts                    Config、File、embedding、Dialog、通知和存储窄接口
  support.ts                  平台支持判断
  database/
    knowledgeDatabase.ts      单个知识库的 DuckDB 存储
```

不新增 Knowledge manager、registry 或第二个 facade。`KnowledgeService` 是唯一公开入口；
`KnowledgeBase`、`KnowledgeTaskQueue` 和 `KnowledgeDatabase` 只在模块内部使用。

## 状态和资源由谁负责

| 状态或资源 | 唯一负责方 | 生命周期 |
| --- | --- | --- |
| 知识库配置 | Config | 长期保存 |
| 配置快照 | `KnowledgeService` | App 进程 |
| 已打开的知识库和初始化任务 | `KnowledgeService` | App 进程，按知识库延迟创建 |
| 文件和片段处理进度 | `KnowledgeBase` | 单个知识库打开期间 |
| 同一文件的写入队列 | `KnowledgeBase` | 单个知识库打开期间 |
| 全局片段任务队列和取消信号 | `KnowledgeTaskQueue` | App 进程 |
| 文件、片段、向量和索引 | `KnowledgeDatabase` | 每个知识库一个 DuckDB 文件 |
| 文件解析能力 | File | App 进程 |
| embedding 请求 | Provider | 单次请求 |
| renderer 通知发送 | App 注入的通知接口 | 单次通知 |

## 固定流程

### 启动和延迟打开

1. App 创建 `KnowledgeService`，传入 Config、File、embedding、Dialog 和通知接口；
2. Knowledge 创建存储目录和唯一的全局任务队列，但不提前打开全部知识库；
3. 第一次文件操作或检索时读取对应配置；
4. 同一个知识库同时只允许一个初始化任务；
5. 数据库文件存在就打开，不存在就按当前 dimensions 和 metric 创建；
6. 打开成功后缓存 `KnowledgeBase`，失败时关闭已经创建的数据库资源。

### 文件进入索引

1. route 调用 `KnowledgeService.addFile()`；
2. Knowledge 检查重复路径，先写入 `processing` 文件记录；
3. File 读取完整内容，Knowledge 按现有配置切片；
4. Knowledge 写入片段，并把每个片段交给唯一任务队列；
5. 任务通过 embedding 接口生成向量；
6. 同一文件的数据库写入继续串行，避免 DuckDB 并发写入冲突；
7. Knowledge 更新片段和文件状态，并通过注入的通知接口发送已经发生的进度和结果。

通知只报告状态，不用来发起切片、写入、取消或重建。

### 检索

1. Routes 或 MCP 通过窄接口调用 `similarityQuery()`；
2. Knowledge 读取该知识库当前配置并生成 query embedding；
3. `KnowledgeDatabase` 使用现有 topK 和 metric 查询；
4. Knowledge 按现有规则归一化 distance 并返回结果。

MCP 只获得 `similarityQuery()`，不能取得知识库实例、任务队列或数据库。

### 配置变化

Config 保存新配置后直接调用 `syncConfigChanges()`：

- 删除配置：取消该知识库任务、关闭并删除对应数据库文件；
- 禁用配置：关闭缓存实例，不删除数据；
- 更新配置：更新已打开实例使用的配置；
- 新增配置：只记录变化，第一次使用时再创建。

本批保持现有配置变化含义，不借目录迁移重建索引或改变 dimensions 处理规则。

### 暂停、恢复和删除

- 删除文件前先取消该文件的排队和运行任务，再删除片段、向量和文件记录；
- 重建文件复用同一个 file id，先删除旧片段和向量，再重新读取；
- 暂停知识库时取消其内存任务，并把数据库中的运行状态改为 paused；
- 恢复时从 paused 片段重新建立进度和任务；
- 所有操作只走 `KnowledgeService`，调用方不直接操作任务队列或 DuckDB。

### App 退出

1. App 在停止其他模块前调用 `confirmShutdown()`；
2. 没有任务时直接允许退出；有任务时由 Knowledge 使用 Dialog 显示现有确认框；
3. 用户取消时 App 不停止任何模块；
4. 确认退出后，App 在固定 shutdown 顺序中调用 `destroy()`；
5. Knowledge 停止接受新任务，取消现有任务，关闭所有已完成或正在初始化的知识库；
6. Knowledge 清空缓存，App 再继续关闭后续资源。

`destroy()` 必须可以重复调用，不能依赖 route、window 或全局 `Presenter`。

## 允许的依赖

```text
App ───────────────> Knowledge lifecycle
Routes ────────────> Knowledge file/query API
MCP ───────────────> Knowledge similarity query
Config ────────────> Knowledge config change
Knowledge ─────────> File / embedding / Dialog / notification ports
Knowledge ─────────> its own DuckDB storage
```

禁止的方向：

- Knowledge 不导入 App、Routes、MCP、Config 实现、Desktop 或 Agent；
- `KnowledgeBase` 不直接调用 `publishDeepchatEvent()`；
- Routes 和 MCP 不使用 `KnowledgeBase`、`KnowledgeTaskQueue` 或 `KnowledgeDatabase`；
- 内部任务和数据库接口不继续放在全局 Presenter 类型集合中；
- 不通过 EventBus 发起配置同步、文件处理、检索或取消。

## 实施批次

1. 删除 `src/main/presenter/knowledgePresenter` 和对应旧测试路径；
2. 在 `src/main/knowledge/` 写入唯一新实现，按上面的最终名字整理文件；
3. 删除 `KnowledgePresenter`、`KnowledgeStorePresenter`、`KnowledgeTaskPresenter`、
   `DuckDBPresenter`、`IKnowledgePresenter`、`IKnowledgeTaskPresenter` 和
   `IVectorDatabasePresenter` 旧名字；
4. App、Routes、MCP、Config support import 和测试改用 `KnowledgeService` 及窄接口；
5. 把 renderer 通知改成 App 注入的明确接口，删除 Knowledge 对 Routes 的反向依赖；
6. 更新当前架构文档和自动依赖检查；
7. 运行 Knowledge、MCP builtin knowledge、Routes、lint 和 typecheck 的相关验证。

每一步都先删旧文件或旧引用，再写新文件；不建立 re-export、旧类别名、可选方法检查或运行时 fallback。

## 完成条件

- 旧 Knowledge Presenter 目录、类型名、变量名和测试路径已删除；
- `KnowledgeService` 是唯一公开入口，内部三个实体不能被 Routes 或 MCP 直接使用；
- 每个知识库只打开一个实例，同一知识库只存在一个初始化任务；
- 文件处理、暂停恢复、搜索、配置变化和退出顺序没有新的业务含义；
- DuckDB 文件位置、表、索引、切片、embedding 和距离规则不变；
- Knowledge 不再反向导入 Routes 或全局 `Presenter`；
- 相关测试、架构检查、lint 和 typecheck 通过。
