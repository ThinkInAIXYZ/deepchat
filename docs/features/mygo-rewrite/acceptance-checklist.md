# mygo 完整替代验收与差距清单

更新：2026-11-07（D2c2c 真实 preview 协议与 sidecar replacement）
分支：`feat/mygo-rewrite`
规范：`spec.md`；执行状态：`plan.md` 阶段 D
整体结论：**尚未完成替代，不得发布为 Electron 的完整替代品。**

## 1. 证据等级与范围

- **已验证**：当前源码上有直接运行证据；历史证据注明对应 spike/提交。
- **部分实现**：有代码或局部验证，但独立运行、异常路径或完整功能仍未证明。
- **未实现**：没有满足要求的真实实现。
- **外部阻塞**：本地可推进工作完成后仍需外部环境或授权，不能把未执行写成通过。

保留功能以 `spec.md` 第 2 节为准。YoBrowser、浮动聊天窗和 computer-use PiP 是已经确认并实施的删减，不计为待恢复的对等差距。`m0-report.md` 保存 M0 历史证据；本文件跟踪产品化真实现状，不沿用旧测试数字代替当前验证。

## 2. 已验证的基线

| 能力 | 状态 | 当前证据 |
| --- | --- | --- |
| 真实 Vue renderer 在 macOS WKWebView 启动 | 已验证（spike） | `m0-report.md` 第 1、11–16 节及对应截图 |
| Go 绑定、renderer typed bridge、事件分发 | 已验证（spike） | `m0-report.md` 第 2、11、14 节 |
| SQLCipher 与现有主进程业务在 Node 中运行 | 已验证（spike） | `m0-report.md` 第 12、18 节；`database-decision.md` |
| 本地 mock Responses API 的 service-level 聊天 | 已验证 | `node shell/spike/local-chat-check.mjs`：`chat.stream.completed`、消息契约与完整回复匹配 |
| Go 壳中的真实 UI 聊天路径 | 已验证（提交 `5b764591d`） | `local-chat-ui.mjs` 真实点击 onboarding 和侧边栏，DOM + `/tmp/deepchat-chat-final.png` 同时验证 2 条消息 |
| 流式 channel、自定义协议、截图、PDF、macOS Secrets API | 已验证（spike 单项） | `m0-report.md` 第 3–8 节；不等于对应产品功能已迁移 |
| macOS spike `.app` / `.dmg` | 已验证（仅 spike） | `m0-report.md` 第 9 节；不含正式 Node 运行时、迁移、更新或完整产品矩阵 |

## 3. 当前差距总表

### 3.1 sidecar 后台运行时（阶段 D1）

| 项目 | 状态 | 实现与证据 |
| --- | --- | --- |
| Electron/Node parent-port 兼容 | 已验证本切片 | `src/main/platform/utilityParentPort.ts`；真实 `child_process.fork` 下 file-watcher RPC 成功往返；定向合同测试通过 |
| file watcher 独立 sidecar 入口 | 已验证本切片 | `out/sidecar/fileWatcherUtilityHost.mjs` 真实生成并执行 IPC，不依赖 `out/main` |
| scheduler/background-exec/code-mode 独立 sidecar 入口 | 部分实现 | 4 个 `.mjs` 已生成且 Node ProcessHost 会优先选择同目录入口；其余 host 尚未分别执行业务级验收 |
| SkillSync worker | 已验证本切片 | `out/sidecar/scanWorkerEntry.mjs` 真实 worker 返回 `{ok:true, scanResults:[], discoveries:[]}`；完整 sidecar 聊天启动中不再出现模块缺失和主线程 fallback 日志 |
| 后台子进程异常诊断、恢复与关闭 | 未实现完整闭环 | D2c1 已覆盖父 sidecar 的有界恢复及 Unix 进程组回收，四个 utility host 的业务级崩溃、取消、重启和打包后生命周期仍待 D4/D6；单次成功启动不代表恢复已验证 |

### 3.2 正式产品壳与传输（阶段 D2）

| 能力 | 状态 | 差距 |
| --- | --- | --- |
| 正式应用入口 | 部分实现（D2b1 已实测） | `shell/deepchat` 可构建并直接启动、获得单实例锁并回收 sidecar，不是正式打包发行版；spike 与正式入口共享 `internal/sidecar` |
| 启动 readiness 与 route 错误 | 部分实现（D2c2b3 已验证锁定期等待） | 早期普通请求等待真实 dispatcher，缺 route/缺 dispatcher 返回错误；60 秒 deadline 仅约束 `sidecar.process.ready` 的 IPC transport，manual unlock 不再被误杀，完整 `sidecar.app.started` 仍独占主 renderer 加载与恢复成功。业务初始化卡死与大输入资源上限仍未覆盖 |
| 超时、取消、背压、损坏响应 | 部分实现（D2c1 已验证单请求边界） | 共享 Process 支持请求 deadline、取消后的合法迟到响应丢弃、非法输出/异常 id 失败；4 MiB 阻塞写入与并发 Close 有界，残帧终止本代，不在通用状态锁中做管道 I/O。超大读取、全局内存/背压和长期资源治理仍待 D2c2 |
| sidecar 崩溃恢复和进程树关闭 | 部分实现（D2c1 单项 macOS 已验证） | 在途请求收到确定错误；超时强杀覆盖进程组并等待回收；真实退出复用 Main shutdown coordinator；意外退出按代次有界恢复并重载 renderer，不自动重放 mutation。尚缺更多流/后台任务异常和多平台重复验收 |
| 多窗口身份 | 部分实现（D2c2b1 settings、D2c2e primary Content 已验证） | Go 将真实 caller window/page 和 document URL 加入请求；主窗口已是 native Content + primary WebView，record 显式保存 primary Page，settings 可同时存活并使用独立真实 ID。Go nested registry/pageId 已验证，普通聊天多窗口及 Node/TabPresenter 生命周期仍未实现 |
| 启动 splash 与数据库解锁 | 已验证本切片（仅 macOS 临时副本） | 原生 splash-first、manual 错误/正确密码、锁定期 sidecar 替换、orphan recovery-cancel 与 data 回退均有真实 DOM/截图；普通聊天多窗口、其他恢复类型、真实用户迁移和其他平台仍未覆盖 |
| 单实例、deep link 和生命周期事件 | 部分实现（D2b1 已验证） | 第二次启动实测退出且不再启动业务进程；deep link、原生命运周期事件和 relaunch 尚未完整桥接 |

### 3.3 原生能力与安全边界（阶段 D3）

