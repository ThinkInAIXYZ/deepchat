# dim Rust Harness 迁移实施计划

本文件是唯一执行跟踪表。目标与职责见 [spec.md](./spec.md)。

状态：主产品 composition 已切换到 dim backend，旧 harness 不再构造；产品插件与辅助文本入口已接线，剩余能力迁移和旧执行器物理清理继续进行。下列任务是 DeepChat 接入 dim 的实施任务，不是 dim 功能缺口清单。dim 的完整队列直接复用，ACP 保持 DeepChat client 路径，dim 自身 OAuth 不做适配，桌面功能保持原所有者；数据库持续加解密按用户决定移除，只保留旧数据解密迁移。

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
- [ ] 固定 typed `DimPluginClient` 调用合同及版本握手；本地 socket/pipe 仅承载跨进程调用，App Server 公共 RPC 探针不代替插件集成验收。
- [x] 验证基础宿主启停、SDK/版本/profile 匹配、插件 readiness、重启与 u64 无损读取、断线后不盲重试。
- [ ] 继续覆盖独立插件 reload/撤销、raw timeline 分页与 desktop 生命周期；不预设上游补丁或自建薄 host。

完成条件：官方 release 可离线运行，两个插件可加载并直接调用 dim 服务，桌面能收到真实结果。

## P2. Session 与完整队列绑定

目标：现有聊天 UI 使用 dim 内置 agent 与完整队列，ACP 继续走原 client。

负责边界：`AgentManager`、Session 服务、`DimAgentBackend`、`deepchat-host`。

- [x] 持久化 appSessionId ↔ dimSessionId/branch/store/runtime 映射；旧内置会话标为待转换，ACP 保留原 backend。
- [ ] `DimAgentBackend` 通过 host 插件实现现有发送、取消、快照、设置与交互 facet；插件内调用 dim service，不导入旧 harness 服务图。
- [ ] 将队列 list/update/reorder/steer/resume 等 UI 操作直接绑定 dim 原生队列；移除旧 pending pump 的执行职责，不新增 TS 队列或先行改造 dim InputQueue。
- [ ] 将 dim 事件转换为既有消息块、usage、状态及 typed events，保留 turn/request/tool 身份和错误来源。
- [x] 实现稳定 submission intent、未知提交结果查询、重连补页、去重、projection cursor 与 generation fencing；确认丢失时不盲目重发。
- [ ] 多窗口/CLI/Remote 复用现有产品入口；ACP 的认证、终端、扩展和取消保持原路径，只做回归，不新增 dim ACP 接口或跨 ACP 委托。

完成条件：现有聊天 UI 可多轮、取消、操作队列和重启恢复；执行和队列状态只由 dim 持有，Direct ACP 不经过 dim。

## P3. 两插件的产品能力与内容接口

目标：用插件注入产品能力，用 storage 插件读取 dim；不复制执行核心。

负责边界：`plugins/dim/deepchat-host/`、`plugins/dim/deepchat-storage/`、main 产品能力网关。

- [ ] host 插件向 dim 注册 DeepChat 的系统工具、内置知识库/CUA、既有插件等能力，声明工具 schema、取消、来源与风险。
- [ ] Main 网关限制到已授权能力，并绑定 profile/session/branch/generation；实现结果、进度、取消、卸载撤销和日志脱敏。
- [ ] 配置/权限/问题 UI 经 host 插件交给 dim 对应 owner；保持 native 服务自己的授权检查，不引入第二套 agent 权限决策。
- [ ] storage 插件实现 profile/store identity、内容页、event detail、timeline、导出和 migration 入口；读取通过 dim services/query，不直读私有 SQLite 表。
- [ ] 定义只读缓存、固定水位、分页、冷 session 获取/释放和失败合同；投影失败可重建，不能回滚 dim 已提交事实。
- [ ] 插件内直接绑定 dim 服务，调用面按业务拆分；避免任意 SQL/方法名通用网关和查询/工具调用之间的依赖环。

完成条件：两个独立插件完成“操作 dim / 向 dim 注入能力 / 从 dim 读内容”，卸载与重启不留下旧授权或重复执行。

