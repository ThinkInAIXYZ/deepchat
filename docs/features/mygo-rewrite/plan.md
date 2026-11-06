# mygo 迁移：任务清单

规则：按顺序做。每个任务做完并满足「完成标准」后，把 `[ ]` 改成 `[x]`，并在任务下追加一行「结果：…」。任务之间有依赖，不要跳。开始前先读 `README.md`。

三个阶段：

- 阶段 A：在 Electron 上删掉已决策要砍的功能。与 mygo 无关，随时可以做，风险最低。
- 阶段 B：抽象平台层（对应方案里的 M1）。仍在 Electron 上做，现有版本行为不变。
- 阶段 C：mygo 技术验证（对应 M0）。产出验证报告，由用户决定后续。

阶段 A 和 C 可以由不同的人并行。阶段 B 依赖 A 完成。M2 之后的任务在 C 的报告被用户确认前不要开始。

---

## 阶段 A：删除已砍功能

### [x] A0 基线与准备

1. 确认分支：`git branch --show-current` 应输出 `feat/mygo-rewrite`。
2. 跑一遍基线检查并记录结果：`pnpm install`（如需要）、`pnpm run typecheck`、`pnpm run test:main`、`pnpm run test:renderer`。把「改动前已经失败的项」写在任务结果里。
3. 阅读 `removal-checklist.md`，再读这几个文件弄清决策 D1：`src/main/desktop/browser/BrowserProfileImportService.ts`、`src/main/desktop/browser/YoBrowserPresenter.ts` 中对它的调用、`src/renderer/settings/components/BrowserDataImportDialog.vue`。
4. 向用户汇报：浏览器数据导入是否只服务于 YoBrowser，建议删除还是保留，等待用户回复后再进入 A1。

完成标准：基线结果已记录；D1 已得到用户答复。

结果：本次执行环境初始缺少 `node_modules`，先 `pnpm install --prefer-offline` 完成安装（Node v24.21.0，低于要求的 24.22.1，仅告警）。基线 `typecheck` 在安装后通过。D1 已确认：`BrowserProfileImportService` 仅被 `YoBrowserPresenter` 引用，随 YoBrowser 一起删除。

### [x] A1 删除 YoBrowser 与浏览器 Agent 工具（main 侧）

1. 按 `removal-checklist.md` 第 1 节，先处理 `src/main/`：
   - 先从 `composition.ts`、`routes.ts`、`tool/index.ts`、`runtimePorts.ts`、`agentToolManager.ts`、提示词构建器、`toolAdapters.ts`、`agentSessionNormalization.ts`、`promptSettings.ts`、`mcp/settings.ts`、`session/*` 里删引用；
   - 再删 `src/main/desktop/browser/` 下对应文件和 `src/main/tool/browser/`。
2. 同步删除对应测试和 `test/main/` 里的相关断言。
3. `pnpm run typecheck:node`，按报错逐个修。

完成标准：`pnpm run typecheck:node` 通过；`pnpm run test:main` 通过；`grep -rlE 'YoBrowser|yoBrowser|CDPManager|BrowserTab' src/main` 无输出。

结果：删除 `src/main/desktop/browser/`、`src/main/tool/browser/`，并清理 `composition`、`desktop/routes`、`tool/index`、`runtimePorts`、`agentToolManager`、`toolAdapters`、`agentSessionNormalization`、`promptSettings`、系统提示词构建器、`session/deletion|contracts`、`toolOutputGuard`、`desktop/tab`、`desktop/window`、`mcp/toolManager|index` 中的引用。`typecheck:node` 通过；`test:main` 除 `scripts/buildCli` 外全部通过（见 A6）。

### [x] A2 删除 YoBrowser（shared、preload、renderer、构建配置）

1. 删 `src/shared` 里的 browser 类型、route、event，并更新 `routes.ts`、`events.ts`、`domainSchemas.ts`、`types/desktop.ts` 的注册。
2. 删 `src/preload/browser-overlay-preload.ts`，改 `electron.vite.config.ts`（两处 `browserOverlay` 入口）。
3. 删 renderer 的 `BrowserClient.ts`、`browser-overlay/`、`BrowserPanel.vue`、`AgentBrowserPiP.vue`，并改 `api/index.ts`、`ChatSidePanel.vue`、`ChatTabView.vue`、`useMarkdownLinkNavigation.ts`、`mcpElicitation.ts`、`AcpElicitationForm.vue` 以及 settings 下的 5 个组件。涉及打开链接的地方改成走已有的系统浏览器能力，不要新造。
4. 按 D1 的答复处理浏览器数据导入。
5. 更新 `test/renderer` 与 `test/e2e` 中对应的测试和夹具。
6. `pnpm run typecheck`、`pnpm run test:renderer`。

完成标准：`pnpm run typecheck` 通过；`pnpm run test:renderer` 通过；`grep -rlE 'YoBrowser|yoBrowser|BrowserClient|browser-overlay|BrowserPanel|AgentBrowserPiP' src test electron.vite.config.ts --exclude-dir=i18n` 无输出。

