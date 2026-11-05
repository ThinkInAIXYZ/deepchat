# M0：mygo 技术验证规格

目的：用最小的 Go 工程，确认 mygo 能否承载 DeepChat 的 renderer 和桌面能力，并量化代价。本阶段只验证，不改 DeepChat 现有代码，不做功能迁移。

## 1. 重要事实与限制

- mygo 是 egoist 写的 Go 桌面框架，纯 Go、无 cgo，窗口用系统 webview：macOS 用 WKWebView，Linux 用 WebKitGTK，Windows 用 WebView2。前端通过 `mygo generate` 生成 TypeScript 客户端调用 Go。
- 项目很新，API 变化快。必须固定版本，在报告里写明所用的版本或 commit。
- 本方案作者没有读到 mygo 原文。网页抓取工具对 github.com、pkg.go.dev、mygo.egoist.dev 等域名返回过 `blocked_address`，只拿到搜索摘要。所以文档里关于 mygo 的描述都是「待验证」。以你实际读到的文档和实际跑出来的结果为准。
- 如果你也读不到文档，请直接 `go doc`、读模块缓存里的源码和 README（`go list -m -json github.com/egoist/mygo`，再看 `GOMODCACHE`）。这条路最可靠。

## 2. 资料入口

- https://github.com/egoist/mygo ，以及仓库内 `AGENTS.md`、`docs/README.md`、`docs/frontend.md`、`docs/native.md`
- https://mygo.egoist.dev/docs 、`/docs/bindings`、`/docs/ui/web-view`
- https://pkg.go.dev/github.com/egoist/mygo
- GitHub issue #729：自定义 scheme 页面被完全信任，无法托管第三方页面（对 MCP Apps 沙箱有影响）；issue #105：原生 UI 路线图

## 3. 验证清单（10 项）

每项都要给出：结论（通过 / 部分通过 / 失败 / 无法验证）、证据（命令输出、截图路径、代码位置）、对 DeepChat 的影响。

1. **renderer 启动**：用 mygo 窗口加载 DeepChat renderer 构建产物，主聊天页能渲染。至少抽查：Monaco 编辑器、Mermaid、markstream-vue 的 markdown 渲染、TipTap 输入框、xterm 终端、虚拟滚动列表。macOS（WKWebView）必测；Windows（WebView2）和 Linux（WebKitGTK）有环境就测，没环境写「无法验证」。
2. **Go 与前端的调用与事件**：从前端调用一个 Go 方法并拿到返回值；Go 主动向前端推送事件。要能对应 DeepChat 现有的「route 调用 + event 推送」模型（见 `src/shared/contracts/` 和 `src/preload/createBridge.ts`）。
3. **流式推送压测**：模拟聊天流式输出，每 120ms 推送一次完整 block 快照（单个 payload 取 50KB 和 500KB 两档），持续 60 秒。记录丢包、延迟、前端 CPU 占用。mygo 的 channel 机制是否支持背压。
4. **多窗口与 tab**：能否同时开主窗口和设置窗口，窗口间互不干扰；能否关闭窗口不退出应用（托盘常驻）。
5. **自定义协议或等价方案**：能否注册自定义 URL scheme 并返回自定义内容；能否给某个页面设置独立的信任级别；不支持时，用 loopback HTTP 服务加随机 token 能否在 webview 中正常加载。这一项决定 MCP Apps 沙箱和 workspace 预览的去留。
6. **页面截图与整页截图**：mygo 或系统 webview 有没有页面截图、打印 PDF 的能力；整页滚动截图能否实现。这一项决定长图导出的去留。
7. **桌面能力**：托盘、应用菜单（含快捷键）、全局快捷键、系统通知、文件对话框、剪贴板（含图片）、深色模式、deep link。逐个写一个最小示例并验证。
8. **密钥存储与数据库口令**：mygo 的 secrets 能力能否读写。DeepChat 现在用 Electron 的 `safeStorage` 保存数据库口令（见 `src/main/app/databaseSecurity.ts`）。需要回答：Electron 加密过的口令，在 mygo 里能否读出？不能的话，迁移方案是什么？注意：只做分析，不要在真实用户数据上做实验，不要读取或打印任何口令。
9. **打包与自动更新**：产出可运行的 macOS 应用包；记录体积；说明 mygo 的更新机制能否让现有 Electron 版用户升级到 mygo 版，如果不能，写出替代方案。
10. **体积与启动对比**：同一台机器上，对比 Electron 版和 mygo 验证工程的：安装包体积、冷启动到首屏的时间、空闲内存。Electron 版数据通过 `pnpm run build:unpack` 取得（耗时长，必要时只量 `out/` 和现有发布包的体积，并注明方法）。注意：方案 B 还要在 mygo 之外分发 Node sidecar，必须把 Node 运行时的体积估算加进去。

## 4. 报告模板

写入 `docs/features/mygo-rewrite/m0-report.md`：

```text
# M0 验证报告
日期：
mygo 版本或 commit：
Go 版本：
测试平台：

## 总结
（三到五句话：能不能继续，最大的阻碍是什么）

## 逐项结果
### 1. renderer 启动
结论：
证据：
对 DeepChat 的影响：
（2 到 10 项同上）

## 对「待定决策」的建议
- MCP Apps 沙箱与 workspace 预览：
- 长图导出：

## 未能验证的事项与原因

## 给用户的建议
（继续 / 调整 / 终止，并说明理由）
```

## 5. 约束

- 只在 `shell/spike/`（或用户指定的目录）里新增文件，不改 DeepChat 现有代码。
- 不使用 cgo。如果某项验证只能用 cgo 实现，记录为「需要 cgo」，不要默默引入。
- 不要把任何真实用户数据、密钥、口令写进日志或报告。
- 做不到的就写做不到，不要为了让结论好看而绕过验证。
