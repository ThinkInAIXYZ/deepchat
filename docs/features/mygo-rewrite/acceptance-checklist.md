# mygo 迁移验收清单

日期：2026-11-05
分支：`feat/mygo-rewrite`
用途：给验收者一份可以逐条核对的现状清单。每条都标注「已验证 / 部分验证 / 未开始」并给出证据位置。

## 一、产品决策（已定，不再讨论）

| 决策 | 状态 |
| --- | --- |
| 内置浏览器 YoBrowser 与 Agent 浏览器自动化 | 已删除 |
| computer use 的 PiP 预览窗口 | 已删除；CUA 插件保留 |
| 浮动按钮、悬浮聊天窗 | 已删除 |
| OAuth 改系统浏览器 + deep link 回调 | 未实施，受阻（见第四节） |
| OCR 与 sharp 放进 Node sidecar | 保留，尚未迁移 |
| Linux 实验性支持 | 未验证（无环境） |

## 二、阶段 A：删除已砍功能（已完成）

验证方式：主进程与渲染层测试全绿，功能相关代码与 i18n 键清零。

- [x] YoBrowser 相关代码、路由、事件、preload、渲染组件全部移除
- [x] 浏览器数据导入（`BrowserProfileImportService`）随 YoBrowser 删除
- [x] 浮动窗口、浮动按钮、computer use PiP 预览移除
- [x] 23 个 locale 的相关 i18n 键清理，`src/types/i18n.d.ts` 重新生成
- [x] 历史消息兼容：旧浏览器工具名仍按普通工具块渲染
- [x] 停用的旧工具名从会话「已禁用工具」列表中自动清理
- [x] 用户设置里 `floatingButtonEnabled` 等历史值保留未删

证据：`removal-checklist.md`、`release-notes-draft.md`、`plan.md` 的 A0–A6 结果行。

规模：223 个文件、约 −21,500 行。

## 三、阶段 C：mygo 技术验证（核心项已完成）

| 验证项 | 状态 | 证据 |
| --- | --- | --- |
| 真实渲染层在 WKWebView 中启动 | 已验证 | `evidence/renderer-in-wkwebview.png` |
| 绑定调用与事件 | 已验证 | `m0-report.md` 第 2 项 |
| 流式通道（12.5 MiB） | 已验证，25 ms | `m0-report.md` 第 3 项 |
| 自定义协议 | 已验证 | 第 5 项 |
| 页面截图、PDF、脚本求值 | 已验证 | 第 6 项 |
| 系统密钥库 | 已验证（macOS） | 第 8 项 |
| 打包 | 已验证：`.app` 75 MB、`.dmg` 15 MB | 第 9 项 |
| 冷启动 | 已验证：首帧约 250 ms | 第 10 项 |
| Windows / Linux 渲染 | 未验证（无环境） | — |
| `safeStorage` 口令迁移 | 未验证 | — |
| 自动更新升级链路 | 未验证 | — |

## 四、阶段 B：平台抽象（进行中）

边界外直接 import electron 的文件：**89 → 38**。

已完成的接口（9 个，均在 `src/main/platform/`，Electron 实现位于 `platform/electron/`）：

| 接口 | 迁移的调用点数量 |
| --- | --- |
| `AppHost` | 126 |
| `SecretHost` | 7 个文件 |
| `ShellHost` | 13 |
| `ProcessHost` | 4 个 utility process |
| `DialogHost` | 4 处 |
| `NetHost` | 4 处 |
| `ClipboardHost` | 3 处 |
| `ThemeHost` | 1 处 |
| `ShortcutHost` | 2 处 |

业务层（agent / provider / mcp / memory / tape / tool / skill / session）只剩 **6 个文件**引用 Electron，逐个结论文档在 `platform-abstraction.md`。

**受阻项**：3 个 OAuth 文件依赖 `https://deepchatai.cn/auth/github/callback` 这个仓库外的回调页。改成系统浏览器后，需要该页面再跳回 `deepchat://` 才能把授权码带回应用。没有服务端配合无法完成。

