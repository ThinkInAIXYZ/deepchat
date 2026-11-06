# mygo 完整替代验收与差距清单

更新：2026-11-06（阶段 D 审计与后台进程运行时切片）
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
| 后台子进程异常诊断、恢复与关闭 | 未实现完整闭环 | 当前请求/进程级恢复和打包后完整生命周期仍待 D2/D4；单次成功启动不代表恢复已验证 |

### 3.2 正式产品壳与传输（阶段 D2）

| 能力 | 状态 | 差距 |
| --- | --- | --- |
| 正式应用入口 | 部分实现（D2b1 已实测） | `shell/deepchat` 可构建并直接启动、获得单实例锁并回收 sidecar，不是正式打包发行版；spike 与正式入口共享 `internal/sidecar` |
| 启动 readiness 与 route 错误 | 部分实现（D2a 已验证） | 早期请求现在等待真实 dispatcher 注册，ready 后才发布 started，缺 route/缺 dispatcher 返回错误；启动超时和启动失败终态仍未覆盖 |
| 超时、取消、背压、损坏响应 | 部分实现（D2b1 已验证） | 共享 Process 支持请求 deadline、取消后的合法迟到响应丢弃、非法输出/异常 id 失败；超大阻塞输入和长期资源治理仍待 D2c |
| sidecar 崩溃恢复和进程树关闭 | 部分实现（D2b1 已验证） | 在途请求收到确定错误、意外退出可终止壳、超时强杀覆盖进程组并等待回收；自动重连、renderer 重建和真实 Main shutdown coordinator 尚未完成 |
| 多窗口身份 | 部分实现（仅单窗口） | 正式 Bridge 使用 `mygo.CallerWindow` 校验当前真实主窗口；shim 内部多窗口身份仍固定/选择最后窗口，目标事件和关闭通知未对等 |
| 单实例、deep link 和生命周期事件 | 部分实现（D2b1 已验证） | 第二次启动实测退出且不再启动业务进程；deep link、原生命运周期事件和 relaunch 尚未完整桥接 |

### 3.3 原生能力与安全边界（阶段 D3）

| 能力 | 状态 | 差距 |
| --- | --- | --- |
| 窗口、托盘、全局快捷键 | 部分 spike | 仅主窗口和单项 macOS 验证；没有多窗口、完整菜单和正式注册/事件合同 |
| 文件对话框 | 部分 spike/不应视为可用 | shim 仍可能返回 `canceled:false` 与空数组，正式结果必须由真实 Go bridge 返回 |
| 通知 | 部分 spike | 仅打包 `.app` 的简单通知实测；业务点击目标和回调未验收 |
| Clipboard/nativeImage | 未实现 | sidecar 仍丢弃文本/图片写入，图片对象和截图可能是空输出 |
| workspace 预览/长图 | 未实现完整链路 | `CapturePage`/`Eval` 能力存在不等于 tab capture、组合图片、滚动导出已成功 |
| workspace/MCP Apps 协议隔离 | 未实现产品边界 | shim `protocol.handle()` 可能假报 true；未形成 origin、导航、session partition 与 sender 的完整安全验证 |
| preload/context isolation | 未实现对等验证 | mygo v0.7.4 macOS 使用未指定 content world 的 `WKUserScript`；需要上游隔离能力或经评审的等价 least-privilege 设计，spike `Eval` 与任意外链转发禁止进入正式绑定 |
| OAuth | 部分受阻 | 系统浏览器迁移未完成；GitHub 回调页需配合回到 deep chat deep link，其他 OAuth 仍需逐项源审 |
| 代理/权限/网络状态 | 未实现 | shim 的 proxy、permission、webRequest 和 `net.isOnline()` 等并非真实系统状态 |

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
| 中断、错误密钥、缺失密钥和恢复 | 未实现 | 需要复制 fixture，禁止直接在真实用户数据上实验 |

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

D1、D2a 已提交，D2b1 已完成共享监管和正式单窗口入口后进入 **D2c：完整真实生命周期**。下一优先级是把退出接入 Main shutdown coordinator 并实现有界重连和 renderer 状态重建；然后补多窗口身份、deep link 与真实原生能力。D2c 尚未完成，D3–D7 也不能从验收中删除。
