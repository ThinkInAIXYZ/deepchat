# mygo 产品化替代规格

状态：执行中；M0 与本地 mock 聊天链路已验证，产品替代尚未完成
日期：2026-11-06

## 1. 背景与范围

DeepChat 已在 `shell/spike` 证明系统 WebView、Go 绑定和 Node sidecar 能承载真实 renderer 与主进程业务代码。当前目标不再是扩大技术验证，而是交付可替代 Electron 的正式桌面应用。

沿用已经确认的方案 B 和产品删减决策：Vue renderer 与 TypeScript 业务服务保持复用，Go/mygo 拥有正式桌面壳和原生资源，Node sidecar 持有 Agent、Provider、MCP、Session、Memory、Skill、数据库及其他原生 Node 模块。YoBrowser、浮动聊天窗和 computer-use PiP 的既有删除决定不在本规格中重开。

本规格是现行规范性 RFC。`feasibility-and-plan.md` 保留方案论证和历史背景，`plan.md` 是唯一执行清单，`acceptance-checklist.md` 保存逐项证据。历史文档中的“不得进入 M2”“整体已完成”或旧测试数字均以当前源代码和实测为准。

## 2. 目标与非目标

### 目标

- 正式 Go 应用不再依赖 `go run`、手动拼装的绝对路径或临时 smoke 脚本即可启动。
- Electron 用户在既定保留功能范围内获得可观察行为对等的使用体验。
- sidecar 的启动、IPC、后台子进程、崩溃恢复和关闭具有明确且可验证的所有权。
- 现有用户设置和加密数据可迁移、可重复迁移、可恢复并可回滚。
- 支持平台完成真实构建、核心行为、安装和升级验证后才能切换默认发行版。
- context isolation、typed preload/IPC sender 校验、workspace 预览及 MCP Apps 隔离不弱化。

### 非目标

- 把现有 TypeScript 业务领域整体改写为 Go。
- 以 route 数量、单条聊天 happy path 或某平台截图替代完整对等验收。
- 为兼容 sidecar 而在业务模块散布 `isSidecar` 分支或复制 `composition.ts`。
- 在验收前删除 Electron 回退路径、改变生产更新服务器或默认发行渠道。
- 使用真实用户数据库、密钥或生产凭据做未经批准的实验。

## 3. 所有权和架构

```text
Go application
  应用生命周期 / 单实例 / 窗口与 tab / 原生菜单与托盘
  原生对话框 / 通知 / 快捷键 / deep link / Secrets / Updater
  受信 renderer 协议 / workspace 预览 / MCP Apps 隔离 / 原生窗口事件
        │ versioned JSON request/event transport
        ▼
Node sidecar
  DeepChat 主进程业务装配 / typed route dispatch
  child process 与 worker 宿主 / 数据库与 Node 原生模块
        │
        ▼
Renderer
  同一份 Vue 应用、renderer API clients 和共享路由/事件合同
```

- **Go 壳**负责需要真实原生资源或包所有权的动作。sidecar 不得通过返回成功、空文件路径或空图片伪装这些动作已经完成。
- **sidecar**负责业务计算和保持现有 typed route/event 语义。渲染器发送者身份必须来自 Go 原生窗口映射和可信传输，不能由页面输入任意声明。
- **renderer**继续通过 `window.deepchat`、`window.api` 和 typed client 调用，不直接获取 Go/Node 原生句柄。
- 当前 Electron 兼容 shim 是迁移层，不是最终正确性的证明。每个保留 shim 成员必须被归类为真实实现、明确转发、允许的空操作或待删除差距；用户可观察功能不得静默降级。

## 4. 传输和生命周期不变量

