# dim Rust Harness 迁移实施计划

本文件是唯一执行跟踪表。目标与职责见 [spec.md](./spec.md)。

状态：核心架构已切换，迁移验收尚未全部完成。内置 harness、loop、queue、模型和上下文已切换为 dim Rust，旧 TypeScript 执行器已物理删除；最新 dev 的 OpenLLM 与 HTML 产品工具已合入。此前报告完整 main 8090 项和 renderer 2760 项通过，HTML/媒体桌面与恢复验收通过；2026-11-12 对 PR HEAD `73a2e8a6` 的复核发现下列缺口，不能以此前测试结果代替本轮验收。持续加解密已移除，保留旧数据一次性解密与按需会话转换。

## 2026-11-12 验收复核（本地已提交，远端 CI 待重跑）

- [x] 定位并修复 required CI 原始失败点：动态架构矩阵契约测试、transcript mock 缺 `pluginHookState`；定向测试和 memory 类型门通过。
- [x] `pnpm dev` 增加启动前 runtime 准备：Node/dim/plugins、Rust 宿主构建及本地缓存；覆盖缺工具链、源码变化、损坏恢复与构建失败回归。
- [ ] 在应用完全退出后实测新的 `pnpm dev` 首次准备与再次启动；此前启动窗口被取消，未完成完整应用级验收。
- [x] PR HEAD 六平台 verification 打包与 dim offline smoke 全部通过（run `42923291616`）。这不包含 macOS distribution 签名/公证，也不代表完整 Electron 首次启动已验证。
- [ ] 本轮补齐 release 漏检：dim smoke 报告纳入 manifest、model 插件检查、跨 lock API 一致性、Windows ARM64 E2E runtime 准备；合同测试已通过，但本轮修复尚未重跑六平台打包。
- [x] 完成协议感知的 reasoning 参数兼容修复，并以 native loopback fixture 验证 Anthropic manual/adaptive、effort-only、Gemini budget/effort 五种 wire body；MiniMax-M3 不再发送 Rust 不支持的 `interleavedThinking`，真实 M3 请求已验证不再因该字段失败。
- [x] 补齐旧会话附件闭包迁移：生产 composition 已注入 `DimLegacySource.images`；`contextText` sidecar 保留可读文本及跳过原因/元数据，排除重复 base64、被跳过附件的原始载荷和原始音频。Native smoke 覆盖宿主重启续传、首次与再次续聊，以及 retain/edit/retry/fork 后的可读文本保留、编辑重算与 ID 重映射；历史工具不执行。
- [ ] 对照 spec §7.3.5 完成结构化工具调用/结果配对验收：目前仅验证旧工具块以不可执行文本进入模型上下文，未恢复 native tool-call/tool-result 结构。旧 interleaved 开关已从配置/UI/推理入口删除，仅保留旧数据库列与迁移/修复兼容。
- [ ] 跑包含本轮修复的 Linux required CI、六平台 verification，以及有授权凭据环境下的 macOS distribution 签名/公证验收。
- [ ] 完成 packaged Electron 离线首次启动验收；当前 offline smoke 直接启动 native host，不能替代应用级 E2E。

本轮专项复验：主进程数据库/供应商 26 项、renderer 串行 183 项、打包/Native 合同 54 项通过；隔离 runtime 的附件迁移与 reasoning 两项 Native HTTP 回归通过，附件测试补强后再次通过。两项已接入 `smoke:dim`，但未将定向运行等同于完整 smoke 或远端 CI。format、i18n、lint（0 errors / 0 warnings）、双端 typecheck 和 `git diff --check` 均通过。环境为 Node 24.22.1 / pnpm 10.34.5；正常构建产生的 provider/ACP registry 刷新保留。

本机 Windows 的完整 main/memory 测试存在路径、执行位、symlink 权限等平台失败；记录实际结果，不跳过或弱化测试，不宣称本机全量通过。

## P0. 基线与已确认决策

- [x] fetch `origin/dev`，从 `42569d6a8f2128ac9c60daf7c4f15706894ccb04` 创建 `docs/dim-rust-harness-migration`。
- [x] 读取现有 Session/AgentManager、harness、Direct ACP、MCP/插件、Tape/Inspector 和数据边界。
- [x] 核对 dim main、alpha.21 release、App Server、插件 SDK、原生存储与发布合同。
- [x] 官方 Linux x64 release 校验与基础探针：v3 socket、mock 回合、history/lookup、关闭和重启一致性。
- [x] 按用户确认的范围改为插件代码集成，移除原先推测的队列、ACP、OAuth 与 desktop 功能缺口。
- [x] 调查 `databaseSecurity.ts`、SQLCipher compatibility 4 和数据库启动恢复路径，形成一次性解密方案。

已有探针只证明 release 基础宿主可用，尚未证明 DeepChat 插件集成；此区别不代表 dim 缺少功能。

## P1. 打包 dim release 并注入插件

目标：优先使用官方 Rust release，将 DeepChat 插件装入 dim 的服务体系。alpha.21 对完整参数/凭据引用使用锁定 release 源码的薄原生插件装配；具体依据见 spec §2，不修改执行核心。

负责边界：runtime packaging、`src/main/agent/dim/` supervisor、插件装载。

- [x] 固定 runtime manifest：release/source commit、六平台包/hash、SDK/rutis/插件运行时版本、插件 digest、存储版本和许可证；接入现有 runtime 安装与离线打包。
- [x] 每 profile 启动独立受监督宿主，显式 home/data root，socket/pipe 私有；复用现有进程树、退出和代理/CA 配置。
- [x] 装载 `deepchat-host` 与 `deepchat-storage` 两条 process 插件 row，通过 `ctx.use` 获取 dim `sessions`/management services。
- [x] 为实时事件注册 branch part，为原生 timeline query/branch 读取注册 Session part；产品工具部分继续在 P3 实施。
- [x] 完成最小插件调用：desktop → 插件注册的方法 → dim session service → 插件事件 → desktop。业务边界是插件代码，不经 ACP、不解析 CLI 输出。
- [x] 固定 typed `DimPluginClient` 调用合同及版本握手；本地 socket/pipe 仅承载跨进程调用，App Server 公共 RPC 探针不代替插件集成验收。
- [x] 验证基础宿主启停、SDK/版本/profile 匹配、插件 readiness、重启与 u64 无损读取、断线后不盲重试。
- [x] 验证独立插件 reload/撤销、raw timeline 分页与 desktop 生命周期；锁定薄原生装配和必要 SDK 扩展的源码、摘要与 notices。

完成条件：官方 release 可离线运行，两个插件可加载并直接调用 dim 服务，桌面能收到真实结果。

## P2. Session 与完整队列绑定

目标：现有聊天 UI 使用 dim 内置 agent 与完整队列，ACP 继续走原 client。

负责边界：`AgentManager`、Session 服务、`DimAgentBackend`、`deepchat-host`。

- [x] 持久化 appSessionId ↔ dimSessionId/branch/store/runtime 映射；旧内置会话标为待转换，ACP 保留原 backend。
- [x] `DimAgentBackend` 通过 host 插件实现现有发送、取消、快照、设置与交互 facet；插件内调用 dim service，不导入旧 harness 服务图。
- [x] 将队列 list/update/reorder/steer/resume 等 UI 操作直接绑定 dim 原生队列；移除旧 pending pump 的执行职责，不新增 TS 队列或先行改造 dim InputQueue。
- [x] 将 dim 事件转换为既有消息块、usage、状态及 typed events，保留 turn/request/tool 身份和错误来源。
- [x] 实现稳定 submission intent、未知提交结果查询、重连补页、去重、projection cursor 与 generation fencing；确认丢失时不盲目重发。
- [x] 多窗口/CLI/Remote 复用现有产品入口；ACP 的认证、终端、扩展和取消保持原路径，只做回归，不新增 dim ACP 接口或跨 ACP 委托。

完成条件：现有聊天 UI 可多轮、取消、操作队列和重启恢复；执行和队列状态只由 dim 持有，Direct ACP 不经过 dim。

## P3. 两插件的产品能力与内容接口

目标：用插件注入产品能力，用 storage 插件读取 dim；不复制执行核心。

负责边界：`plugins/dim/deepchat-host/`、`plugins/dim/deepchat-storage/`、main 产品能力网关。

- [x] host 插件向 dim 注册 DeepChat 的系统工具、内置知识库/CUA、既有插件等能力，声明工具 schema、取消、来源与风险。
- [x] Main 网关限制到已授权能力，并绑定 profile/session/branch/generation；实现结果、进度、取消、卸载撤销和日志脱敏。
- [x] 配置/权限/问题 UI 经 host 插件交给 dim 对应 owner；保持 native 服务自己的授权检查，不引入第二套 agent 权限决策。
- [x] storage 插件实现 profile/store identity、内容页、event detail、timeline、导出和 migration 入口；读取通过 dim services/query，不直读私有 SQLite 表。
- [x] 定义只读缓存、固定水位、分页、冷 session 获取/释放和失败合同；投影失败可重建，不能回滚 dim 已提交事实。
- [x] 插件内直接绑定 dim 服务，调用面按业务拆分；避免任意 SQL/方法名通用网关和查询/工具调用之间的依赖环。

完成条件：两个独立插件完成“操作 dim / 向 dim 注入能力 / 从 dim 读内容”，卸载与重启不留下旧授权或重复执行。

## P4. 原生能力与配置映射

目标：dim 能完成的功能全部交给 dim，其他产品功能经插件交互。

负责边界：dim 原生 owner + host 插件配置映射；不预设 provider 或 OAuth 重写。

- [x] 暂时停用 Code Mode，移除旧 Code Mode/ToolSearch/programmatic dispatch 接线；等待 dim 原生能力后再启用。dim 已提供同等功能的文件、命令、分支等工具使用原生实现，删除 DeepChat 重复执行器，产品桥不重新注册它们。
- [x] MCP/Skills：现有 UI、安装、来源和启用状态通过插件映射到 dim 原生 owner；通用连接、工具发现和执行只保留一个 owner。
- [x] 既有 MCP/插件兼容：in-memory server、MCP Apps、企业身份、知识库和 CUA 经插件注入；保留 consent、撤销、更新与参数/结果语义。作为正常接入实现，不列为 dim 缺失能力。
- [x] 模型：将现有设置及连接参数通过插件交给 dim；会话和辅助模型请求都在 Rust 执行，不回调旧 TypeScript Provider。
- [x] 辅助调用：标题、摘要、翻译、记忆提取、embedding/rerank、媒体等接入 dim 对应 model/auxiliary/modality；desktop 保留展示、索引与非模型服务。
- [x] 图片/视频/TTS 的独立入口与会话已接入 dim Modality；会话通过独立媒体 alias 选择原生 Agent 模型宿主，实际媒体模型保留非聊天声明。原生 loop/队列管理回合，桌面复用消息身份和媒体展示。媒体文件闭包已通过大文件、fork/删除和冷增量归档验收，历史图片反馈与原生预算计数已通过联合验收，大配置和参考媒体载荷按完整请求进入原生文件传输，超帧、重启和归档恢复已验收。
- [x] OAuth：dim 自身登录、账号和 refresh 不做适配或迁移，不新增统一认证层；其他凭据/配置按能力所有者，通过插件正常交互，不能进入 timeline 或普通 row config。
- [x] Context/Skills/Hooks：dim 负责提示词、上下文、压缩、预算和撤销，产品 context/hook 通过插件接入；不由 TS 拼 provider 请求。
- [x] 原生 subagent/branch/collaboration 直接用 dim；ACP 完全由 DeepChat 原有实现处理，不规划 ExternalAgent、dim ACP gateway 或 ACP-as-provider 的 dim 迁移。
- [x] CLI/Remote/计划任务保持 desktop 入口和调度职责，通过相同插件控制内置 agent；通知、关闭窗口和后台结果沿用现有产品流程。

完成条件：模型、loop、queue、context 和工具调度只有 dim 一套 owner，产品能力通过插件可用，ACP 与 dim OAuth 未扩入改造范围。

## P5. 一次性解密与续聊时转换

目标：旧数据可读、旧会话首次续聊转为 dim；移除持续加解密。

负责边界：desktop profile upgrader、storage migration adapter、dim 内容采用接口。

### P5a. 旧加密 profile / 备份的解密迁移

- [x] 复用 `src/main/app/databaseSecurity.ts` 的密码解析、SQLCipher 导出/恢复及 `connectionConfig.ts` 的兼容设置，保留 legacy 读取能力。
- [x] 使用已有 safeStorage 或本地解锁 UI 获取旧密码；缺少密钥、错误密码、取消、损坏分别处理，不新建空库或向 dim 传密码。
- [x] 独占迁移锁、处理 WAL、保留原始加密快照；导出受限 staging 中的未加密数据库，校验 schema、完整性、关键计数和引用后原子切换。
- [x] migration journal 不保存密码；异常重启只采用完整旧库或完整新库，清理未采用的明文 staging，保证原件可恢复。
- [x] 移除持续数据库加密、改密码、重新加密和日常解锁 UI/运行入口；保留旧加密备份的导入解密路径与相应驱动能力。API 凭据的 OS 保护保持原职责。

### P5b. 首次续聊 migration

- [x] 历史浏览继续用 legacy reader，首次续聊获取单 session migration lock；如 profile 仍为加密格式，先完成 P5a。
- [x] storage 插件的 migration adapter 转换消息/变体、工具调用和结果、附件、有效摘要、分支来源及会话配置为 dim 接受的内容表示。
- [x] 通过 dim 内容/导入能力落库，校验计数、hash、配对和引用；不再次执行旧工具，不把旧内容伪造成新运行结果。
- [x] 以 legacy session/revision/转换版本作为幂等键，成功后原子切换 engine mapping，再发送本次新输入；中途失败保留原历史和待发送意图。
- [x] 旧私有 replay/trace 保留只读证据；转换输出服务于 dim 后续上下文，不能只取最后几条消息代替完整有效历史。
- [x] 未续聊的旧会话保持待转换状态，无需全量预迁移；正式切换后其续聊入口只走转换器，不继续调用旧 harness。

完成条件：解密与会话转换可分别恢复，续聊透明转换且新输入执行一次；只读旧历史不依赖旧执行器。

## P6. Desktop 内容访问与 Timeline Inspector

目标：复用已有桌面功能，将数据来源切到 storage 插件；不要求 dim 重做 desktop 服务。