## 四之二、M2 第一版（已验证）

- `pnpm run sidecar:build` 产出 `out/sidecar/entry.mjs`，不含 Electron
- 用真实 `SettingsStore` 与真实路由契约处理 `config.getEntries` / `config.updateEntries`
- 读改落盘全部正确，非法键被 zod 拒绝
- 入口：`src/main/sidecar/entry.ts`；构建配置：`vite.sidecar.config.ts`
- 原生模块与 SQLCipher 已在纯 Node 下实测可用，数据库方案见 `database-decision.md`
- sidecar 已接 33 条路由；壳另有 8 条（5 条窗口控制、1 条渲染就绪、2 条文件对话框）。冷启动 119 次进入 sidecar 的调用中 111 次被真实服务（93%）：config 读写、语言、主题、自定义提示词、设备信息、更新占位、窗口身份与状态、复用的 5 条 onboarding、走真实 `AppSessionService` 的会话列表、走真实 `ProviderSettings` 的 provider 摘要、走真实 `McpSettings` 的 MCP 开关与服务配置、复用的 9 条 `settings.*`
- 与 Go 壳联调：真实设置文件驱动真实渲染层，界面变为日语 + 深色（`evidence/renderer-real-sidecar.png`）

## 四之三、原生模块可用性（已验证）

在纯 Node 进程里加载：`better-sqlite3-multiple-ciphers`、`node-pty`、`sharp`、`@parcel/watcher`、`@duckdb/node-api`、`@zerob13/nativekit`、`opendal` 全部通过。原因是 Node 24.21 与 Electron 43 的 Node 同为 ABI 137。

SQLCipher 加密库写入、正确密钥重开、错误密钥被拒均验证通过。结论：sidecar 可以直接持有现有数据库，不需要为用户数据做任何转换。

更进一步，sidecar 已经用真实的 `MainDatabase` 打开加密库并跑完迁移：`tables: 74`、`hasSessions: true`。详见 `database-decision.md`。

## 四之四、路由归属（已验证）

壳先处理、sidecar 兜底。窗口类路由已由 Go 实现：实测 `window.toggleMaximizeCurrent` 让窗口从 1280×820 变为 1920×960，`window.getCurrentState` 同步返回 `isMaximized: true`。详见 `m0-report.md` 第 13 节。

## 四之五、壳侧能力（部分验证）

已实测：窗口最小化/最大化/关闭、托盘图标与菜单、全局快捷键、系统通知（**仅打包后的 `.app` 可用**）。
已实现待人工验证：文件对话框（`device.selectDirectory` / `device.selectFiles`）。
未验证：Dock 菜单、开机自启注册。详见 `m0-report.md` 第 15 节。

## 五、端到端链路（已验证）

```
renderer（未改动的 DeepChat 前端）
  -> window.deepchat.invoke
  -> mygo 绑定
  -> Go 壳
  -> Node sidecar（stdin/stdout JSON）
```

- 冷启动共 53 次调用、29 条路由，清单见 `boot-route-inventory.md`
- 界面语言、主题、provider 目录、onboarding 状态均由 sidecar 返回并生效，截图 `evidence/renderer-real-sidecar.png`、`evidence/renderer-with-providers.png`
- 事件通道已接通：sidecar 事件 → Go `Broadcast` → preload 分发 → `window.deepchat.on`
- preload 用的是应用自己的 `createBridge`（`out/preload/bridge.js`），契约校验与 Electron 下完全一致；非法枚举值与未知路由都会被拦下
- 用真实事件验证：推送 `config.theme.changed` 后渲染层切换为深色（`evidence/renderer-dark-via-event.png`）

## 六、代码质量门禁（当前状态）

