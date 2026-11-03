# Main 迁移计划

[Main 职责与合同](./spec.md) · [Renderer 实施步骤](../renderer-window-isolation/plan.md)

## 接手入口

工作分支为 `dimagent/main-renderer-decoupling`，目标为 `dev`，源码分析基线为 `145e51763`。从干净 checkout 接手时，先拉取工作分支，再确认自己位于该分支。进入下一个步骤前查看上一位执行者在 PR 留下的提交及证据。

```bash
git fetch origin
git switch dimagent/main-renderer-decoupling
git pull --ff-only
git status --short --branch
git log --oneline origin/dev..HEAD
node --version
pnpm --version
```

使用根目录 `package.json` 声明的 Node 24.22.1 至 25 之前版本及项目指定的 pnpm 10.34.5。缺依赖时从仓库根目录运行 `pnpm install --frozen-lockfile`。先读两层 spec 的依赖图和行为合同，再读当前步骤。默认先做 M1，再做 R1；之后选前置项已验收的步骤。同一时段由一名执行者负责共享接线或导航入口，避免两个提交同时改变一个状态的所有权。

每一步完成后，用 Conventional Commit 提交代码、必要的回归保护和本步骤的勾选，推回同一工作分支。在 PR 留一条可核验的记录，填入以下字段：步骤编号、提交 SHA、已消除的依赖/旧调用、实际命令及结果、额外场景与观察值、跳过项及原因、下一项。原有套件通过只能覆盖其实际断言；每节“验收标准”的额外场景也要取得证据。遇到无法复现的关键门槛，保留未勾选状态，写明可重现场景和阻塞原因。

## 单一 PR 的实施与发布

本次重构从最新 `dev` 切一条工作分支，开一个面向 `dev` 的 draft PR。SDD、Main 的 M1–M10、Renderer 的 R1–R8 和对应验证记录都归入这个 PR。步骤编号用于解释依赖和定位变更；在同一分支上按职责提交，每个提交迁完实际调用者、删除对应旧路径，并能独立检查。中间提交只推工作分支。M10、R8 的删除候选若仍有调用者，保留文件并在 PR 写明证据。

1. 从 M1 和 R1 开始。随后按各步标明的依赖推进；Main 的双宿主验收在 M9，Renderer 的窗口与聊天验收见其计划。完成一个步骤，在同一 PR 描述中关联编号、提交和验证结果，方便分段审查与 `git bisect`。
2. 开发期间，日常修复和 beta 仍走 `dev`。从已验证的 `dev` 提交准备版本、切 `release/<version>`，按仓库流程审查、快进 `main`、打 tag 并发布。发布修复先落 `dev`，再把更新带回工作分支。若下一版 beta 要保持重构前的行为，先完成该版发布，再合重构。[Beta 发布流程](../../release-flow.md)
3. 合并前同步最新 `dev`，在同一候选提交上完成两层验收。PR 描述汇总两份合同、步骤与提交对应关系、已删/保留的旧路径和验证证据。全部门槛通过后，建议用一个 merge commit 合入 `dev`：分步提交继续可查，merge SHA 标识整次重构。此选择仅适用于目标为 `dev` 的重构 PR；发布到 `main` 仍按 fast-forward 流程。
4. 后续从包含合入 SHA 的提交切出的 beta 将包含整次重构。若有阻断回归，在 `dev` 整体 revert 这次 PR，验证旧会话仍可打开、发送和恢复，再从修复后的提交发新版本。已发布的 tag 保留原指向。

### M1 · 把模型目录来源交还 Provider

**目标**：让参数解析只读取本次模型请求的事实，普通 Node 无需桌面 profile 就能加载该模块。

- [x] **依赖**：无。**删除**：`generationSettings.ts → providerDbLoader` 的值导入。沿现有 Provider 配置调用传入本次解析使用的来源 URL；保留已下载目录的 meta URL 及默认地址回退语义，配置变化后可取得新值。

**实施顺序**