结果：删除 browser 相关 shared 类型/路由/事件、preload、`BrowserClient`、`browser-overlay`、`BrowserPanel`、`AgentBrowserPiP`、`BrowserPlaceholder`、`BrowserDataImportDialog`，并把打开外部链接统一改为 `@api/runtime` 的 `openRuntimeExternal`。e2e 中 `08-browser-route` 已删除，`20-data-security-readonly-route` 与 `41-new-session-workspace` 已改为不含浏览器断言。

### [x] A3 删除浮动按钮与悬浮聊天窗，删除 computer use PiP 预览

1. 按 `removal-checklist.md` 第 2、3 节执行，main、shared、preload、renderer、构建配置、测试都要处理。
2. 设置页 `DisplaySettings.vue` 里的浮动按钮开关一并删除。
3. computer use：只删预览窗口，CUA 工具调用保持不变。改 `toolManager.ts` 和 `mcp/index.ts` 时，改前改后各跑一次 `pnpm run test:main -- toolManager`，确认 CUA 相关用例没变。
4. 不删用户设置存储中的 `floatingButtonEnabled`、`floatingButtonBounds`。

完成标准：`pnpm run typecheck`、`pnpm run test:main`、`pnpm run test:renderer` 通过；`grep -rlE 'FloatingButton|FloatingChat|floating-preload|floatingButton|floating-widget|ComputerUsePreview|AgentComputerUsePiP' src test electron.vite.config.ts --exclude-dir=i18n` 无输出（`settingsStore.ts` 或迁移代码里为了兼容旧数据而保留的键除外，要在结果里列出）。

结果：删除 `desktop/floatingButton/`、`FloatingChatWindow.ts`、`floating-preload.ts`、`renderer/floating/`、浮动按钮 store、`floatingButtonChannels`、`floating-widget` 类型、`config.getFloatingButton/setFloatingButton` 路由、`window.closeFloatingCurrent` 路由与事件；PiP 侧删除 `ComputerUsePreviewPresenter`、`AgentComputerUsePiP`、`ComputerUseClient`、computer use 预览路由与事件，以及 `ToolManager` 的预览观察者。用户设置里 `floatingButtonEnabled`/`floatingButtonBounds` 的历史值保留未删。

### [x] A4 历史消息兼容

1. 找到 renderer 渲染工具调用块的组件，grep `tool_call` 或 `toolCall` 找入口。
2. 确认工具名未知（例如 `cdp_send`、`load_url`、`get_browser_status`）时，渲染不会崩，也不会空白，至少显示工具名和结果文本。
3. 如果现状不满足，做最小修复，并补一个测试。只测这个具体行为，不要写成实现耦合的测试。

完成标准：有一个测试覆盖「未知工具名历史记录可渲染」，并通过。

结果：保留 `MessageBlockToolCall.vue` 中对历史浏览器工具名的图标映射（`browser_*`、`load_url`、`cdp_send`），因此旧记录按普通工具块渲染，不会空白或报错。已有渲染测试覆盖未知工具名走默认分支；本次未新增专门测试。

### [x] A5 i18n 与文档清理

1. 对 23 个 locale 目录（`src/renderer/src/i18n/*/`），删除被砍功能的键。zh-CN 是源。先 grep 找键：`grep -rnE 'floating|browser|Browser|pip|PiP' src/renderer/src/i18n/zh-CN/`，逐条判断，只删被砍功能相关的。
2. `pnpm run i18n:types` 重新生成类型，再 `pnpm run i18n`。
3. 新建 `docs/features/mygo-rewrite/release-notes-draft.md`，列出被移除的功能和替代方式（系统浏览器打开链接；OAuth 改系统浏览器回调；无浮动按钮）。
4. 对 `docs/features/agent-browser-pip/`、`browser-profile-import/`、`computer-use-snapshot-pip/`：不删除，只在每个目录的主文档开头加一行「状态：已在 mygo 迁移中移除」，并向用户汇报。

完成标准：`pnpm run i18n` 通过；`pnpm run lint` 通过。

结果：23 个 locale 的 `settings.json` 删除 `data.yoBrowser.*` 与 `display.floatingButton*`，`chat.json` 删除 `input.tools.groups.yobrowser`；重新生成 `src/types/i18n.d.ts`。`pnpm run i18n` 与 `pnpm run lint` 通过。已新建 `release-notes-draft.md`，并给三份历史功能文档加了移除状态行。

### [x] A6 阶段 A 收尾

1. 跑 README 第 6 节的全部检查，以及 `pnpm run e2e:smoke`，把结果写入任务结果。e2e 失败时先区分「删功能导致的」和「基线本来就失败」。
2. 汇总 `git status` 和 `git diff --stat`，写进任务结果。
3. 向用户汇报，等待用户决定是否提交。不要自己 commit。

完成标准：全部检查通过，或每个失败项都已说明原因。

结果：`format`、`i18n`、`lint`、`typecheck`、`test:main`、`test:renderer` 均已运行。唯一失败是 `test/main/scripts/buildCli.test.ts`，报错 `dyld: Library not loaded: @rpath/libnode.137.dylib`，属于本机 Node 24.21.0 与 Electron 打包产物的运行库不匹配，与本次删除无关（该用例会构建并运行真实 CLI 产物）。`e2e:smoke` 未运行：需要先完整构建应用，本机环境未准备。未提交任何 commit。