1. 每个请求有有限生命周期；启动未就绪、未知路由、sidecar 退出和传输损坏均返回可诊断错误，不返回 `{}` 假成功。
2. 请求 id 在单个连接中单调且响应至多一次；慢请求支持取消或调用方超时，事件与响应不得混写非 JSON 日志。
3. sidecar 输出独立 stderr 诊断通道；stdout 仅用于协议。
4. 子进程/worker 在开发构建和打包后都解析到真实存在且可执行的入口，不能依赖 Electron 的 `process.parentPort` 或构建期特殊行为而没有 Node 等价实现。
5. Electron utility process 的 `postMessage` 与消息事件在 Node `child_process.fork` 下保留同一 RPC 语义。
6. sidecar 非预期退出会取消在途请求、通知壳并进入明确的恢复/失败状态；退出会停止所有子进程和 stream。
7. 多窗口调用使用真实窗口和 webContents 身份；不能总是选择“最后一个窗口”。
8. 正式应用启动不自动使用真实用户目录做 smoke；recovery 测试使用临时 profile。

### 4.1 D2b1 已确定的代码组织

Go module 位于 `shell/`。正式应用在 `shell/deepchat`，探测应用在 `shell/spike`，两者使用同一个 `shell/internal/sidecar` 进程合同。spike 保留 probe 和截图能力，不包含产品生命周期实现；正式 Bridge 不暴露 probe Eval。资源目录分为显式 `DEEPCHAT_APP_PATH` 开发仓库和正式 `PathResources` 两种，后者的 Node 使用包内绝对路径且禁止 PATH 回退。

sidecar stdout 有且只有协议 writer 可以写入。`@shared/logger` 在早期绑定的 console 以及业务代码的直接 stdout 写入都重定向到 stderr；非空、非 JSON 行、未知响应 id 和不完整消息必须是协议错误。请求取消后的迟到响应按原 id 消费并丢弃，使后续请求能继续使用同一进程。超时取消不自动重试 mutation。

D2b1 是单窗口、可监督的第一根产品脊柱。D2c1 只关闭真实业务生命周期并补上单项 sidecar 自动恢复；跨窗口身份、deep link、大输入资源治理和产品级隔离等价归入 D2c2，仍不得合并称整个生命周期通过。

### 4.2 D2c1 关闭和恢复合同

- `SidecarLifecycle` 等待现有 `appMain` 的 `before-quit` 完成。只有真实 `app.quit()` 批准后才从 Node 进程退出；同步抛错和可重试注销不能被已完成 Promise 或重复退出请求吞并。
- Supervisor 按进程代次区分响应和事件。请求只发送一次，退出使其返回明确错误；替换进程不得自动重放请求或 mutation。每代共享 Process 的关闭、进程组强杀及 reap 合同；正常及意外根进程退出都清理其剩余所属进程组，并透传实际关闭错误。
- stdout 读管道由壳独立持有，读取与 `Wait` 分离，避免退出关闭截断合法响应或因子进程继承写端而永久阻塞。意外 EOF 不等于进程退出，超过该代关闭 deadline 必须强杀。清理失败独立结束等待和调用，标记终态，禁止在旧子树可能存活时创建新代次。
- 大输入的序列化与实际写入不得占用生命周期状态锁。发送权按 context 等待，并在发送权范围内分配 ID、编码和写出帧，使 wire 顺序与 ID 顺序一致；残缺帧或阻塞写入超时必须终止当前代次，不能在后一请求前拼接不完整 JSON。取消期间发送权保持到实际 writer 完成，发送前再次检查进程关闭状态；关闭首先停止接受新调用，再异步关闭输入并保有强制回收 deadline。
- startup event handler 必须在 reader goroutine 启动前安装，避免立即 ready 被丢失并触发错误的 startup timeout。Windows 使用每代独立 Job Object 和 `KILL_ON_JOB_CLOSE` 处理根进程退出后的子树，不能只依赖根 PID 的 `taskkill`；此项目前只有源码与交叉编译证据，仍需真实 Windows 运行验收。
- 正常关闭和管理器关闭事件不得创建替代进程。连续启动失败默认最多重试 3 次，采用有上限的指数退避；每代有默认 60 秒的可配置 transport-readiness deadline，活着但从不具备可用 IPC transport 的进程必须被强杀并进入同一恢复流程。安装 stdin/关闭处理后的 `sidecar.process.ready` 只解除这个超时，不能加载 renderer、清零失败预算或冒充业务启动完成；数据库等待用户解锁不受该超时误杀。只有真实 `sidecar.app.started` 才清零连续失败计数、触发主 renderer 加载或恢复，未经历这个信号的进程启动不算完整恢复成功。
- 替换进程 ready 后等待真实 renderer reload，不得用单纯 Node 进程存活代替页面注册恢复。失败耗尽后请求返回明确错误，壳进入退出流程。
- 正式生产绑定不包含通用 Eval。mygo 官方 automation 仅在 `e2e` 构建和显式 `MYGO_AUTOMATION` 下启用，用于测试窗口的 DOM、只读 IPC 与实际截图，其余发行构建必须保持该入口关闭。

