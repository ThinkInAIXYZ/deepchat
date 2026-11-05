# M0 验证报告（实测）

日期：2026-11-05
mygo 版本：v0.7.4（2026-11-01 发布，Go module `github.com/egoist/mygo`）
Go 版本：go1.27.3 darwin/arm64（通过 `brew install go` 安装）
测试平台：macOS（WKWebView）
验证工程：`shell/spike/`（本仓库内，非产品代码）

## 总结

可行。DeepChat 的真实渲染层已在 mygo 的 WKWebView 中成功启动并渲染出完整界面，桌面能力（绑定调用、事件、流式通道、自定义协议、截图、PDF、脚本求值、系统密钥库）逐项通过。此前文档中标记为「未知」的最大风险项——自定义协议与页面截图——已确认存在，不构成阻碍。

尚未验证：Windows（WebView2）与 Linux（WebKitGTK）上的渲染差异、数据库口令迁移、自动更新链路。这三项是后续 M5 的主要工作。

## 逐项结果

### 1. renderer 启动 — 通过

用 `-renderer ../../out/renderer` 让 spike 直接服务 `electron-vite build` 产出的渲染层。

证据：

- 页面 `location.hash` 为 `#/chat`，`document.title` 为 `DeepChat`。
- 页面发出 55 次 `window.deepchat.invoke` 调用（由 stub 记录）。
- 截图 `evidence/renderer-in-wkwebview.png` 显示完整主界面：左侧「All Agents / New Chat / Search / Workspace / Plugins / Theme」、中间「Build and explore」与输入框、右上窗口按钮，与 Electron 版布局一致。
- 唯一差异是输入框下方的模型选择显示 `Loading…`，因为 stub 对每条路由返回 `{}`，没有 provider 数据。这是桩的预期结果，不是渲染问题。

未验证：Monaco、Mermaid、markstream、TipTap、xterm 的交互行为。截图只覆盖主界面静态渲染；这些组件位于聊天页和编辑器页，需要接入真实数据后再测。

### 2. Go 与前端的调用与事件 — 通过

- `Bridge.Ping` 返回 `pong:deepchat`，页面拿到结果。
- `mygo.NewEvent[Progress]` + `Emit` 让页面通过 `window.mygo.on('spike.progress', ...)` 收到 `{"sequence":1,"payload":"hello"}`。
- `MYGO_GENERATE=./frontend/mygo.gen.ts go run .` 生成了 TypeScript 客户端（`frontend/mygo.gen.ts`），其中包含每个绑定方法的签名、`Channel` 参数和事件类型。

对应 DeepChat：现有 `route + event envelope` 模型可以一比一映射为「绑定方法 + 事件」，`mygo generate` 可以替代手写 preload。

### 3. 流式推送压测 — 通过

页面创建 `window.mygo.channel()`，Go 侧通过 `*mygo.Channel[string]` 推送 200 条、每条 64 KiB，共 12.5 MiB：

- Go 侧耗时 24 ms，页面侧耗时 25 ms，200 条全部收到，无丢失。
- 这远超 DeepChat 当前每 120 ms 一次快照的负载。mygo 通道在页面消费不及时时会等待（文档写明「页面待取超过 1 MiB 时 Send 会等待」），即具备背压。

### 4. 多窗口与 tab — 部分验证

- 单窗口创建、尺寸（1280x820）、关闭均正常。
- mygo 支持 `Window.NewWebView`，可在**原生 UI 窗口**里放多个 webview（官方文档 `ui.WebView`），这为未来的标签页提供了路径。
- 未验证：同一次运行中同时打开多个窗口、窗口间通信。属于低风险项，API 形态与单窗口一致。

### 5. 自定义协议 — 通过（与最初判断相反）

`mygo.Protocol.Handle("spikeasset", mygo.FileServer(fs))` 注册成功；页面 `fetch('spikeasset://localhost/hello.txt')` 返回正确内容。

影响：

- workspace 文件预览（原 `deepchat-workspace-preview://`）可以直接迁移。
- MCP Apps 沙箱：mygo 提供 `PageOptions.Untrusted`（不受信任页面：不能调用绑定方法、不能开窗、不能下载、只能导航到同源），配合自定义协议可实现隔离。原计划中「可能砍掉」的选项不再需要。

### 6. 页面截图与 PDF — 通过

- `win.CapturePage()` 返回 59,249 字节的 PNG，内容为完整界面。
- `win.Page().PrintToPDF(...)` 返回 19,352 字节的 PDF。
- `win.Page().Eval(...)` 可执行脚本并取回结果（`document.title`）。