| 能力 | 状态 | 差距 |
| --- | --- | --- |
| 窗口、托盘、全局快捷键 | 部分实现 | macOS 已验证主窗口最大化/恢复、settings 的真实 renderer/RPC、重复打开和关闭后新 ID 重开；`app.focus` 已接真实原生调用，但自动化读取的 focused 仍为 false，尚无焦点成功证据。完整菜单、托盘、快捷键和跨平台事件合同仍缺口 |
| 文件对话框 | 部分 spike/不应视为可用 | shim 仍可能返回 `canceled:false` 与空数组，正式结果必须由真实 Go bridge 返回 |
| 通知 | 部分 spike | 仅打包 `.app` 的简单通知实测；业务点击目标和回调未验收 |
| Clipboard/nativeImage | 未实现 | sidecar 仍丢弃文本/图片写入，图片对象和截图可能是空输出 |
| workspace 预览/长图 | 部分实现（D2c2c HTML preview 已验证） | 真实 workspace-preview iframe、脚本和大文件流已验收；`CapturePage`/`Eval` 能力存在不等于 tab capture、组合图片、滚动导出已成功 |
| workspace/MCP Apps 协议隔离 | 部分实现（D2c2c workspace、D2c2d MCP runtime、D2c2e Content 复验均在 macOS 完成） | workspace-preview 的 origin、脚本隔离、owner、取消和 sidecar replacement 有证据；真实 MCP App 实例、AppBridge 工具闭环和 frame 隔离已在 primary WebView 再次通过，但声明权限 consent 仍直接拒绝，session partition、独立 nested Page 与 Windows/Linux 尚未验收 |
| preload/context isolation | 未实现对等验证 | mygo v0.7.4 macOS 使用未指定 content world 的 `WKUserScript`；需要上游隔离能力或经评审的等价 least-privilege 设计，spike `Eval` 与任意外链转发禁止进入正式绑定 |
| renderer sender 与文档来源 | 部分实现（D2c2b3 顶层窗口、D2c2e primary WebView 已验证） | Go source 隔离于 renderer input，Node 绑定平台返回的真实原生 ID 并复核精确 role/path。主 Content 的业务调用必须匹配已注册 primary Page 指针，真实同 URL secondary WebView 已被拒绝；Go nested source/event 已通过真实 e2e，Node pageId 映射与 content-world 对等证明仍未完成 |
| OAuth | 部分受阻 | 系统浏览器迁移未完成；GitHub 回调页需配合回到 deep chat deep link，其他 OAuth 仍需逐项源审 |
| 代理/权限/网络状态 | 部分实现（native Page fail-closed；Linux 全部权限暂拒） | macOS/Windows 不再让 registered custom scheme 继承设备权限；Linux 因 mygo 把 nested 请求归因到顶层 URI，连第一方设备权限也暂时拒绝。MCP 异步 consent 仍未实现，shim 的 proxy、webRequest 和 `net.isOnline()` 等也并非真实系统状态 |

### 3.4 业务功能对等（阶段 D4）

以下均有原 Electron/TypeScript 实现，但 mygo 组合运行时尚未完成对等验收：

- Provider、真实模型配置、附件、流取消、重试、会话恢复、数据库锁定与重启恢复。
- DeepChat/ACP Agent、工具调用、权限确认、terminal、跨窗口交互。
- MCP 启停、tools/prompts/resources、sampling、elicitation 和 MCP Apps。
- Skill、Memory、workspace、搜索、设置、导入导出、通知和插件。
- Monaco、Mermaid、markstream、TipTap、xterm、虚拟滚动在系统 WebView 的交互回归。
- 慢流、超大 payload、sidecar 崩溃、多个窗口、后台任务和大数据量性能基线。

因此，“524 条路由注册”仅证明装配覆盖，不是功能对等验收。

### 3.5 凭据和数据迁移（阶段 D5）

| 能力 | 状态 | 差距 |
| --- | --- | --- |
| OS 密钥保护 | 未实现 | `node/secretHost.ts` 的正式路径仍使用用户目录 `0600` 密钥，`isInsecure() === true`；不满足产品要求 |
| safeStorage 密文迁移 | 未实现 | 当前 AES-GCM 格式不能直接解读 Electron 密文，尚无一次性重加密流程 |
| 数据库/设置无损升级 | 未验证端到端迁移 | 真实 SQLCipher 可由 Node 打开不等于现有用户迁移、回滚和幂等已通过 |
| 中断、错误密钥、缺失密钥和恢复 | 部分实现/本切片仅验证启动分支 | D2c2b3 已在临时副本验证 manual 错误密码与 orphan recovery-cancel 文件保全；真实用户迁移的中断、错误/缺失密钥、备份回滚与幂等仍需复制 fixture，禁止直接在真实用户数据上实验 |

### 3.6 打包、平台和发布（阶段 D6）

| 能力 | 状态 | 差距 |
| --- | --- | --- |
| macOS 正式应用包 | 未实现 | spike 包不包含正式 sidecar 运行时和完整资源布局 |
| Windows / Linux | 外部阻塞待环境 | 尚无真实构建和运行 smoke，不能用跨平台编译替代验证 |
| Node/native addon/worker/plugin 分发 | 未实现 | 侧车入口刚开始具备独立后台文件，完整 Node 运行时和原生模块仍需打包验证 |
| 签名、公证、安装、卸载和文件关联 | 未验证 | 不属于 spike `.dmg` 的已验证范围 |
| 自动更新 | 未实现 | sidecar updater 的检查和安装仍是空实现，relaunch 没有真实动作；更新状态可能停在中途 |
| 灰度、回滚及生产升级 | 未实现且需授权 | 不改变更新服务器或默认渠道，直到完整验收和用户授权 |

## 4. 当前验证与已知失败

D2c2c 真实 preview 协议与流式传输：

