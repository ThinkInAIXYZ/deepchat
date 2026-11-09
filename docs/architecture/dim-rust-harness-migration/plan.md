# dim Rust Harness 迁移实施计划

本文件是唯一执行跟踪表。目标、权威边界和验收合同见 [spec.md](./spec.md)。

状态：调研及实施方案完成；下面 P1–P9 尚未实施。本文中的路径与接口如无“现有”标识，均为拟新增或拟调整，不代表已交付。

## P0. 建立基线与验证接入方向

- [x] fetch 最新 `origin/dev`，从 `42569d6a8f2128ac9c60daf7c4f15706894ccb04` 创建 `docs/dim-rust-harness-migration`，保留原 checkout。
- [x] 读取 AgentManager、built-in/Direct ACP backend、harness/host 合同、MCP/插件、Tape/Inspector 和存储边界。
- [x] 对照 dim main、alpha.21 tag、release manifest、App Server、插件 SDK、原生存储装配和发布合同。
- [x] 官方 Linux x64 release 下载与 SHA-256 校验；执行真实二进制的 v3 socket、mock 回合、history/lookup、关闭和重启读取探针。
- [x] 将“dim 能做则交给 dim”落实到 MCP/Skills/权限/模型/队列/协作归属，而非把现有服务整体包进 bridge。
- [x] 写入目标 RFC、缺口 G1–G8、迁移与回滚合同、阶段交付和验证状态。

结论：官方 release 可以作为首个集成候选；并不等于 release 已满足所有功能。TS 插件不能直接替换底层 TimelineStore，ExternalAgent 文档不是已实现保证。

## P1. 固定协议、能力与发布包（门禁 A）

目标：不依赖本机开发工具链，能够启动锁定 dim，并知道这个版本确切能做什么。

负责边界：DeepChat runtime packaging / main supervisor；协议缺口归 dim 上游。

- [ ] 建立 runtime lock manifest 和获取脚本，纳入 `scripts/install-runtime.mjs` / runtime 打包约定；记录六平台资源、hash、source commit、SDK、插件运行时与许可证。
- [ ] 在 `src/main/agent/dim/` 实现 supervisor 和 v3 client：生命周期、socket/pipe 权限、握手、超时、请求相关、字节边界、取消、graceful shutdown、实例变化。
- [ ] 明确生产 `product-home/home`、每 profile 的租约、短 socket 路径、离线包和系统代理/CA 注入；禁止连接用户全局 dim daemon。
- [ ] 用相同 release 装载最小 TS process/Session/branch part，验证 `partRegistry`、`toolRegistry`、`sessionMethods`、`managementMethods`、`dispatcher.consume` 与 timeline 查询；固定匹配的 rutis/SDK，不从 main 拷贝不兼容声明。
- [ ] 验证现有 `session.methods` 的 discovery、submit/lookup 的不确定性和重复 ID 合同、attach/history 的无丢失边界、u64 无损传输。
- [ ] 建立功能对应清单，覆盖现有 provider registry、所有模型调用点、工具来源、插件格式、队列和 ACP 功能；每一项标 N/P/G、负责人、目标版本、验收证据及临时路径退出条件。
- [ ] 对发现的 release 缺口确定上游补丁范围；需要薄 host 时保持原生 dim 核心、明确回到官方 release 的版本条件。此阶段只记录本地上游工作项，不自动创建 GitHub issue。

完成条件：打包二进制能独立启动、插件加载且安全卸载，版本不匹配在执行前失败；能力清单区分 binary-tested、source-confirmed、proposed。一个关键入口缺失即不开放正式 dim session。

## P2. 接通 DeepChat Session 与 dim 执行（依赖 P1）

目标：打通现有 UI → Session → dim → 流式 UI 的最小完整链路，同时隔离 Direct ACP。

负责边界：`src/main/agent/manager/`、`src/main/session/`、新增 dim adapter、app composition。

