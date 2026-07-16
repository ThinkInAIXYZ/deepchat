# Config、主数据库和 route 实施边界

> 状态：已实施，等待最终验收
> 规则：每批先删除旧方法、旧引用和旧 route 分支，再写唯一的新路径。

实施前，这三个部分是 main 进程里最大的公共入口：

- `ConfigPresenter` 同时保存设置、解释业务配置、管理 ACP、Provider、MCP、Prompt、Knowledge 和
  Desktop 设置，还负责配置变化后的业务操作；
- `SQLitePresenter` 同时打开数据库、执行 migration、公开所有 table，并直接提供旧会话和 ACP 的
  业务方法；
- `MainKernelRouteRuntime` 把几乎所有模块重新装进一个对象，`routes/index.ts` 再用一个巨大
  `switch` 执行业务操作。

不能把它们分别改名为 `ConfigService`、`DatabaseService` 和 `RouteService` 就算完成。那只会保留
三个新的总入口。

## 最终关系

~~~text
App composition
  -> SettingsStore / SecretStore
  -> MainDatabase
  -> 创建各业务模块，并把所需存储能力传给它们
  -> 收集各模块的 route map
  -> RouteRegistry 注册唯一 IPC 入口

业务模块
  -> 解释自己的配置
  -> 使用自己的 repository
  -> 执行自己的操作
  -> 提供自己的 route handler
~~~

依赖方向固定为：

~~~text
renderer/preload
  -> shared route contract
  -> RouteRegistry
  -> module route handler
  -> module operation
  -> module settings/repository
  -> SettingsStore / SecretStore / MainDatabase
~~~

`Config`、`MainDatabase` 和 `RouteRegistry` 都不能反向调用业务模块。

## Config 最终只保留什么

最终的 `src/main/config/` 只保留三类底层能力：

1. `SettingsStore`：读取、写入和删除已经定义的长期设置；
2. `SecretStore`：使用 `safeStorage` 保存和读取 secret；
3. config migration：把旧 JSON、旧 key 和旧存储迁到当前格式。

它们不解释 `providerId`、model 能力、ACP agent、MCP server、Skill、Knowledge 或 Session。
它们也不在写入设置后调用 Desktop、Provider、MCP 或 Agent。

不增加一个包含全部 key 的新 `ConfigServicePort`。模块只在自己的目录内定义自己需要的设置读写。

## 具体配置归谁

| 现有内容 | 最终负责模块 |
| --- | --- |
| Provider、model、自定义 model、model status、model capability | Provider |
| Agent、ACP registry、ACP 安装状态、Agent 的 MCP 选择 | Agent |
| MCP server、启用状态、npm registry | MCP |
| Skill 开关、目录、草稿建议 | Skill |
| Knowledge 配置 | Knowledge |
| Hook 通知命令 | Hook |
| language、theme、font、floating、shortcut、content protection | Desktop |
| proxy、logging、update channel、launch at login、close to quit | App / Platform |
| sync 路径、cloud sync 配置和 secret、last sync time | Sync |
| custom prompt、system prompt、默认 prompt | Agent 的 Prompt 配置 |
| Session 默认选项和每个 Session 的最终选项 | Agent 默认配置 / Session |

配置写入后的操作由负责模块直接完成。例如 Provider 设置更新后由 Provider 自己更新运行实例；MCP
设置更新后由 MCP 自己重连并通知 Tool。不能再经过 Config 的 `runtimeEffects`、late setter 或通用
event。

## Config 生命周期

1. App 在 `app.whenReady()` 后创建 `SettingsStore` 和 `SecretStore`；
2. App 打开主数据库；
3. config migration 把旧存储迁到当前存储；
4. App 创建各模块，各模块读取自己的配置；
5. route 写配置时直接调用负责模块；
6. database maintenance 重开数据库后，底层 store 重新连接，各模块继续通过同一个稳定存储入口读取；
7. App shutdown 时先停止业务模块，再关闭配置存储和数据库。

没有 `startRuntime()`。模块创建完成前不会收到 route，创建完成后也不需要 ready flag 跳过通知。

## 主数据库最终只保留什么

最终的 `src/main/data/` 只负责：

- 打开、关闭和重新打开主 SQLite；
- SQLCipher password 和 connection 参数；
- transaction；
- schema version、migration、schema diagnose 和 repair；
- database maintenance 需要的 checkpoint、backup 和文件替换基础操作。

入口命名为 `MainDatabase`。它不提供 conversation、message、ACP、Agent、Memory、Scheduler 或
Settings 的业务方法，也不公开一个包含所有 table 的对象。

## 数据访问归谁

| 数据 | repository 所在模块 |
| --- | --- |
| Session、message、pending input、Tape、trace、search projection | Session |
| Agent、ACP session、ACP turn | Agent |
| Memory、Memory audit、Memory projection | Memory |
| Cron job、run、delivery | Scheduler |
| project、environment | Project；后续移出旧 Presenter 目录 |
| settings、settings activity | Config / Settings |
| legacy import status | App startup migration |