- `src/main/platform/node/nativeProtocol.ts` 现在维护固定 scheme 的真实 callback registry、请求 metadata、owner/document 和 256 KiB 分片 reader；`shell/deepchat/native_protocol.go` 将 Go 原生 scheme 请求转发到同一 Node handler，支持 GET/HEAD、逐块 flush、取消和非法 metadata（含 `Connection` 指定字段）拒绝。development/packaged 启动都注册 scheme，begin 有 pending/cancel tombstone 和 body 清理，Go 每次 read 前复核真实 Page URL。`protocol.handle()` 不再对这四个 scheme 假报成功，begin/read/cancel 也没有暴露为 renderer 通用业务 route。
- 实际运行暴露出两个协议前的前置兼容问题并已修复：sidecar JSON transport 用带标记的 `Date` 编解码保留 `workspace.readFilePreview` 的 metadata 类型，普通 marker-shaped JSON 用 entries 转义，只有 native `jsonTransport` bridge 在 shape/Zod 校验前恢复且只递归 plain JSON object，未遇 marker 时保留原引用以避免流事件全量深拷贝，Electron structured-clone 路径不执行恢复；workspace 对真实 `CodeFileAdapter` 返回的 `text/code` 增加 `.html/.htm/.xhtml` 分类回退。没有把 route schema 改成接受字符串，也没有把日期以外的 structured clone 类型宣称为已等价。
- macOS 临时 profile 使用真实 e2e Go binary、现有 Vue renderer、sidecar 和 preload。通过 `workspace.register` 与 `workspace.readFilePreview` 得到 `workspace-preview://…/preview.html`，生产 sandbox `allow-scripts allow-same-origin` 的 iframe 实际显示 HTML 并执行脚本。frame 内 `fetch()` 的完整 `ArrayBuffer` 为 **401,443 bytes**，不是只检查 iframe 元素或 header；`/tmp/deepchat-d2c2c-workspace-preview.png` 在目标内容完成后生成并人工查看。
- 隔离断言由 **frame 内脚本** 执行，而不是从父页面读取自己的 WindowProxy：frame 的 `location.origin` 为 `workspace-preview://…`，自身 `mygo` 为 `undefined`，读取父正文、父 `deepchat`、父 `mygo`、父 URL 全部得到 `SecurityError`。恢复后再次得到相同结果；未开启 `PreloadAllFrames`，未使用 app-origin `srcdoc`。
- 最终修复版恢复场景在同一 Go 进程 `89678` 中杀死测试 sidecar `89702`，replacement `89784` ready 后 renderer 重载，旧 iframe 引用消失。新代次先对未注册路径返回 `preview:null`，再重新注册临时 root、加载同一 401,443-byte preview，全部字节与隔离断言通过；`/tmp/deepchat-d2c2c-workspace-preview-recovered.png` 已人工查看。此次是已加载 preview 的进程替换验收，未把它夸大为真实 in-flight read 杀死时序；begin 取消、导航失效和 client disconnect 由 Go/Node 合同测试覆盖。
- Go/Node 定向测试覆盖真实 Response headers、HEAD 不取 reader及取消错误传播、大 source chunk 分片、owner/document、pending/提前取消、非法 method/metadata 和 client disconnect；workspace service 回归使用真实 adapter 的 `text/code` MIME，native validated-event、`chat.stream.updated` fast path 与 Electron structured-clone 都覆盖 marker-shaped JSON。最终 Oxfmt、typecheck、lint、i18n、Go 全包 race/vet、正常/e2e Go build、fragment e2e、`pnpm run build`、最终 Electron/CLI build 与 sidecar/preload build 通过。完整 main 为 9848 项，其中 **9840 passed / 2 failed / 6 skipped**，681 文件通过、1 文件失败、2 文件跳过；仅有既有两项 `sync.tunnel.error.tunnelFailed`。完整 renderer 为 **281 文件、2707 测试全部通过**。Node 24.18.0 与 engines >=24.22.1 的既有 warning 仍存在。
- 正常 prebuild 按仓库约定刷新并保留 `resources/model-db/providers.json`、`resources/acp-registry/registry.json` 与新增的 `resources/acp-registry/icons/kimi-code.svg`；这些是构建生成的公开 registry 更新，不是手写业务数据迁移。
- 仍未执行 Windows/Linux 实机、正式打包/安装升级、MCP Apps 完整权限矩阵、Range/全部 privileged-scheme 等价、legacy TabPresenter/native nested identity。mygo v0.7.4 的 Windows `schemeResponse` 仍将完整 body 聚合到 `bytes.Buffer` 后才 `Finish`，需要上游/fork 的增量 `IStream`/`SchemeBodyWriter` 与 Windows 实测；当前 Go flush 不能被称为 Windows 流式传输。D2c2d 后续补上了 macOS MCP App 实例和工具闭环，但没有证明声明权限 consent 或完整 MCP 生命周期；完整业务、迁移和 Electron 默认切换目标仍未完成。

D2c2d 真实 MCP App 运行时与权限边界：

- 使用真实 e2e Go binary、现有 Vue renderer、Node sidecar/preload 和 `/tmp` 中的本地 stdio MCP server。先由真实 `mcp.addServer`/`mcp.getServers` 生成并保存 server binding，再关闭应用、复制应用生成的临时 profile，仅在副本中写入一条合成 session/message/`tool_call` block；`mcpResult.app`、tool params 与持久化 source 完全匹配。全程未读取真实用户数据、凭据或剪贴板内容。
- 在 base 中通过真实 `mcp.setEnabled`、`mcp.startServer` 使 resource `ui://chart/index.html` 可列出；副本启动后 fixture server 自动 connected，现有 `McpAppView` 经 `mcp.apps.prepareView` 创建 `mcp-app://<instance>/sandbox.html`，生产 iframe 为 `sandbox="allow-scripts allow-same-origin"`。inner app 完成 `ui/initialize` 和 initialized notification，收到 tool input/result 后向真实 server 发起 `tools/call`；server 收到请求且最终 UI 显示 `MCP App and tool round trip complete`，证明响应也返回 inner app。`/tmp/deepchat-d2c2d-mcp-app.png` 在目标状态完成后生成并人工查看。
- live instance 的 `mcp.apps.listTools` 返回 `render_chart` 及其 `ui.resourceUri`/`visibility` 元数据；把已保存 `toolInput.title` 改为 `tampered` 后，`mcp.apps.prepareView` 以 `The MCP App source no longer matches the saved tool result` 拒绝。隔离断言由 inner frame 自己执行并通过 app-visible 工具调用交给 server：父正文、父 `deepchat`、父 `mygo`、父 URL 全部为 `blocked:SecurityError`，自身 `mygo` 为 `undefined`。没有从父 realm 代替 frame 探测，也没有开启通用生产 Eval。
- 权限负向复现使用同一真实链路：resource 明确声明 `geolocation` 后，inner `navigator.geolocation.getCurrentPosition` 返回 `state=denied, code=1`，主 UI 没有 consent 请求；`/tmp/deepchat-d2c2d-permission-denied.png` 显示工具闭环仍成功但 geolocation denied。加入 camera 声明后，当前 WebKit frame 的 `navigator.mediaDevices?.getUserMedia` 为 `unsupported`，没有取得 stream 或保存任何音视频；`/tmp/deepchat-d2c2d-permission-fixed.png` 已人工查看，但这不能证明真实 camera callback 已在 macOS 执行。`navigator.permissions.query({name:'clipboard-write'})` 返回 `TypeError`，只能记录为不支持此查询，未写剪贴板、未据此断言 clipboard 被允许或拒绝。
- 源码根因是 `McpAppSandboxRegistry.configureDefaultSessionPermissions` 面向 Electron `session.defaultSession` 注册异步 request/check handler，而 Node shim 的 default session 是 `noopSurface`；mygo v0.7.4 的 `Page.SetPermissionHandler` 只在主线程同步返回 bool，不能等待现有异步 consent UI。另一个独立安全边界是 mygo `Window.isTrusted` 默认信任所有 `Protocol.IsHandled` custom scheme，macOS camera/microphone、Windows 和 Linux 的部分设备请求会经过该决策，不能继续无 handler 运行。
- `shell/deepchat/native_window.go` 为每个注册的 Page 安装真实同步 handler：非 Linux 严格接受第一方 `mygo://localhost`、file 和 loopback development origin，拒绝 `mcp-app`、workspace/deepcdn、公网、userinfo、带 path/query/fragment、opaque 或 malformed origin。首次提交后的独立复核指出 mygo Linux backend 使用顶层 WebView URI 归因 nested 权限，会让 iframe 冒充第一方；跟进修复因此在 Linux 暂时拒绝全部浏览器权限，而不是信任无法区分的 origin。19 个非 Linux origin case 和 4 个 Linux deny-all case 覆盖空 query/fragment、opaque file、custom scheme 与第一方输入。真实 macOS 修复版再次完成 MCP App 工具与隔离闭环，但 Linux 未实机执行。该修改是 fail-closed 安全修复，不是异步 consent 实现，也没有通过直接放行、预授权全部权限或阻塞主线程制造通过结果。真实 camera/microphone、clipboard、Linux requesting-frame 归因和完整权限矩阵仍需上游/运行时验证。
- 当前切片的 typecheck、lint、i18n、14 个 main 与 1 个 renderer MCP App 定向测试、Go 全包 race/vet、正常/e2e build 和真实 fragment-navigation e2e 均通过；没有把这些定向检查写成完整 main/renderer 全绿。Windows/Linux 未执行，Node 24.18.0 与 engines >=24.22.1 的既有 warning 仍存在。

