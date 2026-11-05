# DeepChat 迁移到 mygo：可行性分析与实施方案

状态：草案，第一轮取舍已确认（见第 10 节），其余待 M0 验证
日期：2026-11-05

## 1. 结论

1. 只替换桌面壳、保留 Vue 渲染层，可行。渲染层是标准 Web 前端，mygo 只需要一个 URL 或一个静态目录。
2. 把 main 进程用 Go 一次性重写完，不建议。main 约 34.6 万行 TypeScript，依赖 Vercel AI SDK、MCP SDK、ACP SDK 等 TS 生态，Go 里没有等价物，会变成重新实现，而不是迁移。
3. 「一次性完成」可以保留，但要拆成有门禁的里程碑，并在 M0 先做 2 周的技术验证。验证不通过的能力，在文档里就确定降级策略，而不是做到一半再发现。
4. 最大的不确定性有两个：
   - 系统 webview 与 Chromium 的行为差异，主要是 Linux 的 WebKitGTK 和 macOS 的 WKWebView。
   - YoBrowser、computer use 等深度依赖 Electron/Chromium 专有能力的功能。

推荐方案是 B：保留 Vue 渲染层，用 mygo 做壳，用 Go 重写桌面层和基础设施，Agent 与 Provider 等 TS 逻辑先以 Node sidecar 方式复用，再按模块逐步迁入 Go（见第 5 节）。

## 2. DeepChat 现状（实测）

| 层 | 规模 | 说明 |
| --- | --- | --- |
| src/main | 约 345,741 行 TS | agent 70k、provider 35k、memory 27k、remote 23k、tape 22k、mcp 19k、session 17k、tool 15k、skill 15k、cli 13.5k、desktop 12k |
| src/renderer | 约 149,935 行，258 个 .vue | Vue 3、Pinia、vue-i18n、Tailwind 4、shadcn-vue、Monaco、Mermaid、markstream-vue、TipTap、xterm、unovis |
| src/shared | 约 35.5k 行 | typed route 与 event 合同，zod schema |
| src/preload | 约 779 行 | 通过 createBridge 暴露 typed route 和 event |
| 测试 | 970 个 test 文件 | Vitest 加 Playwright |
| 国际化 | 20 多个 locale | 必须保留 |

关键事实：

- 通信已经是干净的 typed route 加 event envelope，由 `src/shared/contracts/` 定义，共 32 个 routes.ts。迁移时可以把它作为 mygo 绑定层的合同来源。
- renderer 通过 `src/renderer/api/*Client.ts` 调用，直接依赖 window.api 或 window.electron 的文件只有 1 个。渲染层与 Electron 的耦合很低，这是本方案成立的最重要前提。
- main 中有 101 个文件 import electron。
- 原生与重依赖：better-sqlite3-multiple-ciphers（SQLCipher）、DuckDB 加 VSS、node-pty、sharp、opendal、light-ocr、parcel watcher、jxa 与 applescript、nativekit。
- 已使用 utilityProcess 的 4 处：fileWatcher、scheduler、backgroundExec、codeMode。这些本来就是进程外服务，天然适合作为 sidecar。

## 3. mygo 能力核对

信息来源分两类：一是 2026-11-05 拉取到本地的 mygo v0.7.4 源码（`go mod download` 后直接读代码与 `docs/`），二是 M0 实测（见 `m0-report.md`）。早期基于搜索摘要的判断已在报告末尾逐条修正。

已确认（摘要证据）：

- 纯 Go、无 cgo，macOS 与 Linux 通过 purego 等方式在运行时调用原生 API，Windows 通过 syscall 调用 Win32 和 WebView2。
- 窗口用系统 webview：WKWebView、WebKitGTK、WebView2。不带 Chromium。
- 前端用任意 Web 工具构建；通过 `mygo generate` 生成 TypeScript 客户端，提供调用、channel 和事件，并有类型检查。
- 桌面 API：窗口、菜单、托盘、对话框、通知、剪贴板、shell、显示器、深色模式、电源、网络状态、密钥存储、文件监听、全局快捷键、deep link、文件关联。
- 打包：三平台打包、签名、公证、安装包，带签名的增量自动更新和更新窗口。
- `Window.NewWebView` 可创建 webview 页面，另有 untrusted WebView 模式（issue #729 提到自定义 scheme 页面全信任，无法托管第三方页面，这对 YoBrowser 和 MCP Apps 沙箱有影响）。
- 项目很新（releases 以天计），API 仍在快速变化。

