# 平台层抽象设计（阶段 B0）

状态：草案，等待 Go 验证结果后定稿
目标：把 `src/main` 对 Electron 的直接依赖收敛到一组窄接口，使 Electron 实现与未来的 mygo 壳可以互换。

## 1. 现状盘点（阶段 A 完成后实测）

- 仍有 89 个文件 `import ... from 'electron'`。
- 符号频次：`app` 53、`shell` 14、`BrowserWindow` 13、`nativeImage` 9、`safeStorage` 7、`net` 4、`dialog` 4、`protocol` 3、`clipboard` 3、`Menu` 3、`ipcMain` 2、`session` 2、`screen` 1、`nativeTheme` 1、`globalShortcut` 1。
- 阶段 A 已移除 YoBrowser 和 PiP 预览，`WebContentsView` 仅剩标签页与截图相关用途。

## 2. 接口划分

每个接口只放当前真正被业务调用的方法，不预先设计。位置统一在 `src/main/platform/`。

| 接口 | 覆盖的 Electron 能力 | 主要使用方 |
| --- | --- | --- |
| `AppHost` | `app.getPath`、`getVersion`、`getName`、`whenReady`、`quit`、`relaunch`、事件 | composition、logging、migration、几乎全部数据模块 |
| `WindowHost` | 创建窗口、窗口状态、焦点、发送事件、关闭 | desktop/window、desktop/routes |
| `ShellHost` | `openExternal`、`openPath`、`showItemInFolder`、`trashItem` | lib/externalUrl、settings、deeplink |
| `SecretHost` | `safeStorage` 的可用性、加解密 | secretStore、databaseSecurity、各 credentialStore |
| `ProtocolHost` | `protocol.handle`、`registerSchemesAsPrivileged` | app/protocols、workspacePreviewProtocol、mcp sandboxProtocol |
| `DialogHost` | 打开/保存文件、消息框 | dialog service、knowledge 导入 |
| `ClipboardHost` | 文本与图片读写 | clipboardIpc、contextMenu |
| `MenuHost` | 应用菜单、上下文菜单项 | desktop/menu、contextMenu、tray |
| `ShortcutHost` | 全局快捷键 | desktop/shortcut |
| `ThemeHost` | 原生主题、透明度/材质 | desktop/window、splash |
| `ImageHost` | `nativeImage` 解码、缩放、编码 | watermark、scrollCapture、图标 |
| `NetHost` | `net.fetch` 或代理请求 | proxy、provider 请求兜底 |

## 2.1 已完成（2026-11-05）

| 接口 | 文件 | 迁移的调用点 |
| --- | --- | --- |
| `SecretHost` | `platform/secretHost.ts` + `platform/electron/secretHost.ts` | `config/secretStore`、`app/databaseSecurity`、`app/composition`（sync token）、`provider/auth/xaiGrok`、`provider/auth/openaiCodex`、`mcp/oauthCredentialStore`、`ocr/ocrCacheKeyProvider` |
| `ShellHost` | `platform/shellHost.ts` + `platform/electron/shellHost.ts` | `lib/externalUrl`、`upgrade`、`app/logging`、`skill`、`workspace`、`plugin`、`provider/auth/*`、`desktop/window`、`mcp/*`、`project`、`sync` |
| `ShortcutHost` | `platform/shortcutHost.ts` + `platform/electron/shortcutHost.ts` | `desktop/shortcut` |
| `ThemeHost` | `platform/themeHost.ts` + `platform/electron/themeHost.ts` | `desktop/settings` |
| `ClipboardHost` | `platform/clipboardHost.ts` + `platform/electron/clipboardHost.ts` | `app/clipboardIpc`、`file/index`（图片复制，原 `nativeImage` 逻辑收进实现） |
| `DialogHost` | `platform/dialogHost.ts` + `platform/electron/dialogHost.ts` | `file/index`（保存图片）、`device/index`（选目录/选文件/重置确认）、`desktop/contextMenu`（保存图片）、`appMain`（启动失败提示） |
| `NetHost` | `platform/netHost.ts` + `platform/electron/netHost.ts` | `file/index`（下载远程图片）、`desktop/contextMenu`、`agent/acp/catalog/acpRegistryService`（图标）、`remote/runtime/adapter`（附件） |
| `StoreHost` | `platform/storeHost.ts` + `platform/electron/storeHost.ts` + `platform/node/storeHost.ts` | `electron-store` 的 9 处使用：app settings、MCP、model config、provider model、ACP catalog、plugin settings、plugin tool policy、database security、config migration。Electron 实现等价包装原库；Node 实现是同格式 JSON 文件存储（含 defaults 合并与原子写），已有针对性测试 `test/main/platform/nodeStoreHost.test.ts` |
| `ProcessHost` | `platform/processHost.ts` + `platform/electron/processHost.ts` | `platform/fileWatcher/watcherHostClient`、`scheduler/schedulerProcessManager`、`agent/shared/process/backgroundExecSessionManager`、`tool/codeMode/runCodeRuntimeManager`（4 个 utility process，含 RSS 读取） |
| `AppHost` | `platform/appHost.ts` + `platform/electron/appHost.ts` | 49 个文件，126 处只读调用：`getPath` 83（userData 49、temp 17、home 14、appData 2、documents 1）、`getVersion` 19、`getAppPath` 16、`getName` 2、`getLocale` 2、`isPackaged` 7、`resourcesPath` 6 |