D2c2e native Content primary renderer Page：

- 主窗口从 page-only 改为无额外 UI 的 native Content 宿主，现有 Vue renderer 是全尺寸 primary WebView；`nativeWindowRecord.page` 显式保存业务 Page，导航、descriptor、host action、command/protocol caller、权限和 replacement 都通过同一所有权。`requestSource` 同时要求真实 CallerWindow、注册窗口和 primary Page 指针，业务事件改为 `EmitPage`，settings/splash 通过同一 record 复用顶层 Page。没有把 Content 的 `window.Page() == nil` 当成无主回退，也没有开始复制 windowId 作为 nested pageId。
- 真实 macOS 启动后 primary DOM、`window.deepchat` 和 `config.getLanguage` 正常；`window.toggleMaximizeCurrent` 使原生 content bounds 从 1280×788 变为 1920×928，随后恢复非最大化状态。语言事件实际显示“新会话/工作区/插件”，不是只检查 route 返回值。点击现有设置入口后出现独立原生 settings `id=5`，`#/overview` DOM 和 `config.getLanguage` RPC 正常，关闭后只剩主 Content 窗口。
- 在同一 primary WebView 中重新执行 D2c2c workspace fixture：真实 `workspace.register`/`readFilePreview` 返回 `workspace-preview://…/preview.html`，`Date` metadata 保留，生产 sandbox iframe 的脚本读回 **1201 bytes**；frame 内父正文、父 `deepchat`、父 `mygo`、父 URL 全部为 `blocked:SecurityError`，自身 `mygo=undefined`。`/tmp/deepchat-content-workspace-full.png` 在完整文本显示后生成并人工查看。D2c2d 的 MCP App 也再次完成真实工具闭环和相同隔离断言，`/tmp/deepchat-content-primary.png` 已人工查看。
- sidecar 恢复在同一 Go 进程 **3157** 中从 **3181** 替换为 **3412**；日志出现 replacement-ready 后，primary 重载、旧 `__contentBeforeReplacement` 标记为 `undefined`，新 `deepchat` 可用。聊天选择没有自动恢复，明确重新执行 `sessions.activate` 后 MCP iframe 和工具/隔离再次通过；不把这写成会话自动恢复或 mutation 重放。
- splash 使用新的应用生成临时 base，先通过真实 `databaseSecurity.enable` 加密，再复制副本并省略合成 `sidecar-secret-key` 以强制 manual unlock。错误密码显示 `Wrong password. Try again.` 且输入清空，正确密码解锁后 splash 关闭，唯一剩余窗口为 Content 主窗并通过真实语言 route；`/tmp/deepchat-content-splash-unlocked.png` 已人工查看。随机测试口令只存在于临时 orchestration 内存，未写入日志、结果文件或提交。
- 新增真实 `TestNativePrimaryPageRejectsSecondaryWebView`：同一 Content 中两个 WebView 使用完全相同的 `mygo://localhost/` 文档，primary 到达预期 `sidecar is not available` 业务边界，secondary 在 `registered application page` source 校验处拒绝。e2e TestMain 仅在测试期间保留 last-window-closed 生命周期，避免前一个用例关闭窗口后销毁后一个用例；fragment-navigation 与该用例在 race 下共同通过。
- mygo v0.7.4 的 automation 对 Content 不支持 Eval，且 `Window.captureContent()` 只绘制 native UI、WebView 洞为黑色。新增仅限 `e2e` 的 primary socket提供真实 `eval` 和 `WebView.CapturePage`，权限为 0600，正常构建的同名配置为空且二进制不包含 `DEEPCHAT_AUTOMATION_EVAL`。上述页面截图来自真实 primary WebView，不是黑色 native-only capture；macOS `screencapture` 返回 `could not create image from rect`，所以系统级原生合成截图仍未独立验证，不能把 primary 截图写成该能力已通过。
- Go 全包 race/vet、普通/e2e vet、正常/e2e build、fragment/primary-secondary e2e，以及项目 typecheck、lint、i18n 均通过。`mygo/ui` 的既有传递依赖由 `go mod tidy` 固定。没有执行完整 main/renderer 套件、Windows/Linux、正式打包或系统级合成截图；独立 nested pageId、tab attach/detach/bounds、`WebContentsView`、MCP 异步权限和长图导出仍是后续差距。

D2c2f 原生子切片：nested registry 与 Page 身份：

- `shell/deepchat/native_page.go` 建立真实 nested WebView registry，pageId 单调递增且不超过 JavaScript safe integer，分别记录宿主 window、Page、navigation、bounds、visibility 和 z-order。主 Content 在全尺寸 primary 上按这些真实状态放置 visible/attached pages；隐藏页面保留，close/replacement 销毁，pageId 不复用。`RequestSource` 和 `EventTarget` 新增独立 pageId，primary 继续缺省为零。
- `ensure_page`、`load_page`、`attach_page`、`detach_page`、`bounds_page`、`visible_page`、`focus_page`、`close_page` 均只接受 host command，不能由 renderer input 自封。创建从 `about:blank` 开始，加载可先于 attach；bounds 限幅且非零 placement 才显示。nested 请求不再进入只接受宿主窗口的 `shellRoute`，带 pageId 的宿主窗口命令也在 caller 校验处拒绝，必须继续走 Node 业务 dispatcher；local `mygo` 文档才允许业务 IPC，外部 http(s) 仅能导航显示，凭据、file/data、settings 和 MCP 文档规则均拒绝。
- 真实 `TestNativePageIdentityAndLifecycle` 在同一 Content、同一 `mygo://localhost/` 文档下先证明未注册 secondary 被拒绝，再通过 host command 创建 nested。测试读取 Go 已验证的 `RequestSource`，确认其 pageId/windowId 与 registry 一致；向 nested 发送 `test.nested` 后只有 nested 收到，primary 事件数保持为零。随后验证 640×400 placement、hide 后 placement 清零、show/focus、replacement 销毁旧 page、重新创建得到更大 ID 以及重复 close 失败。fragment-navigation 与该用例在 race 下共同通过，普通文档规则另有 10 个表驱动 case。
- Go 全包 race/vet、正常/e2e build 和真实 primary + MCP 启动回归通过。此子切片没有 Node sender、`native.page` ready/navigation/title 通知或 `WebContentsView`/`TabPresenter` 可见 UI 完成证据，不把 registry 和 placement 单测写成现有 tab 已迁移；Windows/Linux、tab 状态恢复、多窗口、外部页面实际显示与系统级合成截图也未验收。