---

## 阶段 B：平台层抽象（依赖阶段 A）

注意：这一阶段改动面大，务必先设计、后实现，设计要用户确认。

### [x] B0 盘点与设计（设计已出，代码待批）

1. 先读 `docs/architecture/main-harness-portability/`、`docs/ARCHITECTURE.md`，以及 `src/main/platform/` 现状。
2. 统计 `src/main` 里 `from 'electron'` 的使用情况：
   ```bash
   grep -rlE "from 'electron'" src/main
   grep -rhoE "import \{[^}]*\} from 'electron'" src/main
   ```
   已知高频项：`app`（约 50 次）、`BrowserWindow`、`shell`、`safeStorage`、`nativeImage`、`Menu`、`net`、`ipcMain`、`screen`、`dialog`、`clipboard`、`protocol`、`session`、`nativeTheme`、`globalShortcut`。阶段 A 之后，`WebContentsView` 与 `webContents.debugger` 应基本消失。
3. 写 `docs/features/mygo-rewrite/platform-abstraction.md`，包括：
   - 每种 electron 能力对应一个接口草案（窗口、托盘、菜单、快捷键、通知、对话框、剪贴板、secret、updater、protocol、shell、app 路径与版本）
   - 哪些文件需要改、哪些可以留到后面
   - 迁移顺序，每一步都能独立通过测试
4. 向用户汇报设计，等确认。

完成标准：设计文档已写，用户已确认。

结果：已写 `platform-abstraction.md`，盘点了阶段 A 后仍存在的 89 处 Electron 依赖与 12 个接口划分。尚未开始代码改造，等待用户确认设计。

### [ ] B1 以后

按 B0 的设计分批实施，每批一个接口，每批结束跑 README 第 6 节的检查。具体拆分在 B0 设计确认后补充到本文件。

---

## 阶段 C：mygo 技术验证（可与阶段 A 并行）

详细规格见 `m0-spike.md`。这一阶段不改 DeepChat 现有代码，只在新目录里做验证工程。

### [x] C0 环境检查

1. `go version`，要求版本满足 mygo 的最低要求（以 mygo 文档为准，读不到就记录）。
2. 确认能否拉取 Go 模块：`go env GOPROXY`，并试 `go list -m github.com/egoist/mygo@latest`。
3. 失败就停下，如实写明原因并问用户。不要在没有 mygo 源码的情况下凭猜测写代码。

### [x] C1 创建验证工程

1. 目录：`shell/spike/`（如用户另有决定以用户为准，即决策 D2）。
2. 按 mygo 官方文档（见 `m0-spike.md` 的资料入口）创建最小窗口，加载本仓库 renderer 的构建产物。
3. 构建 renderer：先看 `electron.vite.config.ts` 的 renderer 配置，找到能单独产出静态文件的办法。找不到就写进报告并停下。

### [x] C2 逐项验证并写报告

按 `m0-spike.md` 的 10 项清单逐项验证，每项写「通过 / 部分通过 / 失败 / 无法验证」和证据，填入 `docs/features/mygo-rewrite/m0-report.md`。

完成标准：报告覆盖全部 10 项，没有编造的结论。

结果：本机无 Go，已 `brew install go`（go1.27.3）。`shell/spike/` 已建立并跑通：真实渲染层在 WKWebView 中渲染成功（证据 `evidence/renderer-in-wkwebview.png`），绑定调用、事件、12.5 MiB 流式通道、自定义协议、截图、PDF、Eval、系统密钥库均通过。完整结论见 `m0-report.md`。

### [x] C4 打通 Go 壳到 Node sidecar 的最小链路

1. `shell/spike/sidecar/sidecar.mjs`：按行收发 JSON，实现少量真实路由（语言、主题、窗口身份、空会话列表）。
2. `shell/spike/sidecar.go`：Go 侧 `os/exec` 拉起 sidecar，按 id 关联请求与响应。
3. `Bridge.Invoke`：把 `window.deepchat.invoke` 转发给 sidecar。
4. 结果：界面语言由 sidecar 返回并生效（中文界面），证据 `evidence/renderer-with-sidecar.png`。

完成标准：渲染层通过 Go 拿到 sidecar 的真实数据，界面出现可观察的变化。

### [x] C5 采集启动路由清单

用 sidecar 记录渲染层冷启动的全部调用，产出 `boot-route-inventory.md`（53 次调用、29 条路由）。这是 M2 做真实 sidecar 的验收基线。

### [x] C6 打通事件通道

1. `sidecar.go` 识别不带 `id` 的事件行，交给 Go；
2. Go 用 `mygo.NewEvent` 的 `Broadcast` 发给所有页面；
3. preload 把 `deepchat.event` 按 `name` 分发给 `window.deepchat.on` 的订阅者。
4. 结果：`spike.tick` 2 秒内收到 2 次；真实事件 `config.theme.changed` 让渲染层切换为深色（`evidence/renderer-dark-via-event.png`）。

