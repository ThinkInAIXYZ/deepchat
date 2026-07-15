# Tool 和 MCP 实施边界

本文说明 DeepChat Tool、内置 Agent Tool、外部 MCP server、权限检查和调用路由。Direct ACP Agent
仍按 ACP 协议向外部 agent 提供 MCP 配置，不经过 DeepChat Tool 执行链。

## 分开负责

| 内容 | 负责模块 |
| --- | --- |
| 一次 DeepChat Run 使用的 Tool 定义快照 | Agent DeepChat |
| MCP Tool 列表、prompt、resource 和远端调用 | MCP |
| 内置 Agent Tool 定义和执行 | Tool |
| 合并 Tool、处理重名和记录 `toolName -> source` | Tool |
| 执行前权限检查 | Tool 和对应 permission service |
| permission、question、Skill draft 等等待用户处理的状态 | 当前 Agent Run |
| MCP client、transport、OAuth 和 server 进程 | MCP |
| Session 允许的 MCP server 和禁用的 Agent Tool | Session 长期数据 |

Tool 不负责 MCP server 生命周期；MCP 不负责 DeepChat Run、Session 或内置 Agent Tool。两者是同级
模块，由 App composition 连接。

## Tool 定义和映射

一次 DeepChat Run 开始前按以下顺序建立 Tool 快照：

1. Session 和 Agent 配置给出启用的 MCP server、禁用的 Agent Tool、当前 Skills 和 workdir；
2. MCP 返回这次上下文允许使用的 MCP Tool；
3. Tool 返回内置 Agent Tool；
4. Tool 按当前规则合并，重名时保留 MCP Tool；
5. Tool 为该 Session 保存本次 `toolName -> mcp | agent` 映射；
6. Agent 只接收最终定义，不猜 Tool 来源。

Tool 定义 cache 的 key 必须包含会改变结果的 Session、Agent、MCP、Skill、workdir 和能力信息。MCP
配置、client 列表或 Tool 注册变化后，明确通知 Tool 清除 cache；不能依赖全局 `EventBus` 或等到调用
失败后再猜来源。

当前实现已经删除 main 内部全部 `MCP_EVENTS`。Config 修改 MCP 或 Knowledge 配置后直接调用 MCP 和
Knowledge；`ServerManager`、`McpClient` 和 MCP Tool list 变化通过构造时传入的回调清除 Tool cache，
并让 Agent 增加 Tool registry revision。发给 renderer 的 `mcp.*` typed event 保持不变。

Session delete 和 Agent 更换时删除对应映射和 plan 状态。App shutdown 时清空全部内存映射。

## Tool 调用

1. Agent 根据本 Run 的定义产生 Tool call；
2. Tool 使用该 Session 的映射找到唯一来源；
3. 执行前总是调用 `preCheckToolPermission()`；无需权限时明确返回 `null`；
4. MCP Tool 调给 MCP，Agent Tool 调给对应本地 handler；
5. Tool 把原始结果和来源信息返回 Agent；
6. Agent 负责输出大小处理、消息 block、Tape、trace 和 Run 后续状态。

找不到映射、依赖缺失或目标 server 已停止时直接返回明确错误，不能临时改走另一类 Tool。Tool 执行
有副作用时不能为了截断输出而重跑。

## 权限

- 文件路径权限由 file permission service 负责；
- shell 和 command 权限由 command permission service 负责；
- settings 修改权限由 settings permission service 负责；
- MCP server 的 read/write/all 授权由 MCP 负责；
- Agent Run 只负责把需要用户决定的请求排队、展示、恢复或取消。

所有 Tool runtime 必须提供权限预检查、上下文同步、Session mapping 清理和 plan 清理。某种 Tool
不需要预检查时返回 `null`，不能通过“方法不存在”表达。

## MCP 生命周期

### 启动

1. App 创建 MCP，并明确传入 Config、Knowledge、LLM sampling、model catalog、图片缓存和内置 server
   factory；
2. Plugin 先登记它拥有的 MCP server 和资源；
3. MCP 读取启用配置，创建需要的 client，并等待启动结果；
4. MCP ready 后，App 直接处理待安装 deeplink，并通知 Tool 和 Agent 刷新 Tool cache；
5. registry 检测等慢任务放到 App 的后台启动任务，不阻塞主窗口 ready。

### 运行

- `ServerManager` 负责 server config 对应的 client、transport、错误和 registry；
- `McpClient` 负责一个 server 的连接、状态、OAuth 和请求；
- MCP Tool manager 负责 Tool 定义 cache 和远端调用；
- MCP sampling 请求通过明确接口调用 Provider，再把决定交还原请求；
- server started/stopped/status 和 client list 变化是通知，不是业务命令。

### 停止

App 先停止 Plugin 登记变化，再让 MCP 停止接收新操作、取消 sampling、关闭所有 client 和 transport。
MCP shutdown 可以重复调用。MCP 不关闭 Session、Agent、Provider、SQLite 或 App。

## Direct ACP

Direct ACP Agent 在创建远端 Session 时，把允许的 MCP server 转成 ACP 初始化配置。它只使用 MCP 的
server 配置和 transport 过滤接口，不使用 `ToolService` 的定义映射和调用路由。DeepChat 选择
`providerId=acp` 的兼容路径仍按原有 DeepChat Tool 快照执行。

## 对外接口

Tool 提供：

- catalog：按完整上下文返回定义；
- execution：预检查和执行；
- prompt：根据本次定义生成 Tool 说明；
- cleanup：清理 Session mapping 和 plan 状态。

MCP 提供：

- lifecycle：initialize、shutdown、start/stop server；
- catalog：server、client、Tool、prompt、resource；
- execution：call Tool、读 resource、取 prompt；
- permission 和 OAuth；
- Plugin 资源登记；
- ACP 使用的 server 配置和 registry 查询。

调用方只接收需要的部分，不再传整个 MCP 或 Tool 总对象。

## 目录和依赖

Tool 已移到 `src/main/tool/`，旧 Presenter 目录和名称已经删除。MCP 的目标目录是
`src/main/mcp/`；迁移时同时移动对应代码和测试，旧 `presenter/mcpPresenter` 路径直接删除，不保留
转发文件。

Tool 可以依赖 MCP 的窄 catalog/execution 接口、permission、Workspace/File 和 Session 操作；MCP
可以依赖 Config 的底层设置、Knowledge、Provider sampling 和 Platform 网络能力。两者不能依赖
Desktop、Remote、Scheduler、App composition 或具体 Agent instance。

## 完成条件

- Tool 和 MCP 的状态、资源和 shutdown 各有唯一负责模块；
- DeepChat Tool port 的必需方法没有 optional probe 或 fallback；
- Tool 来源只来自本 Run 的映射；
- MCP client 和配置变化通过明确通知清理 cache；
- 全局 `EventBus` 中的 MCP 调用已删除；
- 旧 Presenter 目录和名称已删除；
- direct ACP 和 DeepChat Tool 两条路径仍保持分开；
- Tool 顺序、重名规则、权限、OAuth、sampling、abort 和结果含义保持不变。