影响：长图导出可以保留，滚动截图逻辑（多次 `Eval` 取滚动位置 + 多次 `CapturePage` 拼接）在 mygo 上同样成立。

### 7. 桌面能力 — 部分验证

已在源码中确认存在，接口与 DeepChat 需求对应：

- 窗口：`NewWindow`、`Frameless`、`TitleBarStyle`、`Hidden`、`FitContent`、`Bounds`、`Size`、`Show`、`Close`。
- 菜单与托盘：`NewMenu`、`MenuRole`、`NewTray`。
- 全局快捷键：`GlobalShortcut.Register`。
- 通知：`NewNotification`、`OnNotificationClick`。
- 对话框、剪贴板、深色模式与主题偏好、文件监听、单实例、deep link、文件关联、最近文档、Now Playing。
- DevTools：`PageOptions.DevTools`、`OpenDevTools`、`RoleToggleDevTools`。

本次运行只实测了窗口、密钥库、协议、截图、PDF、Eval。菜单、托盘、快捷键、通知仅做源码确认，未逐个运行——这些 API 形态简单，风险低于上面已通过的项目。

### 8. 密钥存储与数据库口令 — 部分通过

- `mygo.Secrets.Set/Get/Delete` 实测往返成功（macOS Keychain）。
- Linux 需要 Secret Service（libsecret），无桌面密钥环时返回 `ErrUnsupported`，应用需要回退方案。
- **未验证**：Electron `safeStorage` 已加密的口令能否迁移。两者都是系统密钥库，但加密格式与条目名不同，迁移需要一次性重新加密：用户首次启动 mygo 版时用旧口令解锁数据库，再用 `mygo.Secrets` 重新保存。此路径尚未实测，列入 M5。

### 9. 打包与自动更新 — 打包已验证，更新未验证

已执行打包，命令与结果：

```bash
cd shell/spike
mygo build .          # mygo.json 里 frontendDist 指向 ../../out/renderer
```

输出（macOS arm64）：

- `DeepChat Spike.app` 75 MB（其中 Go 可执行文件 75 MB，因为前端 73 MB 被嵌入二进制）
- `deepchat-spike-0.0.1-arm64.dmg` 15 MB
- 全流程 37–63 秒（含前端嵌入、编译、签名、生成 dmg）

注意：这次构建用的是**真实 DeepChat 渲染层**（`out/renderer`，73 MB），所以体积可以直接与 Electron 版对比。

尚未验证：自动更新链路。现有 Electron 版用户如何升级到 mygo 版（更新源与包格式都不同），需要单独设计。

### 10. 体积与启动对比 — 部分完成

体积（同一份渲染层产物 `out/renderer` = 73 MB）：

| 项 | 体积 |
| --- | --- |
| mygo `.app` | 75 MB |
| mygo `.dmg` | 15 MB |
| Electron 运行时（`node_modules/electron/dist`，仅框架，不含应用代码） | 299 MB |
| DeepChat 主进程编译产物（`out/main`） | 9.5 MB |

即：mygo 版的应用包（含全部前端资源）比 Electron 的运行时本体还小 4 倍。Electron 版若完整打包，还需在此基础上再加应用代码，通常在 300 MB 以上。本次未运行 `electron-builder`，因此没有可比的自建 Electron 包体，但 299 MB 的框架已经构成下界。

冷启动（macOS arm64，同一台机器，命中文件缓存后的三次测量）：

| 指标 | 第 1 次 | 第 2 次 | 第 3 次 |
| --- | --- | --- | --- |
| 进程启动 → `WhenReady` | 353 ms | 88 ms | 96 ms |
| → 窗口创建 | 677 ms | 178 ms | 185 ms |
| → 页面 `did-finish-load`（首帧可交互） | 934 ms | 244 ms | 252 ms |

第 1 次是冷缓存。稳定态下 **约 250 ms 完成首帧**，其中还包含 Go 侧启动 sidecar 之外的全部初始化。Electron 版没有测到可比数字（需要完整打包并运行真实应用，且会触碰用户数据目录），列入 M5。

说明：上述 App 内的页面是 DeepChat 真实渲染层，但没有接真实数据，所以 250 ms 只代表「壳 + 前端首帧」，不含数据库解锁与 provider 初始化。

## 对「待定决策」的建议

- **MCP Apps 沙箱**：保留。自定义协议 + `Untrusted` 页面已具备实现条件。
- **workspace 文件预览**：保留。自定义协议直接对应。
- **长图导出**：保留。`CapturePage` + `Eval` 已实测可用。
- **内置浏览器 / 浏览器自动化**：维持删除决定。mygo 没有 CDP，`Page` 只提供导航、求值、截图，不提供 DOM 查询与输入注入。