D2c1 的恢复验收必须包含真实 sidecar 故障注入和新代次 DOM 观察，不能仅依靠 helper 测试或路由数量。它不涵盖多窗口身份、批量流恢复、所有 worker 或平台发行矩阵。

### 4.3 D2c2a 主窗口 caller/source 与 native event 合同

- 每个 renderer 请求的 `source` 由 Go 从已经过 `CallerWindow` / `CallerPage` 验证的调用方生成，包含原生 `windowId` 与当前实际 `documentUrl`；renderer 的 `input` 中同名字段没有授权意义。只有已注册、未销毁的顶层主窗口能通过源校验，嵌套页面不会借用宿主窗口身份。source 分配与编码仍在原单调 write ticket 内，不改变 D2c1 的取消和残帧合同。
- 原生主窗口先由 Go 创建并注册，再启动 sidecar；启动环境只包含该实例真实的 `DEEPCHAT_NATIVE_WINDOW_ID`，缺失或非法时明确失败。业务必须区分两侧 ID 命名空间：`BrowserWindow.id` 对应已注册的原生窗口，`webContents.id` 可以不同。`WindowPresenter` 在登记窗口映射之前通过平台端口绑定主窗口；不能按 Node 的创建序号或任意仍存活的窗口猜 sender。Electron 不注册这个端口，继续由 Chromium 分配身份。
- splash 先于主窗口创建并关闭是现有业务的真实时序。它不能抢占主窗口绑定；未登记的窗口/视图使用不可作为原生 caller 的占位身份，其事件按 webContents 记录一次明确告警后丢弃，不得退化为全窗口广播。每个带目标的 sidecar event 只向匹配的 Go 窗口 `Emit`，全局 quit 控制单独处理。
- 实际页面 URL 取代用于“帮助授权通过”的伪造 `file:` URL。只有显式 Node host 为同一 renderer 资源提供 `mygo://localhost/` 映射；精确入口 `index.html`、settings 和 splash 进入既有授权函数，`frame === mainFrame`、`sender.getURL()` 与 frame URL 一致性仍由原检查执行，未知 origin、路径、带凭据 URL 和预览文档被拒绝。Electron 默认不启用 mygo 文档映射。

本切片建立已注册主窗口的调用和事件归属，但不单独证明第二个真实窗口的异步创建、独立 sender、close→destroy→申请方重绑定、nested WebView 映射或 splash/数据库解锁流程。此处的源文档规则只覆盖主入口；settings 的独立 role/path 规则见 4.4，不通过放宽主入口或来源匹配获得隐式信任。mygo dev URL 流程仍未启用或验证。

### 4.4 D2c2b1 settings 窗口的原生创建和生命周期合同