1. 从 `resolveInterleavedReasoningConfig` 反查所有调用。至少覆盖 `turnCoordinator.ts` 的普通 Turn、`compactionRuntimeCoordinator.ts` 的压缩路径和 Harness 测试夹具。
2. 在宿主的 Provider 配置实现读取 `providerDbLoader.getSourceUrl()`；经现有模型解析依赖交付给调用方。保留 meta URL 优先、缺失时回退以及目录更新后重新读取的语义。参数函数移除单例 import。
3. 对同一模型输入比较结果，重点检查 `providerDbSourceUrl` 和原有推理开关；核对失败告警仍使用同一 URL。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.ts test/main/agent/deepchat/runtime/generationSettings.test.ts test/main/provider/providerDbLoader.test.ts
```

另取临时目录构建该模块的 Node 入口（使用仓库已有 Vite 的构建 API 和 main 别名），用独立 `node` 子进程导入。拒绝解析 Electron，不设置 `DEEPCHAT_E2E_USER_DATA_DIR` 绕开路径访问。需同时证明导入成功且临时 profile 未生成 provider 缓存。

**验收标准**：推理配置和 gap 诊断保留同一 URL；普通 Node 导入该参数解析模块时不访问 Electron、不创建用户目录。此片只验证该模块。参考 [generation settings](../../../test/main/agent/deepchat/runtime/generationSettings.test.ts) 与 [Provider loader](../../../src/main/provider/providerDbLoader.ts)。

### M2 · 把 Sync 所需的未消费输入查询放回 Session 数据层

**目标**：让 Sync 只问“这个会话是否还有未消费输入”，完整保留同步应用门禁。

- [x] **依赖**：无。**删除**：`app/composition.ts#hasPendingSyncSession` 中的手写 SQL。由 pending-input 存储提供按 session 判断存在性的只读操作，沿现有 Sync guard 注入。保持索引友好的存在性查询。`hasPendingTurnInput` 查的是下一条可执行输入，不能代替 `state != 'consumed'`。

**实施顺序**

1. 对照 `composition.ts` 中 `hasPendingSyncSession` 的两个调用位置（`canApply` 与 `guard`）。在 `deepchatPendingInputs.ts` 的 table 上保留等价的 `SELECT 1 … LIMIT 1` 条件，经 `SessionPendingInputStore → SessionPendingInputs` 暴露只读布尔操作。
2. 勿复用 `hasActiveInputs`：它最终调用 `countActiveBySession`，明确排除了已认领的 queue。也勿用只返回下一项的 `hasPendingTurnInput`。新的查询沿用当前连接，且不唤醒 pump。
3. 替换两个调用点，删除组合入口的 SQL；在同一会话分别仅留一条 claimed queue、一条 blocked 输入和一条 consumed 输入，观察 Sync 的准入结果。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.ts test/main/session/data/pendingInputs.test.ts test/main/sync/replicaNative.test.ts
```

记录 native SQLite 套件是否实际执行；若被 ABI 条件跳过，须在匹配环境补证。

**验收标准**：pending、claimed、blocked、retry_required 均阻止该会话的同步应用，只剩 consumed 时允许其通过此项检查；维护、活跃会话、删除 gate 和多会话加锁继续生效。重开后查询使用当前连接。[PendingInputs](../../../src/main/session/data/pendingInputs.ts) · [Sync 副本用例](../../../test/main/sync/replicaNative.test.ts)

### M3 · 一次状态转换交给一个宿主分发点

**目标**：让 Sync 活跃状态只有一个写入所有者，保持桌面和后台观察者看到的原有顺序。

- [x] **依赖**：无。**删除**：`SessionStatusPublisher` 对 renderer 事件名、`SessionUiPort` 的依赖，以及两个发布回调对 `syncActiveSessions` 的重复写入。运行时传出已校验的状态变化或 usage 更新；宿主保留现有输出顺序。Sync 统一消费 DeepChat 与其他状态生产者，包含既有 `running` 与 `generating` 来源。逐一迁入 Direct ACP、Remote、CLI、浏览器预览回收与悬浮窗观察点。

**实施顺序**

1. 从 `SessionStatusPublisher.transition` 列出四条分支：实例过期、状态相同无 usage、状态相同有 usage、状态改变。保留 runtime 对状态和实例归属的判断。
2. 在现有宿主接线处将变化适配为 renderer 两个事件、内部更新、UI 刷新；usage-only 只进入对应的内部更新路径。核对 `sessionRuntimeEvents`、`syncReplica.wake` 和浏览器释放各在什么时候触发。
3. 将 `composition.ts` 中两处 `syncActiveSessions` 写入统一到 Sync 所有者，覆盖 ACP 等其他生产者的状态；移除 runtime 的 widget 回调。用关闭窗口仍运行的会话验证终态可到达后台入口。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.ts test/main/agent/deepchat/runtime/sessionStatusPublisher.test.ts test/main/events/sessionEventRouter.test.ts
```

