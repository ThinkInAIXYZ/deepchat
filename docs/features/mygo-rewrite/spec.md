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
- **sidecar**负责业务计算和保持现有 typed route/event 语义。渲染器发送者身份必须来自 Go YAML/窗口映射和可信传输，不能由页面输入任意声明。
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

D2b1 是单窗口、可监督的第一根产品脊柱。真实 Main shutdown coordinator、自动重连、跨窗口身份、deep link 和产品级隔离等价仍未完成，记录于 D2c，而不是借本切片的进程启动成功宣称整个生命周期通过。

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