- `system.openSettings` 继续复用现有 typed route、`WindowPresenter.createSettingsWindow` 和 renderer，不增加平行设置页或通用 `Eval`。Node 通过平台端口请求 Go 确保一个 settings 原生窗口；Go 返回真实 window ID、role 和实际状态后，Node 才能绑定 `ShimBrowserWindow`。没有对应端口的 Electron 保持 Chromium 的创建路径。禁止把负占位 ID、最后创建窗口或任意仍存活 webContents 当作此操作的替代实现。
- sidecar 与 Go 之间增加窄的 `native.window` 命令协议，只支持 settings 创建/复用、允许文档加载、显示、隐藏、焦点、原生应用激活和关闭。Node 的调用方向 ID 使用独立负数命名空间，避免与 Go→Node 的普通请求混淆；response 沿用现有 `id`/`result`/`error` envelope。复用同一 write ticket、物理写入与残帧关闭语义。Manager 为每条命令提供有界生命周期，隔离旧 generation，按到达顺序串行执行命令；队列有界时必须明确背压失败，不能静默丢弃。
- 创建命令必须携带来自当前原生 IPC 调用的 source，而不是 renderer input 或调用方自选的 target。Go 再次核对已注册窗口、顶层 Page、实际 Page URL、role/path；`load` 额外要求目标窗口为该文档允许的 role，settings 仅允许 `/settings/index.html`。加载前的 `about:blank` 不会获得业务 sender。Node 用 `AsyncLocalStorage` 在异步 renderer handler 间保留原调用来源；原生 ready/focus 回调使用 Go 自己提供的窗口描述，不借用另一窗口的上下文。应用激活优先使用该 caller，非 IPC 回调仅可使用启动环境指定的主窗口，不能选择最新或任意窗口。
- `mygo://` 继续由 Go 的精确文件系统服务提供。对实际存在的 `/index.html` 或 `/settings/index.html`，避免 `FileServer` 的相对 `./` 301 重定向使 WebKit 顶层 navigation 停留空文档；保留请求的规范入口 URL，其他资源和路由仍走原有文件服务，不扩大到目录或任意文件读取。
- Go 创建窗口时先保持隐藏，Node 完成本地绑定并开始允许的 settings 文档加载后，真实 ready-to-show 才进入现有显示流程。ready、focus/blur 和 closed 通知携带 Go 已注册 ID；Node 只更新已经绑定的对应窗口。closed 必须移除 sender 并使本地 wrapper/settings 单例进入不可再调用状态。原生回调不在 mygo 主线程执行管道 I/O；通知发送失败必须记录，不能代替实际窗口完成证据。
- sidecar host principal 与 renderer source 必须互斥，renderer input 不能提升为 host。`BrowserWindow.close/destroy` 和创建失败补偿是受信主进程操作，必须显式进入 host domain，不能继承已经过期的 IPC caller；普通 show/focus/load 仍保留原 caller，caller 校验失败也不能自动提升为 host。host action 仍受目标 role 和当前实际文档约束，只有 settings 创建失败后的 `about:blank` 允许 host close；空白文档不能因此获得业务 IPC。native wrapper 对未知成员可以明确记录兼容 gap，但必须保持非 thenable，避免 `await` 把 no-op `then` 当成异步契约并永久等待。
- close request 不等于 closed：创建/立即重开必须等待真实 closed 通知，构造、绑定或导航失败必须释放对应原生窗口。Go→Node 状态以单调 sequence 拒绝迟到事件，ready/focus 不得解除 pending close；同窗口通知按原生顺序 remove-and-append 合并，closed 清除尚未送达的 ready/focus。close 失败必须按独立 attempt 回滚最新状态并允许重试，并发 navigation 必须返回实际完成导航/重建后的窗口 ID。Electron 路径继续使用真实 Chromium 事件，不经过 Go sequence。
- 本切片的验收目标是两个同时存活的真实原生窗口、独立 window/webContents 身份、settings IPC、按 window 的事件和实际关闭/重新创建。尚未覆盖 sidecar 替换时 settings 的自动恢复绑定、多个普通聊天窗口、splash/数据库解锁的实际 native 界面、nested `WebView` ID/frame 隔离，以及全局背压/内存预算。主窗口已有的恢复行为保持在正常 generation 下验证；不据此宣称第二窗口恢复完成。