- [ ] 增加持久 engine/runtime/store/session/branch 映射与版本化迁移。对现有 session 标 legacy 或 acp，禁止根据是否有消息动态猜引擎。
- [ ] `DimAgentBackend` 实现现有 session handle 的发送、取消、快照、settings 等 facet；不足的字段明确能力诊断，不用空实现伪装可用。
- [ ] 将 dim event 投影为既有 `AssistantMessageBlock`、状态、usage 和 typed events，保留 request/turn/tool 身份及错误来源；变更 shared contracts、preload、renderer client 时保持 typed boundary。
- [ ] 实现稳定 submission intent、accepted/unknown/rejected 状态和 input lookup；实现断线补页、事件去重、projection cursor 事务、重启 fencing。
- [ ] 保持多窗口/CLI/Remote 的 session 引用和取消权限；冷查询不启动 agent、不消费输入。Direct ACP 不经过 dim backend。
- [ ] 使用受控本地模型 fixture 完成普通对话、多轮、工具结果、错误与取消；真实运行需写入 dim 原生 store，不能只模拟 adapter。

完成条件：一个 dim session 可在现有聊天界面连续工作、重启恢复和取消，ACP session 原样工作；即使客户端回复丢失，也不会无条件重发。

## P3. 两个独立插件与内容读取（依赖 P1；与 P2 汇合）

目标：证明插件边界，去除 adapter 对旧 harness 服务图的依赖。

负责边界：`plugins/dim/deepchat-host/`、`plugins/dim/deepchat-storage/`；main 侧 `src/main/agent/dim/hostBridge/` 与 `src/main/session/data/`。

- [ ] `deepchat-host` 注册显式产品能力；实现受限 Main 网关、profile/session/branch/generation 授权、取消、限流、输出限界、故障诊断与卸载撤销。
- [ ] 接入一个确有必要的产品工具（例如既有知识库查询），证明调用与结果属于 dim 的工具执行、审批和 timeline；不采用 bridge 内部 loop。
- [ ] `deepchat-storage` 校验 store root 与 identity，提供版本/能力、session 内容页、分支详情、脱敏 event detail 和 export 接口。
- [ ] 内容读通过 dim service/query，覆盖冷 session、关闭分支、固定水位与分页。无 UI 或 search 代码读取 dim SQLite 私有表。
- [ ] 定义插件间无环依赖：storage 不等待 host 工具；host 不能通过 UI 读请求反向推进同一个被阻塞的 dim 调用。等待审批的状态归 dim，查询连接继续可用。
- [ ] 确定投影缓存和 checkpoint 事务，验证只读访问失败不会被处理成空历史，慢客户端不无限积累流事件。

完成条件：两个插件可独立加载/卸载/报告版本，权限撤销和 storage 失败可观察；重启仅靠 dim 权威内容即可重建聊天投影。

## P4. 把 dim 原生能力收回到 dim（依赖 P2/P3；门禁 B）

目标：消除双重 owner；逐项关闭 G1–G4、G8 中的运行时缺口。

负责边界：dim 原生 owners / 上游扩展；DeepChat 仅配置 UI、转换器、产品桥。