- [x] Inspector 使用新的来源无关 identity/cursor；保留 legacy reader 与 dim timeline reader，复用 Panel/Timeline/Row/DetailPane、虚拟化、过滤、follow/pause、选择和脱敏导出。
- [x] 修改依赖 Tape entryId/incarnation 的数据层与关联，按真实 dim branch/event/turn/request/tool 身份读取；列表 metadata-only，详情按需加载。
- [x] 冷 Native profile 与产品 SQL 同窗口备份，v3 文件 manifest/流式传输和覆盖恢复；保留 Native 只读附件权限。
- [x] 持久导入日志与启动前恢复：未提交回滚 SQL/Native，提交后仅清理；验证损坏快照与目录交换中断。
- [x] 备份、同步、删除、恢复由现有 desktop coordinator 管理；经插件取得内容/附件闭包，保留现有一致性和冲突流程，不直接合并活跃 dim 数据库。
- [x] 迁移后的内容使用未加密存储，旧加密备份恢复调用 P5a。持续加密不再列为兼容目标。
- [x] 新内置会话停止写 Tape；legacy Tape/trace 保留只读。涉及 ACP 历史关联的共享 Tape 依赖只做产品 metadata 解耦，不改变 ACP client 执行。
- [x] 更新 Timeline 命名、i18n 和旧消息定位入口；多窗口、CLI/Remote、通知仍走既有 desktop 边界。

完成条件：桌面功能仍可用，内容查询来自 storage 插件，Inspector 展示新旧来源；没有新增 desktop 重写项目。

## P7. 集成审查与验证

按仓库规范完成实现后选择必要的永久测试；现有检查可随时运行。已实施模块的真实 Native、桌面与平台验证记录在后文；当前仅保留尚未完成的验收项。