### 4.5 D2c2b2 sidecar 代次间恢复 settings 原生绑定

- 实测已经证明：sidecar 异常退出后，主窗口 reload 可以恢复，但存活的 settings 保留完整旧 DOM 并因 Node 缺少原生绑定而拒绝 `IPC source has no live native window binding`。因此恢复验收不能只检查旧窗口、旧 DOM 或进程存活，必须验证新代实际 sender、renderer/preload 重建和业务调用。
- Go 在每一代 Node 进程启动时重新采集当前已注册 settings 的 `NativeWindowDescriptor`，通过只读启动环境 `DEEPCHAT_NATIVE_SETTINGS_SNAPSHOT` 注入该代 sidecar；不得复用第一代环境或把旧启动状态当作恢复成功。快照只包含窗口身份、role、当前文档、sequence、显示/焦点和 close 状态，不包含 renderer input、凭据或业务 mutation。Manager 每代重新求值附加环境，无存活 settings 时也必须写入空快照覆盖继承环境，原有单调 generation、启动 deadline 和失败恢复不变。
- 代次切换必须先更新 Manager generation，使尚未执行的旧队列命令失效，再等待已经进入 `OnCommand` 的同步原生工作结束，最后求值启动环境。这样旧代 `ensure_settings` 不能越过空快照再注册隐藏窗口；回复仍按旧代丢弃，且不得通过这个屏障重放 mutation；等待期间收到 Manager.Close 时也必须在启动前重新检查 stopping。
- Node 在 `startApp` 前使用同一 descriptor parser 校验快照，要求正整数 ID 和 settings role，并写入与后续原生通知共享的状态序列。非法快照必须明确启动失败，不能猜窗口或退化为无主 sender。Electron 不读取这个环境，继续使用 Chromium 原生窗口。
- 启动恢复只能消费一次快照，并将当时仍存活的 descriptor 传给 `WindowPresenter` 现有 settings 创建、事件监听、ready 和 pending-message 管线。该路径不得调用普通 `ensure_settings` 来创造替代窗口；快照之外的正常用户打开仍走 D2c2b1。恢复需要绑定实际原生 ID 并重载 renderer：允许的 `mygo` settings 文档保留其 path/query/hash，半创建的 `about:blank` 使用正常 settings 入口；不得重放崩溃前未确认的 mutation。
- closed tombstone、缺失缓存、`closeRequested`、已有 wrapper 处于关闭中，或恢复期间到达的真实 close 都使本次恢复结束，不得等待后自动重建或申请一个新 ID。并发用户打开与恢复仍共用一个 `settingsWindowCreation`，但只有明确的用户新建操作可以进入普通 ensure/create。恢复失败必须记录并按 role/window ID 清理实际窗口或明确保留原因，不能静默留下一个看似正常但无 sender 的旧 DOM。
- 验收必须在真实 macOS disposable profile 中杀死旧 sidecar，确认新代主窗口恢复之外，settings 也完成真实 renderer/preload 重建、ready、独立 sender、业务调用与目标事件；旧 renderer 标记必须消失。另在 replacement 启动期间关闭 settings，最终只能保留主窗口，不得从快照重新创建设置窗口。此项不包含多普通聊天窗口、splash/数据库解锁或 nested Page。

### 4.6 D2c2b3 真实 splash/数据库解锁窗口