现状（2026-11-05）：8 个接口已抽出，共迁移约 160 处调用。

边界外仍直接 import electron 的文件从 89 降到 **36**；`electron-store` 也只剩平台实现内部使用。

### 业务层几乎已经与 Electron 解耦

按目录统计，业务层（agent / provider / mcp / memory / tape / tool / skill / session）只剩 **5 个文件**引用 Electron：

| 文件 | 用法 | 迁移去路 |
| --- | --- | --- |
| `provider/auth/githubCopilotDeviceFlow` | `BrowserWindow` | 按已定决策改为系统浏览器 + deep link |
| `provider/auth/githubCopilotOAuth` | `BrowserWindow` | 同上 |
| `provider/auth/index` | `BrowserWindow` | 同上 |
| `mcp/apps/sandboxRegistry` | `session`、`webContents` | 依赖 Electron 分区隔离，需与 Go 侧协议方案一起重写 |
| `mcp/apps/sandboxProtocol` | `protocol` | 同上 |
| `tool/agentTools/agentToolManager` | `nativeImage` | 随 sidecar 换 `sharp` |

`utilityProcess` 已由 `ProcessHost` 收口：Electron 实现用 `utilityProcess.fork`，Node sidecar 换成 `child_process.fork` 即可，调用方不再感知运行时。

`agentToolManager` 已改用 `sharp` 读图片尺寸（同为已有依赖），业务层少一个 Electron 依赖。

### 剩余 5 个文件的处理结论

| 文件 | 现状 | 结论 |
| --- | --- | --- |
| `provider/auth/githubCopilotOAuth` | 用 `BrowserWindow` 轮询导航到 `https://deepchatai.cn/auth/github/callback` | **受阻**：回调页在仓库之外，改成系统浏览器需要该页面再跳回 `deepchat://` deep link。需要产品/服务端配合，本轮不改。 |
| `provider/auth/githubCopilotDeviceFlow` | `BrowserWindow` 展示设备码 | 可改系统浏览器 + 剪贴板/提示，但属于同一登录流程，与上一项一起做。 |
| `provider/auth/index` | 旧 OAuth 实现里的 `BrowserWindow` 分支 | 与上面两项同批处理。 |
| `mcp/apps/sandboxRegistry` | `session`、`webContents` | 依赖 Electron 的独立分区与 `webContents` 身份，必须与 Go 侧协议一起重写。 |
| `mcp/apps/sandboxProtocol` | `protocol` | 同上。 |

结论：能立即推进的业务层文件已经清完；剩下的要么依赖仓库外的服务端改动，要么依赖 M3 的 Go 实现，不适合现在硬做。真正的工作量在 `desktop/`（10 个文件）与 `app/`（8 个文件），而这两块按方案本来就要换成 Go 实现，不需要端口化。

剩余符号分布（按文件数）：

| 符号 | 文件数 | 说明 |
| --- | --- | --- |
| `app` | 20 | 只剩生命周期：`whenReady`、`quit`、`relaunch`、`exit`、`on`、`requestSingleInstanceLock`、`setAsDefaultProtocolClient` |
| `BrowserWindow` | 14 | 窗口创建与状态，属于 `WindowHost` |
| `nativeImage` | 8 | 图片解码/缩放/编码，见下面的说明 |
| `protocol` | 3 | 安全边界，见下面的说明 |
| `Menu` | 3 | 应用菜单、上下文菜单、托盘 |
| `ipcMain`、`session`、`clipboard`、`net`、`shell`、`dialog`、`screen`、`safeStorage`、`nativeTheme`、`globalShortcut` | 各 1–2 | 未迁移的遗漏点，收尾时逐个处理 |

两个需要说明的取舍：

- **`nativeImage` 不打算做端口**。它服务于水印、长图拼接、托盘与窗口图标。这些逻辑在 mygo 版里要么随 sidecar 改用 `sharp`（已是依赖），要么由 Go 直接生成图标，做成端口只会固化 Electron 的图片对象模型。收尾时按用途分别改写。
- **`protocol` 也不做 TS 端口**。mygo 的 `Protocol.Handle` 运行在 Go 侧，把 JS handler 反向桥接过去会牺牲性能并放大安全面。workspace 预览与 MCP Apps 沙箱应在 Go 侧重写，TS 侧只保留"请求哪个路径"的纯函数。这一步需要单独评审，因为它同时是安全边界。

下一批顺序：先处理业务层这 8 个文件（能直接让 M2 起步），再决定 `desktop/` 与 `app/` 是端口化还是整体换成 Go 实现。