留下四条分支的事件序列和一次实际终态对应的 Sync 唤醒次数；旧请求到达时不应改变集合。

**验收标准**：四个可观察输出的顺序、同状态 usage 分支和 stale-scope 拒绝均与 [状态合同用例](../../../test/main/agent/deepchat/runtime/sessionStatusPublisher.test.ts) 一致。一次终态变化只触发一次对应的 Sync 释放/唤醒；关闭窗口时后台 Run 仍可结算并通知非桌面入口。

### M4 · 将流和交互输出适配到现有客户端合同

**目标**：让内建 Agent 输出运行事实，宿主负责构造安全的客户端消息。

- [x] **依赖**：M3。**删除**：内建 runtime 中 `dispatch`、`echo`、`deepChatLoopRunner` 到 `cloneBlocksForRenderer` 的调用，以及 turn、compaction、permission、interaction 和 message projection 对 wire event 名的调用。每类事实保留其业务身份，宿主在既有出口完成脱敏、schema 投影、流结束/失败和内部更新的分发。所有既有事件名留在传输边界。

**实施顺序**

1. 用 `rg -n "publishEvent|publishSessionUpdate|cloneBlocksForRenderer" src/main/agent/deepchat` 盘点输出点，按 snapshot、完成/失败、交互、compaction 分组；列出各自接收者与提交前后时点。
2. 在 M3 的宿主边界逐类迁移，先迁一类及其全部调用者再处理下一类。保留 `echo.ts` 中独立的 UI 节流和 DB 刷新时序；把客户端裁剪留在最早的外发边界。不得把含 replay 的原始块交给任一不可信订阅者。
3. 对同一 request 对照流帧、终态、内部更新，校核 session/message/request 身份、revision 与块顺序。检查失败及无文本终态也会结算。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.ts test/main/agent/deepchat/runtime/echo.test.ts test/main/agent/deepchat/runtime/dispatch.test.ts test/main/agent/deepchat/runtime/messageProjectionService.test.ts
```

另外抓取测试会话的最终客户端 payload，断言含私有 replay 的输入块已被裁剪；核对持久历史仍保留其所需信息。

**验收标准**：桌面、CLI、Remote 获得原有顺序和各自允许的字段；重试、暂停、取消、空终态和 compaction 均有对应输出。验证真实发送给客户端的 payload 不含 provider replay。共享节流快照，避免按订阅者重复深拷贝或扩大发送频率。[客户端投影](../../../src/main/session/clientMessageProjection.ts) · [流分发](../../../src/main/agent/deepchat/runtime/dispatch.ts)

### M5 · 移出 ACP 实例依赖工厂

**目标**：Direct ACP 由自己的宿主装配；DeepChat 作为内建 backend 或使用 ACP Provider 的行为可分别验证。

- [x] **依赖**：无。**删除**：`AcpAgentRuntime → DeepChatAgentHarness.createAcpAgentInstanceDependencies`、Harness 构造对 `acp/compatibility/dependencies` 和公开面的 ACP 专用 factory。由 ACP 在宿主接线时取得其需要的 prompt、视图提交、历史、状态、限流和 hook 操作。确需共用的执行行为只保留一个实现，不能通过暴露一组可变 coordinator 绕过 Harness 门面。

**实施顺序**

1. 对照 `app/composition.ts` 创建 `AcpAgentRuntime`、`createDeepChatAgentHarness.ts` 的 `acpCompatibility` 和 `acp/compatibility/dependencies.ts`。逐项记录 prompt、tools、view manifest、状态、限流显示和 hooks 的实际消费者。
2. 在 ACP 创建点绑定其已有 host 协作者。对仍需共用的操作提取最窄调用面，尤其区分读状态、提交视图和修改实例；禁止将 `getDeepChatInstance` 原样搬进新门面。两个 backend 共用同一持久事实和既有权限判定。
3. 迁完唯一调用者后删除公开方法和 ACP 专用依赖类型；对照 agent guard 的 barrel 与深导入规则，保留对重复恢复器的防护。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.ts test/main/agent/manager/directAcpAgentBackend.test.ts test/main/agent/acp/instance/acpAgentRuntime.test.ts test/main/provider/acpProvider.test.ts
```

分别记录 Direct ACP 与内建 Agent + ACP Provider 的输入、执行入口、消息和取消结果；其中一条通过不能代替另一条。