| 检查 | 结果 |
| --- | --- |
| `pnpm run typecheck` | 通过 |
| `pnpm run lint` | 通过，0 warning 0 error |
| `pnpm run format` | 通过 |
| `pnpm run i18n` | 通过 |
| `pnpm run test:main` | 9785 通过、1 失败 |
| `pnpm run test:renderer` | 2704 通过 |
| `pnpm exec electron-vite build` | 通过 |
| Electron 版启动冒烟 | 通过（临时 user-data 目录，未接触真实数据） |
| `pnpm run e2e:smoke` | 未运行（需完整构建） |

唯一失败的用例是 `test/main/scripts/buildCli.test.ts`：它会构建并运行真实 CLI 产物，本机报
`dyld: Library not loaded: @rpath/libnode.137.dylib`。原因是本机 Node 为 24.21.0，而项目要求
>= 24.22.1，Electron 打包产物的原生库与之不匹配。与本次改动无关，尚未在干净环境复验。

## 七、下一步（按依赖排序）

1. ~~事件通道~~：已完成，见第五节。
2. **真实 sidecar**：31 条路由 + 真实加密数据库（含迁移）已在 sidecar 里跑通。冷启动清单里只剩 6 条路由共 8 次调用未服务，全部需要 MCP 活连接或完整运行时（`mcp.listPrompts`、`mcp.listToolDefinitions`、`mcp.getClients`、`mcp.listResources`、`startup.getBootstrap`），它们需要 MCP 活连接与启动编排，依赖 composition 拆解（见 `composition-decomposition.md`）。
3. **Go 壳路由分流**：window、app、tray、menu、shortcut 由 Go 直接服务，其余转 sidecar。
4. **口令迁移**：`safeStorage` → `mygo.Secrets` 的迁移脚本与首次启动流程。
5. **打包与更新**：三平台产物、签名、公证，以及 Electron 用户向 mygo 版的升级路径。
6. **Linux / Windows 验证**：需要对应环境。

## 七之二、遗留工作的唯一大前提

剩余 8 条 sidecar 路由（`mcp.listPrompts`、`mcp.listToolDefinitions`、`mcp.getClients`、`mcp.listResources`、`settings.getSnapshot`、`startup.getBootstrap`、`toolchains.getStatus`、`sessions.getAgents`）都依赖 `composition.ts` 的多服务装配。拆解方案见 `composition-decomposition.md`，里面给出了 6 个工厂的拆分顺序、依赖约定、已知难点与验证方式。

## 七之三、本分支的规模

相对 `dev`：**334 个文件、+5,334 / −21,972 行、13 个提交**。

| 提交 | 内容 |
| --- | --- |
| `fa4cdcca0` | 删除桌面专属功能 + 平台端口 + sidecar 入口 |
| `4b08e6c98` | 文档与 Go 验证工程 |
| `59ab83f71` | 设置子系统工厂 |
| `a70d63ba3` | Provider 子系统工厂 |
| `43f03d449` | `sessions.getAgents` |
| `9677f7eeb` | `toolchains.getStatus` |
| `1315c133e` | 真实 preload 桥接 |
| `0a777d777` | 托盘与全局快捷键 |
| `d1219f578` | 通知与文件对话框 |
| `f9ba44002` | 解除 agent/provider 构造循环 |
| `afa8b65cb` | 全部设置路由 |
| `4c366d49c` | `mcp.getServerAuthStatus` + 覆盖率日志 |
| `3d661f044` | 壳回答 `notification.rendererReady` |

## 八、验收结论

- **方案可行性**：已验证。渲染层零改动即可在系统 webview 中运行，桌面能力齐备，体积与启动均有明显收益。
- **阶段 A（删功能）**：可验收。
- **阶段 B（平台抽象）**：约完成一半，剩余工作集中在 `desktop/` 与 `app/`，其中 OAuth 一项受阻于仓库外依赖。
- **整体迁移**：尚未到可发布的验收阶段。按当前进度，剩余工作主要是 M2–M6，粗估 4–6 个月。