D2c2b3 真实 splash/数据库解锁窗口：

- Go 创建并注册受限 `splash` role，Node 在绑定真实 descriptor 后导航；主窗从隐藏 `about:blank` 起步，早期 `ready-to-show` 仅在绑定且安装现有监听后重放。原生加载按目标 URL 过滤完成/失败事件，初始空页不会提前 resolve；`loadFile` 只在精确 splash entry 确实存在且为文件时映射 URL，不再把缺失资源产生的空文档当成成功。420×340、透明、无边框、不可移动/缩放、置顶窗口的 DOM 与截图均已核对。
- 同一 `createSplashApi` 复用于 Electron 与 mygo，只有 unlock/recovery 的 submit/cancel 四条原生 channel 及只读早期语言读取。preload 缓存早于 Vue `onMounted` 到达的状态，并按原始跨 channel 顺序在一次微任务中重放；实测修复了旧 progress 在 request 后重放、把 manual 表单错误覆盖为 system-unlock 的时序。普通业务 route 仍拒绝 splash 来源，非精确文档/超限 data URL/未知 channel 不获得权限。
- 通过应用自身 `databaseSecurity.enable` 生成临时 SQLCipher fixture，并只操作其副本；未使用真实用户数据或凭据。manual-unlock 中错误密码显示 `Wrong password. Try again.`、清空输入且可重试；等待超过原 60 秒 readiness deadline 时 sidecar PID 45847 保持不变，主窗仍隐藏。随后提交正确测试口令，同一 PID 完成启动，原生窗口只剩主窗并显示 `#/welcome`。`/tmp/deepchat-d2c2b3-splash-manual.png`、`/tmp/deepchat-d2c2b3-splash-invalid.png` 与 `/tmp/deepchat-d2c2b3-main-unlocked.png` 均在目标 DOM 完成后生成并人工查看。
- `sidecar.process.ready` 现在只约束 IPC transport 看门狗，不能触发主 renderer 加载、清零崩溃预算或冒充完整业务启动；`sidecar.app.started` 保留原有 dispatcher 门槛。锁定期实际杀死 sidecar 48734 后由 48796 接管，同一 splash `id=2` 重新加载、旧页面标记消失、manual 表单和 `en-US/system` 语言读取恢复，主窗仍隐藏；`/tmp/deepchat-d2c2b3-splash-restarted.png` 已人工核对，随后取消解锁正常退出，没有再生成替代进程。
- recovery 使用独立 `orphaned-sidecar` fixture，实际出现“存在无主数据库日志”的 Start empty/Quit 表单，`/tmp/deepchat-d2c2b3-orphan-recovery.png` 已人工核对。选择 recovery Quit 后，WAL 和移开的主库测试备份的内容摘要逐项不变，没有创建新主库或 quarantine 目录。本项不冒充 true-corruption、unreadable 或真实用户迁移矩阵已经通过。
- 暂时移开本次生成的 splash 静态入口后，`loadFile` 明确失败并进入真实 `data:` 回退（16154 字节）。回退的受限 `data:///` trust 没有使用通配 origin，Go 仍校验精确前缀和 65,536 字节上限；语言读取、错误密码反馈正常，普通 debug 业务 route 被 `business route is not allowed for the splash document` 拒绝。`/tmp/deepchat-d2c2b3-inline-invalid.png` 已人工查看；退出 trap 恢复静态入口，SHA-256 校验与原文件一致。
- 修复前还真实观察到 splash 对 `about:blank` 的三次 show/focus 失败，以及等待密码的 sidecar 被 60 秒超时误杀。目标导航过滤、transport/app readiness 分离后，正常 manual 启动不再出现这些错误。错误诊断仅输出脱敏的本地文档 path，不记录 query、fragment 或 data 内容；临时事件追踪代码未保留在交付中。
- 独立终审进一步指出 DidFinishLoad 不携带导航 ID，当前 URL 匹配仍可能误收旧 blank 的完成。后续修订为每个 Page 记录 OnDidNavigate committed URL/revision，load 只接受本次调用之后提交的目标代次并复核当前 URL，ready 也要求已提交文档；同文档 hash 路由不另起代次，query 变化仍需一致。回归覆盖“当前 URL 已是目标但尚未 commit”、目标失败仍可回退、blank/目标/旧代次和 hash/query；真实修订版再次通过 data 回退语言与错误密码、静态 manual 正确密码后主窗 complete/visible，以及 settings `#/overview` complete/语言读取。诊断确认 blank revision 后再递增到目标 revision，临时诊断已移除。Windows/Linux 的失败 URL/导航 ID 交错仍需实机或上游能力验证，不据此宣称跨平台竞态已全部消除。
- 针对复核指出的 WebView2 fragment-only 合同，后续又将同文档 hash 导航与新文档代次分开：已提交的同 origin/path/query 文档允许在精确目标 URL 生效且 loading 结束后完成，不要求不可能的 ContentLoading/revision；未变化 URL 的 reload 仍要求新代次。`e2e` 标签的真实 mygo 页面测试先加载 `#/old` 再调用生产 `loadNativeDocument(#/new)`，在 macOS 普通与 race 运行均通过，并断言确实进入 fragment-only 前置条件。Windows/Linux 此路径尚未实机执行，不把源码与 macOS 结果写成跨平台通过。
- 本切片没有执行 Windows/Linux、正式打包、真实用户数据迁移或完整数据库损坏类型矩阵；OS Secrets/safeStorage 迁移仍在 D5，nested Page 和 preload content-world 隔离仍未完成。
- Electron `electron-vite build` 通过。该构建会清理 `out/preload`，因此随后按 `run.sh` 顺序重新执行 `sidecar:app:build` 和 `preload:build`，再启动 Go；新的非加密临时 profile 中主窗显示 `#/welcome`，settings 创建为 `id=3`、加载 `#/overview`、语言读取为 `en-US/system`，关闭后只剩主窗。`/tmp/deepchat-d2c2b3-settings-regression.png` 已人工核对；这证明目标 URL 修复没有破坏既有 settings 导航，不是完整 Electron UI 验收。
- 37 个相关 Node 测试通过；Node/Web typecheck、lint、i18n、icons freshness、Go 全包 race/vet、正常/e2e 壳构建及 sidecar/preload 构建通过。最终完整 main 为 9835 项，其中 9827 passed / 2 failed / 6 skipped，679 文件通过、1 文件失败、2 文件跳过；仅有既有两项 tunnel 失败。完整 renderer 为 281 文件、2704 测试全部通过。Node 24.18.0 与当前 package engines 的 >=24.22.1 要求仍有既有警告，未把它改写为环境完全匹配。