**验收标准**：Direct ACP 启动、发送、取消、恢复、限流提示和历史投影正常；内建 Agent 配 ACP Provider 仍经 DeepChat loop。一侧单独构造时不启动另一套进程或恢复器。相应调整 [既有 Harness 边界](../deepchat-agent-harness-boundaries/spec.md) 的 ACP 接线断言，保留对私有 owner 深导入的禁止。[ACP 实例用例](../../../test/main/agent/acp/instance/acpAgentRuntime.test.ts)

### M6 · 收回身份、工具策略与 Memory 游标的表访问

**目标**：身份、工作目录、工具范围与记忆游标由拥有数据的模块解释；运行时只接收业务值。

- [x] **依赖**：无。**删除**：`SessionIdentityService`、`DeepChatToolResolver.sqlitePresenter` 和 Harness 内 Memory 回调对具体表的读取/更新。按实际操作从现有 Session/Memory 所有者取得身份、父子与工作目录、工具限制、Memory 游标推进/回退。adapter 在宿主侧解析数据库行，运行时消费最小业务值。

**实施顺序**

1. 从 `SessionIdentityService`、`toolResolver.ts` 的 `sqlitePresenter` 和 `createDeepChatAgentHarness.ts` 所有表访问列出实际字段。包括 `readPersistedProjectDir` 和父会话查询，并区分缺失行、缺失字段和已 hydrate 实例的优先级。
2. 分别把读取绑定到 Session 所有者、把游标读取/推进/回退绑定到原有持久化操作。复用已有类型；每换一类调用就删除该消费者的具体数据库依赖，避免返回整行让上游继续解释 schema。
3. 验证转移、子 Agent 权限、fork、清历史/回退、重开后读到新连接。继续追踪输入权限和模型快照，禁止默认授予找不到父记录的工具。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.ts test/main/agent/deepchat/runtime/sessionIdentityService.test.ts test/main/agent/deepchat/runtime/toolResolver.test.ts test/main/agent/deepchat/memory/memoryRuntimeCoordinator.test.ts
```

在步骤证据中列出已删除的表访问和对应的新所有者；保留原有空值和拒绝结果。

**验收标准**：缺失会话、父子工具授权、Agent 转移、Memory rewind 与数据库 reopen 保持实现中的既有语义；三处不持有表、原始 SQL 或数据库连接。覆盖 [ToolResolver](../../../test/main/agent/deepchat/runtime/toolResolver.test.ts) 与 [身份解析](../../../test/main/agent/deepchat/runtime/sessionIdentityService.test.ts)。

### M7 · 将持久化接线收窄到可原子执行的操作

**目标**：核心只描述需要提交的事实，SQLite 宿主保持一个事务和一个重开/恢复顺序。

- [x] **依赖**：M5、M6。**删除**：内建 Harness 的 `database: SessionDatabase`、`sessionData: SessionData` 和消费方对具体 transcript、Tape store、journal 或 pending-input 实现的依赖。复用 [Session 数据合同](../../../src/main/session/data/contracts.ts) 和 [Tape 能力](../../../src/main/tape/ports/capabilities.ts)。SQLite adapter 持有事务。宿主负责编排数据库重开，内核运用同一个 pump 装载重启 hold，并在 hydrate/发起请求前完成每次恢复。

**实施顺序**

1. 从 `harness/createDeepChatAgentHarness.ts` 的 `sessionData` 解构往下追踪 settings、transcript、tapeStore、pendingInputs、programmaticExecutionJournal。逐项归到现有 Session/Tape 操作；同一事务的动作不能拆成多个可独立成功的回调。
2. 保持 `SessionTranscript.commitRecord` 以及 replacement/retraction 的事务所有权。重开路径按原序做 journal 分类、pending 恢复与 hold 安装、compaction 修复、剩余 pending message 恢复。保留一次构造/一次重开各自的恢复边界。
3. 令 adapter 每次从稳定的 database owner 获取当前连接。构造测试会话，注入 Tape 写失败并重开，再查询消息、Tape、游标和未消费输入。成功后删除 Harness 对整个 `SessionData`、`SessionDatabase` 的依赖。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.ts test/main/session/data/transcriptAtomicity.test.ts test/main/session/data/transcriptProjection.test.ts test/main/agent/deepchat/runtime/pendingInputPump.test.ts
```

对比成功、回滚、重启三种数据库结果。队列认领后异常退出不能留下双份消息或再次执行效果不确定的调用。