- `SplashWindow` 的既有显示延迟、主窗口抑制、解锁/恢复请求、取消与关闭语义保持不变，不复制另一套数据库决策或表单。Go 新增受控 `splash` role 和 `ensure_splash` 命令，按 420×340、隐藏、透明、无边框、禁止移动/缩放、置顶的真实窗口返回 descriptor；Node 取得该身份后才能绑定并导航，未绑定 `loadFile/loadURL` 继续明确失败。Electron 保留 Chromium 路径。
- 唯一静态应用入口为 `mygo://localhost/splash/index.html`。`loadFile` 只把实际存在且为文件的精确 splash entry 映射到该 URL，缺失时必须拒绝并让既有回退接管，不能把 mygo 缺失资源的空文档当作加载成功；`loadURL` 不接受其他 origin/path，内联 `data:text/html;charset=utf-8,` 回退仅由受信 `SplashWindow` 生成且原文长度受限。mygo 对 opaque data origin 的 `data:///` trust 只用于该 splash，不使用通配 origin；Go 仍逐次校验精确前缀、65,536 字节上限和 role/channel。`about:blank` 仅用于创建/清理阶段，不是正常 caller。通用 Eval、任意外链和普通业务文档都不能借 splash role 获得权限。
- 正常 splash Vue renderer 与 inline 回退共用同一 `createSplashApi` 业务逻辑，分别注入 Electron ipcRenderer 或受限 mygo port。其独立 preload 复用现有常量、请求监听/退订和提交参数校验，不能弱化 Electron `contextBridge`；Go preload 使用 mygo 原生取消订阅。状态事件可能早于 Vue `onMounted` 到达，preload 必须缓存当前状态，并按原始跨 channel 顺序在一次微任务中重放；逐 channel 立即重放会把旧 `progress(active=true)` 放在新 request 之后，错误覆盖 manual-unlock 表单。生产资源布局必须包含并校验专用 splash bundle，缺失时明确失败。
- unlock submit/cancel 与 recovery submit/cancel 是仅有的四条原生源 channel。Go 根据已注册 splash Page、实际文档、固定 channel 和 JSON envelope 复核后交给 sidecar，Node 再交给 `SplashWindow` 既有 `ipcMain.on` 监听者；不得经过通用 route dispatcher 自创 mutation。事件仍按真实 window ID 回到同一 Page。它们不能等待数据库路由 readiness，否则形成解锁死锁。
- 早期语言读取必须与实际 `config.getLanguage` 使用同一个 `settingsStore`、`DesktopSettings` 的 locale 规则和 route output schema。仅当当前已验证文档为 splash 时，`config.getLanguage` 可以在早期 reader 已注册后直接读取；`data:` 回退只能执行该只读查询及上述四条 channel，其他业务 route 保持拒绝。其他文档和所有 mutation 均必须等待正常 appReady 与调用方校验。
- 启动主窗口与 splash 均先隐藏。mygo 的 DidFinishLoad 不携带导航 ID，不能只比较回调时的当前 URL。Go 必须记录每个 Page 的 OnDidNavigate committed URL/revision；load Promise 仅接受本次调用之后提交的目标代次，并再次要求当前目标 URL 精确一致，创建时 `about:blank` 不得提前 resolve。ready 只能来自已提交的允许文档，hash 路由是同文档状态而非新代次，origin/path/query 仍需一致。目标 DidFailLoad 继续按目标 URL 进入回退；Windows/Linux 失败事件的真实 URL/导航 ID 语义仍需实机验证，不能由 macOS 推断。仅 fragment 变化的同文档导航不能要求新 commit：WebView2 的 ContentLoading 不因这种导航触发。此时必须已有同 origin/path/query 的已提交文档，精确目标 URL 已生效且原生 loading 已结束；若无完成回调，只能有界观察当前 URL/loading，不得无限等待新代次。未变化 URL 的 reload 仍走新文档代次。主窗口的早期 ready 在 Node 绑定并安装现有监听器后重放，不得提前展示主窗口或永久隐藏。随后沿用现有 SplashWindow suppress/close 和真正 closed 通知，不能用占位 wrapper 的删除冒充窗口销毁。
- 验收先用正常临时 profile 验证真实 splash、DOM、语言、显示/关闭及主窗口切换，再以复制加密 fixture 触发实际错误密码→有效密码与 recovery/cancel，核对 requestId、数据库结果、原文件保留和业务日志；密码不得进入日志、截图或提交。另覆盖静态入口失败回退、非 splash 文档拒绝、未知 channel 拒绝和 sidecar 重启期间的确定性行为。Windows/Linux、正式打包、真实用户数据迁移与 mygo content-world 差距仍单列，不能由此切片推断完成。