## P4. 原生能力与配置映射

目标：dim 能完成的功能全部交给 dim，其他产品功能经插件交互。

负责边界：dim 原生 owner + host 插件配置映射；不预设 provider 或 OAuth 重写。

- [ ] 暂时停用 Code Mode，移除旧 Code Mode/ToolSearch/programmatic dispatch 接线；等待 dim 原生能力后再启用。dim 已提供同等功能的文件、命令、分支等工具使用原生实现，删除 DeepChat 重复执行器，产品桥不重新注册它们。
- [ ] MCP/Skills：现有 UI、安装、来源和启用状态通过插件映射到 dim 原生 owner；通用连接、工具发现和执行只保留一个 owner。
- [ ] 既有 MCP/插件兼容：in-memory server、MCP Apps、企业身份、知识库和 CUA 经插件注入；保留 consent、撤销、更新与参数/结果语义。作为正常接入实现，不列为 dim 缺失能力。
- [ ] 模型：将现有设置及连接参数通过插件交给 dim；会话和辅助模型请求都在 Rust 执行，不回调旧 TypeScript Provider。
- [ ] 辅助调用：标题、摘要、翻译、记忆提取、embedding/rerank、媒体等接入 dim 对应 model/auxiliary/modality；desktop 保留展示、索引与非模型服务。
- [ ] 图片/视频/TTS 会话与辅助媒体入口直接路由 dim Modality；非聊天模型不能作为聊天 loop 的模型选择，原会话及展示身份保留。当前已验证媒体任务原生执行，产品 backend 路由仍待接线。
- [ ] OAuth：dim 自身登录、账号和 refresh 不做适配或迁移，不新增统一认证层；其他凭据/配置按能力所有者，通过插件正常交互，不能进入 timeline 或普通 row config。
- [ ] Context/Skills/Hooks：dim 负责提示词、上下文、压缩、预算和撤销，产品 context/hook 通过插件接入；不由 TS 拼 provider 请求。
- [ ] 原生 subagent/branch/collaboration 直接用 dim；ACP 完全由 DeepChat 原有实现处理，不规划 ExternalAgent、dim ACP gateway 或 ACP-as-provider 的 dim 迁移。
- [ ] CLI/Remote/计划任务保持 desktop 入口和调度职责，通过相同插件控制内置 agent；通知、关闭窗口和后台结果沿用现有产品流程。

完成条件：模型、loop、queue、context 和工具调度只有 dim 一套 owner，产品能力通过插件可用，ACP 与 dim OAuth 未扩入改造范围。

## P5. 一次性解密与续聊时转换

目标：旧数据可读、旧会话首次续聊转为 dim；移除持续加解密。

负责边界：desktop profile upgrader、storage migration adapter、dim 内容采用接口。

### P5a. 旧加密 profile / 备份的解密迁移

- [ ] 复用 `src/main/app/databaseSecurity.ts` 的密码解析、SQLCipher 导出/恢复及 `connectionConfig.ts` 的兼容设置，保留 legacy 读取能力。
- [ ] 使用已有 safeStorage 或本地解锁 UI 获取旧密码；缺少密钥、错误密码、取消、损坏分别处理，不新建空库或向 dim 传密码。
- [ ] 独占迁移锁、处理 WAL、保留原始加密快照；导出受限 staging 中的未加密数据库，校验 schema、完整性、关键计数和引用后原子切换。
- [ ] migration journal 不保存密码；异常重启只采用完整旧库或完整新库，清理未采用的明文 staging，保证原件可恢复。
- [ ] 移除持续数据库加密、改密码、重新加密和日常解锁 UI/运行入口；保留旧加密备份的导入解密路径与相应驱动能力。API 凭据的 OS 保护保持原职责。

### P5b. 首次续聊 migration