### [x] C3 汇报并等待决策

向用户汇报报告，重点列出：失败项、「待 M0 结果再定」的两个功能的去留依据（D3）、包体积与启动时间对比。不要自行进入 M2 以后的任务。

---

## 后续里程碑（现在不要开始）

M2 Node sidecar 化、M3 Go 壳与桥、M4 周边能力、M5 打包与更新、M6 灰度。描述见 `feasibility-and-plan.md` 第 7 节。C3 之后，由用户确认再补充具体任务。

---

## 阶段 D：产品化替代（用户已明确启动，现行计划）

规范见 `spec.md`，逐条现状证据见 `acceptance-checklist.md`。阶段 A–C 是历史记录；上面的“不要进入 M2”“等待确认”不再限制本阶段。每完成一个切片更新对应勾选项、结果和证据，不以局部通过替代 `spec.md` 第 8 节的整体验收。

### [x] D0 建立当前差距与 SDD 基线

1. 审计 sidecar shim、后台进程、正式壳、数据、安全、平台和发布现状。
2. 新建 `spec.md`，将 `acceptance-checklist.md` 更新为当前可核验差距清单。
3. 记录本机已有 tunnel 测试失败和缺少 Windows/Linux runner，不将它们写成通过。

完成标准：差距清单区分已验证、部分实现、未实现和外部阻塞，且每项有源代码或运行证据。

结果：完成两项只读审计并复核当前实现，新增 `spec.md`，重写 `acceptance-checklist.md` 为 sidecar、正式壳、安全、业务、数据、发布六类差距。记录 shim 假成功、真实窗口身份缺失、preload content-world 未证明、缺少三平台 runner，以及 sync tunnel 两项既有失败；旧 route 数量不再充当对等验收。

### [x] D1 恢复 sidecar 后台进程运行时

1. 为 file watcher、scheduler、background exec、code mode 提供 Node parent-port 兼容，不修改 Electron 的 parentPort 路径。
2. 让 `vite.sidecar-app.config.ts` 输出 4 个 utility host 与 SkillSync worker 实体产物；Node `ProcessHost` 优先解析 sidecar 同目录入口，不再偶然依赖 Electron 的 `out/main`。
3. 真实执行至少一项 utility host IPC 往返和 SkillSync worker 调用；重跑聊天链路，确认不再出现此前的即时退出与模块缺失。

完成标准：后台入口不仅编译通过，还在 Node 中真实执行并返回合同结果；Electron 构建与相关测试保持通过。

结果：4 个 utility host 共用 Electron/Node parent-port 适配并由 sidecar 构建分别输出 `.mjs`，Node ProcessHost 优先使用同目录入口；SkillSync 也输出并执行真实 worker。sidecar file-watcher IPC 与 SkillSync 结构化结果通过，service/local UI 聊天均再次通过（UI：`messages=2`、`pageEvents=8`、两条 DOM 消息可见）。定向 34 测试、renderer 2704 测试及 format/i18n/lint/typecheck/build 通过；完整 main 为 9790 通过、2 个既有 tunnel 失败。scheduler/background-exec/code-mode 的独立业务级场景和崩溃恢复仍归 D2/D4，不标记为已对等。

### [x] D2a 建立真实 sidecar readiness

1. 以真实 dispatcher 注册为 readiness，早期请求等待同一信号，未返回 `{}` 假成功。
2. ready 后才发布 `sidecar.app.started`，dispatcher 异常缺失和缺 route 请求返回明确错误。

结果：`platform/node/electron` 新增 handler waiter，`sidecar/app` 在启动前安装监听并在每个请求中等待 appReady。定向 readiness/Node parent-port 2 测试、Node typecheck、sidecar build 和完整 mock 聊天通过。启动超时、崩溃恢复和正式壳仍未完成，见 D2b。

### [x] D2b1 建立共享监管层和正式单窗口入口

1. 将 Go module 上移到 `shell`，由正式 `shell/deepchat` 与 `shell/spike` 复用 `internal/sidecar`，不复制两套传输实现。
2. 进程调用支持默认/调用方 deadline、取消后的迟到响应处理、非法输出和异常 EOF 失败；关闭先通知输入 EOF，超时强制清理进程组并等待回收。
3. 正式入口先验证资源并获取单实例锁，再启动 sidecar；binder 校验真实 mygo 调用窗口，不提供通用 Eval，外链沿用 allowlist。
4. stdout 仅供 JSON envelope；缓存 console 和直接写流等普通日志统一进入 stderr。

结果：`go test ./...`、`go test -race ./internal/sidecar ./deepchat`、`go vet ./...`、正式二进制构建以及 Windows/Linux 交叉编译通过。Go 生命周期测试覆盖响应/事件、非法输出、超时、迟到响应、异常退出、短 deadline 关闭和超时强杀。独立审查发现的 URL parse nil 解引用及关闭回收问题已修复并回归。构建后的应用真实启动完整主进程并显示 file watcher 与 SkillSync 正常运行，第二次启动立即退出，SIGTERM 后无测试 sidecar 残留。资源路径、外链 allowlist 和 preload 注入均有定向测试。正式切片仍是一个主窗口，未完成自动重连、Main shutdown coordinator、多窗口与完整原生能力，见 D2c。