- [ ] **MCP / Skills**：迁移 user/project/plugin 配置、启用状态、凭据和来源 revision；UI 改调 dim 管理接口，通用连接/认证/工具发现由 dim。逐个迁出当前 `serverManager`、`toolManager` 的通用执行职责；in-memory、企业身份、MCP Apps 仅按真实缺口保留 bridge。
- [ ] **模型与 G3**：按 `providerRegistry.ts`、特殊 Provider/auth/media 和辅助调用入口制定 mapping；Rust 完成请求、stream、retry、reasoning/cache、usage、代理/headers/OAuth。对齐模型设置、标题、翻译、memory extraction/embedding、媒体调用；缺少 provider 端口在 dim 补，禁止回调 TS AI SDK。
- [ ] **凭据**：安全导入/绑定既有 secret，验证 redaction 与 refresh/revoke。OS keychain resolver 如为必需，应先完成 Rust 接口再启用；不得将 secret 填入普通插件 JSON。
- [ ] **队列与 G1**：核对 send/steer/withdraw/pending 原生语义。编辑/排序/重启显式 resume 若缺失，在 dim InputQueue/Session methods 增加原子变更和版本校验；移除 DeepChat pending pump 的执行职责，UI 队列读 dim。
- [ ] **Context / G2**：模型输入组装、自动/手动压缩、usage/budget、AGENTS/Skill/context revocation 归 dim；不能用 TS 拼好 provider messages 再交 dim 发送。现有插件 hook 事件时序与幂等性通过 dim owner/兼容 part 保持。
- [ ] **工具和产品插件 / G2**：迁移标准文件/shell/search 到 dim，保留 CUA、知识库和专有系统能力；核对 large result、附件、question/permission、异步后台结果、并行风险与取消。
- [ ] **协作 / G4**：native dim subagent/branch/collaboration 覆盖 DeepChat 原功能。跨 ACP 委托由 dim Collaboration 插件扩展调 DeepChat ACP adapter；审批回到原操作，取消和终态有单一 owner。明确 ExternalAgent 草案的待实现部分，不能视作已存在。
- [ ] **ACP-as-provider**：清点现有配置/会话；能等价迁入 dim Rust provider adapter 才保留该执行方式，否则作为显式的产品迁移项，完成可接受方案前不切换受影响用户。
- [ ] **Headless / G8**：CLI、Remote、计划任务经同一 Session backend；优先复用 dim scheduler 等已有插件，将 DeepChat 触发源作为输入。核对 background tool、通知、关窗口和 app quit 的生命周期。

完成条件：能力清单中原生支持的功能均由 dim owner 执行；每个留下的桥接项有产品原因。模型请求、queue/approval/compaction/subagent 只有一套权威状态机。

## P5. 数据迁移、备份与回滚（依赖 P3/P4；门禁 C）

目标：关闭 G5/G6，确保“历史仍在、能续聊、能恢复”。

负责边界：DeepChat migration/data lifecycle coordinator，dim import/storage owner。

- [ ] 建立 dry run、migration journal、stable mappings、磁盘容量预检和可恢复阶段标记。覆盖 userData 之外的旧 `~/.deepchat/sessions` 内容引用。
- [ ] 复用或扩展 dim 的正式 migration/import 能力来接受 DeepChat 数据，保证旧工具不会重放；不能靠向保留域 timeline append 伪造执行事实。
- [ ] 迁移消息、变体/编辑点、tool pairing、附件、有效压缩摘要、分支/子会话、配置/权限意图、context 来源；核验后原子切换 engine mapping。旧队列保持 hold，用户显式恢复后才执行。
- [ ] 旧请求 replay/trace 无法等价转换时保留只读 legacy evidence，明示边界；导入上下文与用户可见内容一致，provider 特有字段不盲目送其他模型。
- [ ] 重复迁移、崩溃续跑、单会话损坏隔离、取消及中途磁盘满都可恢复，不留下两个可写会话。
- [ ] 实现 shutdown barrier 下的一致备份、恢复与完整性校验；不能在运行中只拷 SQLite。在线备份若为产品必要能力，补 dim 原生 snapshot/export 后再通过 storage 插件开放。
- [ ] 同步迁为 snapshot/import 或不可变内容协议；迁移原来的活跃会话 sync 抑制机制，避免双 writer。关闭 G6 的加密、个人数据删除、附件闭包及回滚一致性缺口。
- [ ] 显式演练 DeepChat 升级、dim store 格式升级和整套快照回滚；保留升级后的新增内容，不让旧二进制打开新 store。

完成条件：既有代表性真实结构样本能继续对话且不丢数据，备份/删除/恢复的每个中断点有确定结局；只读历史可用不算完成迁移。

## P6. Timeline Inspector 与 Tape 退化（依赖 P3/P5；门禁 D）

目标：关闭 G7，复用 Inspector 的展示能力，把 Tape 从新执行路径移除。

负责边界：`src/shared/types/tape-inspector.ts` 的新来源无关合同、Session typed routes、storage plugin、renderer Inspector。

