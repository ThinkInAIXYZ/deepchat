# Desktop 实施边界

> 状态：已确定并已迁移实体目录

## Desktop 负责什么

Desktop 负责所有 Electron 界面资源和界面临时状态：

- `BrowserWindow`、`WebContents`、tab 和 settings window；
- floating chat、Floating Button、Tray、Shortcut 和 context menu；
- YoBrowser 的 `WebContentsView`、overlay、CDP 连接和下载；
- renderer 与 Session 的临时 binding；
- 向 renderer 发送有类型的界面状态。

这些实现统一放在 `src/main/desktop/`。旧 `presenter/windowPresenter`、
`presenter/tabPresenter`、`presenter/floatingButtonPresenter`、`presenter/browser`、
`presenter/shortcutPresenter` 和 `presenter/trayPresenter` 已经删除，没有保留转发文件。

## Desktop 不负责什么

- 不创建、删除或归档 Session；
- 不选择 Agent backend，不保存 Agent instance；
- 不实现 Remote channel、Cron job 或 Provider process；
- 不把 App composition 当成模块查找入口；
- window 或 tab 关闭时不默认取消正在执行的 Turn。

## renderer binding

`DesktopSessionBinding` 保存 `WebContents` 到 Session id 的内存映射。它与对应
`WebContents` 同寿命，不写入 Session 数据库。

固定规则：

1. renderer 激活 Session 时建立 binding，并通过 Session 查询取得当前投影；
2. tab、window 或 renderer 销毁时只解除 binding；
3. 找不到已绑定的 Session 时删除失效 binding；
4. 最后一个界面关闭后，Session、等待中的 Interaction 和后台 Turn 仍按 Session 生命周期存在；
5. 重新打开界面后可以再次绑定同一个 Session。

## window、tab 和附属界面

- `WindowPresenter` 拥有主窗口、settings window 和 floating chat window；
- `PluginSettingsWindow` 拥有 Plugin package 提供的独立 settings window，Plugin 只请求打开或关闭；
- `TabPresenter` 拥有 `WebContentsView`、tab 到 window 的映射和 tab 关闭清理；
- close-to-tray 只隐藏主窗口，真正退出由 App 决定；
- Shortcut 和 Tray 直接调用 Window，不通过 `EventBus` 发业务命令；
- Floating Button 只读取 Session 投影和 Desktop binding，用 Window、Tab 打开或聚焦界面；
- YoBrowser 的页面、overlay 和下载跟随对应 browser Session，由 Desktop 创建和销毁。

## 启动和停止

App 按以下顺序连接 Desktop：

1. 创建 Window；
2. 创建 Shortcut、Tray 和 YoBrowser；
3. 创建 `DesktopSessionBinding`；
4. 创建 Tab，并把 Tab 明确绑定给 Window；
5. 创建 Floating Button；
6. 注册 route 后创建首个可用窗口。

退出时顺序相反。每个 `destroy()` 或 `shutdown()` 只清理自己拥有的 Electron 资源，并允许重复调用。

## 依赖方向

Desktop 可以调用 Session 的公开查询和操作，也可以使用 Config 读取界面设置。Session 和 Agent
运行模块不能导入 `src/main/desktop/`。Tool 调用 YoBrowser 时只使用 Browser 对外操作，不读取
window、tab 或 renderer binding。
