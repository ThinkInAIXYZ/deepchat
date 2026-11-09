# dim Rust Harness 迁移实施计划

本文件是唯一执行跟踪表。目标与职责见 [spec.md](./spec.md)。

状态：已交付 release、插件宿主与持久会话读写核心；主产品的 session backend 尚未切换。下列任务是 DeepChat 接入 dim 的实施任务，不是 dim 功能缺口清单。dim 的完整队列直接复用，ACP 保持 DeepChat client 路径，dim 自身 OAuth 不做适配，桌面功能保持原所有者；数据库持续加解密按用户决定移除，只保留旧数据解密迁移。

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

- [ ] 持久化 appSessionId ↔ dimSessionId/branch/store/runtime 映射；旧内置会话标为待转换，ACP 保留原 backend。
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

- [ ] 开发试用 → 新会话默认 dim → 正式将旧内置会话续聊入口切至 migration；不在后台批量迁移全部旧历史，不对同一输入双执行。
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