- [x] 检查真实路径为 desktop → 注入插件 → dim service，排除 ACP 包装、CLI 文本解析、旧 loop/queue/context 的重复实现。
- [x] 运行真实 release + 插件 + 本地模型/MCP fixture，验证发送、队列操作、取消、工具回调、事件补读与重启；不能只测 mock adapter。
- [x] 复用现有 main/renderer/E2E：launch/settings、聊天流、provider 参数、用户插件、知识库、memory 和 Inspector；ACP 只验证旧 client 未受影响。
- [x] 为按需转换、解密导入、未知提交结果和插件撤销选择必要的回归；覆盖错误密码、取消、WAL、磁盘满、切换前后崩溃、重复续聊与新输入执行一次。
- [x] 验证 desktop 内容适配后的备份/同步/删除、历史浏览、窗口关闭、CLI/Remote；不增加 dim OAuth 或外部 ACP 协作验收。
- [x] 回读迁移实现的六平台 Native 回归、打包、离线启动和安装包大小检查，并记录 Windows ARM64 定向复验。每次候选提交的检查以 [PR Checks](https://github.com/ThinkInAIXYZ/deepchat/pull/2511/checks) 为准。
- [x] 清理临时探针，运行 format、i18n、lint、typecheck、相关 unit/E2E 和生产 build；未执行与环境阻塞不标为通过。

完成条件：验证证明接入正确，不以未测项推断 dim 缺失功能；解密迁移和按需转换失败不会损坏旧数据。

## P8. 切换与旧执行器移除

- [x] 开发试用 → 新会话默认 dim → 正式将旧内置会话续聊入口切至 migration；不在后台批量迁移全部旧历史，不对同一输入双执行。
- [x] 观察接入错误、未确认提交、转换失败和延迟；失败恢复原始数据/对应版本，不把已迁移会话静默送回旧执行器。
- [x] 切换后删除旧 built-in harness/loop/runtime、pending pump、TS 模型执行及其 Tape 写入/重建职责；保留旧会话 reader/migrator 和 ACP 所需的共享兼容 writer，不向其分派内置执行。
- [x] 保留 Direct ACP client 及真实 desktop 服务；清理 feature flag、无调用者依赖和持续数据库加密入口，legacy 解密 importer 仍支持旧备份。
- [x] 回滚使用一致的数据/二进制快照；保留升级后的新数据供恢复，旧程序使用旧加密快照，不重新加密新数据。

完成条件：DeepChat 内置 harness 完全由 dim 替代，旧历史按需转换，ACP 保持原实现，持续加密已退出。

## P9. 维护文档与交付

- [x] 按已实现状态更新 harness/host/agent/session/Tape/Inspector 合同，保留历史 reader/migration 说明。
- [x] 更新两插件开发、runtime 版本、数据目录、按需迁移、旧库解密和 desktop 内容访问文档；说明新数据库不再持续加密。
- [x] 记录模块 97 恢复、模块 98 退出预算和模块 101 Windows ARM64 复验的 CI 证据。UI BEFORE/AFTER 布局见 [PR #2511](https://github.com/ThinkInAIXYZ/deepchat/pull/2511)。
- [x] 实现完成后将 RFC 转为现行参考并校正本目标的验收记录；按仓库 SDD 规则保留追踪，独立文档清理仅在用户明确要求时执行。

## 依赖与拆分

主路径：`P1 → P2/P3 → P4 → P5/P6 → P7 → P8 → P9`。旧库解密 P5a 与插件接入可独立实现；P5b 在首次续聊时执行。移除旧执行器依赖转换器可用，不依赖全量历史转换完成。

建议按 release/插件骨架、session/队列绑定、产品能力、解密与按需转换、desktop 读取/Inspector、切换清理拆 PR。取消旧版按推测上游缺口估算的 12–20 人周；首个插件端到端切片完成后，依据实际映射与转换工作量估算，不把 ACP/OAuth 重写或 desktop 重做计入。

## 模块进度

- 模块 103：`c718509d8` 的 [Linux PR Check](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/43224628989/job/131204744926) 通过全量 main，Native 媒体联合用例在 90 秒超时，其余 29 项通过。拆开图像/语音和视频会话的生成与冷恢复，两个用例分别校验原生归属、完整 SHA 和归档后的字节。视频保留重启前后两次任务及无重发验证，图像保留编辑、取消、fork 和删除后的原生文件校验。文件读取使用原生允许的 1 MiB 分块，保留原始 18 MiB 载荷与每例 90 秒上限。CI 输出媒体阶段耗时。

- 模块 102：修复 MiniMax-M3 验收暴露的推理配置错误。会话和辅助调用统一按模型实际路由映射参数，旧 interleaved 兼容字段继续持久化。macOS ARM64 上 207 项定向测试和 30 项完整 Native smoke 通过，后者覆盖启用旧标志的真实会话请求。锁定 Rust 宿主的本地 HTTP 验证覆盖 Anthropic 手动预算与自适应、Gemini 预算与 level、Chat 兼容与 Responses effort。打包工作流测试在 Windows 优先选用 Git Bash，文件 symlink 权限不足时仅跳过对应的独立用例。

- 模块 101：Windows ARM64 在 `982913c8e` 的权限投影和媒体联合场景失败，Native 为 28/30。模型响应确认与投影等待分开，媒体测试增加阶段诊断，测试时限维持原值。回归工作流支持平台和架构定向复验，默认、定时和复用调用仍覆盖六平台。`73a2e8a67` 的 [Windows ARM64 定向复验](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/42923281048) 30/30 项通过，六平台 [Package Check](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/42923291616) 也全部通过。

- 模块 100：HTML 默认关闭迁移的测试按 Native canonical 工具名 `schedule` 更新，4 项持久化/同步专项通过。完整 main 8090 项通过、37 项跳过（641 文件，248s），完整 renderer 2760 项通过（290 文件，308s）。format、i18n、lint 和双端 typecheck 通过。`bbb98a412` 在 [CI 42914414360](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/42914414360) 通过六平台 Native、打包和离线检查。含 HTML 的 `982913c8e` 在 [CI 42917926939](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/42917926939) 通过其余五个平台，Windows ARM64 结果见模块 101。

- 模块 99：合入最新 `dev` 的 `d6853c7b1`（OpenLLM、opt-in HTML 可视化与默认关闭迁移）。保留旧 Harness/Code Mode 源码删除，HTML 工具经产品插件提供，描述通过 Native 结果重建；原文、section 与尺寸经 storage 插件读取固定 Native transcript，旧 SQL 仅兼容未迁移历史。帧使用 scope generation 与派生源身份验证失效，异步面板读取保留并发大小预算。OpenLLM 模型目录逻辑保留，推理走已有 Rust 兼容驱动。128 项相关回归与最终 7 项 HTML 回归通过；完整生产构建、双端类型、格式/i18n/lint 通过。真实桌面媒体用例通过（13s）；HTML 联合用例通过（37s），覆盖默认关闭、Native 工具调用、实际隔离页面、section、备份/两类恢复、重启、原生续聊与清空失效。首轮页面已实际显示，修正外层/内层 iframe 的测试选择器后通过，未提高时限。旧 TS HTML context 改写不恢复，预算/压缩仍归 dim；桥 0.43.0 和 SDK/store 不变。合入后的完整 main/renderer 与当前代码六平台验收继续执行。

- 模块 98：六平台回读定位到 Windows x64 的全局 daemon.shutdown 10 秒外层 RPC 截止，而锁定 rutis 合同允许插件清理 10 秒、loader 停止余量 2 秒及进程退出等待 5 秒。全局退出改为回执与进程正常退出共享单一 30 秒预算，避免在原生允许的清理窗口内误杀；仍必须收到成功回执且确认 exit code 0 才放行冷存储，busy、超时或未知退出继续拒绝访问。模型与工具取消不使用这一全局预算。新增两个有/无 ifIdle 的迟到成功回执回归，验证 15 秒仍封锁回调、回执后还要等待正常退出，剩余退出等待只取得剩余预算。12 项生命周期/快照单元、两个实际 Native 模型用例（55s）、最新 Electron 两项（44.2s）、双端类型/格式/i18n/lint 和生产主进程（35s）通过。未增加 fixture 的测试时限，桥 0.43.0、SDK/store 不变；已推送 bbb98a412，六平台回归 42914414360 正在运行。

- 模块 97：完成整体验证与恢复边界复核。修复设备导入日志已发布、目录 flush 随后报错但调用方尚未取得 journal handle 的恢复路径；恢复未确认时保留暂存并阻止 Native 重启。启动回滚完成后先持久记录 rolled-back 阶段再清理恢复目录，允许目录已清理时重复启动恢复；兼容不含阶段字段的旧日志。手动数据库导入在替换 SQL 前处理遗留设备导入日志，避免两类恢复记录交错。真实双设备流程注入日志发布后的 ENOSPC，验证不提交绑定、无孤立日志、重建后沿用同一导出恢复，再验证分叉采用、Rust 续聊与删除（45s）；26 项相关单元及恢复清理中断回归通过。完整 main 8067 项通过（639 文件，240s，37 项既有/环境跳过）、renderer 2758 项通过（289 文件，411s）；最新 Electron 两项通过（42.7s），双端类型、完整格式/i18n/lint 与生产主进程通过（16s）。首轮并行验证的扫描超时和 umask 077 权限差异，已分别通过单独运行及环境 umask 022 验证，未增加测试超时或修改打包权限逻辑。Native bridge/SDK/store 不变。模块 96 已推送至 95abdcf3d；GitHub 401 凭据问题恢复后，本模块已以 160647dd2 推送。当前 head 的六平台 CI 继续核验，不以旧版本结果代替。

- 模块 96：自动设备同步已接入独立 Native 文件清单与 16 MiB 有界分块、SHA 校验和持久缺块续传；原生快照按 SQL 批次缓存，网络重试复用导出。产品仅同步 binding/scope/import 元数据，canonical 内容经 storage 插件从 dim 取得。源端检查所选闭包的原生活动/未消费队列，并比较导出前后分支水位；接收端在空闲屏障内按 LWW 胜出会话准备原生替换，SQL 事务重查授权、胜出集合和游标，连同唯一导入回执提交，启动日志据精确回执保留或回滚 Native。未知提交、未完成迁移和暂停队列阻止覆盖；派生 input/Inspector 缓存按会话重建，无关会话保留。Native 三项归档与双设备 18 MiB 附件、真实分块中断/重建续传（只导出一次）、分叉采用、Rust 模型续聊、删除和 Inspector 缓存均通过；完整集合 29 项通过，修正调度状态断言后的同步专项再通过（31s）。25 项相关单元、双端类型/格式/i18n/lint、release（3m17s）及最新主进程构建（33s）、两项 Electron 联合回归（46.7s）通过。接收端等待 Native 空闲后原子安装，不推进忙碌批次的游标；源端允许无关执行继续。暂存采用文件系统 reflink 并保留普通复制回退。桥 0.43.0，SDK/store 锁定不变。

- 模块 95：新增原生冷暂存的选择性替换接口，通过 AgentRecords 和 SessionStore 按后序删除所选会话及其拥有的子会话，保留公共 agent 与无关根会话。删除前验证整组输出路径属于暂存；桌面先将输出归属迁入私有 dim 目录，再删除旧闭包、仅合并胜出的原生会话，最后迁到安装目录。未确认释放时保留隔离 owner 及暂存，保留主操作/清理双方错误。三项真实 Native 归档联合通过（36s），包含两端不同历史、安装回滚、远端采用、附件、无关历史、删除传播和源快照校验。关闭会话会追加原生 stop 事实，测试按关闭后的完整历史比较。桥 0.41.0，SDK/store 不变。

- 模块 94：storage 插件可从运行中的原生存储 owner 导出所选会话闭包，沿用 Timeline 的已提交分支水位与不可变批次读取，只关闭新建目标 owner；源 SQLite 不被活复制或由 Node 打开，不重启源 daemon。桌面仅在原生释放确认后清理暂存，断连保留可能仍有 owner 的目录。真实 Native 用持续挂起的另一会话模型请求验证原连接、请求未取消/未重发，导出后请求正常完成，并检查选择范围、附件与冷选择/源完整性；两项联合归档流程通过（23s），双端类型、格式/i18n/lint 和 release 构建（3m02s）通过。桥 0.40.0，SDK/store 未改。

- 模块 93：原生归档支持按 Session 选择必要的 agent、祖先和子会话闭包，非默认 agent 的导出保留原生默认配置但不带入无关历史。筛选只读经验证快照的临时副本，输出独立快照；新接收端由原生存储 owner 初始化，增量恢复仅合并会话内容，不复制源端全局媒体任务。两个真实归档流程及三个媒体流程通过，完整 28 项 Native 回归通过（255s），两项 Electron 联合流程（48s）、7 项相关单元、生产主进程构建、双端类型及格式/i18n/lint 门禁通过。压缩 fixture 增加短末轮，使长历史实际进入 dim 可压缩区间，遵守原生保留最新轮的规则；未改预算或时限。桥 0.39.0，SDK/store 锁定不变。

- 模块 92：新增原生冷快照的独立文件传输层，使用 16 MiB 有界分块、不可变且带 SHA 的清单，支持乱序接收和进程重启后的缺块续传。完整文件经 SHA 校验后原子发布，空文件/只读权限保持，损坏的分块与收发缓存可从校验来源恢复；清单及路径/索引边界先验证，整个过程只复制不透明文件字节，不读取 Native SQLite。18 MiB 大文件及损坏恢复/边界回归、相关设备同步共 16 项测试、双端类型与门禁通过。这一模块提供传输层，HTTP 端点、会话 LWW 及原生导入事务继续接线。
- 模块 91：停机请求失败与退出未确认的结果在强制清理前记录；两阶段都失败时保留原始原因和清理错误，既有超时和冷存储门禁继续生效。新增可选生命周期诊断，记录阶段、耗时、PID、连接数及失败时至多 32K 字符的原生 stderr 尾部；Windows 的合成 Native 验收启用诊断，权限/工具等待失败也附带有界请求摘要。11 项生命周期/RPC 回归、两项真实 Native 联合（54s）、生产主进程及双端类型/格式/i18n/lint 门禁通过；无需修改或重编译上游 SDK。Native 0.37 的六平台整轮验收已全部通过，历史 Windows 超时继续用诊断追踪。
- 模块 90：桌面媒体任务视图通过原生 ModalityTasks 读取状态、列表、等待和取消结果，只返回任务/结果元数据；完整参数与可能包含原始请求的恢复句柄保留在 dim，桌面只取得句柄存在标记。独立媒体提交也按完整请求大小采用文件载荷。18 MiB 参考图片实际传入独立/会话视频请求，状态回复保持小体积，重启后两次任务均保留且没有重发，冷恢复仍可读取原生文件；原生媒体专项（32s）、完整 27 项 Native（237s）、两项 Electron（43.9s）、8 项相关单元、生产主进程及双端类型/门禁通过。断连错误包含 RPC 方法名，保留未知执行结果语义。桥为 0.38.0，SDK/store 锁定值不变。
- 模块 89：大体积媒体配置经 SHA 校验的文件载荷进入 Native Session 方法，外层 Session/branch 路由身份与文件内容必须一致；超过 64 KiB 的设置由原生 SessionFilesHost 分块保存，配置事实和设置回复只保留清单引用，媒体任务按需通过 FileStorage 还原。真实视频请求验证超过 4 MiB 内联阈值的参考图片完整传输、错误路由身份拒绝、临时文件清理及冷恢复后内容 SHA；媒体专项、完整 27 项 Native（260s）、两项 Electron 联合、生产主进程构建、双端类型和格式/i18n/lint 门禁通过。桥更新为 0.37.0，上游 SDK 与 store format 保持原锁定值。
- 模块 88：已生成图片的原生引用在视觉请求中解析为真实图片字节；请求按 dim 提供方要求使用 user-role 图片部分，原生 Timeline、事件身份和历史内容不变。私有引用从 wire 表示中移除，带提供方 continuation 元数据的文本保持原样；旧 assistant 图片也转换到可表达的请求角色。相同请求视图交给 ProductContextModel 的原生计数器，图片进入预算，声明的 context/output/阈值不变。桥 0.36.0，SDK/依赖/存储格式不变。Rust 预算回归、39 项相关单元、真实视觉 HTTP 发送图片而不泄露私有 URL 的联合用例（21s）、完整 Native 27 项（242s）、release（2m59s）、生产主进程及格式/i18n/lint 通过。实际 Electron 两例（44s）再次验证媒体与聊天/CLI/备份恢复/重启/会话读取/Inspector。模块 86 的六平台原生构建/打包验收全部通过；较新桥的矩阵继续运行。大媒体配置传输与其他产品接线继续实施。

- 模块 87：媒体结果改为 Native SessionFilesHost 拥有的 8 MiB 分块和小清单，复用原生 fork、删除/回收及增量归档的文件生命周期；没有改动 Native SQLite schema 或新增桥内查询。256 MiB 媒体输出不受原生单文件 16 MiB 上限影响，完整 SHA 校验后才向会话返回不可变文件引用。storage 插件通过公开 FileStorage 读取有界内容，桌面缓存支持新引用并保留旧任务引用。真实 Rust 验证 18 MiB 输出、多块读回、图片编辑直接读取原生引用、fork 后删除原会话仍保留文件，以及冷增量导入到无原媒体任务记录的 profile 后完整读回。桥 0.35.0，SDK/依赖/存储格式不变。定向 Native（24s）、完整 27 项 Native（260s）、双端类型、格式/i18n/lint、release（2m53s）与生产主进程通过；缓存/投影补充回归通过。实际 Electron 两例（46s）验证新文件引用呈现、缓存完整性及聊天/CLI/备份恢复/重启/read_session/Inspector。媒体历史送入视觉模型及大配置和参考媒体载荷按完整请求进入原生文件传输，超帧、重启和归档恢复已验收。

- 模块 86：图片/视频/TTS 会话以独立媒体 alias 接入 dim 原生 Agent 的作用域模型宿主，实际媒体模型保持非聊天声明。原生 loop、队列和 ModalityTasks 负责输入、执行、幂等、取消与文件；普通调用继续委托原生默认宿主。媒体设置按 Native branch 保存，任务只接收媒体字段。固定请求切点的已消费输入经公开 Timeline owner 读取，媒体保留该回合全部有效输入；Hook 排除 keyed 状态及无 key 的 dim 状态/规则封装，修复 macOS x64 实测提示词污染。桌面复用原有媒体组件，缓存经公开任务文件读取、大小/hash 校验后原子发布，供显示、保存/复制、附件、CLI/远程复用。桥 0.34.0，SDK、存储格式与依赖不变。完整 Native 27 项（243s）通过；桌面发现并修复 temperature 被媒体 schema 拒绝的问题，带默认聊天温度的媒体三例复验（57s）通过。131 项相关回归、双端类型/格式/i18n/lint、最终 release（2m25s）与主进程构建通过。完整 main 最终 8053 项通过、34 项按原条件跳过（243s）；初轮发现的过时技能/签名测试合同已修正，架构用例在无编译竞争下通过，未放宽时限。实际 Electron 两例（47s）验证图片呈现/缓存、聊天/CLI/备份恢复/重启/会话读取/Inspector；测试显示服务恢复后重新验收。媒体历史反馈与增量归档文件闭包继续实施。

- 模块 85：Voice.ai 与 APIMart 特有媒体协议接入独立 Rust ModalityAdapter，使用 dim 共享 Aimux 传输；任务准入、排队、持久化、取消、结果文件与恢复继续交给 dim。Voice.ai 保留产品模型/语言/温度/格式/voice 配置以及二进制、JSON/base64、URL 三种输出；APIMart 保留异步任务、端点和参数白名单、图像比例、视频参考与下载，语音仍复用 dim 默认适配器。扩展目录将 APIMart 路由声明持久化，Native alias 从公开管理 owner 恢复，不依赖 Node 内存缓存。桥 0.33.0，SDK 与存储格式不变，无新增依赖或 SDK 补丁。21 项相关单元、双端类型/格式/i18n/lint、生产主进程与 release（3m30s）通过；真实媒体联合（41s）验证输出、凭据 Header、参数过滤、取消与重启不重复提交，完整 Native 26 项（250s）、Electron 联合流程（36s）通过。标准媒体与特有协议分为两例，原各例 90s 上限保留；开发构建曾在追加协议前耗尽原整体 90s，未增加时限。媒体聊天会话和其他特殊协议继续接线/核验。

- 模块 84：通过 Electron 失败请求与产品 SQL 查明压缩问题的具体原因：刷新目录产生与显式自定义模型同 ID 的稀疏记录，目录优先查询抹掉声明的 32k/8k，桌面和 Native 实际采用默认 16k/4096。统一内容/路由查询优先采用显式自定义事实，暖缓存和刷新也不覆盖；保留逐 ID 数据库读取。两个存储模式的刷新/缓存回归、761 项供应商测试、双端类型/格式/i18n/lint、主进程生产构建通过。Electron 增加会话/Native 实际 32k/8k 断言，聊天/CLI/增量与覆盖恢复/故障回滚/重启/read_session/Inspector 全流程通过（41s）。未增加模型声明的预算、测试超时或修改 Native 压缩算法；SDK 与桥不变。

- 模块 83：物理删除 Node AI SDK 执行目录、七个供应商类的文本/流/向量/媒体推理、旧函数调用/XML 适配和 Codex/xAI/DeepSeek 网络包装器；移除 10 个运行时 SDK 依赖及专用 override。供应商类仅负责目录、配置、认证与模型管理，Ollama 下载和 Direct ACP 保留；纯 URL 规范化独立，DeepSeek 旧归档只读解码保留。公开连通性检查使用 Native 模型服务，26 个内置配置验证不构造 Node 推理实例；旧实现细节测试退役，Native 防回退、ACP、元数据与认证回归保留。759 项供应商测试、6 项旧消息读取、双端类型/格式/i18n/lint、主进程生产构建及完整 Native 25 项（239s）通过。Electron 聊天/CLI/备份恢复已运行，重启后两次 read_session 再现模块 80 的间歇压缩无法缩小；失败请求已留存，继续定位，未放宽窗口或超时。SDK/桥版本不变。

- 模块 82：修复实际 macOS x64 runner 暴露的 Hooks 输入来源错误：dim 的 keyed 环境状态也渲染成 User 消息，桥不能用最后一条 User 消息推断真实输入。Native frame owner 在当前 model-start 固定切点查询当前 turn 已消费的 input，排除尚在队列的未来输入及 keyed 状态，只提取真实 user 内容或无 key 的 operator raw；产品上下文适配采用该原生来源，Hooks 与记忆查询共用。桥 0.32.0，SDK 和存储格式不变。真实 Rust 在强制错误状态提示、追加未来队列输入和晚到 keyed 状态时，仍分别收到当前/下一轮真实输入；原有归档、取消、撤销、重启、换代和清空场景一并通过（32s）。99 项相关单元、双端类型及全部门禁通过；release（3m06s）、完整 Native 25 项（230s）、Electron 联合流程（41s）通过。提问夹具将 HTTP 答复已刷出和 Native/桌面问题投影分为两个现有 5 秒断言，整体测试时限保持；Windows 间歇提问延迟继续由新 runner 验证。桥 0.29.0 的 Linux x64、macOS ARM64、Windows x64/ARM64 四个平台完整打包离线验收通过；该轮 macOS x64 的上述输入问题由本模块修复，旧 Linux ARM64 下载失败已由下一轮 Native 成功验证覆盖。

- 模块 81：旧 Context Hooks 归档在历史迁移中转换为 Native 审计与观察事实，保留成功上下文、原 entry 来源及失败重试输入；started 转为 uncertain，被动诊断不迁移或执行。已转换的旧版本可经私有 Native 导入补齐，验证原 invocation hash、当前 owner/digest、声明事件和 generation，已存在 Native 执行事实不由旧归档覆盖。Native 冻结历史携带最新 Hooks 状态，普通换代保留，clear/fork 明确为空，避免旧 Tape 回流；显式重试先准备旧会话，再经原生进程 owner 执行。旧 Node 命令执行、Tape writer、context 投影与旧执行端口已物理删除，注册、撤销、更新屏障和产品环境准备保留。桥 0.31.0，无 SDK 或存储格式变更。真实 Rust 归档/uncertain/显式重试/上下文/换代保留/清空隔离/只读 Tape 联合通过（17s），283 项相关回归、双端类型及格式/i18n/lint 通过；release 构建（3m20s）、完整 Native 25 项（225s）和 Electron 聊天/CLI/备份导入/恢复/重启/会话读取联合通过（39s）。旧执行器测试由 Native 生命周期和归档验收覆盖，包导入、安全及更新回归保留。Windows x64 在桥 0.29.0 的 runner 已通过全部 Native 测试，确认 cmd.exe 参数修复；Linux x64 与 macOS ARM64 该轮打包/离线验收通过，Linux ARM64 下载基础设施失败待重跑，其余继续验证。

- 模块 80：SessionStart 观察事实由 Native 插件独立持久化，全部 matcher 跳过时也记录当前启动边界，恢复专用处理器在重启后只运行一次。启动、子会话和输入按事件顺序处理；恢复或压缩 matcher 不匹配时保留该处理器最近成功的会话上下文，原生内部子 agent 与普通 fork 分开。观察配置查询仍校验当前 scope、revision 和声明事件，不绕过实际命令 matcher。桥 0.30.0，SDK 扩展和存储格式不变。真实 Native 启动限定/压缩限定/恢复限定、既有上下文保留及取消/撤销/强杀恢复/重试联合通过（17s），完整 12 文件 25 项 Native 通过（218s），相关网关回归、双端类型、格式/i18n/lint、release 与主进程构建通过。Electron 联合首轮在重启后的工具读取遇到压缩无法缩小，添加失败请求附件后同一流程通过（48s）；该间歇失败仍保留诊断跟进，不提高预算或时限。旧 Tape Hooks 续接和旧 Node 执行器删除继续下一模块。

- 模块 79：已分配但未显式选择的私有技能可由当前 Agent 按需发现；产品只提供经授权的目录和显式选择策略，读取目录、SKILL.md 和执行脚本使用 dim 原生工具。完整目录通过 Native SessionFilesHost 发布为不可变的会话文件，内容 hash 去重，fork、备份、迁移和 GC 复用原生所有者；上下文只附当前文件指针，避免重复注入元数据挤占首轮预算。发布前后复核 Agent、工作区、选择和完整目录，撤销期间不采用旧指针；不将 Agent 私有根注册为进程级全局技能。桥 0.29.0，无新增依赖或存储格式变化。显式选择/按需发现两种真实 Native 场景通过（18s），私有文件位于工作目录外，跨多模型步骤只生成一份目录；24 项相关回归、双端类型/门禁和 SDK 离线图/边界/25 项插件文档校验通过。首次整目录注入触发首轮预算失败，改为按需文件并精简重复桥接说明；没有调整 Native 上下文限额。release 构建通过（21m10s），完整 Native 25 项通过（227s），Electron 聊天/CLI/备份导入/故障恢复/重启/会话读取联合通过（39s）。夹具仅在请求提供 read_session 时返回该工具，避免压缩请求误消费会话读取步骤；提问投影超时增加原生 pending/latest 诊断，原断言时限保持。Windows cmd.exe 的命令字符串通过原生 verbatim 参数传递，固定 hash 的第 12 个 SDK 代码扩展纳入来源清单；其余可执行程序和 Unix 行为保留，Windows 实际 runner 待验证。

- 模块 78：已声明的产品 Context Hooks 接入 Native Session 插件；DeepChat 仅提供经当前作用域授权、不可变版本验证的配置和旧 JSON 协议适配，命令通过 dim HostPlatform 的进程树 owner 执行。启动前等待 Timeline publication；取消、撤销和 Session close 等待整棵进程树结束才记录终态，重启只有 started 事实时保持 uncertain，显式重试校验当前版本、旧事实和原生分支空闲状态。启动/恢复/压缩、用户输入及子 agent 边界独立，单个输出 64 KiB、上下文 8 KiB、整体 10 秒预算保留；兼容小数秒超时及 DeepChat 工具链环境，Rust 再过滤环境，不传递模型凭据。诊断经 storage 插件读取 owned generations，新执行不写 Tape；原生 Hooks 保留上游行为。桥 0.28.0；首次真实 Rust 的上下文/去重/控制字段拒绝/取消/撤销/强杀恢复与显式重试通过（11.5s），46 项相关回归与双端类型通过。最终 release 构建通过（2m46s），压缩/工具链环境与过滤追加场景通过；完整 Native 24 项通过（205s），回执合并及超限输入边界调整后 Hooks 定向通过（5.7s），主进程复构建与 Electron 聊天/CLI/备份导入/故障回滚/重启联合通过（33s）。旧 Node Hook 执行代码在后续模块物理移除。

- 模块 77：DeepChat 现有 ChatGPT/Codex 登录通过产品凭据插件进入原生连接；dim 自身 managed OAuth authority 不适配或改写。固定 hash 的可选 ProviderConnectionHost 在原生静态连接校验与凭据解析后提供连接元数据/恢复端口，旧构造器依赖保持；仅 scoped Codex 引用启用，普通模型不增加回调。Rust 使用 dim 现有 Codex preset/请求规则和公开 RecoverModelConnection；产品只提供当前 token、账号与 client headers，Native 决定 401 恢复/重放与取消。账号 owner 原子比较被拒绝的 lease，并发/迟到拒绝只刷新一次；产品 grant、模型和配置身份在凭据工作前后重新校验。API Key 与 OAuth 模式身份隔离，draft 继续使用独立授权；base URL 复用现有产品规范化。桥 0.27.0；实际 Rust 辅助调用/401/账号头更新/聊天/标题/重启/取消/撤权及异步撤权拒绝通过（18s），旧 Timeline 前缀保留并允许原生关闭事实追加，未重写历史。41 项相关回归、14 项账号恢复 suite、网关授权/脱敏、双端类型/门禁、主进程构建与 SDK 模块/crate/插件文档通过；release 构建通过（13m28s），完整 Native 23 项通过（200s），Electron 聊天/CLI/增量导入/覆盖恢复/故障回滚/重启联合验收通过（36s）。生成图已验证从上一已知完整版本恢复原始图再应用新补丁，未知或部分状态仍拒绝。

- 模块 76：公开判断模型入口统一经过产品模型准入和 Rust decision 插件，Node Jev/Workers AI 判断执行器与旧解析桥已物理删除，目录发现、配置检查与非聊天类型保护保留。通过 dim 公开非聊天连接 owner 取得授权后复用 Aimux Jev model/decide；产品插件只转换旧 noul 参数、Workers AI 外层协议和缺省 usage，保留模型版本、confidence 与 score legend。原生负责验证、重试、deadline、网络与取消；取消关闭专属 caller 并 join，错误不返回凭据/原始 vendor 文本。Jev 仅增加可选 Fetch 配置 seam，缺省行为不变，精确源码 hash 入锁；网络复用 Native MediaTransport。桥 0.26.0；真实三类判断/轮换/Workers 包装/原生重试/无效额外答案拒绝/撤权/取消/重启通过（22s）。65 项目录/入口回归及 6 项迁移后端点授权保护回归、Node 类型、Rust locked check 与 SDK 边界通过；release 构建通过（16m44s），完整 Native 22 项通过（195s），Electron 聊天/CLI/增量导入/覆盖恢复/故障回滚/重启联合验收通过（40s）；判断模型误作聊天模型时在原生准入拒绝，零 HTTP。

- 模块 75：标题辅助模型偏好通过 Session scoped host 提供给 Native SessionTitle；产品侧只检查当前绑定和配置、登记原生模型，模型选择、请求、规范化与标题 CAS 仍由 dim 负责。无偏好使用原生策略，原生显式标题配置优先。标题 owner 对偏好查询、推理和发布持有原生活动租约，空闲备份拒绝中断，强制关闭取消并 join。桥 0.25.0；真实模型偏好/聊天模型隔离/重启/空闲拒绝/强制取消测试通过（14s）。SDK 模块图由离线 xtask 生成，原始与生成 hash 和精确补丁均锁定；模块/crate 边界与 25 篇插件文档通过，默认 SDK 目录检查缺少 embedding 凭据 host 的限制单独记录，未宣称整体通过。release 构建与 21 项 Native 覆盖通过：联合 suite 20 项通过，旧 Session 空闲断言按新增租约更新后对应回归通过（13s）；未修改备份拒绝/取消断言。41 项相关回归、双端类型/门禁与 Electron 聊天/CLI/导入恢复/重启联合验收通过（31s）。

- 模块 74：原生内部子会话经 storage parent link 核验当前桌面归属，从私有网关取得已选 MCP 配置；会话级插件只管理配置授权与原生资源 view，连接、发现、工具贡献、调用、取消与动态发布复用 dim MCP owner。新增固定 hash 的原生工厂在 Session 资源取得阶段准备首个目录；普通 temporary attach 仍等待 Session activated，不修改原有行为。后续更新仍由原生 worker 负责，配置撤销/变更关闭旧资源，授权续期和连接清理在 close 时 join。桥 0.24.0；20 项网关/归属/MCP/打包回归与 Rust check 通过，真实子 agent 首轮目录/工具调用/撤销联合用例通过（DEV 122s）；release 构建、完整 Native 20 项（221s）及双端类型/门禁通过；Electron 聊天/CLI/增量导入/覆盖恢复/故障回滚/重启联合验收通过（43s）。

- 模块 73：v3 Native profile 增量导入已接通。独立空 profile 的 storage 插件在 disposable staging 经 Native owners 合并，已有身份逐事件/trace/原子批次核对共享前缀后追加兼容尾部；分叉、创建记录或归属冲突拒绝安装，已有目标标题保留。原始备份只校验，查询使用工作副本。SQL 导入前校验绑定/归档 scopes 引用的全部 Native 会话确实在目标 owner 目录中；原有 journal 同时保护 SQL 与 Native 的安装、回滚和重启恢复。已有产品绑定/消息/Inspector 缓存保留本地游标并从 canonical tail 重建，另行保留导入旧代的只读归属，避免占用未来活动 generation。实际 Rust 重复合并/尾部追加/分叉拒绝、真正 prepareMerge/安装/重启/附件 GC/恢复后模型续聊与源备份完整性通过（41s）；37 项导入与恢复回归、共享 Native 身份游标回归通过。桥 0.23.0 release 构建、完整 Native 20 项（158s）、双端类型/门禁与 Electron 增量导入保留当前标题和消息、覆盖恢复、故障回滚、重启续聊（35s）通过。实时同步继续实施。

- 模块 65 runner 实测修正：Linux x64/ARM64 的 Native、实际打包、包内无网络 dim 与 OCR 均通过，安装包体积门禁发现旧 1.1.0-beta.4 基线不含 Rust runtime。x64 新增 dim 组件 gzip 77,296,084 字节，安装包实际增长 145.02 MiB，归档 138.51 MiB；据此显式记录 80 MiB 的新增组件预期，原有 90/112 MiB 剩余波动预算与 dim 独立 84 MiB 上限保留。macOS ARM64 的 Native/离线 dim 通过后，OCR 揭示未签名 verification 应用内的共享 Node 被重签，无法使用 enclosing-app seal；verification 现保留原 Node 分发字节与签名，distribution 仍重签并校验所属团队。Windows x64 原生 19/20 通过，仅问题弹窗投影断言失败：保留原 5s 断言，补 Native 问题/事件种类诊断，不输出请求正文与凭据。Rust 编译缓存改在 smoke 前保存，避免单个运行时断言丢弃已完成构建；每次仍重新 build --locked 并完整验收。

- 模块 72：备份记录原 Native home；独立空 profile 协调器在应用启动屏障内，通过 storage 插件对 staging 执行 SessionStore 输出归属重定位，未恢复任何 Agent，不发模型请求。原始 Timeline 不修改，恢复后的删除不触碰原 profile 文件。命令输出合并经 Native FileStorage 以 64 KiB 分块复制并比较已有文件 hash，保留原目录下的相对身份；内部 grant 与 context 路径按目标位置恢复。已验证真实 262,161 字节输出合并、跨目录覆盖恢复、目标删除与源文件保留，以及已有媒体/历史合并两项 Native 用例；9 项相关单元、Rust check、双端类型/门禁通过。桥 0.22.0 release 构建、完整 Native 20 项（172s）、Electron 联合验收（34s）通过。桌面离线恢复 fixture 改为使用真实 Native 协调器，验证包括故障回滚与重启续聊。SDK 只读会创建 WAL/SHM 的事实由临时工作副本隔离，原始校验清单不放宽。产品增量/实时同步仍继续接线。

- 模块 71：Native FileStorage 复制原生不可变会话附件并比较已有文件字节，再交给 SessionStore 原生归属写入器接纳原 file ID；原 schema、共享归属与孤儿清理器保留，插件不写 native SQL。SDK 两个固定扩展分别 hash 校验并固定 LF 检出，桥 0.21.0。storage scope 发布当前归属路径，上下文追加当前会话文件目录根，不修改历史绝对路径或扩大权限。实际跨目录文件/原始历史/重复合并/重启、孤儿删除而附件保留、目标侧模型恢复后续聊及源 DB hash 不变通过（23s）；31 项相关回归和双端类型/门禁通过。release 构建、完整 20 项 Native（169s）通过；Electron 联合验收通过（39s）。综合桌面用例原 30s 上限两次在末段重启触发，60s 诊断全部完成后，为包含 CLI/备份回滚/重启的单一流程设置 60s 总预算，各界面断言时限不变，标准命令复验 36s 完成。命令输出归属重定位与产品增量导入继续实施。

- 模块 65 macOS 签名清单修正：macOS ARM64 的 Native 20 项、打包与包内离线 dim 启动通过，随后 OCR 校验发现其原始 Node 分发 SHA 被错误替换为签名后 SHA。现保留 OCR 分发来源 SHA，继续由原有 enclosing-app signature 校验签名后字节；dim 的运行清单仍单独记录签名后的真实 SHA，不放宽任何校验。

- 模块 65 包体预算修正：六平台实际工作流中 Linux x64 的 20 项 Native 回归、打包及包内离线启动通过；OCR 测量发现旧政策仍要求独立 Node 为 0。实际 CI 测得 Node 压缩 49,895,032 字节、dim 压缩 77,268,592 字节；现为两者分别设置 56/84 MiB 上限，dim 从 otherRuntime 拆出，OCR 与 uv/cloudflared 的既有上限保持。移除不再成立的删除 Node 预期 -50 MiB，总安装包增长/缩小阈值不放宽。33 项包体回归和本地真实解包包的组件测量、OCR 初始化/中英文识别/退出（峰值 RSS 329 MiB）通过。其余平台继续实际验证。

- 模块 70：storage 插件新增冷 profile Timeline 合并原语，AgentRecords/SessionStore/TimelineStore 公开 owner 接纳归属与完整批次，保留原事件 ID、序号、trace、分支和标题；已存在会话保留目标内容，归属冲突与运行中目标拒绝。关闭后的完整原生历史/重启/重复导入真实验证通过（18s），双端类型与门禁通过。桥 0.20.0；release 构建、完整 8 文件 20 项 Native 回归（147s）和 Electron 聊天/CLI/备份恢复/重启/Inspector（31s）通过。文件归属接纳与产品增量导入继续实施，当前不开放不完整导入。

- 模块 65 Windows 校验修正：Windows x64 实际 release 编译成功（34 分钟），随后发现 Git 默认 CRLF 检出使 Cargo.lock 的精确字节 SHA 不一致。为锁文件声明 LF 检出，保留原 SHA 与构建后校验；不把换行差异归一化以绕过校验。

- 模块 65 依赖链接测量修正：Linux x64/arm64 实际 release Native 19 项及完整打包通过，后续 OCR 组件测量因 dim 的 pnpm 包内链接被拒绝。测量现仅为 dim 依赖树接受指向自身目录内的链接，外部链接继续拒绝，按实体文件计量一次。11 项相关回归、实际解包目录组件测量及双端类型/门禁通过。

- 模块 69：storage 插件新增关闭 profile 的分页归属目录读取，使用 Native AgentRecords/SessionStore 读取 Agent 配置、会话创建配置/父关系、标题、文件归属和权限；只读打开快照，不恢复 Agent 或访问私有表。SDK 仅公开已有归属 owner 类型，无 schema/loop/model/queue 改动，桥 0.19.0。实际三个关闭会话分页、原 Agent/标题/CWD、错误边界、源 DB hash 不变与零模型请求用例通过（9s）；34 项相关回归及双端类型/格式/i18n/lint 通过。release 构建、完整 Native 8 文件 20 项回归（134s）、主进程构建及 Electron 聊天/CLI/备份恢复/重启/Inspector 联合验收（31s）通过。macOS 子会话 CWD 回归改比较物理路径，保留目录身份验证。增量合并写入与附件搬迁继续实施。

- 模块 68：Vertex 通过独立认证桥复用 Google Auth 的服务账号/应用默认凭据及刷新，API Key 继续已有 owner；新增直接依赖与已有传递版本一致的 google-auth-library 10.9.1，不执行 Node 推理。公开配置投影只包含认证方式、区域/项目/版本与地址，按现有 SDK 规则保留 Express/custom-prefix，支持 standard/global/us/eu 路由；私钥不进入 Native 配置。Native 使用 Gemini driver 和 bearer/x-goog-api-key，scope 变化生成新连接并拒绝旧授权。1110 项供应商/凭据/配置回归、双端类型及格式/i18n/lint 通过；两种实际 Vertex Native 连接的流式/完成、禁用、重启、草稿、项目换代联合通过（19s）。主进程构建及 Electron 聊天/CLI/备份恢复/重启/Inspector 联合验收通过（29s）。没有新增 SDK 补丁或桥版本变化。

- 模块 67：新增仅负责认证的产品凭据桥。AWS 显式 key/session token、Profile 与默认凭据链由既有 AWS SDK 认证 owner 提供，刷新与过期仍交给该 owner；不在 Node 执行模型或 SigV4。空 Bedrock 地址按区域生成 Native 支持的官方端点，签名/请求使用 dim 原生 driver。Copilot 复用 DeepChat 登录 token exchange，向 Native 连接只提供短期 Copilot token，并保留集成 Header；缓存按 OAuth 身份隔离，处理过期、旋转与取消，错误不回传秘密。AWS Profile/区域与 Copilot client scope 进入不可变 Native 配置引用，准入前后重验，旧 owner 在重新准入后也不能借用新作用域。1100 项供应商/授权回归与双端类型、格式/i18n/lint 通过；四种 Native 连接分别实际通过，包含 Copilot 流式、禁用/地址变化/重启、草稿清理、client scope 换代拒绝旧连接及 profile 无明文 token。Native Bedrock 配置准入通过，没有向 AWS 发送推理。最终 Copilot 联合复验 8s，主进程最终构建及实际 Electron 联合验收（29s）通过。Vertex 与 ChatGPT/Codex 产品凭据接线继续实施，dim 自身 OAuth 不适配。

- 模块 66：独立转写等大媒体输入使用受管文件传输与独立 Native media-input 插件。插件通过公开 PluginFileTransactions 准备私有原始文件，把 node_path 交给 ModalityTasks；执行/排队/取消/恢复仍属于 dim。文件保留到 Native 任务终态，未知准入保留输入且不自动重送；启动等原生恢复完成后，按公开任务记录清理终态与未提交孤儿，卸载等待观察任务结束。提交使用独立连接保护准备阶段，避免备份按空闲停机。桥 0.18.0，无新增 SDK 补丁。18 MiB + 17 字节的真实转写、重复准入去重、取消、丢失回执及重启清理通过；完整 release Native 16 项通过（118s），独立连接最终媒体联合复验通过（24s）。15 项相关回归、双端类型及格式/i18n/lint 通过；主进程最终构建和实际 Electron 聊天/CLI/备份恢复/重启/Inspector 联合验收通过（30s）。

- 模块 65 离线探测修正：首轮 Linux x64/arm64 实际 release Native smoke 与完整打包成功；离线探测入口误把 pnpm 传入的独立 -- 当成未知参数。入口现接受该标准分隔符，原有参数校验保留；在禁网 namespace 中按工作流同样的 pnpm 命令，release 0.18.0 的 Rust/Node/独立插件及 Agent owner 启动与正常退出通过，31 项打包回归通过。Rust cache 改为在 Native 构建与 smoke 成功后显式保存，避免后续安装包步骤失败丢失已验证编译缓存。

- 模块 65 macOS runner 修正：macOS arm64 实际 release 编译成功，16 项 Native 中 15 项通过；剩余一项把 /var 临时路径与 dim 返回的 /private/var canonical CWD 作字符串比较。迁移与换代的 CWD 验证改为 realpath 后比较同一物理目录，保留 tools 身份断言；Linux 的完整 Native owner 联合用例定向复验通过。macOS 仍待新一轮实际 runner，不跳过该检查。

- 模块 65 发布验证修正：实际六平台 workflow_dispatch 已启动；Windows x64 发现 Git Bash 的 tar 将盘符路径解释为远程地址。安装器在 Windows 显式使用系统 ZIP-capable tar，并从 staging 工作目录传入相对归档名；保留原有 checksum、路径和链接校验。3 项安装器回归及格式/i18n/lint/双端类型通过，Windows runner 修复结果待新一轮实际验证。

- 模块 65：六个原生 OS/CPU 打包 job 统一安装锁定 dim release/插件并编译 release 薄宿主，固定 Rust 1.98.1 与目标 triple；构建/打包验证 ELF/PE/Mach-O 架构、源码/格式/版本锁、Native 和 Node hash、JS 入口与法律文件闭包。支持 Cargo target 子目录及目标缓存，Native 源码/锁变更进入打包影响分类。macOS 在主应用签名封存前签 Native 与 Node，写入最终 hash 并同步 OCR 的 Node hash，主应用避免再次改写这些二进制；运行期验证包内 Node。安装包只保留生产使用的 Native 宿主、Node 和插件依赖，移除未使用的官方可执行副本。新增独立包内探测，从临时工作目录启动复制后的 Rust/Node/host/storage 插件并访问 Agent owner、验证正常关闭，CI 限制外网。90 项打包/签名/影响分类/维护回归及双端类型、格式/i18n/lint 通过；主进程构建通过。首次完整优化构建耗时 27m36s；Linux release 的 16 项真实 Native 回归通过（111s），真实 Electron 解包安装包聊天/模型测试/CLI/备份恢复/重启/Inspector 联合验收通过（27s），复制后的包内原生/插件/Agent owner 在禁用网络的独立 namespace 中启动并正常关闭。其余五平台仍需实际 runner 结果，不将工作流配置视为已验收。

- 模块 64：辅助模型完成/流式请求超过 4 MiB 时改用受管文件信封，原 RPC 帧仍限制 16 MiB，不截断媒体；JSON 文件最多 256 MiB，目录在 DeepChat profile 的 rust/deepchat-payloads，0700/0600。Rust 插件只接受 UUID 文件名，通过公开 FileStorage 读取并校验长度/SHA-256 后调用原生模型 owner；拒绝篡改、路径越界和最终目录符号链接，系统路径别名先规范化。完成/取消关闭专用连接并清理文件；原生启动在数据库 lease 后清除前进程残留，备份排除此临时目录。薄桥 0.17.0，无新增 SDK 补丁。实际 18 MiB 音频完成/流式原字节 hash、取消上游、目录别名、完整性拒绝及重启清理通过（15s）；1174 项相关单元回归、格式/i18n/lint/双端类型和主进程构建通过；实际 Electron 联合通过（44s）。首次新增取消场景触及夹具默认 1s 等待，改用明确的 10s 文件传输观察窗口并消除悬空断言后复验通过；最终完整 Native 回归 7 个文件、16 项全部通过（279s）。独立转写的大文件路径仍继续接线。

- 模块 63：手动标题经 storage 插件调用 Native SessionStore 的公开 CAS 写入器，保留桌面较长标题的既有合同，不受 SessionTitle 默认 80 字共享上限阻止；自动标题继续由原生插件生成。原生存储广播、标题来源、并发版本与迁移幂等保持有效；拒绝空标题、控制字符和超过 64 KiB 的传输输入。薄桥 0.16.0，无新增 SDK 补丁。真实 Rust 验证超过 80 字的中文手动标题、非法换行拒绝及换代保留（8s），8 项标题/作用域/安装回归和双端类型、格式/i18n/lint 通过；主进程构建与实际 Electron 的 228 字手动改名、备份/两类恢复、重启续聊和 Inspector 联合通过（49s）。

- 模块 62：旧待发送草稿在首次续聊/修改时写入 dim 的非上下文兼容事实；被动浏览只读旧 SQL，claimed 归档按需转为显式 retry_required，不改旧档案。Native 插件支持 CAS 编辑/排序/删除/附件阻塞和操作幂等，重启从 Timeline 恢复。用户恢复/重试只准备输入并交给原生 Branch，InputQueue 负责全部调度，无桌面执行泵；稳定提交身份与 Branch.lookup 防止并发/丢回执重送。未重试旧用户行保留可见但不进入模型上下文；从 storage 插件读取旧消息身份，原生队列编辑/重排保留关联元数据，避免重复用户行。薄桥 0.15.0，无新增 SDK 补丁。6 个文件的完整真实 Rust smoke 共 15 项通过（310s）；追加验证已入原生队列的旧重试再次编辑后身份保留（11s），121 项相关单元回归通过；格式/i18n/lint/双端类型和主进程构建通过。实际 Electron 聊天、模型测试、CLI、备份/覆盖恢复/中断恢复、重启续聊及 Inspector 联合通过（50s）。

- 模块 61：桌面归档改用 ZIP64 的流式读写（yazl/yauzl，MIT），解决原写入器的 32 位文件大小、偏移和数量字段；按需打开单个输入流，zlib 与磁盘输出共同施加背压，异常关闭输入与输出。导入校验 CRC/大小与文件名，拒绝重复别名、越界及特殊文件；同步宿主直接查中央目录，只缓冲不超过 1 MiB 的 manifest，不扫描/解压 Native 大文件。保留 v1/v2/v3 包与 Native manifest 协议，不改 Rust SDK。实际 4 GiB + 17 字节文件写入通过，读取无损 ZIP64 长度（45s）；小数据的强制 ZIP64 完整解压、旧格式、损坏 CRC、异常源文件和路径回归通过。新增 smoke:backup 便于独立复验。全部 130 项 sync 回归串行通过，双端类型、格式/i18n/lint 和主进程构建通过；实际 Electron 备份/覆盖恢复/中断恢复/重启续聊 54s 通过。环境重启后使用 workspace 中已有 Xvfb 恢复 :89；首次桌面启动缺少 display 不计业务结果。并行重负载时一个真实文件 I/O 用例触及默认 10s 超时，串行复验通过，未放宽阈值。Native 增量/实时同步与跨目录附件继续实施。

- 模块 60：覆盖/增量导入统一使用持久事务日志，变更前在 profile 内保存产品 SQL/WAL 与设置原件及 SHA-256；Native staging 的 prepared/swapping/installed/rolling-back/restored 阶段先持久化再交换目录。启动在设置、SQL 与 Native owner 构造前恢复：未提交事务校验全部原件后回滚两侧，已提交事务保留新数据并完成清理；中断回滚可重复执行，原先不存在的配置恢复为不存在，快照损坏/越界或恢复异常保留文件并拒绝启动。提交先 flush 当前数据再持久化 commit，完成通知在提交后发送；备份 ZIP 也以 0600 创建并在发布前 flush 文件/目录。删去旧临时目录备份/回滚路径。备份遇 Native 短暂发布则在 30 秒内等候空闲，期间恢复读者、不取消任务；实际 Rust 用例验证后台 exec 跨两次尝试仍运行，显式 stop 后才复制（9s）。5 项持久中断场景与 136 项相关回归通过；最终 36 项数据/持久性回归复验通过。真实 Electron 将 SQL/设置变为不可读并留下未提交 Native 交换，再启动自动恢复，原标题、消息身份及续聊保留（46s）；ACP/Native 两项联合通过（约 75s）。修复测试夹具以真实聊天根节点识别主窗口，避免把临时启动窗口交给用例；保留失败 trace，应用日志证明此前已完成初始化。格式/i18n/lint/双端类型与主进程构建通过，无 Native SDK/执行实现变更。Native 增量/实时同步、跨目录附件与大型归档兼容仍继续实施。

- 模块 59：桌面备份格式升 v3，包含受管 dim profile 的不透明文件闭包（含 WAL、附件、命令/媒体输出），不解析 Native SQLite；v1/v2 legacy 包继续可导入。备份先暂停桌面 reader/标题订阅，保留提交 scope；等待现有 hydration 完成后进入共用空闲停机屏障，同窗口收集 Native clone 和产品 SQL，再恢复读者并离线流式打包。复制与 manifest 校验保留 Native 0400 不可变附件及执行位，只授予 owner 权限；拒绝符号链接、越界/重复路径、格式身份不匹配及散列损坏。导入改为有界流式解压；覆盖恢复先验证全部 Native 文件，再同盘 staging/目录交换，产品失败时回滚两侧；Native 回滚异常保留恢复目录/SQL 快照并阻止运行期重新启动宿主。SDK store format 从锁定源码公开常量核对进安装 manifest，不改 Native 执行代码。131 项 sync/生命周期/文件回归和新增恢复栅栏用例通过，最后 7 项权限/交换/栅栏用例复验通过；实际 Electron 验证备份、修改、覆盖恢复、重启续聊，消息身份及原标题保留，数据设置/Native 两项联合通过（52s）。格式/i18n/lint/双端类型、Native 装配及主进程构建通过。Native 增量导入暂显式拒绝，跨目录附件重定位、跨进程中断恢复及增量/实时同步继续实施，不将 P6 标为完成。

- 模块 58：storage 插件新增 Native profile readiness，读取各分支 Session.in_use（含 detached exec 活动 hold）、ModalityTasks 的 queued/running 及 ProviderService 的辅助请求。薄桥升 0.14.0；SDK 只新增公开 AgentIndex 的重导出与只读 provider 活动 getter，分别精确锁定源码 hash，不复制任务调度。空闲维护遇到任一 owner 有工作即拒绝，保留原连接与任务。实际 Rust 联合用例（66s）验证主回合结束后的自动标题 HTTP 仍存活、后台 exec 阻止复制、显式 stop 后允许复制，以及视频运行中拒绝维护。64 项相关回归、格式/i18n/lint/双端类型与主进程构建通过；桥 0.14 的完整实际 Rust smoke 14 项串行通过（262s）；数据设置与 Native 两项 Electron 联合验收通过（47s）。首轮重启后的窗口加载期间调试连接关闭，保留 trace；同代码独立复验通过。profile 文件备份/恢复仍在接线。

- 模块 57：冷 profile 维护可选择 dim 原生 daemon.shutdown.ifIdle，由 Native 原子检查其他连接、已附着会话及 main 上运行中的回合；daemon_busy 时保留主连接、作用域连接与运行工作，不进入文件回调，不强杀宿主。仅确认 graceful exit=0 才开放冷数据访问，未知退出状态也拒绝复制。三组真实 Rust 用例（56s）验证活跃连接保持可调用、busy 时无 profile 访问，以及空闲关闭后的启动屏障/恢复；3 项生命周期回归、格式/i18n/lint/双端类型和主进程构建通过。此入口供备份协调器使用，媒体/后台执行 owner 的空闲检查与 profile 内容接线仍继续实施。

- 模块 56：Native supervisor 增加共用的停机维护栅栏，先完成原生 graceful shutdown，再允许回调访问冷 profile；维护期间所有主连接/辅助连接的 start 等待同一屏障，维护串行化，失败时等待者在准入前明确拒绝。主 composition 的导入/重置维护在 SQL 恢复可用前保持屏障，随后恢复 Native reader、目录与产品后台服务，避免辅助模型在数据库关闭窗口重启宿主。3 项生命周期回归与三组真实 Rust 凭据/重启用例（58s）、222 项相关回归、格式/i18n/lint/双端类型及主进程构建通过。数据设置与 Native 两项 Electron（43s）验证失败导入后消息/标题不丢失、重启和续聊正常；原生 profile 的备份/同步内容接线继续实施。

- 模块 55：自动标题使用 dim SessionTitle/SessionStore，桌面不再重复等待首回合或调用辅助标题模型。独立私有 v3 会话订阅先 attach 再读 metadata；通知仅使 storage 插件读取失效，不伪造 Timeline 事件或周期轮询。手动改名调用原生 session.rename，产品投影同步标题及搜索索引；旧会话与各代切换以原生 owner 初始 revision CAS 保留名称和来源，幂等重试不能覆盖后续手动标题。绑定换代、关闭中的异步连接和通知撤销有回归。桥升 0.13.0，无新增 SDK 补丁。919 项相关回归、实际 Rust 技能/记忆/标题及关闭代复制用例（11s）、ACP/Native 两项 Electron（41s）通过；格式/i18n/lint/双端类型与主进程构建通过。桌面首轮在业务开始前遭遇 CDP promise 被回收，修复夹具：初始化检查在 DOM 就绪后、已登记进程清理的 try/catch 内执行，避免失败后遗留 Electron。桥 0.13.0 的完整 13 项 Native smoke 串行通过（231s），覆盖队列、MCP、子任务、权限、媒体及历史恢复。标题模型偏好与超长手动改名兼容仍继续核对。

- 模块 54：Memory 视图查询接通 Native storage 插件，按产品 Agent 与各代持久归属读取原生审计，不创建 Tape 或触发模型；旧 Tape 记录继续只读合并。用户消息由 input/consumed 事实关联真实 turn，按消息查询在固定水位的 canonical transcript 上解析身份；原生记录返回 nullable entryId 与无损 Timeline 坐标。分页按原生位置降序且固定 through，存储插件将声明的 sequence 比较操作数无损转为 u64；继承分支不冒充当前 owner，异步和最终返回前检查撤权。153 项相关回归、实际 Rust 技能/记忆联合用例（8s）、ACP/Native 两项 Electron（47s）通过；Memory scope/type 79 项、格式/i18n/lint/双端类型与主进程构建通过。

- 模块 53：被动 Trace manifest 与嵌套执行审计查询改为只读旧归档，不再为 Native 消息初始化 Tape。有 Native 绑定而内容插件未接线时，会话引用显式失败，不降级到旧 Tape 或触发初始化。新增实际 SQLite 回归验证两类诊断零 Tape 写入，以及缺少 Native owner 时选择/读取均拒绝；53 项会话/引用/原子性回归通过。格式/i18n/lint/双端 typecheck 与主进程构建通过；Electron 首轮在启动未处理异常后卡住清理，保留日志并清理该测试进程后，同代码独立复验（含模型测试、CLI、聊天/重启、引用和 Inspector）34s 通过。

- 模块 52：DeepChat 私有 Agent/项目技能的已选择内容，通过独立 DimSkillContext 接入 Native PrepareContext；产品 owner 校验当前分配、项目覆盖、选择和文件根，并在异步读取后重验 Agent/目录及选择快照，收据保存内容 hash。默认/项目技能发现、read、exec 继续属于 dim，不恢复 Node 技能执行器。旧 skill_run 指引替换为原生工具指引，内容 builder 升 v4。真实 Rust 用例完成已选技能注入、Native read + exec 执行技能脚本及 Timeline 收据（8s）；538 项技能/上下文回归通过。桌面验收发现整份未选目录占满固定上下文，修正为仅注入已选技能，并加入无选择时不读取/注入私有目录的回归；主进程构建、ACP/Native 两项联合验收通过（40s）。格式/i18n/lint/双端 typecheck 通过；Native smoke 脚本新增独立技能用例，现为 13 项。私有技能的原生目录注册、环境与策略兼容仍继续实施。

- 验证批次 51：按当前模块重新生成 schema 3 架构基线，全量 main 8312 项通过、18 项跳过，唯一失败为模块 44 已移除物理表访问后遗留的 databaseSecurity Tape 边界豁免。删除该过期豁免后 46 项 Tape 边界用例全部通过，没有放宽存储边界。Memory scope（78 classified/3 exempt）和 78 项类型门禁通过。后续产品接线继续进行，最终全量仍在完成剩余模块后复跑。

- 模块 50：聊天音频通过插件输入准备接入 Native auxiliary owner：公开的 MIME-bearing file source 在辅助请求中由 Aimux 转换为真实音频，先提取与用户问题相关的音频证据，再交给 dim Agent；保留原附件展示/追溯。实际测试确认当前 Native Agent image policy 会过滤音频，因此禁止直接把辅助音频形状交给 Agent，未修改 SDK 的该策略。音频准备截断、取消、会话/模型/目录/代次变化时不接纳输入；使用音频聊天模型的独立转写也走原生辅助调用，专用 ASR 继续 Native Modality。32 项相关回归通过，真实 Rust 用例覆盖原始音频 auxiliary、Agent 证据/工具、fork/retry/迁移与重启（112s），主进程构建、Electron 草稿/模型测试/CLI/聊天/重启/引用/Inspector 联合验收通过（31s）。格式/i18n/lint/双端 typecheck 通过。没有新增 SDK 补丁；大体积音频的文件传输仍待补齐，不将该模块计为全部媒体兼容完成。

- 模块 49：物理删除无生产入口的 Node SkillExecutionService、旧 SkillTools、cron 模型工具和 LiveDelegationAgentTool，以及对应旧执行器测试；项目技能隔离/引用测试改为直接验证仍在使用的 SkillService 公共管理接口。工具侧移除多余 Tape/cron ports、composition 接线与旧 cron prompt；桌面技能管理、Scheduled Tasks 服务及 CLI 子会话能力保留。清理 guard 阻止重新导入这些执行器。962 项工具/技能/边界回归通过，主进程构建、ACP/Native 两项 Electron 联合验收通过（43s）；格式/i18n/lint/双端 typecheck 通过。模块 48 的完整 12 项 Native smoke 已串行通过（227s）。

- 模块 48：图片、视频、TTS 与 ASR facade 均要求 Native Modality，删除 Node 媒体推理回退。视频优先复用 dim 默认适配器；当前锁定版本未提供的 OpenAI 兼容 /videos 协议以 Rust ModalityAdapter 扩展实现，任务准入、排队、持久化、恢复与取消继续属于 dim，网络复用 Native Aimux transport/guard。保留原请求选项、两种 body 格式、参考素材与提示词时长提取，流式写入有界结果文件，不持久化连接或响应 URL。实际恢复用例发现 Native Modality 在产品 adapter 就绪前读取可选绑定，通过公开插件装配依赖修正启动顺序，无新增 SDK 补丁。桥 0.12.0。1107 项 provider/CLI compute 回归、真实 Rust 媒体联合用例（含视频取消及重启不重复提交）通过；主进程构建、Electron 草稿/模型测试/CLI/聊天/重启/引用/Inspector 联合验收通过（35s）；格式/i18n/lint/双端 typecheck 通过。媒体聊天会话、聊天音频输入及特殊供应商仍继续接线。

- 模块 47：未保存 provider 草稿的生成式连接验证改走 Native auxiliary owner；临时准入和凭据只在内存中，测试不保存/启用产品 provider，不替换正在使用的实例。结束时先撤权并拒绝迟到回调，再用公开 provider.delete CAS 清理临时 Native 配置；重启时仅按专用命名空间及模型 UUID 标记清理可识别的草稿残留。1092 项 provider/草稿回归通过；三项实际 Rust 连接验证覆盖临时 key、清理、重启残留恢复及 profile 无明文 key。主进程构建和实际 Electron 草稿验证、CLI、聊天、重启、引用与 Inspector 联合验收通过（30s）。格式/i18n/lint/双端 typecheck 通过。

- 模块 46：非 ACP 的已配置文本调用、流、标题、摘要及向量入口要求 Native owner，缺少接线时显式失败，不再静默调用旧 Provider；物理删除 Node EmbeddingManager。ACP 辅助调用继续原 client。配置 key 升为 v2，认证权限 fingerprint 扩展形成新的不可变 Native provider identity，避免旧 grant 被就地重指向。1116 项 provider/CLI/辅助模型回归、模型授权回归、实际三种连接 smoke 通过；主进程构建及 ACP/Native（含实际 CLI 与模型测试）两项 Electron 联合验收通过（34s）。格式/i18n/lint/双端 typecheck 通过。未保存 provider 草稿验证及媒体旧回退将继续迁移。

- 模块 45：CLI streamChat 与显式/默认生成式模型测试转交 Rust 插件；模型配置默认值、reasoning 参数与辅助摘要指令进入 Native 请求。插件仅适配单次流，使用 dim 的公开 ModelSelection、ModelHost、ConnectionResolver 与 invoke_with_recovery，不增加 agent loop 或重试策略。采用原生 management.progress，序号和终态计数检测最佳努力通道丢帧，TS 队列有界、退出/取消关闭独立连接并等待请求结束。桥升级 0.11.0。无 key 的 OpenAI 兼容连接使用 Anonymous，带 key 的 Ollama 连接保留 Bearer，认证模式变化撤销旧 grant；Native 每次仍重验产品启用状态，admission 回执不进入 HTTP。69 项模型/CLI/流生命周期回归通过，三种实际连接的定向流/撤销验证通过；完整真实 Rust smoke 12 项通过（242s），包含 HTTP 未结束时收到增量及关闭连接取消上游。主进程与打包 CLI 构建通过，Electron 从 providers.testConnection、实际 CLI model invoke --jsonl 和聊天/重启/会话读取验证统一 Native 执行，24s 通过。格式/i18n/lint/双端 typecheck 通过。

- 模块 44：旧加密库在 MainDatabase 校验后、desktop services 构造前一次性解密；原加密库 checkpoint 后按唯一文件名保留 0600 恢复副本，空间预检、全部迁移表计数和 quick_check 校验，替换无法重开即恢复原库。文件已切换而 metadata 未写完时，下次启动验证明文文件后修复 metadata，无需再次输入旧密码。停用开启/改密码实现，旧客户端请求在进入数据库维护前拒绝；设置页移除持续加密表单，保留 OS 凭据保护与数据库修复。旧加密备份新增仅导入使用的密码参数，先在 staging 解密校验，再进入增量/覆盖导入；密码不持久化到配置。实际 SQLCipher 解密、恢复和备份转明文测试通过；142 项主进程回归、88 项界面回归通过。进一步移除通用重新加密分支后 18 项迁移回归和 Node 类型复验通过。完整 Electron 构建、主进程复构建、数据设置及 Native 重启续聊两项桌面验收通过（30s）；格式/i18n/lint/双端 typecheck 通过。Native profile 备份/同步仍独立待接线。

- 模块 43：按已批准的 Code Mode 暂停范围，物理删除旧 Node Code Mode runtime、utility host、协议、生成工具与打包入口，共移除约 4600 行源码/旧执行器测试。ToolService 不再创建或调度 Code Mode；Agent/Minimal 仅转交 owner 目录，Code 明确拒绝。架构门禁禁止恢复旧目录和运行器。435 项工具/权限/架构回归及格式/i18n/lint/双端 typecheck 通过；完整 Electron 构建和四项 ACP/dim 桌面联合验收通过（84s）。

- 模块 42：Native 会话引用使用独立产品 epoch，清空/删除会话撤销旧引用，普通代次更新保留引用身份。preview/search/context 读取 Native 同步后的有界派生索引，原始消息详情经独立 storage 插件从 dim 公开 transcript owner 读取，不以 SQL 缓存或 Tape 校验 Native 内容；授权在 Native I/O 前及每次 await 后重验，scope/generation 变化拒绝过期结果。保留旧历史读取兼容，不在选择 Native 引用时创建 Tape。48 项会话引用、投影和 schema 回归通过；真实 Electron 新建/重启/续聊用 Native read_session 连续读取列表和原文，31s 通过；主进程构建、格式/i18n/lint/双端 typecheck 通过。

- 模块 41：工具管理器缩减为产品扩展，移除旧文件、命令/进程、搜索、问题、技能发现/执行、调度与子代理派发入口；物理删除 Node 文件/命令/搜索/Minimal 编辑器处理器及模型侧 Tape handler。保留桌面浏览器、长期记忆、会话引用，并把图像生成、桌面设置与技能草稿管理纳入统一 ToolProvider 桥；图像结果的展示回执/预览随 Native 事实投影恢复。MCP 桥按会话工具偏好过滤，调用仍受版本与作用域 fence 约束。原生 smoke 新增 registry 临时 scope 清理、真实 Native exec 及 disallowedTools 拒绝/重新启用；10 项 Rust smoke 和 134 项产品/投影/边界回归通过。全量 main 为 8413 项通过、四项失败：旧数组顺序断言已更新为原生偏好合同，两个 mac 打包断言来自 shell umask 0077，架构生成遇到 10s 超时；标准 umask 022 下三套共 161 项定向复验通过，未修改产品打包或放宽超时。Memory 类型门禁 78 项、scope、格式/i18n/lint/双端 typecheck 通过。主进程复构建通过；四项 Electron 流程中三项一次通过，ACP 工作区一次性错误模拟遇到竞态，单独复验 30s 通过。遗留 Code Mode/调度/委派的无入口代码、其余 Tape API 及产品兼容继续清理。

- 模块 40：工具设置目录改读 Rust ToolRegistry 的公开定义，独立只读用途的临时 Native scope 不提交输入、不迁移旧会话，读取后由 Native owner 删除。旧工具偏好名称在共享产品元数据边界转换为 dim 名称；新会话策略、下一次准入及即时工具开关均采用 Native Permission owner 的 disallowedTools/CAS，禁用 provider 时也能重新启用工具，无需发起模型请求。Agent 设置、会话返回与草稿界面使用同一转换，避免界面显示启用而原生策略仍禁用。删除界面凭空构造的 Minimal 编辑器/进程/子代理工具，只展示 owner 发布的目录；Code Mode 继续暂停。桥升级 0.10.0。10 项完整真实 Rust smoke（含原生目录、旧偏好映射及无需模型准入的权限刷新）、461 项主进程、43 项界面回归、完整构建及四项 Electron ACP/Native 联合验收通过；桌面验收新增目录读取零推理、无旧问题工具与真实会话开关保存检查。格式/i18n/lint/双端 typecheck 与 Memory scope 通过。旧 Node 工具处理器的源码清理及剩余产品工具插件接线继续实施。

- 模块 39：物理删除旧 `src/main/agent/deepchat` 执行树，包括 Harness、loop、driver、调度、压缩和旧执行器；保留的产品默认值、Agent 配置仓库、Memory 策略、工具目录元数据及 CLI 合同迁至各自 owner。旧 Tape 迁移输入仅暴露只读查询。清理只验证旧执行器的测试和 Node verifier，原 test:harness:node/test:agent:eval 命令改验实际 dim Rust；CI 安装锁定工具链并构建薄 host。架构门禁禁止重新引入旧执行树，ACP 和 dim 边界继续独立。421 项保留合同、67 项架构、Memory 类型门禁 78 项、10 项真实 Rust smoke、四项 Electron ACP/Native 验收以及格式/i18n/lint/双端 typecheck 通过。全量 main 的 8604 项通过，仅两项旧 CI 命令断言失败；更新断言后对应 6 项复验通过。后续继续清理旧工具注册、剩余模型入口与产品迁移兼容，尚不宣称整体迁移完成。

- 模块 38：ACP 资源组装只构造 SessionResources/Registry，包含项目目录、身份、启用技能、工具缓存和 staleness fence，没有 generation、queue、模型或执行器状态。七个可复用的提示/目录/身份/状态/Hook owner 与对应测试迁出旧 Harness；工具目录和 hook 通知合同独立，ACP 不再从旧 loop/instance/runtime 导入实现。旧执行器通过窄资源合同复用产品代码，等剩余引用拆完后整体删除。更新架构 owner 路径与源目录证据，并将格式忽略限定到根 assets，确保新共享源码进入格式检查。477 项相关回归、87 项资源/架构复验、86 项资源/ACP 装配复验、主进程构建、四项真实 ACP/dim Electron 联合验收及格式/i18n/lint/双端 typecheck 通过。工具 Surface、Memory 产品策略和 CLI 合同是旧执行树的剩余外部引用，继续收敛。

- 模块 37：修复旧 DeepChat agent + ACP provider/model 兼容选择的创建与恢复。Manager 根据持久选择解析实际 ACP client descriptor，保留公开 shell agentId；首次初始化显式选择目标 client，设置由 client 单次创建，不进入 dim，不构造旧 Harness。后续发送、取消和恢复都选择 ACP client。目标必须是可执行 ACP agent，初始化不得覆盖已有 Native 绑定。辅助 ACP 文本调用继续使用桌面 ACP client，其余文本模型继续由 Native facade 执行。92 项 Manager/provider/lifecycle 回归、主进程构建、四项实际 Electron ACP/Native 联合验收及 format/i18n/lint/双端 typecheck 通过。现存 Native 会话跨 backend 切换仍需独立 handoff，ACP 资源组装与旧实例继续拆解。

- 模块 36：ACP client 的流消息聚合、刷新、终态、权限展示和请求脱敏改为共享桌面投影，直接依赖独立展示合同，不再导入旧 Harness 的 process/dispatch/types。旧 runtime 下四个纯展示实现及对应兼容入口已物理删除，测试迁至 shared；旧执行器暂时复用共享投影，等待后续整体删除。原方法、权限块、timing、状态、分段输出和脱敏逻辑保持，未增加模型或调度实现。533 项相关回归、主进程构建、format/i18n/lint 和双端 typecheck 通过。Electron 的 ACP 设置、composer warmup 与 Native 聊天/Inspector 三项通过；ACP extensions 用例的 Direct client 问答、用量及 child 展示通过，末段 ACP-as-provider 兼容入口未执行，已定位为主入口切换后的独立缺口，下一模块修复。ACP 的资源组装与旧实例依赖继续拆解。

- 模块 35：主入口 Inspector 查询、详情、导出及 head 订阅切换到 Native Timeline，旧 Tape 仍只读。独立 storage 插件通过 dim 公开 owner 补读固定切点历史和按 event ID 获取详情；产品 SQL 仅保存可重建的有界摘要/分组索引，不持久化请求正文或原始事件副本。Native sequence 保持 u64 字符串，列表数字仅为展示序号；缓存丢失重建更换 epoch，旧翻页与详情游标要求 reset。升级已有 transcript cursor 时先补齐旧前缀，防止实时投影跳过历史；个别和批量工具结果仅产生一次终态分组。保留现有过滤、分页、执行/工具分组、耗时、详情与支持导出，显示原始 Native 事件名和位置。被动查看旧会话不进行迁移。137 项主进程/Inspector 界面回归、10 项真实 Rust smoke、完整 Electron 构建、主进程复构建与聊天/重启/原生详情/Inspector 打开验收通过；最终格式、i18n、lint 与双端 typecheck 通过。Electron 首次在测试 fixture 的 DevTools 初始化阶段遇到 CDP promise 回收，清理该进程后复验 27s 通过。

- 模块 34：内部子会话在原生初始化时，通过 SessionStore 公开 creation_record 验证实际 parent link 并装载产品 ToolProvider；client 会话仍等待桌面持久绑定后显式刷新。产品 scope owner 与模型 frame 查询分开复用，子工具在执行前校验当前根会话代次、产品配置与调用子会话，拒绝未知 client、跨 scope 和旧代访问。profile.tools 按 dim 合同只挂载固定工具，产品扩展单独由 ToolProvider 提供，不移植 TS agent loop。原生 PermissionState 为无产品元数据的分支保留继承的 FullAccess 策略；显式产品 default 模式继续要求同意，Native deny 继续优先。真实 HTTP 证明首次子模型请求已看到产品工具，实际以子会话身份调用插件，并完成原生 write；6 项作用域/产品能力回归、10 项 Rust smoke、主进程构建、format/i18n/lint 、双端 typecheck 与 Electron 真实聊天/重启续聊均通过。桥 0.9.0，无新增上游补丁；原生 MCP 的子会话继承、子会话桌面记录/独立产品配置和目录动态刷新继续实施。

- 模块 33：Ollama 匿名连接也持久化产品准入引用，经公开 ProviderSecretHost 在每次请求重新检查启停、模型状态与连接指纹；确认值不会成为 HTTP header，API key owner 不参与匿名请求。锁定源码仅将 secrets.rs 的 Anonymous 早返回限定为“未声明引用”，保持无引用的 dim 原有行为，hash 记入 extensionPatches；桥升为 0.8.0。独立真实 Rust fixture 绕过后续 TS admission，证明缓存连接拒绝禁用 provider、禁用模型及替换地址，重启后仍检查，实际 HTTP 无 Authorization/准入值且不调用 API key owner。最终 10 项 Rust smoke、39 项目录/provider/安装回归、应用主进程构建、Electron 聊天/重启续聊、格式、i18n、lint 和双端 typecheck 均通过。

- 模块 32：知识库/记忆使用的 embeddings 与维度探测已接入 Native Rust 插件。连接通过公开 ModalityConnectionHost 按声明的 embedding.embed 授权，实际请求、重试和取消使用 dim 锁定的 Aimux；产品只分装有界传输页。Rust 遵守模型批量上限，并只在明确的 HTTP 400 批量拒绝后缩小批次；文本过长不重送，结果顺序/维度/有限值和响应大小有界。保持维度失败 DTO 与取消语义，生产入口不回退 TS embedding provider。真实 HTTP fixture 覆盖 35 条结果、供应商批量拒绝、维度、长文本拒绝及取消；39 项 provider/目录/辅助回归与 37 项 dim 单元回归通过。完整回归中并发资源争用暴露旧长用例 120s 预算和新增请求启动默认等待过短，原生长用例隔离复验 86s 通过；smoke 文件改为串行，新等待显式采用跨进程预算。最终 9 项 Rust smoke、Electron 真实聊天/重启续聊、format/i18n/lint、双端 typecheck 和 Memory scope 检查均通过。桥 0.7.0，不新增上游补丁；视频和特殊 provider 兼容、工具/子会话、Inspector、备份及旧执行器物理删除继续实施。

- 模块 31：桌面图片生成、TTS 与独立 ASR facade 接入 Native Modality；保留现有配置合并、产品限流和结果 DTO，实际 HTTP、任务排队、文件与取消由 dim Rust 持有。结果通过公开任务文件分块读取并核对 hash，不读取 Native 私有数据库。Native admission 结果未知时保留 clientTaskId 并直接报错，不重送或回退 TS provider。真实 HTTP fixture 验证尺寸、质量、背景、格式、voice/speed、转写、任务取消和重启恢复；36 项相关单元回归通过。视频、向量与旧聊天音频转写兼容仍需后续接入，不能把本模块计为全部模型迁移完成。

- 模块 30：原生插件通过 SessionStore/TimelineStore 公开 owner 提供 readonly creation origin、父 Session、CWD、模型与 title/revision，并通过 TreeCommands 查询模型请求实际所在的 branch；用 QueryEvent.position 排除其他分支继承的历史前缀，游标以字符串返回。产品 context 逐级核验原生 parent link、拒绝未知 client/环路/旧代父 scope，并在 I/O 前后校验当前 desktop generation；原生请求附带实际 agent profile 身份供后续产品配置映射。main 已接入 resolver。实际由 dim 的 agent 工具创建 member，并证明 member 在继承目录内发起真实模型请求；DeepChat 不创建、调度或调用 member 模型。7 项作用域/网关单元、9 项 Rust smoke、存储插件路径的真实 Rust 复验与 Electron 聊天/重启续聊通过；format、i18n、lint 与双端 typecheck 通过。桥版本 0.6.0，装配补丁不增加。Native 子会话的桌面展示、独立产品配置/MCP 继承、profile/context 细化继续实施。

- 模块 29：主 composition 改为 createDimAgent，旧 harness 不再实例化；会话、队列、交互、配置、消息编辑/重试/清空、记忆 context/提取/证据与销毁走 Native owners。持久绑定恢复只附着已接纳的 Native scopes，不在启动时转换旧会话；数据库维护先关闭 Native readers/租约与宿主，恢复后再附着。辅助文本通过 DimAuxiliaryModels 接入 ProviderRuntime 的产品 facade；媒体、向量和特殊推理仍需继续迁移。新产品工具目录直接复用桌面浏览器/记忆/会话引用处理器及产品管理 MCP，不导入旧 AgentToolManager、ToolSurface 或内置文件/进程/搜索/skills/agent/调度工具。标准 stdio MCP 只映射命令、工具链与环境后交给 Rust；显式 CWD/隔离环境走产品兼容桥。原生 fork 固定来源 cutoff、为目标生成独立展示身份并导入 Native owner，持久 mutation intent 支持中断恢复，删除分叉不影响来源。新增 Electron 真实产品会话/重启续聊用例，在虚拟 X11 显示中执行。9 项原生 smoke、64 项入口/工具/模型回归和 100 项产品生命周期回归通过；完整构建和 Electron 真实聊天/重启续聊验收通过；format、i18n、lint、双端 typecheck 与 Memory scope 检查通过。下一阶段处理原生内部 branch/child 的产品作用域、剩余模型/skills/hooks/Inspector、备份及旧代码删除。

- 模块 28：Memory coordinator 改用会话读端口、异步来源和审计端口，不依赖旧 harness registry；保留原注入/提取/分块/失效/排空策略。新增 Native memory 组合和 settled Timeline 来源，读取固定已结束回合，不把活跃回合提前提取；旧代证据通过 dim storage owner 读取。来源 JSON/DTO 同时支持旧数字 Tape 引用与 dim 的不可变视图（u64 字符串、messageId），现有来源界面保留展示。原生 memory audit 走 retirement 共用 lane，持久回执有独立 timeline 地址，不写 Tape、不进模型上下文，桥升为 0.5.0。作用域销毁/失效会取消提取的模型端口并拒绝迟到写入。真实 Rust 验证 settled 来源、关闭代次证据和审计隔离；9 项 native、982 项 Memory 行为、375 项旧入口回归、78 项 Memory 类型门禁通过，分页的 50k 数据夹具在 30s 预算下通过，format/i18n/lint/双端 typecheck 通过。删除要求重新激活 Code Mode 的过时旧用例。Native memory 组合和来源读取仍待主入口接线，Native 子会话/分支的产品能力继承与 Inspector 继续实施。

- 模块 27：Rust 产品上下文插件实现 dim 公开 PrepareContext，在原生请求边界获取新上下文；只追加文本，不改变固定历史前缀，预算/压缩仍由 dim 负责，回执进入原生 ModelCall metadata。Native cancel 关闭回调并终止产品准备，不发起推理。新增显式 per-Session host factory 装配扩展，从原生 SessionIdentity 获取身份而不依赖可复制的模型 metadata；独立源码 hash 纳入 extensionPatches，桥升为 0.4.0。产品侧通过 storage 插件查询 step/model-start，校验请求、分支、u64 cutoff 与 generation，前后重验产品授权，拒绝旧作用域注入。9 项原生 smoke、补充实际 owner 查询/取消/更代组合回归和 808 项 main 回归通过；format/i18n/lint/双端 typecheck 通过。具体 memory/skill/hook 内容与主 composition 接线继续进行。

- 模块 26：自定义 HTTP Header 改为不可变不透明引用，调用时通过 ProviderSecretHost 临时读取；Header 轮换/删除撤销旧连接，匿名 provider 的 Header 也有独立准入，原生配置和 Timeline 不存明文。薄桥 0.3.0 在 Provider 装配的两个精确 seam 启用引用解析，loop/驱动不变。新增产品附件准备 facade，保留 OCR/PDF 选择、图片、引用、展示数据和 retry 的历史 representation，阻塞/取消不提交；音频等待 native media 接线，不能静默降级。组合工厂的真实 HTTP 测试改用该输入端口。9 项原生 smoke、额外组合回归与 1092 项 main 回归通过；脚本回归以 umask 022、30s 架构扫描预算通过，format/i18n/lint/双端 typecheck 通过。主 composition 仍待切换。

- 模块 25：抽出附件/引用/用户输入格式化为无执行职责的共享模块，ACP client 不再为此依赖旧 context builder；保留现有 OCR/PDF/文件显示规则，去掉旧 Code Mode 引导。新增辅助模型 facade，先进行产品模型准入，再将 system、文本/图片与工具历史转换为 dim 原生合同，配置默认值和取消边界保留；provider replay 与无效工具参数拒绝恢复。真实 Rust/HTTP 验证辅助调用与参数，3 项合同测试、348 项 context/ACP 回归及 format/i18n/lint/双端 typecheck 通过。主 composition 与音频原生接纳仍待完成。

- 模块 24：原生媒体适配插件从 dim ProviderService 的公开 metadata 重建 UUID→vendor 名称映射，模型连接和全部执行仍委托 dim Modality/MediaAdapter；恢复时坏 provider 不阻塞其他会话。产品模型目录声明媒体操作和非聊天类型，防止图片等模型误进入聊天选择。新增仅提交/等待/取消/读取结果的 DimModality facade，结果有界分片与 SHA 校验，保留未知提交身份和未知取消结果。薄桥版本升为 0.2.0，旧二进制会在 manifest 握手被拒绝。真实 HTTP 验证图片、TTS、转写、幂等、取消、重启后从 dim owner 恢复映射/任务及凭据轮换；9 项原生 smoke 与 1182 项相关 main 回归通过，format/i18n/lint/双端 typecheck 通过。媒体会话/产品辅助调用入口与其他 provider 的完整兼容仍待接线。

- 模块 23：组合工厂接入原生 MCP 临时绑定与桌面授权续期，配置撤销/凭据轮换/Session 更代时卸载旧绑定，不转发 MCP 工具调用到 Node。新增选中配置导出与临时 OAuth token 解析，in-memory/产品管理进程明确保留兼容入口；stdio 环境与主 composition 仍待接线。删除 JS 工具目录重载实现，改用 Session scoped Rust ToolProvider，目录无效时撤回，禁止覆盖原生工具，ToolHandler 复用私有产品授权网关；等原生 ToolBinding 的公共 PromptSnapshot 采用全部当前 source 后再返回，解决目录更新后立即提交的竞态。真实 Rust 验证目录替换、原生工具同名拒绝、取消、MCP 凭据轮换/禁用、共存和宿主重启；8 项原生集成与 1179 项 dim/session/MCP/installer 回归通过，format/i18n/lint/双端 typecheck 通过。

- 模块 22：新增 createDimAgent 统一组合设置、迁移、generation、队列、交互、context 与现有 backend contract；新 history 容器可登记禁用 provider 的 metadata，但真实提交仍必须通过严格模型准入，凭据读取继续拒绝禁用状态。实现全代原生删除及关联 cache/metadata 原子清理。组合验证发现并修复 JS 工具目录被误当作全局服务的问题，改为 Session scoped shared service；导入/提交封口回执等待原生 publication，防止绑定安装越过未落盘的 history seal。重试保留原用户行，仅暂缓其上下文；真实 retry 替换一次，取消后由下一条普通输入通过 native Append 恢复历史。验证宿主重启、异步 retry hook、实际插件工具执行、两 Session 的不同目录、全部 generations 删除且保留其他会话。8 项 native 与 951 项 dim/session/data 回归通过；补充重试预先停止/队列保护后定向原生回归再次通过，format/i18n/lint/双端 typecheck 通过。该工厂尚未替换主 composition，fork、legacy 草稿、MCP/附件/memory 等完整产品接线继续进行。

- 模块 21：新增只读 legacy 来源选择器，在同一 SQL 快照中合并有效 Tape 与旧 SQL 专有消息；Tape 编辑/撤回优先，陈旧缓存不复活删除内容，pending assistant 保留给 importer 转为中断历史。快照捕获 summary 边界、旧队列 payload 与附件转换结果，摘要边界随 retain generation 保留，历史修改则重置。Rust import 分离完整展示历史和模型上下文：边界前的消息仍可查看，但只追加原摘要和边界后的消息给原生上下文。真实 Rust 证明摘要生效、旧工具结果保留且被摘要覆盖的原用户消息不重复进入模型请求；8 项 native、890 项 dim/session 回归和双端 typecheck 通过。旧 queue payload 已保存在 native 快照，其兼容草稿恢复入口与主 factory 仍需接线。

- 模块 20：新增 native transcript mutation adapter，并在产品 mutation coordinator 提供明确的 native 路由；编辑/删除/清空/重试使用 storage 插件读取和 generation controller，不调用旧 Tape writer/runtime。重试先移除原用户消息及其后续内容，再由 Rust 接纳一次新 input；非上下文展示事实保存复用的消息 ID/顺序/时间，读模型可完全从原生事实重建该身份。submission intent 包含复用身份，重复提交复用旧回执。history preparation callback 改为可等待，确保异步切换完成后才提交。真实 Rust 验证模型只收到一次重试消息、消息身份/时间保持、全代归属，以及禁用 provider 时编辑/清空不调用模型；8 项 native、200 项 dim/session 回归与双端 typecheck 通过。fork、有效 legacy 来源与主 composition 继续接线。

- 模块 19：实现目录/工具创建身份变化与 retain/edit/truncate/clear 的 generation controller。产品 mutation intent 记录来源、固定 cutoff、目标身份和进度；Rust 原生提交封口与队列空检查共用 admission lane。目标先获得持久归属，再由 native import owner 导入并封存；停止/关闭旧执行实例后只读其存储，最后把消息缓存、绑定与各代归属同事务切换。重启复用已封存目标，不重复创建或导入；旧消息 ID 和图片保留，历史修改丢弃旧 summary。纯数据变更从原生来源复制模型设置，不要求 provider 启用。真实 Rust 验证切换前中断/重启、目录、后续模型上下文、编辑、清空、队列保护及 provider 禁用。8 项 native、950 项 dim/session/data 回归先通过；新增归属约束后调整旧替换回归使用真实原子切换，相关 78 项和 8 项 native 再次全部通过，format/i18n/lint/双端 typecheck 通过。主 composition 与 transcript controller 接线继续进行。

- 模块 18：存储插件通过 dim 公共 SessionStore/TimelineStore owner 读取关闭会话的完整 committed Timeline 和 submission 回执，不恢复 agent、不直接访问 native SQLite。新增隔离的 transcript 重建入口供目录切换、编辑与 fork 使用，保持固定 through 和原生 u64 游标。桌面通知改为历史失效信号，持久游标只由按序历史读取推进，避免跨进程乱序造成内容遗漏；加入乱序与缺失通知的回归。真实 Rust 验证关闭后历史与读模型一致、旧回执可查询且没有新模型调用；8 项 native、8 项相关单元回归与 node typecheck 通过。完整 generation controller 和主入口仍在接线。

- 模块 17：原生插件新增持久提交封口；与产品提交/队列控制共用 native lane，封口后新输入明确拒绝，既有 submission lookup 仍返回原回执。Rust 装配下的所有 Runtime 提交统一经过插件，展示 metadata 可选，不再让无 representation 的输入绕过封口。封口确认后，仍不存在的旧未知提交才能标记拒绝。新增只同步 committed facts 的 reader 方法，取消后同步桌面状态，并读取 native 创建时 cwd/tools。真实 HTTP 阻塞期间验证同步不等待 agent，8 项 native、19 项相关回归及 format/lint/typecheck 通过；验证封口幂等、重启、旧回执和拒绝后无新模型调用。generation 切换的 controller 继续接线。

- 模块 16：新增 Rust history import 插件，非上下文快照分块逐块/整体 SHA-256 校验，通过 Branch.input 的 Append 模式提供历史上下文，完成标记前阻止产品新输入。桌面只持久导入身份/进度，未知回执通过 native status 恢复；完成后不再读取 legacy 来源。导入快照可重建现有消息/附件/引用/metadata 读模型，旧待确认交互退为历史，保留原消息 ID 且防止跨产品会话覆盖。初次接纳时保留相同消息的 legacy sidecar。真实 Rust 验证损坏分块拒绝、中途退出后恢复、Unicode 分块、导入不调用模型/不重放工具、首次新回合，以及丢失缓存和桌面回执后的 native 重建。8 项 native 和 952 项 dim/session/schema/install 回归通过，format/lint/typecheck 通过。主 factory、有效 legacy Tape 来源选择、legacy 队列/图片准备及 mutation/目录变化的 rollover 继续接线。

- 模块 15：新增 storage 插件的固定边界最新事件读取，context usage/manual compact 委托 native owner；compaction 快照与事件保留原生 session/branch/event/u64 字符串位置，Tape 专属 evidence 字段为空。固定 through 的读取与读途中 generation 检查防止混合或过期快照；桌面投影新增 committed-event 观察口。真实 Rust 验证 context 上限、占用、手动压缩成功及未转换会话的被动读取。8 项 native 通过；session/contracts/dim 的 930 项先通过，发现一项旧 Code Mode 预期与已批准的停用行为相反，更新后该 9 项 table suite 全通过（合计 931 项）。format/lint/typecheck 通过。

- 模块 14：桌面会话改走原生 session.create（sessions.launch 是非交互委托入口），ask_user 的 1–4 题、多选和自定义答案直接提交 native question.respond；审批直接交给 native approval.respond，取消由原生事实清除等待卡片。通过 Permission advisor 表达 DeepChat 默认模式的 mutating-tool consent，Rust 继续决定准入、确认后执行与取消；修正 full-access preset 名称。交互界面复用原控件，新增 native 批次表单，不移植旧 question executor。真实 HTTP 模型 fixture 验证原生提问、非法答案拒绝、多选/自定义、write 审批及取消；8 项 native、489 项 main、7 项 renderer 通过，format/i18n/lint/typecheck 通过。

- 模块 13：队列 UI controller 直接读取 native Timeline，编辑/排序/删除/steer 通过 Rust 插件调用 InputQueue.withdraw 与 Branch.inputs；扩展事实只保存控制日志和展示信息，不建立第二个执行队列。操作身份支持重复请求，分阶段日志在 branch 加载和后续提交前恢复；已开始输入返回冲突，恢复只重送确认撤回的输入。真实 Rust + 阻塞 HTTP fixture 验证排序、编辑、删除、steer、重复命令及重启后去重；8 项 native 集成和 18 项 dim/desktop 状态回归通过，format/lint/双端 typecheck 通过。附件准备阻塞的产品草稿处理与主 factory 仍在后续接线。

- 模块 1：锁定 alpha.21 六平台 release 与 rutis 0.19.3，新增 `installRuntime:dim`、冻结插件运行时依赖、两个独立插件模块和安装完整性回归。Linux x64 的首次安装、重复安装以及托管 Node 已验证；其他平台尚未执行。
- 模块 12：新增内置 backend 的 dim 提交 facade、桌面事件发布与设置 controller；把无执行职责的 output/sessionUpdates 移到 shared，ACP 不再从旧 runtime 导入这些视图合同。native Agent profile 按内容身份复用，模型切换/并发设置采用串行配置命令，context/output 上限及 timeout 由 native 配置采用。真实 Runtime 证明 persona/参数/上限进入 Rust 请求，模型切换与并发设置一致，原生事实产生 stream/status/usage 与通知；302 项 ACP/共享视图回归通过。主 composition factory 仍未切换，完整队列/交互/迁移和生命周期 controller 正在继续接线。
- 模块 11：产品输入的展示信息写入 dim 的非上下文扩展事实，输入本身仍走 Branch.input 并保持 submission 幂等；拒绝 malformed representation 与外部 handover。storage 插件接入完整 committed Timeline 读取（公共 history 会过滤扩展事件），保留 u64 游标与固定 through。桌面消息/附件名称/原文本/引用可从 native 事实重建，输入消费/撤回清理暂存缓存。真实 Runtime.submit、重复提交、Rust HTTP 请求不含展示元数据、重启后清空缓存再重建均已验证。
- 模块 10：引入产品模型目录适配和持久非密钥 provider grant，现有 provider/model 设置转换为 native provider 与 capability snapshot；密钥仅采用引用。回调按 provider/model 的当前启用状态、连接身份及引用重新授权，支持凭据轮换并在禁用或换地址后拒绝旧授权。真实 Rust HTTP fixture 已改走此目录，SQLite 重开与撤销回归通过。生成参数映射只生成 dim ModelConfig；OAuth 特殊连接、媒体/向量及主 backend 仍在后续接入。
- 模块 9：新增锁定 alpha.21 source commit 的 Rust 插件装配，设置走 Branch.configure、扩展辅助调用走 native auxiliary_model owner；启用原有 ProviderSecretHost 注入依赖。凭据通过私有网关按引用读取，值不落 native 配置。构建清单核对源码、锁文件、二进制 hash 和桥版本，明确区分官方 release alpha.21 与源码 package alpha.18。Linux x64 的 8 项集成检查通过，含真实 HTTP 参数/取消、凭据引用、重启和 profile 全文件无明文密钥检查。产品 settings/backend 接线与其余平台构建仍待完成。
- 模块 8：实际停用 Code Mode 的选择入口；遗留 agent/session/model-catalog 的 code 值不再进入执行模式，回退为可用 Agent/Minimal 选项。删除 Code 专属工具分组与权限提示；旧 Code executor 文件随 P8 一并清理，不接到 dim。相关 renderer 与配置兼容回归覆盖该行为。
- 模块 7：固定 Session 控制命令接入 native owners（队列/原子 withdraw+steer、权限 CAS、模型/上下文、问题/审批、fork），区分 v3 safe-integer 命令与 u64 内容游标。消息只在 dim input/applied 后进入桌面读模型，缓存尚未应用的输入事实；fork/branch 复用事件 ID 时使用作用域消息身份，工具 call ID 按 request 区分。原生队列/权限/fork 与消息顺序回归已加入，完整 backend/队列编辑 UI 仍待接线。
- 模块 6：将无执行职责的 generation settings/模型事实/数值边界移到 shared；引入 DesktopSessionState，让 Direct ACP 的设置和 identity 不再依赖 built-in harness，ACP 的协议、进程与事件仍使用原 client。新增无 Tape/无 dim 会话的 ACP 状态持久化与并发模型切换校验。内置 backend 继续在 P2 实施。
- 模块 5：host 插件新增独立模型 row，通过 dim 原生 provider management 接纳配置，通过 auxiliaryModel service 执行辅助调用；隔离的调用连接取消时仅终止对应辅助请求。真实 Rust provider + 本地 HTTP fixture 验证 agent/auxiliary 两条路径、凭据不进历史、配置重启幂等与流请求取消。现有 Provider 设置、媒体及辅助调用者仍待接线。
- 模块 4：私有产品能力网关、Session toolRegistry 注册、工具目录版本校验与按 Session 重新挂载、取消与断线撤销。真实 release 验证工具执行/目录替换/取消/重启，并用真实 step/tool-\* 事件验证 UI 工具投影。产品 MCP/知识库/CUA 服务目录尚未接线，不把此模块标为 P3 全部完成。
- 模块 3：原生事件订阅、有界补页与 raw timeline query；持久 app/native binding 与 submission intent；消息、工具、审批与 usage 的 SQL 读模型投影。消息和 cursor 同事务提交，旧 reader 被替换后禁止写入；断线可重连同一执行进程，accepted input 不重发。真实 release + SQLite 验证重启后身份/历史/提交幂等，投影失败回滚与恢复。完整桌面 backend、工具配置与迁移仍在后续任务。
- 模块 2：实现 `DimRuntimeSupervisor` 与 `DimPluginClient`，使用私有 socket/pipe、受管 Node、版本/profile/readiness 校验、并发启动合并、graceful shutdown 及进程树兜底；新增 `smoke:dim` 原生集成检查。主应用尚未接入，P2 队列 UI、P5 migration 等任务保持未完成。

## 方案验证记录与 PR 状态

[PR #2511](https://github.com/ThinkInAIXYZ/deepchat/pull/2511) 面向 `dev`，包含桌面入口切换、两插件集成和旧历史按需迁移。当前候选提交结果以 [PR Checks](https://github.com/ThinkInAIXYZ/deepchat/pull/2511/checks) 为准。合入 `dev` 的 Wiro AI 保留 `/v1/models` 凭据验证与目录读取，模型推理复用 dim 的 OpenAI 兼容驱动。HTML 对话导出保留用户文本中的字面花括号。

`73a2e8a67` 的六平台任务均通过 Native 回归、打包、离线启动及安装包大小检查。

| 平台 | x64 | ARM64 |
| --- | --- | --- |
| Windows | [通过](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/42923291616/job/130203675995) | [通过](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/42923291616/job/130203676066) |
| Linux | [通过](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/42923291616/job/130203675984) | [通过](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/42923291616/job/130203676098) |
| macOS | [通过](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/42923291616/job/130203675821) | [通过](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/42923291616/job/130203676296) |

同一提交的 [PR Check](https://github.com/ThinkInAIXYZ/deepchat/actions/runs/42923291527) 报出两项回归。打包合同检查现已校验定向矩阵表达式与默认架构集合，Memory 测试夹具已补齐 Native transcript 的 `pluginHookState`。Wiro AI 的连接测试验证两次凭据检查均经 catalog 请求。