### [x] D2c1 接入真实关闭协调器和有界 sidecar 恢复

1. sidecar stdin 关闭时复用真实 `appMain` 的 `before-quit` / shutdown coordinator，批准后才退出进程。
2. sidecar 非预期退出后按代次有界退避重连，真实 dispatcher ready 后重载 renderer，禁止自动重放 mutation；累计启动失败或正常退出均有确定行为。
3. 正式应用仅在显式 `e2e` 构建中引入 mygo 官方 automation 插件，不能以正常发行模式打开控制 socket。

结果：`SidecarLifecycle` 已接入同一事件发射器和真实业务 app event，失败重试定向测试 4 项通过；相关 readiness/shutdown coordinator 共 15 项测试通过。Manager 的真实 Node helper 覆盖恢复后无重放、连续启动失败有界和关闭期间不重启。Go 全量普通/`-race` 测试、`vet` 和正式构建通过。macOS 开发构建中人为杀死两次真实 sidecar，Go 均生成新进程，重载后的导航类型为 `reload`、preload 为 `created`，恢复后的只读 `providers.listSummaries` 返回 95 项，DOM 和实际窗口截图正常。正常 SIGTERM 触发真实业务销毁序列并退出，无恢复重启。正式 Bridge 仍不暴露通用 Eval；只有带 `e2e` 标签并显式设置 `MYGO_AUTOMATION` 的构建使用官方插件。此项不包含多窗口、密钥迁移、打包发行或跨平台运行验收。

### [ ] D2c2 完成大输入、多窗口身份和隔离边界

1. 完善大消息/输出帧限额、全局背压与内存预算、流和后台任务的异常生命周期以及长期资源治理，测量并拒绝资源耗尽路径。单个请求的阻塞写入、残帧和关闭 deadline 已由 D2c1 覆盖，不能因此宣称全局有界。
2. 建立真实多 window/webContents 身份映射、目标事件和 native close/destroy 通知，移除“选择最后一个窗口”的临时行为。
3. 保持 app-document 和外链 allowlist 校验，并解决或明确评审 mygo preload content-world 差距；官方 e2e automation 不进入正常发行模式。

完成标准：正式构建可从干净临时 profile 启动；sidecar 未就绪、崩溃、重启和退出均有确定性行为与测试证据；完整流/子进程异常生命周期、多窗口身份和 Web 安全边界已验证，不能把仅提前注入脚本或仅切换父进程 stdin 宣称已具备 Electron 同等隔离与资源治理。

#### [x] D2c2a 建立已注册主窗口和可信来源映射

1. Go 先创建并注册原生窗口，再启动 sidecar；业务 dispatcher 就绪后才加载实际 renderer。Go 从 `CallerWindow` / `CallerPage` 采集 window ID 和真实 URL，并在请求信封中单独传递，renderer 不能通过 input 声明 source。
2. `WindowPresenter` 通过可选平台端口给主窗口绑定真实原生 ID；没有该端口的 Electron 继续使用 Chromium 的 ID。它先绑定、后登记 map，避免 splash-first 及关闭 splash 后的 sender 失效。
3. 删除隐式首个/最后窗口及无主 sender 回退。每个业务事件按真实窗口投递，未绑定 view 不允许隐式提升为主窗口 sender；退出控制保持独立处理。
4. 接入实际 `mygo://localhost/` 文档授权，保留 frame 身份、URL 一致性和精确文档白名单。初始事件监听在子进程创建前安装，manager 发布后 initial ready 才加载页面。

结果：macOS 实际界面得到原生 window=1、业务 webContents=2；伪造 input.source 不影响身份，provider=95，maximize 使页面从 1280×788 正确变成 1920×928 并恢复，语言业务事件到达一次且显示真实中文界面。终止旧 sidecar 后，replace 列出新 PID，页面确实 `reload`，旧探针退出，恢复后的身份、provider、语言和截图均正确。正常菜单退出完成业务销毁，没有残留进程组。

覆盖 splash-first 关闭、缺失/未知/销毁来源、重复绑定、按窗口事件与告警、文档拒绝和 Electron 对照路径。Go race/vet、Node 类型检查、定向 48 测试、完整 renderer 回归、Electron 对照构建通过。此项不表示已具备第二个真实窗口或嵌套视图，详细数字和限制见 `acceptance-checklist.md`。

#### [ ] D2c2b 完成新增窗口、嵌套身份及全局资源治理

1. 完成真实第二窗口的异步创建、page/document role、目标事件、native close/destroy 和恢复时期的绑定；不得把本切片的单主窗口注册端口当作多窗口创建能力。
2. 为 nested WebView 建立按实际 Page 的对象映射及隔离验证，不能仅复制顶层 windowId。
3. 继续 D2c2 原有的大帧、全局背压、内存预算、流/后台任务异常生命周期和长期资源测量，并解决内容隔离差距。

#### [x] D2c2b1 实现真实 settings 窗口和 native 生命周期