- [ ] 历史浏览继续用 legacy reader，首次续聊获取单 session migration lock；如 profile 仍为加密格式，先完成 P5a。
- [ ] storage 插件的 migration adapter 转换消息/变体、工具调用和结果、附件、有效摘要、分支来源及会话配置为 dim 接受的内容表示。
- [ ] 通过 dim 内容/导入能力落库，校验计数、hash、配对和引用；不再次执行旧工具，不把旧内容伪造成新运行结果。
- [ ] 以 legacy session/revision/转换版本作为幂等键，成功后原子切换 engine mapping，再发送本次新输入；中途失败保留原历史和待发送意图。
- [ ] 旧私有 replay/trace 保留只读证据；转换输出服务于 dim 后续上下文，不能只取最后几条消息代替完整有效历史。
- [ ] 未续聊的旧会话保持待转换状态，无需全量预迁移；正式切换后其续聊入口只走转换器，不继续调用旧 harness。

完成条件：解密与会话转换可分别恢复，续聊透明转换且新输入执行一次；只读旧历史不依赖旧执行器。

## P6. Desktop 内容访问与 Timeline Inspector

目标：复用已有桌面功能，将数据来源切到 storage 插件；不要求 dim 重做 desktop 服务。

- [ ] Inspector 使用新的来源无关 identity/cursor；保留 legacy reader 与 dim timeline reader，复用 Panel/Timeline/Row/DetailPane、虚拟化、过滤、follow/pause、选择和脱敏导出。
- [ ] 修改依赖 Tape entryId/incarnation 的数据层与关联，按真实 dim branch/event/turn/request/tool 身份读取；列表 metadata-only，详情按需加载。
- [ ] 备份、同步、删除、恢复由现有 desktop coordinator 管理；经插件取得内容/附件闭包，保留现有一致性和冲突流程，不直接合并活跃 dim 数据库。
- [ ] 迁移后的内容使用未加密存储，旧加密备份恢复调用 P5a。持续加密不再列为兼容目标。
- [ ] 新内置会话停止写 Tape；legacy Tape/trace 保留只读。涉及 ACP 历史关联的共享 Tape 依赖只做产品 metadata 解耦，不改变 ACP client 执行。
- [ ] 更新 Timeline 命名、i18n 和旧消息定位入口；多窗口、CLI/Remote、通知仍走既有 desktop 边界。

完成条件：桌面功能仍可用，内容查询来自 storage 插件，Inspector 展示新旧来源；没有新增 desktop 重写项目。

## P7. 集成审查与验证

按仓库规范完成实现后选择必要的永久测试；现有检查可随时运行。本轮仅修改方案，没有实现 adapter 或产品测试。

- [ ] 检查真实路径为 desktop → 注入插件 → dim service，排除 ACP 包装、CLI 文本解析、旧 loop/queue/context 的重复实现。
- [ ] 运行真实 release + 插件 + 本地模型/MCP fixture，验证发送、队列操作、取消、工具回调、事件补读与重启；不能只测 mock adapter。
- [ ] 复用现有 main/renderer/E2E：launch/settings、聊天流、provider 参数、用户插件、知识库、memory 和 Inspector；ACP 只验证旧 client 未受影响。
- [ ] 为按需转换、解密导入、未知提交结果和插件撤销选择必要的回归；覆盖错误密码、取消、WAL、磁盘满、切换前后崩溃、重复续聊与新输入执行一次。
- [ ] 验证 desktop 内容适配后的备份/同步/删除、历史浏览、窗口关闭、CLI/Remote；不增加 dim OAuth 或外部 ACP 协作验收。
- [ ] 六平台分别核查 release/插件 runtime、socket/pipe、离线、签名、升级和 notices，测量流 UI/停止/历史读取/内存，记录真实结果。
- [ ] 清理临时探针，运行 format、i18n、lint、typecheck、相关 unit/E2E 和生产 build；未执行与环境阻塞不标为通过。

完成条件：验证证明接入正确，不以未测项推断 dim 缺失功能；解密迁移和按需转换失败不会损坏旧数据。

## P8. 切换与旧执行器移除