M0 已验证（v0.7.4，macOS）：

- 流式 channel：12.5 MiB / 200 条，25ms 完成，具备背压。
- 自定义协议：`Protocol.Handle` + `FileServer`，页面 `fetch` 正常。
- 页面截图 `CapturePage`、打印 `PrintToPDF`、脚本求值 `Eval`、DevTools 均存在且实测通过。
- 系统密钥库 `Secrets` 往返成功。
- 子 webview：原生 UI 窗口内可放多个 `WebView`；不受信任页面用 `PageOptions.Untrusted` 隔离。
- 真实渲染层在 WKWebView 中完整渲染，证据见 `evidence/renderer-in-wkwebview.png`。

仍未确认：

- Windows（WebView2）与 Linux（WebKitGTK）下渲染层与组件的差异。
- 独立 cookie 与 session 分区（MCP Apps 隔离需要）。
- 窗口材质、点击穿透等精细窗口能力。
- Electron `safeStorage` 密文向 `Secrets` 的迁移路径。
- 打包体积、冷启动与自动更新的升级链路。

## 4. 能力缺口矩阵

| DeepChat 能力 | Electron 实现 | mygo 对应 | 风险 | 处理策略 |
| --- | --- | --- | --- | --- |
| 主窗口、多窗口、tab | BrowserWindow 加 WebContentsView | Window 加 NewWebView | 中 | M0 验证 |
| IPC 与事件 | ipcMain 加 preload bridge | 绑定加 TS 客户端 | 低 | 保留合同，在适配层转换 |
| 流式更新 | webContents.send | channel 与事件 | 中 | M0 压测 |
| 托盘、菜单、全局快捷键、通知、对话框、剪贴板 | 对应 Electron API | 已有 | 低 | 直接映射 |
| 密钥存储 | safeStorage | secrets API | 中 | 数据库口令的存储需要迁移方案，不能让用户重输 |
| 自动更新 | electron-updater | 内置签名增量更新 | 中 | 更新通道、已安装用户的升级路径需要单独设计 |
| 自定义协议 | protocol.handle | 待确认 | 高 | 无则改为本地 loopback HTTP 加随机 token |
| 内置浏览器 YoBrowser | WebContentsView 加 CDP，BrowserTab 约 800 行 | 无 CDP | 极高 | 见 4.1 |
| 截图与滚动截图 | capturePage 加 executeJavaScript | 待确认 | 高 | 退化为 DOM 转图或 sidecar 浏览器 |
| computer use、CUA 插件 | 插件进程加 PiP 窗口 | 待确认 | 中 | 插件本来是外部进程，窗口部分再适配 |
| OAuth 弹窗，如 Copilot | BrowserWindow 加 executeJavaScript | 待确认 | 中 | 改为系统浏览器加 deep link 回调 |
| MCP Apps 沙箱 | 自定义 scheme 加 privileged | untrusted 模式有缺口 | 高 | 同自定义协议策略 |
| 终端 | node-pty 加 xterm | Go 的 pty 库 | 低 | creack/pty 或 sidecar |
| SQLCipher | better-sqlite3-multiple-ciphers | Go 的 SQLCipher 绑定 | 高 | 见 4.2 |
| DuckDB 加 VSS | node-api | duckdb-go 需要 cgo | 高 | 见 4.2 |
| 图像处理 | sharp | 纯 Go image 库 | 中 | 先走 sidecar |
| OCR | light-ocr | 无 | 高 | sidecar |
| AI SDK、MCP SDK、ACP SDK | TS | Go 有官方 MCP SDK，AI SDK 与 ACP SDK 需要自写 | 高 | 先走 sidecar |

