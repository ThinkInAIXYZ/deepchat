# 评审说明（branch `feat/mygo-rewrite`）

面向 reviewer。相对 `dev`：**342 个文件、+5,784 / −22,028 行、18 个提交**。

## 这个分支做了什么

为「用 mygo（Go + 系统 webview）重写桌面壳」做前期工程：删掉不迁移的功能、把 Electron 依赖收进平台端口、跑通一个能用的 Node sidecar、并用 Go 验证工程把关键假设逐条测掉。

**没有做**：完整的壳替换。`desktop/` 与 `app/` 仍是 Electron，产品行为除下列删除项外没有变化。

## 一、用户可感知的变化

三条功能按产品决策下线：内置浏览器（YoBrowser）与 Agent 浏览器自动化、浮动按钮与悬浮聊天窗、computer use 的 PiP 预览。CUA 插件本身保留。

**会话侧边栏（BEFORE）**
```
┌──────────────┬────────────────────────────┐
│ 会话列表      │ [工作区] [浏览器] [MCP] [Tape] │
│              │                            │
└──────────────┴────────────────────────────┘
```

**会话侧边栏（AFTER）**
```
┌──────────────┬────────────────────────────┐
│ 会话列表      │ [工作区] [MCP] [Tape]        │
│              │                            │
└──────────────┴────────────────────────────┘
```

**设置 · 数据（BEFORE）**
```
数据与安全
├─ YoBrowser 数据导入
├─ 数据库加密
└─ 清理数据
```

**设置 · 数据（AFTER）**
```
数据与安全
├─ 数据库加密
└─ 清理数据
```

**设置 · 显示（BEFORE）**
```
显示
├─ 主题 / 字体
├─ 浮动按钮  [开关]
└─ 语言
```

**设置 · 显示（AFTER）**
```
显示
├─ 主题 / 字体
└─ 语言
```

历史数据兼容：旧会话里的浏览器工具调用仍按普通工具块渲染，不会报错；设置里残留的 `floatingButtonEnabled` 等字段保留未删，只是不再生效。

## 二、代码结构变化

新增 `src/main/platform/`：10 个端口（app / clipboard / dialog / net / process / secret / shell / shortcut / store / theme），每个都有 Electron 实现，其中 6 个另有 Node 实现。

业务层（agent / provider / mcp / memory / tool / session）引用 Electron 的文件从 8 降到 5，边界外总数从 89 降到 36。

新增 `src/main/sidecar/entry.ts`：同一个业务代码在 Node 里跑，已接 37 条路由，冷启动 122 次调用里 120 次由真实业务代码服务。`vite.sidecar.config.ts` 在打包层把 `platform/electron/*` 换成 `platform/node/*`，业务代码只认一个符号。

## 三、怎么验证的

| 检查 | 结果 |
| --- | --- |
| `typecheck` / `lint` / `format` / `i18n` | 通过 |
| `test:main` | 9788 通过、1 失败 |
| `test:renderer` | 2704 通过 |
| sidecar 产物 | 1.67 MB，`from "electron"` 0 次 |
| 冷启动覆盖率 | 122 次进入 sidecar 的调用中 120 次被真实服务 |
| Electron 版构建 | `electron-vite build` 通过（main / preload / renderer） |
| Electron 版启动 | 真实启动冒烟通过，见下 |

**Electron 版启动冒烟**（本轮新增，此前的验证都停留在单测与 Go 壳，没有真正启动过 Electron）：

```
pnpm exec electron out/main/index.js --user-data-dir=/tmp/dc-electron-smoke
```

日志显示完整启动链路走通：`app.startup.started` → 数据库打开（5.1 ms）→ 建表（25 ms）→ 迁移 → 协议注册 → 95 个 provider 限流初始化 → 知识库、MCP、插件依次就绪。窗口与渲染进程正常起来。

用临时 user-data 目录，没有接触真实用户数据。

唯一一条报错是 `plugins/memcode` 的清单校验（`Invalid Nowledge Mem server URL`）。该文件在我改动之前就存在（`git log` 显示由 `7f9d54f61` 修改），且 `plugins/` 目录没有任何本地改动，与本次迁移无关。

唯一失败用例是 `test/main/scripts/buildCli.test.ts`：它构建并运行真实 CLI 产物，本机 Node 24.21.0 低于项目要求的 24.22.1，报 `dyld: Library not loaded: @rpath/libnode.137.dylib`。与本分支改动无关，但没有在干净环境复验过——**这条请在 CI 上确认**。

## 四、值得 reviewer 重点看的地方

1. **`src/main/platform/node/secretHost.ts`**：sidecar 用本地主密钥（0600 文件）加密，`isInsecure()` 返回 `true`。这是**临时方案**，正式版必须换 `mygo.Secrets`。如果这条被误当成生产实现，加密数据库的安全性会退化。
2. **`src/main/agent/settings.ts`**：provider 端口从构造时传值改成按调用求值的 getter，用来解除与 `ProviderRuntime` 的构造循环。行为不变，但签名变了，测试也一并调整。
3. **`src/shared/logger.ts`**：不再依赖 `@electron-toolkit/utils`，改用 `import.meta.env.DEV` 与 `NODE_ENV`。影响面几乎全局，但判断语义等价。
4. **`src/main/sidecar/entry.ts` 的 `sessions.getAgents`**：没有走 `AgentSettings`，而是直接用 `AgentRepository` + `AcpCatalogSettings`。这是折中，风险写在 `composition-decomposition.md` 里，等 `providerRuntime` 搬出来应改回工厂。
5. **`src/main/platform/proxy.ts`**：代理应用从直接调用 Electron `session` 改为可注入的 `ProxySessionApplier`，Electron 实现在 `platform/electron/proxyApplier.ts` 并在 `mainProcess.ts` 装上。副作用是 `proxy.test.ts` 改为注入假实现。
6. **`src/main/sidecar/entry.ts` 的 `McpService` 装配**：ACP 代理列表为空、MCP sampling 抛错、语义通知丢弃，都是因为对应运行时还没迁移；服务器启动未接线。这三处是「能构造但能力不全」，不是完整实现。
7. **`shell/spike/`**：验证工程，不是产品代码。9 个源文件，构建产物已 gitignore。

## 五、已知遗留

- 剩余 2 次冷启动调用未服务（`acp.elicitation.list`、`remoteControl.listChannels`），需要各自运行时整体迁移
- sidecar 不启动 MCP 服务器，`mcp.getClients` 等返回空列表；启停编排待定
- OAuth 三个文件仍用 `BrowserWindow`：回调页在仓库之外，改成系统浏览器需要服务端配合跳回 deep link
- Windows / Linux 只在代码层面兼容，未在真机验证
- 自动更新链路未设计

细节见 `docs/features/mygo-rewrite/`：`acceptance-checklist.md`（现状）、`m0-report.md`（验证数据）、`database-decision.md`（数据库方案）、`composition-decomposition.md`（后续拆解）。