- [x] 开发试用 → 新会话默认 dim → 正式将旧内置会话续聊入口切至 migration；不在后台批量迁移全部旧历史，不对同一输入双执行。
- [ ] 观察接入错误、未确认提交、转换失败和延迟；失败恢复原始数据/对应版本，不把已迁移会话静默送回旧执行器。
- [ ] 切换后删除旧 built-in harness/loop/runtime、pending pump、TS 模型执行及 Tape writer/reconciler；旧会话 reader/migrator 保留，未全部转换不阻塞旧执行器移除。
- [ ] 保留 Direct ACP client 及真实 desktop 服务；清理 feature flag、无调用者依赖和持续数据库加密入口，legacy 解密 importer 仍支持旧备份。
- [ ] 回滚使用一致的数据/二进制快照；保留升级后的新数据供恢复，旧程序使用旧加密快照，不重新加密新数据。

完成条件：DeepChat 内置 harness 完全由 dim 替代，旧历史按需转换，ACP 保持原实现，持续加密已退出。

## P9. 维护文档与交付

- [ ] 按已实现状态更新 harness/host/agent/session/Tape/Inspector 合同，保留历史 reader/migration 说明。
- [ ] 更新两插件开发、runtime 版本、数据目录、按需迁移、旧库解密和 desktop 内容访问文档；说明新数据库不再持续加密。
- [ ] PR 描述反映最终范围和真实验证；涉及 UI 的实现 PR 附 BEFORE/AFTER 布局。
- [ ] 实现完成后按 SDD 规则将 RFC 转为现行参考并清理已完成 plan。

## 依赖与拆分

主路径：`P1 → P2/P3 → P4 → P5/P6 → P7 → P8 → P9`。旧库解密 P5a 与插件接入可独立实现；P5b 在首次续聊时执行。移除旧执行器依赖转换器可用，不依赖全量历史转换完成。

建议按 release/插件骨架、session/队列绑定、产品能力、解密与按需转换、desktop 读取/Inspector、切换清理拆 PR。取消旧版按推测上游缺口估算的 12–20 人周；首个插件端到端切片完成后，依据实际映射与转换工作量估算，不把 ACP/OAuth 重写或 desktop 重做计入。

## 模块进度

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
- 模块 4：私有产品能力网关、Session toolRegistry 注册、工具目录版本校验与按 Session 重新挂载、取消与断线撤销。真实 release 验证工具执行/目录替换/取消/重启，并用真实 step/tool-* 事件验证 UI 工具投影。产品 MCP/知识库/CUA 服务目录尚未接线，不把此模块标为 P3 全部完成。
- 模块 3：原生事件订阅、有界补页与 raw timeline query；持久 app/native binding 与 submission intent；消息、工具、审批与 usage 的 SQL 读模型投影。消息和 cursor 同事务提交，旧 reader 被替换后禁止写入；断线可重连同一执行进程，accepted input 不重发。真实 release + SQLite 验证重启后身份/历史/提交幂等，投影失败回滚与恢复。完整桌面 backend、工具配置与迁移仍在后续任务。
- 模块 2：实现 `DimRuntimeSupervisor` 与 `DimPluginClient`，使用私有 socket/pipe、受管 Node、版本/profile/readiness 校验、并发启动合并、graceful shutdown 及进程树兜底；新增 `smoke:dim` 原生集成检查。主应用尚未接入，P2 队列 UI、P5 migration 等任务保持未完成。

## 方案验证记录与 PR 状态

- 官方 alpha.21 Linux x64 的 checksum/version、重复安装、受管 Node、两个实际注入插件的 mock 回合/lookup/history/重启一致性，以及无账号的 product profile 插件启动均已验证。真实 provider、完整插件工具、其他平台和桌面 backend 接线尚未验证。
- 本次修订已通过文档本地链接、代码围栏、whitespace 与旧缺口标签清理检查；重新运行 `i18n:validate` 通过（23 locales）。
- 网络变更后依赖和 Electron 原生模块已安装，先前依赖阻塞已解除；本次所有相关检查均实际执行，未绕过 TLS/校验和。
- 方案已提交为面向 `dev` 的 [Draft PR #2511](https://github.com/ThinkInAIXYZ/deepchat/pull/2511)，包含修订后的插件集成与按需迁移范围；会话持久读写核心已实现，主产品入口尚未切换。