- [ ] 引入新的 Timeline identity、branch cursor、metadata/detail 合同；`LegacyTapeReader` 和 `DimTimelineReader` 共用 UI DTO，不共用事实写入器。
- [ ] 迁移 Panel/Timeline/Row/DetailPane/layout/resize 的 UI，保留 virtualization、选择、follow/pause、过滤、按需详情和脱敏导出。
- [ ] 重写 store/model/timeline 中依赖 Tape incarnation/entryId/run/requestSeq 的逻辑；dim 使用真实事件/turn/request/tool IDs 和分支顺序，未知关联不猜测。
- [ ] 明确 public history 与完整 timeline 查询差异；新详情和 trace 通过插件按固定水位取，不能为了便利把 raw history 或原始 export 全量跨 IPC。
- [ ] UI 使用 Timeline 命名，旧 Tape 记录明确标历史来源。更新全部 locale，保留旧入口的选中消息定位能力。
- [ ] 对 dim session 停止 Tape 写入；Direct ACP 中只为 lineage 使用 Tape 的调用迁到产品关联数据。Legacy session 暂保持旧路径，直到 P8 结束。

完成条件：新旧会话均可检查，长会话/多分支/重连无重复漏读、错绑或隐私泄露；新 dim session 无 Tape 写入依赖。

## P7. 全变更审查与验证选择（依赖 P2–P6）

按仓库规范先实现完整切片，再选择必要的永久测试。P0 的外部临时探针用于协议可行性，未新增产品测试；迁移/并发/恢复的 characterization 如必须先于实现，需在本计划记录具体理由。

- [ ] 审查依赖方向、所有权、权限和凭据：是否残留 loop/retry/context assembler、重复审批、双数据库事实、双 MCP server 或双调度器。
- [ ] 盘点原有 behavior tests，将仍有效的产品断言迁到 adapter/真实 dim fixture；不删除仍保护恢复、持久化、安全和可见行为的覆盖，不继续锁定旧实现细节。
- [ ] 选择最小必要的新回归：协议兼容/不确定提交、插件撤销、断线补页、崩溃恢复、旧数据转换和双 store 一致性。避免全部通过 mock adapter 的自证测试。
- [ ] 使用现有主/renderer 测试及 E2E workflow：launch/settings、`36-chat-streaming`、provider custom headers/connection save、user plugin install、ACP extensions/composer、memory lineage/impact、knowledge read、原 Inspector 行为。
- [ ] 真实 release + 本地脚本化 provider/MCP 验证无凭据链路；选定 provider 的 live 验证单独记录凭据需求、结果和未测范围。
- [ ] 故障演练覆盖提交确认丢失、工具副作用后断线、插件中途卸载、被取消/删除 session 的晚到回包、磁盘满、备份中断及新格式回滚。
- [ ] 测量旧/新性能基线：控制开销、TTFT、停止、流 UI、长历史页读、空闲内存、并发和包体；超阈值先诊断，不能宣称“Rust 所以更快”。
- [ ] 在六平台验证可执行包、Node 插件 runtime、socket/pipe、权限、离线、升级/卸载、签名和 notices。按平台记录通过、失败、跳过、未测。
- [ ] 清理临时探针；运行 format、i18n、lint、typecheck、相关 unit/E2E 和生产 build。dim 上游代码若有变更，另跑其 fmt/clippy/test/xtask/发布检查。

完成条件：G1–G8 闭环；验证结果可追踪到锁定版本与目标平台。上游源码测试成功不能替代打包 release 验收。

## P8. 灰度与移除旧执行路径（依赖全部门禁）

