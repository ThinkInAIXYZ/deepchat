# Plugin 模块边界

> 状态：已确认，可以实施
> 范围：官方 Plugin package、安装记录、能力登记、runtime 检查和设置页面资源

## 先说结论

Plugin 是进程级能力登记模块。它负责识别可信的官方 package、保存启用状态，并在启用或停用时
把 package 声明的 MCP、Skill、Tool policy 和 settings contribution 完整登记或撤销。

Plugin 不执行 Agent 任务，也不成为 MCP、Skill 和 Tool 的上层总管理器。它只根据 manifest 直接
调用这些模块的登记操作。登记完成后，实际运行状态仍由对应模块负责。

Plugin package 中的 settings 页面仍可以打开独立窗口，但 `BrowserWindow` 和窗口表属于 Desktop。
Plugin 只把已经校验的页面入口交给 Desktop，并请求打开或关闭，不自己创建 Electron 窗口。

## 负责的状态和资源

| 内容 | 类型 | 负责方 | 结束时间 |
| --- | --- | --- | --- |
| 已安装 package 文件 | 长期文件 | Plugin | Plugin 安装记录被移除 |
| 安装、启用、资源和 runtime 记录 | 长期设置 | Plugin | 用户操作或修复无效记录 |
| 当前可用的官方 package 表 | 进程内缓存 | Plugin | 重新扫描或 App 退出 |
| Plugin 提供的 MCP 配置 | MCP 长期配置 | MCP/Config | Plugin 撤销登记 |
| Plugin 提供的 Skill | Skill 进程内登记 | Skill | Plugin 撤销登记或 App 退出 |
| Plugin Tool policy | Tool 进程内登记 | Tool | Plugin 撤销登记或 App 退出 |
| settings contribution 描述 | Plugin 长期资源记录 | Plugin | Plugin 撤销登记 |
| Plugin settings `BrowserWindow` | Desktop 外部资源 | Desktop | 页面关闭、Plugin 停用或 App 退出 |
| Plugin MCP 进程 | MCP 外部资源 | MCP | Plugin 停用或 App 退出 |

Plugin 的 `resources` 记录只描述登记结果，不是其他模块运行状态的第二份可信来源。

## 生命周期

### 创建

App 创建一个 `PluginService`，并明确传入：

- Plugin 所需的设置读写能力；
- MCP server 登记、状态查询、启动和停止操作；
- Skill contribution 登记和撤销操作；
- Desktop 的 Plugin settings window 操作；
- 当前 platform、arch、app path 和 resources path。

Tool policy 留在 Plugin 目录内的进程级登记表，由 Tool 读取。它不能反向取得 Plugin 实例。

### 启动

固定顺序如下：

1. Plugin 扫描并校验官方 package；
2. 修复没有对应安装记录的残留资源；
3. 逐个启用保存为 enabled 的 Plugin；
4. 每个 Plugin 先撤销同 owner 的旧登记，再按 manifest 登记 runtime、settings、MCP、Skill 和
   Tool policy；
5. Plugin 登记完成后，App 再启动普通 MCP server。

单个 Plugin 启用失败时记录失败并继续启动其他 Plugin，保持当前产品行为。这里没有旧路径或第二套
实现；失败的 Plugin 不应留下完成一半的登记。

### 运行

- `listPlugins()` 和 `getPlugin()` 可以重新扫描官方 package，并用安装记录和实际 MCP 状态生成结果；
- `enablePlugin()` 只有在 package、信任、平台和 runtime 检查通过后才保存 enabled 状态；
- `disablePlugin()` 先停止并删除 owner 对应的 MCP 登记，再撤销 Skill、Tool policy、settings 和
  资源记录，最后保存 disabled 状态；
- runtime 状态检查只更新 Plugin 自己的 runtime 记录，不接管 runtime 进程；
- settings 页面由 Desktop 创建和关闭，Plugin 只传入校验后的入口。

### 停止

App 在停止 MCP 前调用 `PluginService.shutdown()`：

1. 找出全部 Plugin-owned MCP server；
2. 通过 MCP 的 shutdown 操作停止这些 server；
3. 撤销所有 Plugin Tool policy；
4. 请求 Desktop 关闭全部 Plugin settings window；
5. 再由 App 停止 MCP 和其余模块。

App 退出不删除安装文件、启用记录或 manifest。停止过程可以重复调用。

## 允许的依赖

```text
App ───────────────> Plugin
Routes ────────────> Plugin query and action
Plugin ────────────> MCP registration and lifecycle
Plugin ────────────> Skill contribution
Plugin ────────────> Tool policy registration
Plugin ────────────> Desktop plugin-settings window
Tool ──────────────> Plugin tool-policy query
```

禁止的方向：

- Plugin 不导入 App、Routes、Agent、Session 或全局模块入口；
- MCP、Skill 和 Tool 不导入 `PluginService`；
- Plugin 不直接创建 `BrowserWindow`；
- Plugin 不保存 MCP、Skill 或 Tool 的第二份运行状态；
- 不增加统一的 contribution framework 或通用 plugin runtime。

## 对外操作

Routes 只需要：

- `listPlugins()`；
- `getPlugin()`；
- `enablePlugin()`；
- `disablePlugin()`；
- `invokeAction()`。

App 只需要 `initialize()` 和 `shutdown()`。调用方通过窄接口依赖这些操作，不接收 Plugin 内部存储、
package 解析或 contribution 实现。

## 实施批次

1. 删除旧 Plugin Presenter 目录和旧测试入口；
2. 把实现、Tool policy 和测试移到 `src/main/plugin/` 与 `test/main/plugin/`；
3. 把进程内入口改为 `PluginService` 和 `PluginServicePort`，不保留旧导出；
4. 先从 Plugin 删除 `BrowserWindow`、settings window map 和窗口创建代码，再在 Desktop 写唯一的
   `PluginSettingsWindow` 实现并通过窄接口传入；
5. App、Routes、MCP、Tool 和测试全部改用新路径和新名字；
6. 增加架构检查，禁止旧路径、旧类名以及 Plugin 直接创建 `BrowserWindow`；
7. 更新当前架构文档并运行 Plugin、MCP、Skill、Tool、Routes 和 Desktop 相关测试。

每批先删除旧代码和旧引用，再写新实现；不使用转发文件、别名、可选方法检查或新旧双轨。

## 完成条件

- 旧 Plugin Presenter 目录、类名、变量名和测试路径已经删除；
- Plugin 不再 import 或创建 `BrowserWindow`；
- Plugin settings window 由 Desktop 唯一保存和停止，原有页面入口和 preload 不变；
- Plugin 启停仍完整登记和撤销 MCP、Skill、Tool policy 与 settings contribution；
- App 启动时 Plugin 仍在 MCP 前登记，退出时 Plugin-owned MCP 仍在 MCP shutdown 前停止；
- 安装记录、package 文件、route 输入输出和用户操作含义不变；
- 自动检查阻止旧路径和窗口所有权倒退。