### 4.1 内置浏览器与自动化（已决策：整体砍掉，见第 10 节）

以下为决策前的分析，保留作为背景。

系统 webview 没有 Chromium 的 debugger 协议，现有 4 处 CDP 调用（BrowserTab、yoBrowserSession、CDPManager）、8 处以上 capturePage 或 sendInputEvent 无法直接迁移。三个选项：

- a. 内置浏览器降级：只保留页面浏览，去掉 agent 自动化。这是功能退化，必须由产品决定。
- b. 自动化改由独立的 Chromium 进程承担，例如受管的 headless Chrome 加 CDP，体积与依赖都会回到 Chromium 量级。
- c. 该功能整体延后，作为 mygo 版本发布之后的独立里程碑。

建议选 c 并写入发布说明，在 M0 确认 mygo 是否有等价能力后再改判。

### 4.2 数据库

数据库有加密，用户数据不能丢。SQLCipher 与 DuckDB 在 Go 里通常需要 cgo，与 mygo 的无 cgo 卖点冲突，并拖累交叉编译。可选：纯 Go 的 SQLite 移植版加自实现加密（不兼容现有密文，需要一次性迁移，风险高）；或继续用 Node sidecar 持有数据库（风险最低）。

## 5. 方案对比

| 方案 | 做法 | 优点 | 缺点 | 评价 |
| --- | --- | --- | --- | --- |
| A 全量 Go 重写 | main 全部改写成 Go，渲染层复用 | 最终形态最干净，单一二进制 | 约 35 万行，且有大量 TS 生态依赖；周期以年计；回归面极大 | 不建议 |
| B 壳换 mygo，TS 逻辑留在 Node sidecar | Go 负责窗口、托盘、更新、安全存储、进程管理；Agent、Provider、MCP、Memory 等跑在随包分发的 Node 进程里，通过本地 socket 与 Go 通信 | 渲染层与业务逻辑几乎不动，界面与功能最接近一致；可分阶段 | 仍需分发 Node 运行时，体积优势有限；需要写一层 Go 到 sidecar 的桥 | 推荐 |
| C 先 B，再按模块迁入 Go | 在 B 稳定后，把低耦合模块（scheduler、file watcher、workspace、settings、updater）迁入 Go | 风险随时间递减，可随时停下 | 总周期最长 | B 之后按收益决定 |

选择 B 的理由：目标是尽可能保留功能和界面一致。收益在 mygo 的体积、启动速度与原生体验，而这些主要来自去掉 Electron 壳，不要求业务逻辑也改成 Go。

坦白说明一个事实：方案 B 的收益取决于 sidecar 的 Node 运行时。如果最终仍要随包带 Node，安装体积相比 Electron 的下降会小于预期。这点需要在 M0 量化后再确认是否值得做。

## 6. 目标架构（方案 B）

```text
Renderer (Vue，基本不改)
  -> mygo 生成的 TS 客户端（由 shared/contracts 适配）
  -> Go 壳 (mygo)
       - Window / Tray / Menu / Shortcut / Notification / Dialog / Updater / Secrets
       - Bridge：把 typed route 转发给 sidecar，把 event 转发给 renderer
  -> Node sidecar（现有 main 业务代码，去掉 electron 依赖）
       - agent / provider / mcp / session / tape / memory / skill / tool / remote / scheduler
       - 数据库与原生模块
```

要点：

- 保留 `src/shared/contracts` 的 route 与 event 合同。写一个脚本，由合同生成 mygo 绑定，避免手写两套。
- sidecar 的入口把 `from 'electron'` 的使用收敛到一个 platform 适配接口。main 中 101 个文件依赖 electron，其中约 20 个是窗口相关，要先抽象再迁移。可借助已有的 `docs/architecture/main-harness-portability`。
- renderer 的 `src/renderer/api/*Client.ts` 是天然的替换点，只改传输层，不改调用方。

## 7. 里程碑与计划

