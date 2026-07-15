# Provider 和 model 实施边界

本文只说明普通模型 Provider、model 列表、请求运行和兼容的 ACP Provider。Direct ACP Agent 的
进程和 Session 生命周期见 [Agent 运行实施边界](./agent.md)。

## 负责什么

Provider 模块负责：

- 保存和读取 Provider 配置、启用状态和凭据引用；
- 根据明确的 `providerId` 和 `apiType` 创建已知 Provider 实例；
- 管理普通模型请求、图片、视频、音频、embedding 和取消；
- 管理每个 Provider 的限流队列；
- 合并内置 model、Provider DB model 和用户自定义 model；
- 检查连接、刷新 model 列表，并把变化通知给 renderer；
- 保留 `kind=deepchat + providerId=acp` 使用的 `AcpProvider` 兼容入口。

Provider 模块不负责 Agent backend 选择、Session、Tool、MCP server、Memory、Knowledge 或 Desktop。
它也不创建 direct ACP runtime。

## 状态和资源

| 内容 | 保存方式 | 存在时间 | 负责模块 |
| --- | --- | --- | --- |
| Provider 配置、顺序和启用状态 | 长期保存 | 到用户删除或重置 | Provider；Config 最终只提供底层 settings 和 secret 能力 |
| model 元数据和启用状态 | 长期保存或由 Provider DB 刷新 | 与 Provider 相同 | Provider |
| Provider 实例 | 内存 | 首次使用到禁用、重建或 App shutdown | Provider runtime |
| active stream 和 abort controller | 内存 | 一次请求 | Provider runtime |
| 限流队列 | 内存 | 请求排队和执行期间 | Provider runtime |
| OAuth token、API key | 加密或受保护的长期存储 | 到退出登录或删除 Provider | Platform secret 能力；Provider 解释和使用 |
| direct ACP process、远端 Session 和 permission | 外部资源和运行状态 | ACP instance 生命周期 | Agent ACP |

Provider DB 是 model 展示信息和能力数据来源之一，不是动态执行框架。新增 Provider 仍使用明确代码、
已知 transport 和正常 review，不增加运行时 manifest 或自动安装 SDK。

## Provider 实例生命周期

1. App 创建 Provider runtime，并传入当前 Provider 配置和由 Agent ACP 创建的 `AcpRuntimeOwner`。
2. Provider runtime 只建立配置索引和限流状态，不在启动时创建所有 Provider 实例。
3. 第一次请求、检查或手动刷新时，按 `providerId` 创建一个实例并复用。
4. 不影响连接方式的配置变化直接更新实例；影响连接方式的变化先停止该 Provider 的 stream，再删除旧
   实例并按新配置重新创建。
5. 禁用或删除 Provider 时，停止它的 stream、清理实例和限流状态。
6. App shutdown 时，Provider runtime 先拒绝新请求、停止所有 stream、清理普通 Provider 实例；
   Agent ACP 随后按 App 的固定顺序关闭共享 `AcpRuntimeOwner`。

同一个 `providerId` 只有一个运行实例。不能因为实例不存在、Provider 被禁用或依赖缺失而改走其他
Provider。

## model 规则

- `PublicProviderConf` / Provider DB 继续提供名称、图标、价格、能力和推荐 model 信息；
- 用户自定义 model 与数据库 model 分开保存，查询时按现有规则合并；
- model 启用状态属于 Provider，不属于 Session；
- Session 只保存最终选中的 `providerId`、`modelId` 和本 Session generation settings；
- Provider DB 更新后，只刷新已经启用且确实使用该数据源的 Provider；
- `openai-codex` 等自己维护 model 列表的 Provider 不参加通用后台刷新；
- 未知 `apiType` 直接报错，不能猜 transport 或载入任意 npm package。

## ACP 两条路径

- direct ACP：`AgentManager -> AcpAgentRuntime -> AcpAgentInstance`，完全由 Agent ACP 负责；
- compatibility：`DeepChat loop -> providerId=acp -> AcpProvider`，只保留现有兼容行为。

两条路径可以共用一个 `AcpRuntimeOwner`，但共享 owner 由 Agent ACP 创建和关闭。Provider 只能接收它，
不能通过 `LLMProviderPresenter` 创建、转交或关闭 direct ACP runtime。ACP registry 查询也是 Agent ACP
创建时收到的必需接口，缺失时直接失败。

## 对外接口

调用方按用途接收窄接口，不再把整个 Provider runtime 传给所有模块：

- execution：普通 completion、stream、图片、视频、音频和取消；
- embedding：embedding 和 dimensions；
- rate limit：在指定 `providerId` 下排队执行；
- catalog：Provider、model、自定义 model 和能力查询；
- administration：连接检查、启停、刷新、配置变化和 OAuth 操作；
- ACP compatibility：旧 `AcpProvider` 的 Session、permission 和 debug 操作。

这些接口属于同一个 Provider 模块，但调用方只依赖自己实际使用的部分。不新增一个同时汇总 Tool、
MCP、Skill、Memory 和 Provider 的总管理器。

## 目录和依赖

目标实现放在 `src/main/provider/`。Provider 可以依赖 Config 的底层 settings/secret、Platform 网络和
代理能力、Agent ACP 提供的共享 owner，以及自己的数据表；不能依赖 Session、Desktop、Remote、
Scheduler 或 App composition。

`src/main/presenter/llmProviderPresenter/` 在调用方和测试全部迁移后直接删除，不保留转发文件。Provider
DB 的全局 `EventBus` 已删除。Provider DB Loader 只发布本模块内的有类型通知；能力索引直接订阅，
App 把更新通知明确连接到 Provider 的后台 model 刷新，不另建通用 EventBus。

## 完成条件

- direct ACP owner 的创建和 shutdown 已离开 Provider；
- Provider 创建时需要的依赖全部明确提供，没有 optional registry 或 runtime fallback；
- Provider 的配置、model、执行、限流和 ACP compatibility 调用方使用窄接口；
- Provider shutdown 能停止所有普通请求和实例；
- 旧 `llmProviderPresenter` 目录和名称已删除；
- Provider 不反向导入 Session、Desktop、Remote、Scheduler、routes 或 App；
- 现有 Provider、model、OAuth、stream、abort、proxy 和 ACP compatibility 行为不变。