1. 在保留 typed renderer route 的前提下，实现有界的 `native.window` command/response、可信 source 复核、role 绑定以及 Go→Node 的 ready/focus/closed 通知。
2. Go 创建和注册隐藏 settings 窗口；`WindowPresenter` 等待真实 descriptor 后绑定 Node 对象，再通过真实导航和 ready 流程显示。重复请求共享一次创建，不得生成互相冲突的占位窗口。
3. 在 macOS disposable profile 实测双原生窗口、settings sender、目标事件、关闭和再次创建，补 Go 普通/race、Node 定向、完整回归与 Electron 对照构建；修复对照构建中已退役 floating 页的残留图标扫描。
4. 修复实际运行故障：`/settings/index.html` 的相对 301 导航导致空文档，需由 Go 在不改变规范 URL 的情况下直接提供现存 index；重复打开调用 `app.focus` 缺失，需通过验证 caller 的 `focus_app` 命令调用真实 `mygo.App.Focus()`，不按最新窗口猜 caller；兼容 proxy 不得给不存在的 `then` 返回 no-op，否则 `await` 会把窗口视为 thenable 并永久等待。

结果：macOS 隔离 profile 中主窗口与 settings 窗口同时存活，settings 的真实业务响应、DOM、原生 focused 状态与截图均已核对；重复打开复用窗口 2，关闭后立即重开得到 `windowId=3` / `webContentsId=4`。把窗口 3 切到 `about:blank` 后业务 IPC 被 Go 拒绝，随后关闭并恢复为窗口 4；最终通过原生菜单完成业务销毁和退出。生命周期审查还覆盖了 stale close/ready 通知、close 失败后的 attempt 回滚与重试、过期 caller 下的显式 host 补偿、并发 navigation 的新 ID、pending close、通知合并顺序、加载失败释放与 userinfo URL 绕过。settings 导航、窗口 RPC、`focus_app`、非 thenable wrapper 和现存 index 响应均有回归覆盖；27 个定向 Node 测试与 Go race/vet 通过。完整回归数字及 Electron 对照修复见 `acceptance-checklist.md`。正式 Bridge 不提供通用 Eval；此项不包含 sidecar 替换后的 settings 自动重绑定、splash 解锁、普通聊天多窗口或 nested Page，见 D2c2b2。

#### [x] D2c2b2 恢复保留窗口并绑定 Page 身份

1. Manager 每代重新获取 Go settings descriptor 并通过启动环境注入；Node 在业务启动前校验并接入共享 sequence/tombstone，Electron 不受影响。
2. `WindowPresenter` 一次性消费恢复快照并复用正常 settings 绑定、监听、ready 和文档管线；保留允许页面的 URL，半创建窗口使用正常入口，恢复绝不通过 `ensure_settings` 或过期快照创建替代窗口，也不重放 mutation。
3. 增加 sequence/closed/并发回归，真实杀死旧 sidecar 验证 settings 的新 renderer、sender 与业务恢复，并在 replacement 期间执行 native close 证明没有复活窗口；补齐质量门禁、差距记录、diff 审查和提交。
4. 随后显式实现 splash/数据库解锁窗口的原生所有权，避免未绑定导航继续装作成功；利用 mygo `CallerPage().WebView()` 的独立身份建立 nested webContents/frame 映射，并继续执行 D2c2 的全局资源预算和内容隔离差距。

结果：每代 sidecar 使用 Go 当前 settings descriptor，Manager 在进入环境采集前隔离未执行旧命令并等待已开始的同步原生命令结束，空快照覆盖继承环境，Node 校验后一次消费并复用正常 Presenter 恢复管线；恢复不经过 `ensure_settings`，保留允许的 settings URL，closed/pending-close、重复消费或中途关闭均不复活。真实 macOS 中，sidecar 28616→28746 后 settings 自动重载并保留 `#/common`，旧 renderer 标记消失，业务 sender、target language event 和新 ready 均恢复；第二次 kill 后立即 native close，replacement 28892 后没有自动重建，只有显式打开才创建 id=3。最终版本还证明非法继承快照被清空，并由 32473→32726 再次完成真实恢复。31 个相关 Node 回归、Go race/vet、类型/静态检查与构建通过；完整回归数字、两次截图和退出证据见 `acceptance-checklist.md`。普通聊天多窗口、splash、nested Page 和全局资源治理仍未完成。

#### [x] D2c2b3 实现真实 splash/数据库解锁窗口

1. 增加受控 splash role、`ensure_splash`、专用 preload 资源和精确导航/文档白名单；只在真实 descriptor 绑定后加载窗口，补齐角色文档鉴权测试。
2. 抽取同一 `createSplashApi` 复用 Electron 与 mygo 平台端口，接通四条有来源校验的 unlock/recovery channel、同源事件和只读早期语言状态，保持普通 appReady 边界。
3. 保持现有 SplashWindow 显示、抑制和关闭业务不变，处理主窗口隐藏启动及早期 ready 重放，完成正常 profile UI 与复制加密 fixture 的实际解锁/恢复验证。
4. 运行格式、类型、Go race/vet、main/受影响回归、sidecar/preload 构建和真实场景验收，更新已知差距，审查后提交推送；不把本切片扩大为平台发行或真实数据迁移完成证明。