## 5. 后台进程与 worker 合同

现有 file watcher、cron scheduler、background exec 和 code-mode host 共享一种窄的 parent-port 合同：`postMessage`、`message` 监听和可选 `start`。Electron 使用 `process.parentPort`，Node 使用 `process.send` 与 `process.on('message')` 适配，同一 utility host 主体不得复制两份。

`?modulePath` 在 sidecar 构建中必须产生实际 worker entry，并在运行时解析为相对 sidecar 产物的文件 URL；不能只保留未编译源码路径。SkillSync worker 必须返回其结构化结果，只有经过实测证明 worker 不可用时才允许记录并使用已有 fallback。

这类后台入口的最小验收必须包含真实进程或 worker IPC 往返，不能只依靠 TypeScript 编译或存在文件。

## 6. 原生、安全和数据兼容

- 密钥正式存放在 OS 凭据库，由 Go 通过受控启动通道注入 sidecar。当前用户目录中的 `sidecar-secret-key` 是明确的不安全开发方案，不满足发布要求。
- Electron safeStorage 密文迁移使用复制 fixture 覆盖：首次升级、重复启动、错误密钥、缺失密钥、中断、备份恢复和回滚。日志不得出现明文或密钥材料。
- 自定义 scheme 的调用方、导航来源和可执行内容按信任等级限制。预览不得获得应用源权限；不允许 app-origin `srcdoc` 同时拥有脚本和同源访问。
- mygo v0.7.4 在 macOS 使用三参数 `WKUserScript` 初始化器，未声明独立 content world。正式壳必须提供经过评审的隔离等价实现或上游隔离能力，不能把仅提前注入 preload 宣称为 Electron context-isolation 对等；spike 的通用 `Eval` 绑定和任意外链转发不得进入产品绑定。
- 文件对话框、协议注册、单实例、更新与安装必须返回真实结果；无实现时应报明确 unsupported，而不是 `canceled:false`、`true` 或空成功。
- OAuth 的外部回调缺口不能通过放宽 sender/URL 校验绕过。

## 7. 实施顺序

优先恢复当前业务运行时的真实执行能力，再建立正式壳，之后做窗口/原生能力、数据迁移、打包更新和跨平台验收。具体切片和完成状态只记录在 `plan.md`。

优先级遵循：

1. 修复会立即终止后台进程、导致错误或静默降级的实际运行时问题。
2. 建立可重复启动的正式壳和可靠 sidecar 生命周期/传输。
3. 完成窗口、原生协议和安全边界。
4. 完成功能矩阵、异常路径和性能验证。
5. 完成数据迁移、三平台打包更新及获授权的默认切换。

## 8. 整体验收条件

以下条件都需当前证据证明：

- 正式应用覆盖保留功能，无影响用户的隐藏 noop 或未披露降级。
- Electron utility process 和 worker 在 sidecar 中真实运行；崩溃、取消、慢流和重启路径通过。
- 本地与打包后的聊天、Agent、MCP、workspace、设置和关键 UI 流程通过。
- 数据迁移幂等且可回滚，无真实密钥/用户数据进入仓库或日志。
- Windows、Linux、macOS 各自执行其构建与核心 smoke，不以跨平台编译代替运行。
- 安装、卸载、deep link、文件关联、自动更新和运行时资源分发通过。
- 完整约定质量门禁通过，已知失败逐项记录且不得用于宣称完成。
- 最终发行切换和 Electron 删除已获得明确授权并执行。
- 工作树干净，最终提交推送至 `https://github.com/zerob13/deepchat.git` 的指定分支。