D2c2b2 sidecar 代次间自动恢复 settings：

- 修复前实测 sidecar 21505 → 21653：主窗口确实 reload，但 settings 仍显示正常旧 DOM，`window.getRuntimeIdentity` 明确失败为 `IPC source has no live native window binding`；从主窗口显式重新打开才能恢复。这证明旧 DOM 和窗口存活不能充当恢复证据。
- Go Manager 每代重新求值附加环境，注入当前 settings descriptor；Node 在 `startApp` 前校验并合并原生 sequence/tombstone。无存活 settings 时写入空快照覆盖继承环境。恢复一次性消费快照，复用正常 `WindowPresenter` 绑定/监听/ready 管线且不调用 `ensure_settings`，保留允许的文档 URL；`about:blank` 使用正常入口。重复消费、closed、pending-close、已有 wrapper 处于关闭中或恢复中途 close 都不创建替代窗口，普通显式打开不受影响。
- 专项审查还构造出旧代 `ensure_settings` 在新代空快照后注册的竞态。Manager 现在先提高 generation 使未执行旧命令失效，再等待已进入 `OnCommand` 的同步原生工作结束，之后才能采集环境；等待期间收到 Manager.Close 也会重新拒绝启动。真实 Node helper 回归让进程在命令处理中退出，证明第二次环境求值在释放前不发生、释放后 replacement 正常 ready；此项不写成已动态复现隐藏原生窗口。
- macOS disposable profile `/tmp/deepchat-d2c2b2-auto.GWBMIU` 中，杀死 sidecar 28616 后由 28746 接管。settings 自动重新加载并保持 `mygo://localhost/settings/index.html#/common`，旧 renderer 标记消失，runtime identity 为 window=2 / webContents=3，`config.getLanguage` 成功且日志出现新的 `window.notifySettingsReady`。恢复后监听者收到一次 `config.language.changed`，界面与查询同步为 `zh-CN`；`/tmp/deepchat-mygo-settings-auto-restored.png` 在目标 Common Settings 完成后生成并人工查看。
- 再次杀死 28746 并立即调用 Go 原生 `window.closeCurrent`，页面销毁使 automation 返回 unsupported result type，但真实窗口已关闭。replacement 28892 与主窗口 reload 完成后仍只有主窗口，没有从快照创建设置窗口；随后明确调用 `system.openSettings` 才得到新窗口 3 和其业务身份。正常菜单退出完成数据库与业务销毁，无 EPIPE、uncaught exception、恢复耗尽、socket 或进程残留。
- 最终修订版另在 `/tmp/deepchat-d2c2b2-final.fHGaNl` 的父进程注入非法 `DEEPCHAT_NATIVE_SETTINGS_SNAPSHOT='{'`，Go 的空快照覆盖后应用仍正常启动。创建 settings 后杀死 32473，由 32726 接管，旧 renderer 标记消失，settings Overview、语言和 identity 自动恢复并出现新 ready；`/tmp/deepchat-mygo-settings-recovery-final.png` 在恢复完成后生成并人工核对。
- 带代次屏障的最终版还在 `/tmp/deepchat-d2c2b2-barrier.9u2K0s` 复验 34800→34872，settings Overview、语言、sender 与新 ready 自动恢复，`/tmp/deepchat-mygo-settings-recovery-barrier.png` 已人工核对；随后正常菜单退出。
- 31 个相关 Node 测试（含快照校验/一次消费、关闭不复活、现有生命周期）通过；Node/Web typecheck、lint、i18n、icons freshness、sidecar build、Go 全包 race/vet 和正常/e2e 壳构建通过。最终完整 main 为 9829 项，其中 9821 passed / 2 failed / 6 skipped，678 文件通过、1 文件失败、2 文件跳过；仅有两项既有 tunnel 失败，没有新增失败。未执行 Windows/Linux 或完整 Electron UI 验收。

D2c2b1 真实 settings 窗口：

- Node→Go 使用负 ID 的 `native.window` 命令和独立 response，保留同一线性 write ticket；Go 仅在已注册窗口、当前顶层 Page 和 role/path 通过后允许操作。Node 用 `AsyncLocalStorage` 保留实际 IPC caller，不读取 renderer 提供的 source；没有 IPC 上下文的 `focus_app` 只采用启动环境指定的主窗口。sidecar host 与 renderer source 互斥，host 对 settings `about:blank` 仅有关闭权限。关闭通知解绑对应 wrapper，创建请求并发时共享同一 pending promise；单调 sequence、pending close 和 remove-and-append 合并阻止迟到 ready/focus 或 close acknowledgement 复活旧窗口。
- 首次实跑发现 business open 成功但窗口只有 `<html><head></head><body></body></html>`：Go `FileServer` 对 `/settings/index.html` 返回 `301 Location: ./`，WebKit 顶层 navigation 停在空文档，而 `/settings/` 可返回预期 HTML。`shell/deepchat/frontend.go` 仅对实际存在的 index 入口调整内部请求路径，保持原 origin/path 和其余静态文件服务，未扩大 origin 或文档授权；其单元测试覆盖 canonical URL、直接导航 URL 和资源直通。
- 后续硬化版本又出现 settings 永久停在 `about:blank`。SIGQUIT 栈证明 Go 命令循环已空闲，真正原因是 `noopSurface` 给不存在的 `then` 返回 no-op，`await new BrowserWindow()` 将 proxy 当成 thenable 并永不 resolve；现在 `then` 明确为 `undefined`，并由 `Promise.resolve(window)` 回归测试保护。构造、绑定和导航失败的窗口释放由故障注入单测覆盖，本轮未把该项写成真实资源故障注入。
- 独立终审又构造出三条交错路径：ready/focus 替换状态对象后 close 失败可能无法回滚；加载失败补偿继承过期 renderer caller 可能拒绝清理；并发 navigation 可能返回重建前的旧 ID。修复后 close/destroy 与失败补偿使用显式 host domain，close 按 attempt 回滚最新 sequence 并允许重试，navigation 返回实际重建 ID；对应 27 个定向 Node 回归全部通过。
- 首轮 thenable 修复版本使用 macOS disposable profile `/tmp/deepchat-d2c2b-thenfix.UjQafm` 验证：窗口 2 加载 `mygo://localhost/settings/index.html#/overview`，`config.getLanguage` 返回 `en-US/system`，runtime identity 为 `windowId=2` / `webContentsId=3`；重复打开仍返回 2，Common Settings 的实际点击进入 `#/common`。automation 与 `window.getCurrentState` 均报告 focused=true；这不扩大为其他平台或 OS 前台进程矩阵结论。页面完成后的 `/tmp/deepchat-mygo-settings-then-fix.png` 已人工查看。
- 关闭窗口 2 并立即重开得到窗口 3 / webContents 4，DOM 与 `/tmp/deepchat-mygo-settings-then-fix-reopened.png` 正常。将窗口 3 切到 `about:blank` 后，preload 仍存在，但 `config.getLanguage` 被 Go 以 `renderer caller is not an allowed application document` 拒绝；随后正常关闭并创建窗口 4 / webContents 5，业务 IPC 和 Settings Overview 恢复。最终通过 `DeepChat → Quit DeepChat` 菜单退出，窗口 4 收到 closed，业务数据库关闭，无 replacement、EPIPE、uncaught exception、socket 或进程残留。
- 终审修复版另以 `/tmp/deepchat-d2c2b-final-review.dGuHCz` 复验：窗口 2 的业务 IPC、Overview DOM 和 focused 状态正常，close 后立即重开得到窗口 3 / webContents 4，语言仍为 `en-US/system`；`/tmp/deepchat-mygo-settings-final-review.png` 在 Overview 完成后采集并人工查看。原生菜单正常退出完成 business shutdown，无 close 错误或进程残留。
- `go test -race ./deepchat ./internal/sidecar`、`go vet ./deepchat ./internal/sidecar`、完整 `go test ./...`、正常壳构建和 27 个定向 Node 测试通过。Oxfmt、typecheck、lint、i18n、`icons:check`、`sidecar:app:build` 通过；本切片完整 `pnpm run build`（含 prebuild、Electron 与 CLI）也已通过。最终完整 main 为 9825 项，其中 9817 passed / 2 failed / 6 skipped，678 文件通过、1 文件失败、2 文件跳过；失败仅为既有 tunnel 两项。完整 renderer 为 281 文件、2704 测试全部通过。
- prebuild 的既有图标扫描仍引用已删除的 `src/renderer/floating`，首次执行报 `ENOENT`。已移除这个退役扫描根并按正常生成器刷新两份图标产物，未恢复已删减 UI；之后 icons freshness 与完整对照构建通过。