table 的 SQL migration 可以继续集中在 `src/main/data/migrations/`，因为 migration 只描述 schema，
不执行业务。日常增删改查放在负责模块的 repository 中。

长期模块不能缓存某次打开得到的 `Database` 或 table 实例。repository 每次操作都从稳定的
`MainDatabase` 取得当前连接，因此 maintenance 完成后不会访问已经关闭的 handle。

不增加通用 `RepositoryManager`、`TableRegistry` 或 `DataService`。

## route 最终只做什么

保留现有 shared route contract、route name、输入输出结构和 preload 安全边界。main 中的 route
只做四件事：

1. 根据 contract 校验输入；
2. 建立 `windowId`、`webContentsId` 等调用上下文；
3. 调用一个明确的模块操作；
4. 根据 contract 校验输出。

database maintenance gate、调用来源检查和后台任务进度属于通信边界，可以由 `RouteRegistry` 的
统一 wrapper 处理。业务判断、状态修改、跨模块步骤和 activity 内容不放在 registry 中。

每个模块提供自己的 route map，例如：

~~~ts
export function createProviderRoutes(deps: ProviderRouteDeps): DeepchatRouteMap
~~~

App 明确创建这些 map，并交给 `RouteRegistry`。注册时发现重复 route name 立即失败。请求到达后按
route name 直接查找 handler，不依次询问多个 handler，也不使用返回 `undefined` 表示“不是我的
route”。

最终删除：

- `MainKernelRouteRuntime`；
- `createMainKernelRouteRuntime()`；
- `dispatchDeepchatRoute()` 的总 `switch`；
- route 对完整 Config、SQLite 或 App 组合对象的依赖。

## route 文件放置规则

- `src/main/provider/routes.ts` 只处理 Provider 和 model route；
- `src/main/session/routes.ts` 只处理 Session 和 chat route；
- `src/main/desktop/routes.ts` 处理 window、tab、shortcut 和 browser route；
- `src/main/mcp/routes.ts`、`skill/routes.ts`、`memory/routes.ts` 等放在各自模块；
- 只属于 App 生命周期的 database maintenance、startup 和 reset route 留在 `src/main/app/routes.ts`；
- `src/main/routes/` 最后只保留 `RouteRegistry`、调用上下文和共享 wrapper。

route handler 可以组合多个同模块内部对象，但不能重新取得所有模块。确实需要跨模块的操作由 App
提前组合成一个明确的操作函数，再把这个函数传给对应 route。

## 分批实施顺序

每批只处理一个明确边界。旧入口和新入口不能同时服务同一组调用方。

### 第一组：route 外壳

1. 删除 `MainKernelRouteRuntime` 的可选字段和测试 adapter；
2. 建立只负责查找、校验和调用的 `RouteRegistry`；
3. 按模块逐批删除总 `switch` 中的 route 分支，再在对应模块写 route map；
4. 每迁出一组 route，就增加检查，禁止它重新出现在 `routes/index.ts`。

未迁移的其他 route 可以暂时留在旧 `switch`，但已经迁移的 route 只有新 handler 一条路径。这是
按业务域分批，不是同一 route 的新旧双轨。

### 第二组：Config

1. 删除 `ConfigPresenter` 内部对 `ElectronStore` 和 `safeStorage` 的直接管理，建立唯一的
   `SettingsStore` 和 `SecretStore`；
2. 按 Provider、Agent、MCP、Skill、Knowledge、Hook、Desktop、Sync 的顺序，每批先删除
   `ConfigPresenter` 中对应字段、方法、runtime effect 和 shared interface，再把实现放到负责模块；
3. 每批同时迁移 route 和调用方；
4. 最后删除 `ConfigPresenter`、`IConfigPresenter`、late setter 和旧测试目录。

### 第三组：主数据库

1. 把 connection、transaction、migration、diagnose 和 repair 移到 `MainDatabase`；
2. 按 Session、Agent、Memory、Scheduler、Project、Settings 的顺序，每批先删除
   `SQLitePresenter` 暴露的 table 和业务方法，再把 repository 放到负责模块；
3. 每批同时移动 table 测试和增加反向依赖检查；
4. 最后删除 `SQLitePresenter`、`ISQLitePresenter` 和旧目录。

Config 和主数据库可以交错实施，但一个 commit 只迁移一个负责模块。不能一次搬完目录后再慢慢修
调用方。

## 每批完成条件

- 旧方法、旧类型、旧 import 和旧 route 分支已经删除；
- 没有 forwarding file、re-export alias、optional method、runtime fallback、双读或双写；
- route name、输入输出、数据 key、table 和 column 含义没有改变；
- 调用顺序和 `await` 关系没有新增含义；
- 负责模块的局部测试、架构检查、typecheck、lint 和 i18n 通过；
- 该批是一个可单独回退的 commit。