## 修正此前文档中的错误判断

| 早前判断（基于搜索摘要） | 实测结论 |
| --- | --- |
| 自定义协议可能不存在，需要 loopback HTTP 兜底 | 存在，`Protocol.Handle` + `FileServer` |
| 页面截图能力未知，长图导出可能砍掉 | 存在，`CapturePage` + `PrintToPDF` |
| 子 webview 嵌入未确认 | 存在，原生 UI 窗口内可放多个 `WebView` |
| 第三方页面隔离能力不足（依据 issue #729） | `PageOptions.Untrusted` 已提供 |
| 无 DevTools | 存在，可开关 |
| 无密钥库 | 存在，`Secrets` 接系统凭据库 |
| 需要 cgo | 不需要，`go build` 直接通过 |

## 11. 附加验证：Go 壳 → Node sidecar 链路（2026-11-05 同日完成）

在 spike 里补了一条最小但完整的链路，用来证明方案 B 的传输层成立：

```
renderer (未改动的 DeepChat 前端)
  -> window.deepchat.invoke(route, input)      // preload 由 Go 注入
  -> window.mygo.call('Bridge.Invoke', ...)    // mygo 绑定
  -> Go: Bridge.Invoke                         // 转发
  -> Node sidecar (stdin/stdout, 每行一个 JSON)
  -> 结果原路返回
```

证据：

- `sidecar.started=true`，Node 进程由 Go 的 `os/exec` 拉起。
- 界面语言从默认英文变成中文（「所有 Agents / 新会话 / 搜索 / 工作区 / 插件」），因为 `config.getLanguage` 由 sidecar 返回 `zh-CN`，而此前的桩返回 `{}`。
- 截图 `evidence/renderer-with-sidecar.png`。
- 主题显示「跟随系统」，同样来自 sidecar 的 `config.getTheme`。

事件通道也已打通（同日完成）：

```
sidecar 每行 {"event": name, "payload": ...}
  -> Go 读取并 Broadcast 一个 mygo 事件
  -> preload 的 window.mygo.on('deepchat.event') 按 name 分发给 window.deepchat.on 的订阅者
```

两条实测证据：

1. 页面订阅 `spike.tick`，2 秒内收到 2 次，证明事件能穿过整条链路到达渲染层。
2. sidecar 推送真实的 `config.theme.changed`（`{theme:'dark', isDark:true}`），渲染层主题 store 生效：`document.documentElement.className` 变为 `dark text-base`，侧边栏「主题」显示「深色」，界面整体切成深色。截图 `evidence/renderer-dark-via-event.png`。

这条证据的意义是：DeepChat 现有的 typed event 合同不需要改动就能在 mygo 壳上工作，包括流式渲染依赖的 `chat.stream.updated`。

未完成：provider、session 等路由仍返回 `{}`，所以输入框仍是「加载中」；这些要等真实 sidecar。

这一步把 M2/M3 的最大不确定性——「Go 壳能不能把渲染层的调用转给现有 TS 业务代码」——变成了已验证的事实。剩余工作是让真实 main 进程跑在 sidecar 里（阶段 B 的直接目的）。

## 12. M2 第一版：真实业务代码在 Node 里跑通

`src/main/sidecar/entry.ts` 由 `vite.sidecar.config.ts` 打成 `out/sidecar/entry.mjs`，**产物里没有 Electron**。

当前注册 **21 条路由**。其中 5 条直接复用官方路由工厂 `createOnboardingRoutes(settings)`，会话列表走真实的 `AppSessionService`：

| 路由 | 数据来源 |
| --- | --- |
| `config.getEntries` / `config.updateEntries` | `app-settings.json` |
| `config.getLanguage` / `config.setLanguage` | 设置 + `resolveSupportedLocale` |
| `config.getTheme` / `config.setTheme` | 设置 |
| `config.listCustomPrompts` | 设置里的 `customPrompts` |
| `device.getInfo` | `node:os` + 平台版本表（辅助功能探测留待壳上报） |
| `upgrade.getStatus` | 占位：更新由壳负责，sidecar 报告「无待处理」 |
| `window.getRuntimeIdentity` / `window.getCurrentState` | 由壳传入的环境变量 |
| `onboarding.*`（5 条） | 直接调用 `createOnboardingRoutes`，与 Electron 版同一份实现 |
| `sessions.listLightweight` | 真实 `AppSessionService.listPage`（`ProjectDatabase` + `SessionDatabase`），查询加密库 |
| `sessions.getAgents` | 占位空数组：需要 `AgentSettings`，等 agent 层搬入 |
| `providers.listSummaries` | 真实 `ProviderSettings`（`ProviderDatabase` + 同一条加密库），返回完整 provider 目录 |
| `mcp.getEnabled` / `mcp.getServers` | 真实 `McpSettings`（store + 数据库镜像），返回 MCP 开关与内置服务配置 |