**验收标准**：现有 profile 直接可读；注入 Tape 追加失败时，消息和游标均无半提交。取消和重启中断后不会重复认领、自动发送旧输入或重放不确定的副作用。维护完成时只恢复一次，保留 Memory drain/fence/resume 顺序。[事务用例](../../../test/main/session/data/transcriptAtomicity.test.ts) · [PendingInputPump 用例](../../../test/main/agent/deepchat/runtime/pendingInputPump.test.ts)

### M8 · 隔离工具和扩展能力的宿主实现

**目标**：同一运行循环可消费受限宿主能力；具体权限、token、子操作与后台服务不进入核心。

- [x] **依赖**：M6。**删除**：内建 runtime 对 CLI token/parent registry、宿主 tool 实现、Skill/Plugin/Memory 服务类以及平台配置的具体导入和公开类型泄漏。沿现有 provider/tool adapter 接线分离运行决策和实际执行。保留 run-scoped grant 的颁发、精确匹配、撤销和副作用日志在可信宿主，Tool Surface 的执行/恢复语义按现有合同保留。

**实施顺序**

1. 从 `DeepChatHarnessDependencies` 中 `programmaticToolParents`、`agentCliTokenAuthority`、Skill/Memory/Plugin、attachment 和 shell 协作者反查方法使用。区分纯类型、实际执行和授权，先复用 `runtime/toolAdapters.ts` 与既有端口。
2. 宿主绑定具体实现，仅交付本轮所需操作；保留工具定义快照、精确操作匹配与父子 Run 因果关系。明确宿主能力缺席时哪一步拒绝调用，拒绝结果不能转为宽松默认。
3. 迁完逐项删 concrete import 并检查公开类型；对已授权调用、目标不符、取消后复用 grant 及宿主无相应能力逐一验证。历史 Tool Surface 和 journal 仍可读。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.ts test/main/agent/deepchat/runtime/toolAdapters.test.ts test/main/cli/agentTokenAuthority.test.ts test/main/cli/programmaticToolParentRegistry.test.ts
```

记录四种场景的允许/拒绝结果与工具实际执行次数。token 和完整凭据不得进入快照、PR 或测试输出。

**验收标准**：普通工具与受限工具走原授权流程，取消后旧 grant 不能再用；缺失桌面能力时无法执行该操作。相同模型、工具和技能输入产生相同的可见定义和提交顺序。没有新增通用服务查找入口。[执行适配器](../../../src/main/agent/deepchat/runtime/toolAdapters.ts) · [现有工具合同](../tool-system.md)

### M9 · 以同一生产入口完成双宿主验收

**目标**：以一个可执行证据证明 Desktop 和普通 Node 使用同一套真正的 Harness，旧数据也能恢复。

- [ ] **依赖**：M1、M4、M5、M7、M8。**删除**：公开入口剩余的 Electron 间接导入（包括 `@shared/logger`）、只为接线暴露的 registry/observer 和具体宿主类型。Desktop 的 backend 现在直接读取 `deepChatRuntime`，维护路径读取 `memoryIngestionObserver`；迁为明确的实例操作与 drain/reopen 合同后，再删除旧 getter。保留一个注册表、一个 pump 和每个 profile 一个写入所有者。模块仍在当前源码树内。

**实施顺序**

1. 以 `src/main/agent/deepchat/harness/index.ts` 为唯一生产入口，迁移 backend 的 registry getter 和维护路径的 observer getter。审查重导出、动态 import、公开类型，以及 `@shared/logger` 等间接来源。构建或启动时从解析器拒绝 Electron/桌面实现，不能用空模块替身让导入通过。
2. 为普通 Node 提供最小测试宿主，使用生产循环、脚本化 Provider、仅一个可执行的受限工具和临时可重开的存储。第一条消息触发工具并在下一次 provider request 中断言结果；第二条引用上一轮内容。另走拒绝/允许权限、取消、异常关停重开和事务注入失败。
3. 从独立进程运行该场景，避开 `test/setup.ts` 的 Electron mock；记录可从干净 checkout 执行的命令、退出码和关键断言。用相同代码入口跑 Electron 基本聊天、流、历史恢复和两种 ACP；真实 SQLite 原子性单列。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.ts test/main/agent/deepchat/harness/deepChatAgentHarness.test.ts test/main/agent/manager/deepChatAgentBackend.test.ts
```