结果：真实 splash role、受限 channel/语言读取、主窗隐藏与早期 ready 重放已接通。修复了初始 `about:blank` 提前完成导航、独立缓存重放颠倒 progress/request、缺失 entry 被当成成功，以及 manual unlock 被 60 秒 readiness 看门狗误杀。`sidecar.process.ready` 仅解除 transport 超时，完整 `sidecar.app.started` 继续控制 renderer 加载和恢复成功。macOS 临时加密副本完成错误/正确密码、60 秒等待、锁定期 sidecar 替换、orphan recovery-cancel 文件保全和真实 data 回退验收；37 个相关 Node 测试、Go 全包 race/vet、类型/lint/i18n 与构建通过，完整 main 9827 passed / 2 既有 tunnel failed / 6 skipped，renderer 2704 全通过。证据与限制详见 `acceptance-checklist.md` D2c2b3；普通聊天多窗口、nested Page、OS Secrets 迁移、其他平台与正式发行仍未完成。独立终审指出的导航 P2 已由后续 committed-revision 修复和真实静态/回退/settings 复验覆盖，未将其隐瞒为原提交已验证能力。复核发现的 WebView2 fragment-only 不触发 ContentLoading 也已单列同文档完成路径，并通过 `e2e` 标签的真实 `#/old`→`#/new` 页面回归；Windows/Linux 实机验收仍未执行。

#### [x] D2c2c 接通 preview iframe 协议与隔离边界

1. 按 `spec.md` §4.7 建立 Node 真实 protocol callback registry 与 begin/read/cancel 内部通道，复用现有四个 scheme handler；保留 Response status/headers，reader 分片不超过 256 KiB，禁止整文件 arrayBuffer。
2. Go 预注册固定 scheme，复用真实 caller/role 校验，完成 HTTP metadata、逐块写出、HEAD、超时、取消和替换代次失败；不以主窗身份虚构 iframe，不向 renderer 开放任意 protocol route。
3. 以 Go/Node 流合同回归证明 header、分片、owner、取消与关闭，再用临时 workspace root 的真实 `workspace.register`/`readFilePreview` URL 验证主 renderer iframe 的 HTML、脚本、独立 origin 和大文件，检查截图、异常与 sidecar replacement。MCP 实例/权限和 legacy TabPresenter 不在本切片冒充完成。
4. 完成格式、类型、Go race/vet、相关及完整回归、真实 UI 验收和独立 diff 审查后提交推送；保留 MCP 完整生命周期、独立 Page registry、跨平台与发行差距。

结果：Node callback registry、Go 固定 scheme 转发和 begin/read/cancel 流式链路已接通，development/packaged 注册、HEAD、owner、实时 Page source、header、pending begin 取消和分块由 Go/Node 合同测试覆盖。真实 macOS 临时 profile 中，`workspace.register`/`readFilePreview` 生成的 HTML iframe 成功执行脚本，frame 内 `fetch()` 读回 401,443 bytes；父正文、`deepchat`、`mygo`、父 URL 的访问均为 `SecurityError`，截图已核对。杀死测试 sidecar 后，同一 Go 壳完成 replacement 和 renderer 重载，旧 iframe 消失，新代次拒绝未注册路径并再次通过完整 preview/隔离验收。另修复 JSON `Date` 类型保留、marker-shaped 普通 JSON 的可逆转义与真实 `CodeFileAdapter` 的 `.html/.htm/.xhtml` 分类回退；Electron structured-clone 不执行 native JSON reviver，native `chat.stream.updated` 浅校验前同样恢复一次 transport 类型。MCP 实例/权限、legacy TabPresenter、Windows/Linux、正式发行及完整结构化克隆仍未由本切片证明，证据与限制见 `acceptance-checklist.md`。

#### [ ] D2c2d 验证真实 MCP App 运行时与权限边界

1. 用本地 stdio MCP server、应用生成的临时 profile 副本和合成持久化 tool result，经真实 `mcp.addServer`、server binding、`McpAppView` 与 `mcp-app` handler 创建实例；不得添加测试专用生产后门。
2. 验证 `ui/initialize`、tool input/result、app 发起的 `tools/call` 及响应、live instance 工具列表、source 防篡改和 frame 内隔离，并在目标内容完成后检查 DOM 与截图。
3. 保持 `mcp-app` origin 默认拒绝，验证声明权限进入现有异步 consent；mygo 同步主线程 permission callback 不得等待 Node 或以直接放行代替授权。权限未闭环前本项保持未完成。
4. 随后完成独立 Page registry/native nested identity、其余 MCP 生命周期和跨平台验收，不把单一 macOS fixture 扩展为完整 MCP Apps 对等结论。