D2c2a 可信原生窗口身份验证：

- Go 从真实 `CallerWindow` / `CallerPage` 采集窗口身份和 document URL，source 与 renderer input 分离。实际调用得到原生 `windowId=1`、业务 `webContentsId=2`，证明两个 ID 空间不能混用。向 `providers.listSummaries` 的 input 注入伪造 source 后结果仍为 95 个 provider，Node 记录的真实 ID 未被覆盖，日志不再打印带输入内容的完整 source URL。
- 启动顺序已根因修复：Go 先创建并注册原生窗口，再启动 Node；`WindowPresenter` 先绑定真实 ID 再放入 `windowsById`，splash-first 不再抢占主窗口身份。此前 splash 测试版确实因优势窗口被绑定到 webContents 1 而报 `IPC source window is not the registered startup window`；该机制已删除，不通过自动认领其他窗口绕过失败。
- macOS 真实窗口实测 `window.toggleMaximizeCurrent` 得到页面 viewport 1280×788 → 1920×928，再恢复 1280×788。`config.setLanguage` 改为 `zh-CN` 后只收到一个目标的 `config.language.changed` 事件，最终 `getLanguage=zh-CN`、DOM 事件计数为 1，并已核对中文界面截图 `/tmp/deepchat-native-source-language.png`（仅含 copy 的测试设置，没有真实数据或凭据）。
- 实际 kill 旧 sidecar 25806 后检查到恰好一个替代进程 29859；页面导航类型为 `reload`，旧探针全局变量为 `undefined`，新调用仍得到 `windowId=1` / `webContentsId=2` 和 95 个 provider。`/tmp/deepchat-mygo-bound-recovered.png` 已人工核对。随后通过原生 `DeepChat → Quit DeepChat` 菜单退出，观察到 `destroy.mainDatabase.close done` 和应用级 `app exited`；没有 source rejection、sidecar 事件残留、进程组残留、control socket、data race 或 panic。
- 两条 `[sidecar] discarding events from webContents(1) without a native window owner` 是主窗口注册前 splash 测试 webContents 的目标事件被有意丢弃，每个无主 webContents 仅告警一次。当前将未绑定窗口保持负占位 ID，拒绝它伪造原生 caller；这不是成功投递。Splash 尚未显式建立 Go 窗口注册与 Page 身份，真实 DB unlock / protected migration 流程也未验证，必须作为 D2c2b 输入而不是视为已完成能力。
- Go source 校验保留 `mygo://localhost` 主文档的 `""`、`/`、`/index.html`，拒绝非主 Page、错误 origin 和带 userinfo 的 URL。Node 复核实际 mygo/frame URL、精确 main/settings/splash 文档路径和 live native window；Electron 端口不返回 mygo renderer origin，保持 Chromium sender 行为。定向 48 个 Node 测试、Go 普通/race/vet、Node/Web typecheck、完整 renderer 回归、lint、i18n、Electron 对照构建均通过；最新完整 main 为 677 个文件通过、1 失败、2 跳过，9804 passed / 2 failed / 6 skipped。仅有两项既有 tunnel 失败，见下文。
- e2e race 二进制仅在 macOS disposable profile 执行，临时二进制、control socket 和截图都在工作区之外，不属于交付文件。`executeJavaScript` 仍是披露的非-Eval stub，通知“renderer ready”路径未使用；普通聊天多窗口、Page 级 nested identity、splash/数据库解锁、全局背压/内存预算、后台异常生命周期、Windows/Linux 运行、正式打包和真实用户数据迁移仍待完成。

D2c1 关闭协调、恢复和一次性 profile UI 验证：