以上是桌面兼容回归。M9 必须另交付独立 Node 回归的入口和可复跑命令；仅运行已有 Vitest 文件、仅调用 LoopEngine 或跳过本机数据库用例都不足以签收。

**验收标准**：审查入口的静态、动态、本地别名、barrel 及公开类型依赖。以独立 Node 进程运行 spec 的两轮工具会话、权限恢复、取消和持久化失败场景，显式拒绝加载 Electron。仅网络模型和外设使用脚本化替身；事务/重启使用能跨实例重新打开的临时存储，并与真实 SQLite adapter 的原子性用例交叉验证。`test/setup.ts` 默认 mock Electron，普通 Vitest 绿灯不足以证明可移植。Electron 入口用同一核心验证发送、流、工具响应、旧会话、Direct ACP 与兼容 Provider。发布独立包是此门槛之后的独立决定。

### M10 · 删除两个无生产调用的 main 候选

**目标**：确认未被产品或扩展加载后，移除失去用途的入口；现用 MCP 策略与浏览器工具继续工作。

- [x] **依赖**：无；不阻塞 M9。**拟删文件**：`desktop/browser/BrowserContextBuilder.ts`、`mcp/agentMcpFilter.ts`。删除前针对当时的目标分支复查文件名、导出名、路径别名、动态发现、构建入口、插件与 fixtures。有消费者的项退出本片。

**实施顺序**

1. 先运行 `rg -ni "BrowserContextBuilder|agentMcpFilter|getAgentFilteredTools" . --hidden -g "!.git" -g "!node_modules"`；另查打包文件清单、动态装载、入口和插件。按运行入口、测试、文档报告分类。
2. 只有实现自身及历史报告引用时才删除；发现生产消费者则保留文件并记录路径。更新因实际删除而失效的受维护链接或 baseline 条目。

**验证入口**（仓库根目录）：

```bash
pnpm exec vitest run --config vitest.config.ts test/main/desktop/browser/YoBrowserToolHandler.test.ts test/main/tool/toolService.test.ts
```

为每个候选记录“已删”或“保留 + 调用位置”，再验证现用浏览器动作和 MCP 权限过滤。

**验收标准**：现有浏览器工具提示和按 Agent 限制 MCP 工具的实际执行路径仍能工作；无悬空 export、打包入口或失效 fixture。零入度报告只用于发现候选，utility-process 入口和旧数据读取路径不据此删除。

## 整个 PR 的合并门槛

在同步最新 `dev` 的同一候选提交上运行以下检查。Playwright 使用构建后的应用和隔离 profile，详见 [E2E 运行条件](../../../test/e2e/README.md)。这些 smoke 只覆盖各自入口；前文要求的普通 Node 宿主、数据库重开和两窗口交叉投递需要单独证据。

```bash
pnpm run format:check
pnpm run i18n
pnpm run lint
pnpm run typecheck
pnpm run architecture:renderer-baseline:check
pnpm run test:main
pnpm run test:renderer
DEEPCHAT_REQUIRE_NATIVE_SQLITE=1 pnpm exec vitest run --config vitest.config.ts test/main/session/data/transcriptAtomicity.test.ts test/main/sync/replicaNative.test.ts
pnpm run build
pnpm exec playwright test -c test/e2e/playwright.config.ts 04-settings-navigation 35-agent-composer-drafts 36-chat-streaming 40-acp-extensions
```

用一次性 profile 的副本验证升级和回退：在重构前版本创建会话、发送包含工具结果的消息、记录会话 ID 与消息顺序，然后关闭应用。用候选版本打开副本，校验历史并发送下一条消息。关闭并用同一份副本在重构前版本重新打开，确认会话、工具结果、新消息与发送均可用。只在脱敏测试数据上操作。若需要不同 SQLite ABI，使用隔离环境或 CI 执行，对照实际运行条数确认没有静默跳过。

- [ ] 在工作分支逐步核对生产调用者、失败和撤销路径；M1、M4 至 M8 的新增依赖发现按实际所有者在本分支处理，再进入 M9。清理临时探针并复核入口依赖、权限、所有残留旧路径及历史数据兼容性。
- [ ] 最终候选提交通过格式、i18n、lint、typecheck 和相关测试。附 M9 的普通 Node 与 Electron 双宿主结果、真实 SQLite 原子性/重开验证，以及 Renderer 的 MCP、草稿恢复和多窗口验收结果。列明实际运行平台和跳过项；关键场景缺少通过证据时，PR 保持待合并，beta 继续从 `dev` 发布。