每个里程碑都有出口标准，不满足就不进入下一阶段。

### M0 技术验证（2 周，已完成一条主线）

状态：核心项已在 macOS 上验证通过，报告见 `m0-report.md`，验证工程在 `shell/spike/`。剩余项（Windows/Linux 渲染、口令迁移、打包体积与更新链路）移入 M5。

原计划：做一个最小 Go 工程，加载现有 renderer 构建产物，逐项验证第 3 节的未确认项：

1. 渲染层能否正常启动，Monaco、Mermaid、markstream、TipTap、xterm 在 WKWebView、WebView2、WebKitGTK 三个引擎上是否正常。
2. 流式 channel 以 120ms 间隔推送大快照的吞吐与 CPU。
3. 多窗口与 tab 切换（子 webview 嵌入已不再需要）。
4. 自定义协议或本地 loopback 替代方案。
5. 页面截图能力（决定长图导出的去留）；CDP 与页面自动化已不再需要。
6. 加密数据库口令的读取与迁移。
7. 自动更新能否覆盖现有 Electron 用户。
8. 安装包体积与冷启动时间，与当前 Electron 版对比。

出口标准：写出一页验证报告，并对每个缺口给出确定的降级策略。

### M1 平台适配层抽象（2 到 3 周，仍在 Electron 上进行）

在 main 里抽出 platform 接口，覆盖窗口、托盘、菜单、快捷键、通知、对话框、剪贴板、secret、updater、protocol。Electron 实现保持现状，全部测试通过。这一步对现有版本零风险，且无论后续是否继续迁移都有价值。

### M2 Node sidecar 化（3 到 4 周）

把 main 业务代码跑成独立进程，Electron 壳作为其客户端，通过 socket 通信。以现有 utilityProcess 的做法为模板。出口标准：全部 main 与 renderer 测试和 e2e smoke 通过。

### M3 Go 壳与桥（4 到 6 周）

实现 Go 的 platform 层、bridge 与 mygo 绑定生成脚本；主窗口、设置窗口、托盘、菜单、快捷键、通知、deep link 跑通。出口标准：聊天主流程端到端可用。

### M4 周边能力与平台差异（4 到 6 周）

splash、插件设置窗口、OAuth 改系统浏览器加 deep link、导出，以及 M0 后再定的 MCP Apps 沙箱、workspace 预览和长图导出。同时执行第 10 节的删除项（YoBrowser、浮动窗口、computer use PiP），并清理对应的 route、i18n 与测试。

### M5 打包、签名与更新（2 到 3 周）

三平台安装包、签名、公证；插件和 helper 的 bundle 脚本改造；从 Electron 版升级到 mygo 版的数据与设置迁移。

### M6 灰度与回归（3 到 4 周）

内部灰度，对比测试，性能与体积基线，三平台回归，发布说明。

粗估总周期约 5 到 7 个月，按 1 到 2 名熟悉代码库的开发估算，不含 YoBrowser 的重做。这是粗估，M0 之后应重新估算。

### M7 可选：逐模块迁入 Go

优先级依次为 scheduler、file watcher、workspace、settings、updater，再到 skill 与 tool 的非 Agent 部分。Agent 与 Provider 最后，且只在有明确收益时做。

## 8. 验收标准

- 全部现有 route 与 event 合同保持不变，renderer 调用方零改动或接近零改动。
- 界面像素级一致的范围：聊天、设置、侧边栏、对话框。允许差异：系统 webview 的滚动条与字体渲染。
- 数据：现有用户数据库、设置、密钥无需用户操作即可迁移，且可回滚。
- 三平台安装、更新、卸载通过。
- 性能：冷启动、流式渲染帧率、内存占用不劣于当前版本，具体阈值在 M0 基线后确定。
- 已知降级项在发布说明中明确列出。