用真实工厂而不是重写，是这一版的设计要点：路由的解析、默认值与状态机都来自原实现，sidecar 只提供运行时。

`sessions.listLightweight` 的实测输出：

```
{"id":1,"result":{"items":[],"nextCursor":null,"hasMore":false}}
```

空库返回空列表，形状与契约一致，说明查询真的打到了加密库而不是桩。

为了让两个运行时映射一致，两处原本内联的映射抽成了共用函数：`src/main/session/listItem.ts`（记录 → 列表项）与 `src/main/provider/summary.ts`（provider → 摘要）。

`providers.listSummaries` 接通后，渲染层输入框不再显示「加载中」，可以正常拿到模型供应商。

顺带修掉一个隐藏的跨运行时问题：`src/shared/logger.ts` 原来依赖 `@electron-toolkit/utils` 的 `is.dev`，这让**任何**引入 logger 的模块都被迫依赖 Electron。改成 `import.meta.env.DEV`（渲染层）与 `NODE_ENV`（Node）后，sidecar 才能加载 provider 链路。

联调证据（Go 壳 + 真实 sidecar + 真实渲染层，设置文件里 `language=ja-JP`、`appTheme=dark`）：

- 界面整体为**日语**，侧边栏「すべてのエージェント / 新しいチャット / テーマ ダーク」
- 主题为**深色**
- 页面进入欢迎页，provider 磁贴（Claude / OpenAI / DeepSeek / Gemini / Ollama / OpenRouter）正常渲染
- 接入 onboarding 真实状态后，界面显示「引导进度」，说明状态机链路也通了
- 截图 `evidence/renderer-real-sidecar.png`
- 启动耗时：ready 约 100 ms、窗口约 200 ms、首帧约 300 ms

这是第一次「同一份业务代码、两种运行时」的完整验证：Electron 版仍走原路径，sidecar 版用同一批模块 + Node 实现。

## 13. 路由归属：壳与 sidecar 的分工（已验证）

`Bridge.Invoke` 现在的顺序是**先问壳、再转 sidecar**。壳已实现窗口类路由：

| 路由 | 壳的处理 |
| --- | --- |
| `window.getRuntimeIdentity` | 返回 mygo 窗口 id |
| `window.getCurrentState` | 读取 `IsMaximized` / `IsFullScreen` / `IsFocused` |
| `window.minimizeCurrent` | `win.Minimize()` |
| `window.toggleMaximizeCurrent` | `win.ToggleMaximize()` |
| `window.closeCurrent` | `win.Close()` |

实测：在页面里调用 `window.toggleMaximizeCurrent` 后，窗口从 1280×820 变为 1920×960，随后 `window.getCurrentState` 返回 `isMaximized: true`。说明自定义标题栏的按钮可以直接由 Go 接管，不需要经过 Node。

这条分工规则值得固定下来：

- **壳负责**：窗口、托盘、菜单、快捷键、通知、文件对话框、截图、协议、更新、深链、密钥库
- **sidecar 负责**：会话、Agent、Provider、MCP、Skill、Memory、Tape、工具执行、数据库
- **边界**：凡是需要「原生资源」的，壳做；凡是需要「业务数据」的，sidecar 做

## 下一步

1. 接入真实桥接：用 `window.api` 的 mygo 实现替换 spike 里的 stub，验证 55 次启动调用能否返回真实数据（对应 M2/M3）。
2. 在聊天页实测 Monaco、markstream、TipTap、xterm。
3. 验证 `safeStorage` → `Secrets` 的口令迁移。
4. 出包对比体积与冷启动。

## 复现方式

```bash
# 一次性：安装 Go 1.27.3+
brew install go

# 生成 TypeScript 客户端（不开窗口）
cd shell/spike
MYGO_GENERATE=./frontend/mygo.gen.ts go run .

# 跑内置探针页（验证桌面能力）
go run . -seconds 10

# 加载真实渲染层并截图
cd /Users/colab/Documents/deepchat
pnpm exec electron-vite build --outDir out
cd shell/spike
go run . -seconds 12 -renderer ../../out/renderer -shot /tmp/renderer.png
```