- [ ] 内部 opt-in → 新 session 默认 dim → 旧 session 分批迁移；每个阶段只改变会话引擎选择，不对同一输入双执行。
- [ ] 监测错误/恢复率、unknown submissions、权限拒绝、工具状态、迁移失败、延迟与内存；日志脱敏，不采集原始提示词或凭据。
- [ ] 灰度失败暂停新迁移，保留 dim 数据并用对应版本恢复；旧未迁移 session 可继续旧引擎，已迁移 session 不静默降级。执行整套快照回滚须明确新增内容去向。
- [ ] 完成旧会话处理后删除 `agent/deepchat` 的旧 harness/loop/runtime 执行模块、TS 内置模型执行路径、旧 pending pump 和 Tape writer/reconciler；先查剩余调用，保留 Direct ACP 和真实产品服务。
- [ ] 将 `deepChatAgentBackend` 的产品名与实现分离，最终 backend 只指向 dim；清理 feature flag 与 legacy engine 执行选择。历史 Tape/trace reader 按兼容保留策略继续只读。
- [ ] 移除确无调用者的 AI SDK/旧 runtime 依赖，保留 ACP 等还在使用的依赖；更新 lockfile，重跑完整必要打包检查。

完成条件：DeepChat 自有 agent harness 被 dim 完全替代，bridge 不含隐藏的第二 harness；正式默认路径没有 legacy 执行 fallback。

## P9. 更新维护合同与交付

- [ ] 将 `main-harness-portability`、`deepchat-agent-harness-boundaries`、`agent-system`、`session-management`、`tape-system`、`tape-trace-inspector` 的现行合同更新为已实现架构；保留历史只读限制。
- [ ] 更新 user-plugins、MCP/Skills/provider/auth、memory/knowledge、工具表面、打包与开发文档，说明两插件 authoring、版本锁、数据目录、备份和故障恢复。
- [ ] 为 reviewer 写明最终所有权、数据升级、回滚、行为差异与验证证据；UI PR 附 BEFORE/AFTER ASCII 布局。
- [ ] 在所有能力通过后将 RFC 转为现行参考，按 SDD 规则清理已完成 plan；不提前把拟定状态写成已上线。

## 实施依赖和工作量

主路径：`P1 → P2/P3 → P4 → P5/P6 → P7 → P8 → P9`。两插件和 UI 投影可在协议稳定后独立推进；删除旧执行代码必须最后进行。

建议按上述阶段拆分可审查 PR；P4 按模型、MCP/Skills、queue/context、collaboration/ACP 拆分。负责人按 dim runtime、DeepChat main/data、desktop UI/packaging 三类职责分配；这是实施分工建议，不是本轮启动多 agent 工作。

工作量先按 **12–20 工程人周** 预估（含跨平台、数据迁移和行为回归，不含等待上游 release），P1 完成后按 G1–G8 的实际缺口重估。不能将“两进程能通信”当作迁移已完成，也不能在 provider/历史续聊等缺口未闭环时给出无条件上线日期。

## 本轮方案验证记录

- 已验证：Git 基线与分支、上游 tag/release 资源、Linux x64 checksum/version、协议 v3、mock Rust loop、输入查询、固定水位历史读取与重启一致性。
- 已核查源码但未做 DeepChat 集成：插件注册服务、原生 MCP/Skills、输入 pending/withdraw、compaction、存储装配；这些不能标为产品测试通过。
- 未运行迁移产品测试：本轮未实现 adapter/插件/UI，也未变更 runtime 代码。
- 文档检查通过：本轮文件的本地链接、代码围栏、未解决标记和 whitespace 检查；23 locales 的 `i18n:validate` 通过。
- 使用仓库要求的 pnpm 10.34.5 尝试质量门禁：`format:check` 缺少 oxfmt；完整 `i18n` 在 validation 通过后缺少 i18n-check；`lint` 缺少 typescript；`typecheck` 缺少 tsc。依赖尚未完整安装，前次 frozen install 被 `cdn.sheetjs.com` 网络策略 403 阻塞。以上是环境阻塞，不能记为通过或归因于本轮文档变更。
- 已结束本轮启动的 dim 进程并移除临时协议探针及其合成 profile；没有修改真实用户 profile。
- 方案以面向 `dev` 的 Draft PR 交付；仅含设计文档及现有合同的迁移指引，不发布上游、不修改 dim 源码，也不将迁移实现标为完成。