## 9. 主要风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| mygo 仍年轻，API 变动或有缺陷 | 阻塞或返工 | 固定版本，M0 验证，必要时向上游提 issue 或 fork |
| WebKitGTK 在 Linux 上表现差异大 | Linux 体验退化 | M0 单独验证；必要时 Linux 暂不支持或标注为实验 |
| 数据库加密迁移失败 | 用户数据丢失 | M1 到 M5 全程保持密文格式不变，迁移前自动备份 |
| 内置浏览器与自动化无法迁移 | 功能缺失 | 4.1 的决策，写入发布说明 |
| 自定义协议缺失 | 多个功能失效 | loopback HTTP 加 token 作为备用，M0 提前验证 |
| sidecar 带来体积与进程管理复杂度 | 收益不及预期 | M0 量化体积与启动，决定是否继续 |
| 一次性切换风险 | 回归面过大 | M1 与 M2 可独立发布，灰度通道 |

## 10. 已确认的取舍决策

| 能力 | 决策 | 影响范围 |
| --- | --- | --- |
| 内置浏览器 YoBrowser 与 Agent 浏览器自动化 | 整体砍掉，需要时改用系统浏览器打开 | 移除 `src/main/desktop/browser/`（YoBrowserPresenter、BrowserTab、CDPManager、yoBrowserSession、overlay 窗口）、浏览器类 Agent tool、BrowserClient、browser-overlay preload 与 renderer 页面、tab.ts 中的内嵌网页部分、agent-browser-pip 相关功能；第 4.1 节的 CDP 风险不再成立 |
| Computer use | 保留 CUA 插件，砍掉 PiP 预览窗口 | 移除 ComputerUsePreviewPresenter 与 computer-use-snapshot-pip；CUA 外部进程与工具调用不变 |
| 浮动按钮与悬浮聊天窗 | 两者都砍掉 | 移除 FloatingButtonWindow、FloatingChatWindow、floating-preload、renderer/floating；入口只剩主窗口与托盘；相关设置项在迁移时隐藏并保留数据 |
| OAuth 登录（Copilot 等） | 改用系统浏览器加 deep link 回调 | 重写 githubCopilotOAuth、githubCopilotDeviceFlow 中依赖 BrowserWindow 与 executeJavaScript 的部分；deep link 注册由 mygo 承担 |
| OCR 与图片预处理 | 保留，放进 Node sidecar | light-ocr 与 sharp 随 sidecar 分发，体积计入 M0 基线 |
| Linux | 实验性支持 | 提供构建，不作为发布阻塞项；WebKitGTK 问题不阻塞三平台主线 |
| MCP Apps 沙箱与 workspace 预览 | 待 M0 验证后再定 | 若 mygo 无自定义协议，备选是 loopback HTTP 加 token，或砍掉 MCP Apps 沙箱 |
| 整页截图与长图导出 | 待 M0 验证后再定 | 若 mygo 无页面截图能力，备选是 DOM 转图、延后或砍掉 |

这些决策带来的变化：

- M0 验证清单去掉 CDP、子 webview 嵌入、浮动与置顶透明窗口，保留自定义协议和页面截图两项。
- M4 的范围缩小为 splash、插件设置窗口、OAuth、导出，以及 M0 后再定的两项。
- 砍掉的功能要在发布说明中列出，并保证升级后旧数据、旧设置不报错，也不丢失。
- 删除这些模块时，同步清理对应的 route 合同、i18n 文案和测试。

## 11. 仍需确认的决策

1. 是否接受方案 B（Node sidecar）作为第一阶段，而不是直接全量 Go 重写。
2. 目标仓库形态：在本仓库的 `dev` 分支新建 Go 壳目录，还是另起仓库。
3. 是否同意先做 M0 和 M1，再决定后续投入。
4. 第 10 节中还有两项等 M0 结果再定，M0 报告出来后需要你逐项拍板。

已关闭的问题：YoBrowser（已砍掉）、Linux 定位（实验性支持）。

## 12. 后续动作

1. 你确认第 10 节后，我再把 M0 拆成可执行任务清单（plan.md），并开始搭 Go 验证工程。
2. M1 的 platform 抽象可以立即开始，不依赖 mygo 的验证结果。
