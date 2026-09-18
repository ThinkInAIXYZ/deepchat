# DeepChat 百智云 Agent Toolkit 用户插件

[English](./README.md)

这是百智云提供的可选 MCP 用户插件，直接连接
[Agent Toolkit](https://baizhi.cloud/landing/agent-toolkit) 托管工具服务，提供搜索、网页与文档处理等能力。
它不是模型供应商、DeepChat 默认内置插件或 MCPRouter 商店条目。

包内只有插件声明、远程 MCP 配置、说明和许可证；没有本地命令、hooks、Skills、安装脚本或工具自动批准规则。
安装后默认禁用，不会改写模型配置。

## 使用前确认

- DeepChat 需要具备“插件 → 从 ZIP 安装”和用户插件 MCP 凭据配置功能。
  `v1.1.2-beta.5` 已包含该流程，`v1.1.1` 尚不支持。打包所用源码版本还必须包含本示例目录。
- 在[百智云控制台](https://agent-toolkit.app.baizhi.cloud/)创建自己的账号和 API Key，确认服务条款、
  权限、余额与用量限制；调用可能消耗额度。
- 连接地址固定为 `https://agent-toolkit.app.baizhi.cloud/mcp`，采用 Streamable HTTP 与 Bearer 鉴权。
  此流程不使用 MCPRouter 账号、中间代理 Key 或 OAuth 登录。
- 调用工具时，查询词、URL、文档或提取要求等对应输入会发送到百智云托管服务。
  未经许可不要发送敏感内容，使用前查看服务当前隐私说明；本示例不承诺数据保留期限、存储地区或“完全不记录”。

## 安装、启用与填写 Key

1. 获取包含本示例的源码，制作**仅包含此插件目录**的 ZIP，必须保留隐藏文件。
   例如在具备 `zip` 的系统上，从仓库根目录执行：

   ```sh
   cd examples/user-plugins/baizhi-agent-toolkit
   archive_dir="$(mktemp -d)"
   zip -r "$archive_dir/baizhi-agent-toolkit.zip" .codex-plugin .mcp.json README.md README.zh-CN.md LICENSE
   ```

   审阅尚未合并的 PR 时，应使用贡献者的精确提交；待审 PR 不属于上游 `dev`。
   打包前检查来源，不要包含 `.env`、凭据、`.git`、`node_modules` 或整个项目源码。
2. 打开“插件 → 从 ZIP 安装”，选择该压缩包，审阅唯一的 `agent-toolkit` MCP 服务、上述 HTTPS 地址和必需变量 `BAIZHI_API_KEY`。
   选择 MCP 后确认安装；此包不含可选的 Skills 或 hooks。此时插件仍为禁用状态。
3. 打开已安装的 `baizhi-agent-toolkit` 详情，显式启用；随后 MCP 设置区域的 `BAIZHI_API_KEY` 密码输入框可以编辑。
4. 在密码输入框中填写原始 Key，不加 `Bearer`、引号或完整请求头，点击“保存并重新连接”。
   不要把 Key 写入 Git 地址、JSON 文件、聊天、Issue 或截图。变量名只是绑定标识；设置系统环境变量不能代替此步骤。
5. 在插件详情页下方的 MCP 状态卡查看运行状态或错误，必要时点击重新加载。
   在使用 DeepChat 内置 Agent 的会话中，打开“高级配置 → 插件”查看发现的工具数量。
   安装成功或保存 Key 不等于鉴权成功；普通 MCP 设置列表不显示插件拥有的服务器，不应以该列表判断此插件状态。

DeepChat 现有凭据表单通过 SecretStore 单独保存输入；MCP 配置只保留
`Authorization: Bearer ${BAIZHI_API_KEY}` 模板，不回显已保存的值。
平台加密是否可用由 DeepChat 处理；若凭据保存失败，应解决提示的存储问题，不要改成把 Key 写进插件文件。

不要为此示例直接使用“从 Git 安装”导入整个 DeepChat 仓库：当前安装器先检查完整仓库归档，再选择插件子目录，
该源码归档超过插件文件数上限。只打包本插件目录即可避免此限制，无需放宽安装安全检查。

## 验证与工具权限

连接成功后，在内置 Agent 会话的“高级配置 → 插件”组确认插件及工具数量，再按客户端提示确认调用权限。
该分组显示工具数量，不是逐项工具选择清单；此示例不配置外部 ACP Agent。
可先用一个非敏感的小任务尝试 `websearch_search`、`web_scrape` 或 `web_extract`，以账号实际可用工具为准，
并核对结果与控制台用量。发现工具不代表每个工具都已授权或账号额度充足。

这三个名称只是建议的起步场景，**不是已配置的工具白名单**。插件导入服务发现的工具，实际范围取决于服务和 Key；
不会自动批准调用，也不会覆盖 DeepChat 自身的工具选择与权限控制。

## 更换、停用、卸载与更新

- **更换 Key：**在百智云创建替代 Key，在同一插件 MCP 表单填写并保存，确认连接正常后撤销旧 Key。表单不显示旧值。
- **停用：**禁用插件以停止其集成；不会撤销云端 Key。
- **卸载：**删除插件及其拥有的本地配置和绑定。不再使用时还需在百智云撤销 Key；卸载不会删除历史会话，
  也不会撤销其他应用持有的凭据。
- **更新：**使用“检查并审阅更新”，检查地址、鉴权声明等变化后明确确认。地址变化可能要求重新配置凭据；
  修改源码目录不会静默改变已经安装的快照。

## 常见问题

- **没有安装或凭据界面：**检查 DeepChat 版本，并确认按用户插件安装，而不是粘贴到普通 MCP 配置编辑器或 MCPRouter 商店。
- **缺少变量：**启用插件，在其 MCP 表单填入非空 Key 并保存。
- **401 / 未授权：**确认 Key 有效，且没有额外填写 `Bearer` 前缀。
- **已连接但调用失败：**检查权限、额度、余额和工具必填参数；避免重复重试可能计费的操作。
- **连接失败：**检查到固定 HTTPS 地址的网络连通性和连接诊断。对外提供日志前，移除凭据与敏感工具输入。

服务与账号问题可通过[百智云集成仓库](https://github.com/chaitin/baizhi-agent-toolkit)反馈；
DeepChat 安装机制参见[用户插件说明](https://github.com/ThinkInAIXYZ/deepchat/blob/dev/docs/features/user-plugins/authoring.md)。
反馈时提供版本与脱敏诊断，不要提供真实 Key。

示例文件按 DeepChat 的 [Apache-2.0 许可证](./LICENSE)提供；托管服务由百智云独立运营，适用其服务条款，
本包不包含托管后端源码。此示例不表示已经获得 DeepChat 认证或推荐。