`typecheck`、`lint`、`format`、`test:main`（除既有的 `buildCli` 环境失败外）与 `test:renderer` 均通过。

## 3. 迁移顺序

按「被谁依赖」排，先做叶子：

1. `AppHost`、`ShellHost`、`SecretHost`：调用点分散但语义单一，替换风险最低。
2. `ClipboardHost`、`DialogHost`、`ThemeHost`、`ImageHost`。
3. `MenuHost`、`ShortcutHost`、`ProtocolHost`、`NetHost`。
4. `WindowHost`：最后做，因为它牵连 desktop 模块和 tab 生命周期。

每完成一个接口，Electron 实现放 `platform/electron/`，测试里用已有的 fake 注入；断言只覆盖接口行为，不覆盖 Electron 细节。

## 3.1 两种构建，同一份源码

`platform/*.ts` 只是类型和再导出，具体实现在 `platform/electron/` 或 `platform/node/`。sidecar 构建时应在打包层把 `platform/electron/*` 替换为 `platform/node/*`，而不是在源码里做运行时分支——这样业务代码始终导入同一个符号，也不会把 Electron 打进 Node 产物。

目前已具备 Node 实现的端口：

| 端口 | Node 实现 | 说明 |
| --- | --- | --- |
| `AppHost` | `platform/node/appHost.ts` | 路径由 `DEEPCHAT_USER_DATA` 等环境变量传入，未传时按平台惯例推导 |
| `StoreHost` | `platform/node/storeHost.ts` | 同格式 JSON，defaults 合并、原子写 |
| `ProcessHost` | `platform/node/processHost.ts` | `child_process.fork`；RSS 在 Linux 读 `/proc/<pid>/status`，其他平台返回 null |
| `SecretHost` | `platform/node/secretHost.ts` | AES-256-GCM + 用户目录下的 0600 主密钥。**临时方案**：正式部署必须把主密钥放进 `mygo.Secrets`，当前实现 `isInsecure()` 返回 true，调用方会按「不受保护」处理 |

`src/main/platform/*.ts` 的别名顺序在 `vite.sidecar.config.ts` 里必须先匹配具体端口再匹配通用 `@/` 前缀，否则替换不生效。

## 3.2 sidecar 第一版已经能跑

`src/main/sidecar/entry.ts` + `vite.sidecar.config.ts`（`pnpm run sidecar:build`）产出 `out/sidecar/entry.mjs`，**不含 Electron**（打包后 `grep 'from "electron"'` 为 0）。

实测：

```bash
DEEPCHAT_USER_DATA=/tmp/dc-sidecar-test node out/sidecar/entry.mjs
```

- 启动即输出 `{"event":"sidecar.ready","payload":{"routes":2}}`
- `config.getEntries` 从真实 `app-settings.json` 读出 `sidebar_group_mode: by_time`
- `config.updateEntries` 改成 `manual`，再次读取得到 `manual`，并落盘
- 契约校验真实生效：传入白名单外的键（如 `language`）会被 zod 拒绝并返回结构化错误

当前只注册了两条路由，其余 27 条按启动清单逐个迁移。这也是第一次证明「同一份业务代码、两种运行时」成立。

## 4. 与 mygo 的关系

Go 壳需要实现的正是这些接口。mygo 验证报告（`m0-report.md`）应当逐项回答：

- `SecretHost`：mygo secrets 能否读写；Electron `safeStorage` 已加密的口令如何迁移。
- `ProtocolHost`：mygo 有没有自定义 scheme；没有则用 loopback HTTP，接口签名保持「按 URL 返回内容」不变。
- `WindowHost`：多窗口、窗口状态、发送事件的等价能力。
- `MenuHost`、`ShortcutHost`、`ThemeHost`：mygo 的托盘/菜单/快捷键/深色模式 API 是否一一对应。

接口设计不绑定 Electron 的 DTO：窗口 id 用 `number`、事件用 `(channel, payload)`，足以映射到 mygo 的绑定调用。

## 5. 已知难点

- `app.getPath` 被引用了 53 处，很多在模块构造时调用。抽象后要避免把 host 传遍所有构造函数，优先通过已有的 composition 注入点下发。
- `BrowserWindow` 在 `desktop/routes.ts`、`desktop/window` 里被用来读窗口状态。mygo 没有同构对象，`WindowHost` 必须只暴露「查询状态」而不是返回窗口对象。
- `safeStorage` 的加密结果与平台绑定。抽象层不改密文格式，迁移时才需要一次性重加密。
- `protocol.handle` 在 MCP Apps 沙箱里与「第三方页面隔离」强相关，属于安全边界，改动需要单独评审。

## 6. 阶段 B 的验收

- `grep -rl "from 'electron'" src/main` 的结果只剩 `src/main/platform/electron/` 与 `src/main/appMain.ts`（当前边界外仍有 77 个文件）。
- 现有全部 main 测试通过，e2e 冒烟通过。
- Electron 版本行为无可观察变化。