- `SidecarLifecycle` 等待现有 Main shutdown coordinator，shim `app.quit()` 先走真实 `before-quit`，只有业务批准后才发出 transport 退出许可；`app.exit()` 保留立即退出。17 个 lifecycle/quit-flow/readiness/shutdown-coordinator 定向测试通过，其中 quit-flow 使用实际 shim 和实际生命周期批准函数。
- Manager 以进程代次管理有界恢复，每代默认 60 秒、可配置 readiness deadline。真实 Node 测试验证未响应 mutation 报错且不在第二代执行、快速/挂起启动均有界、backoff 中关闭不拉起新进程、异常退出回收进程树、关闭错误不被吞掉，并覆盖真实 OS stdout 关闭但 Node 存活及子进程继承保持 stdout 打开的边界。等待与读取分离后的 `go test -race -count=5 ./internal/sidecar ./deepchat` 通过，Windows/Linux 测试二进制也已交叉编译（未在这些平台运行）。
- 使用带 `e2e` 标签的 mygo 官方 automation 接入真实窗口，没有给正式 Bridge 增加通用 Eval。此前两次实际 sidecar 故障注入均由 Go 拉起替换进程；恢复后导航类型为 `reload`、preload 为 `created`、DOM 正常，`providers.listSummaries` 再次实际返回 95 项，已人工查看窗口截图。
- 修复后的 bundle 用显式 `/tmp/deepchat-d2c-runtime.LT09fB` 一次性 profile 验证：`window.deepchat.invoke("providers.listSummaries", {})` 返回 95 项，DOM `__step=created`，`/tmp/deepchat-mygo-final-before-quit.png` 已生成并核对。通过实际 `DeepChat → Quit DeepChat` 菜单完成普通退出，日志进入真实业务销毁并关闭数据库，无 replacement、graceful-shutdown 错误或 socket 残留。
- 最终传输修复版使用 disposable profile 复验：旧 sidecar PID 2428 退出后由 PID 4548 接管，导航类型为 `reload`、桥重新 `created`、恢复后 provider 仍为 95；`/tmp/deepchat-mygo-ordered-recovery.png` 已核对。之后以 native menu 正常退出，业务数据库完成关闭，两个进程组无残留。
- 应用级失败耗尽也已实测：仅给测试进程设置无效 `NODE_OPTIONS=--deepchat-invalid-startup-flag` 和新的 disposable profile，不改 bundle。日志恰好为初始加 3 次替换共 4 个失败代次、1 次 recovery exhausted，随后应用正常结束；没有假 ready 或无限重启。独立故障注入也证明：清理失败会结束等待和调用、拒绝后续请求且不重启；正常根进程退出后的遗留子树同样回收。
- 4 MiB 阻塞写入及中途 Close 的用例分别重复普通和 `-race` 运行 20 次通过，覆盖调用超时、残帧强杀、实际 writer 完成后的锁释放与关闭状态。8 MiB 大请求首先占住发送权时，较小请求的实际 Node 接收记录保持 `1:slow`、`2:fast`，并发 ID 顺序回归连续 10 次通过。Electron `e2e:smoke` 本切片未执行；mygo 原生窗口验收不等于 Electron 安装/升级 smoke。Windows Job Object 仅有源码和交叉编译证据，未运行对应平台测试。
- 最终完整回归：renderer 281 个文件、2704 测试通过；main 9797 通过、2 失败、6 跳过，失败仅为下面记录的两项既有 tunnel。Oxfmt、typecheck、lint、i18n、Electron 对照构建、正式 preload 与 sidecar 构建、Go 普通/race/vet、macOS e2e 构建和 Windows/Linux 交叉编译均通过。完整 renderer 另一次早期负载混合运行有 2 项超时，单独相关两文件 181 测试通过，串行重跑全量后为上述全绿。
- Linux/Windows 尚只交叉编译；没有实际运行或安装验收。这里仍不是完整 stream/后台 worker 恢复、其他平台、迁移或正式发行完成证明。

D2b1 生命周期与正式壳验证：

- `go test ./...`、`go test -race ./internal/sidecar ./deepchat` 与 `go vet ./...` 通过。临时 Node helper 实测响应/事件、非法输出、超时与取消后迟到响应、异常退出和强制关闭；不会因客户端取消误杀后续请求。独立审查发现的 URL parse nil 解引用、短 deadline 回收问题已修复并有回归证据。
- Windows/amd64 与 Linux/amd64 Go 构建通过，仅表示可编译，未表示对应平台已运行。
- `go build -o /tmp/deepchat-mygo ./deepchat` 后以临时 profile 启动完整业务。第二次启动立即退出，SIGTERM 后检查不到测试 Go/Node sidecar；启动日志直接出现 `[SkillService] File watcher started` 与 SkillSync 扫描完成。
- 原始输出分流实证：sidecar stdout 只有 JSON envelope，绑定 console 与 `process.stdout.write` 产生的业务日志均进入 stderr；严格 Go supervisor 不再被 `DatabaseInitializer` 文本日志触发错误停止。
- 相关 lint、typecheck、i18n 和 12 个 readiness/Node parent-port/shutdown coordinator 定向测试通过。
- `local-chat-ui.mjs` 在共享监管层下再次得到 `messages=2`、`pageEvents=8`、`listed/hasReply/chatPage/userMessageVisible/assistantReplyVisible=true`、`onboardingVisible=false`。`/tmp/deepchat-shared-supervised-ui.png` 已人工核对。

D1 直接验证：

- `pnpm run typecheck:node` 通过；`pnpm run sidecar:app:build` 成功生成 4 个 utility host、SkillSync worker 和 sidecar 主入口。
- 定向测试中 4 个文件、34 个测试通过，包括新增的 Node parent-port 合同测试。
- sidecar 自身 file-watcher entry 的真实 Node IPC 返回预期 RPC 错误合同，证明进程未在 parent-port 检查处退出。
- SkillSync 实体 worker 返回结构化成功结果；`local-chat-check` 再次完成 streaming + persistence，此前 watcher 和 worker Startup 错误消失。
- Go UI 最终复验得到 `messages=2`、`pageEvents=8`、`listed/hasReply/chatPage/userMessageVisible/assistantReplyVisible=true`、`onboardingVisible=false`，`/tmp/deepchat-chat-runtime-slice.png` 已人工核对。若使用全量 Electron 构建，需按 `run.sh` 顺序重新生成 `out/preload/bridge.js`，旧产物被清理后再截图不能证明 bridge 回归。
- `format`、`i18n`、`lint`、`typecheck`、Electron build、sidecar build 均通过。完整 `test:renderer` 为 281 个文件、2704 测试通过。D2b1 后再次执行完整 `test:main`，为 9791 通过、2 失败、6 跳过。

已知失败仍是 `test/main/sync/tunnel.test.ts` 两项 `sync.tunnel.error.tunnelFailed`，此前单文件重跑也可复现；本切片未修改 sync/tunnel。这两个失败使“完整 main 全绿”仍为未完成项，不能从最终验收中略去。

本机 Node 为 v24.18.0，仓库声明要求 >=24.22.1；当前命令会给出 engine warning。不能据此宣称与目标 Node 版本完全等价的发布验证。

## 5. 外部条件与授权边界

- Windows/Linux runner 未提供；对应构建与 UI smoke 尚未执行。
- 生产签名证书、公证和生产更新环境的验证需要后续环境与明确授权。
- GitHub OAuth 的仓库外回调页仍需配合；这不是放宽本地安全校验的理由。
- 未经明确授权，不操作真实用户数据，不发布生产更新，不删除 Electron，不改变默认发行版。

## 6. 下一项最高优先级工作

D2c2f 的 Go 原生子切片已建立真实 nested registry、pageId、host-only 命令、非零 placement、独立 source/event 和 replacement 清理，但 Node 与可见 tab 尚未完成。下一项是 **D2c2f 的 Node/TabPresenter 子切片**（合同见 `spec.md` §4.9）：实现 `native.page` ready/navigation/title/close 通知、Node pageId→`ShimWebContents` 映射、真实 `contentView`/`WebContentsView` pending load、bounds、visibility、focus 和销毁，再用现有 `TabPresenter` 验证 local tab 创建、显示、切换、导航和关闭，以及外部文档业务拒绝与 sidecar replacement，不能用 Content fixture 或通用 Eval 冒充迁移。MCP 精确 pending-request consent 仍受 mygo 异步 permission API 与 Linux requesting-frame origin 阻塞；系统级原生合成截图、原生焦点、大帧限额、全局背压、后台生命周期、preload content-world、Windows/Linux、D3–D7、真实迁移与发行仍是验收中不能删除的差距。