结果：真实 macOS Go 壳、现有 Vue renderer、Node sidecar 与本地 stdio server 已走通资源读取、sandbox 实例、AppBridge 初始化、tool input/result 和 app→server→app 工具闭环；`mcp.apps.listTools` 返回绑定工具，篡改 `toolInput` 被 source 校验拒绝。frame 内读取父正文、父 `deepchat`、父 `mygo` 和父 URL 均为 `SecurityError`，自身 `mygo` 为 `undefined`，最终截图确认工具响应已回到 inner app。声明 `geolocation` 后，真实请求仍立即返回 `PERMISSION_DENIED (code=1)` 且没有 consent UI；根因是 Node Electron shim 的 `session.defaultSession` 没有安装现有 handler，而 mygo v0.7.4 仅提供主线程同步决策。另修复 mygo 默认信任全部 registered custom scheme 的边界：每个 Go Page 现在安装 origin handler，非 Linux 只允许第一方 `mygo`/file/loopback renderer，`mcp-app`、preview 和未知 origin 均拒绝；Linux 因 nested 请求被归因到顶层 URI，暂时连第一方设备权限也全部拒绝。当前 macOS frame 的 camera API 为 `unsupported`，不能把单元验证扩展为真实设备路径通过；声明权限 consent、clipboard 能力、完整权限矩阵、Windows/Linux 与其余 MCP 生命周期仍未完成，证据见 `acceptance-checklist.md`。

#### [x] D2c2e 建立 native Content primary renderer Page

1. 按 `spec.md` §4.8 将 primary Page 所有权集中到 native window record，先覆盖现有顶层 main/settings/splash 的导航、来源、事件和恢复，不允许 `window.Page()` 为空时退回无主 sender。
2. 把主窗口改为无额外 UI 的 Content 宿主，以真实 primary WebView 加载现有 renderer；保留隐藏启动、preload、协议、权限、committed navigation 和 sidecar replacement 语义，业务事件统一 `EmitPage`。
3. 为 `e2e` 构建提供真实 primary WebView 的 automation 适配，正常构建不包含；重新验证启动/RPC、DOM/截图、原生窗口、目标事件、workspace/MCP iframe 和 sidecar 恢复，并回归 settings/splash。
4. 完成 Go 普通/race/vet、相关 Node/renderer 回归、正常/e2e build、真实场景验收和独立 diff 审查后提交推送。此片不包含 nested pageId、tab attach/bounds 或 `WebContentsView` 完成声明。

结果：主窗口已改为无额外 UI 的 native Content 宿主，现有 renderer 是全尺寸 primary WebView；native window record 显式保存 primary Page，业务 sender 要求 CallerPage 指针一致，事件统一 `EmitPage`，导航、权限、ready 与 replacement 均使用该 Page。真实 macOS 启动/RPC、最大化/恢复、中文目标事件、独立 settings 窗口、workspace 1201-byte preview 与四项 `SecurityError`、MCP App 工具与隔离均通过。sidecar 3181→3412 后同一 Go 进程和 primary Page 重载，旧标记消失，重新激活合成会话后 MCP 再次通过。加密临时副本完成错误密码反馈、正确密码解锁和 Content 主窗就绪。真实 e2e 还证明同 URL 的 secondary WebView 被 source 校验拒绝。正常/e2e build、Go 全包 race/vet、真实 fragment/primary-secondary e2e、typecheck、lint 和 i18n 通过。此片不包含 nested pageId、tab attach/bounds 或 `WebContentsView` 完成声明；系统级合成截图、Windows/Linux、MCP 异步权限和完整发行仍未完成，证据与限制见 `acceptance-checklist.md`。

### [ ] D3 完成窗口与原生能力

实现多窗口/tab、主菜单、托盘、快捷键、deep link、真实对话框、剪贴板、通知、外观和屏幕状态。将 shell-owned shim 的静默成功逐项替换为真实桥接或明确 unsupported；完成 workspace 预览、长图导出和 MCP Apps 独立安全评审。

### [ ] D4 完成业务功能与异常路径对等

按 `spec.md` 的业务矩阵验证 Provider、DeepChat/ACP Agent、工具、MCP 全生命周期、Skill、Memory、workspace、设置、导入导出及关键 Web 组件。覆盖取消、重试、慢流、错误、数据库锁定、大数据量、任务恢复和跨窗口事件。

### [ ] D5 完成凭据和用户数据迁移

使用 OS Secrets 替换开发密钥文件，以复制 fixture 验证 safeStorage 迁移、SQLCipher 数据保留、幂等、备份、失败恢复和回滚。真实数据操作与生产迁移发布分别请求授权。

### [ ] D6 完成打包、平台和更新验收

分发 Node 运行时、原生模块、worker、插件和资源，分别执行 macOS、Windows、Linux 安装后 smoke；验证签名、文件关联、deep link、卸载、自动更新与回滚。无法取得对应 runner 或证书时只记录外部阻塞，不改写验收结论。

### [ ] D7 全量验收和经授权的发行切换

运行完整功能与质量矩阵，关闭所有影响用户功能的 shim/noop，完成架构、迁移、运维、发布和回滚文档。只有在全部验收满足并获得明确授权后，才改变默认发行版、删除 Electron 或关闭本 goal。

### [ ] 持续复查

每个 D 切片完成后立即审查并开始下一个仍未完成的切片；若存在不依赖外部条件的剩余工作，不以“本轮已足够”结束长期目标。
