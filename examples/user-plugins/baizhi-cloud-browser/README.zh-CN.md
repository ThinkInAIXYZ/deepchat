# 在 DeepChat 中连接百智云云浏览器

[English](./README.md)

百智云云浏览器（Baizhi Cloud Browser，也称 CapyBrowser）提供云端浏览器运行、
保存档案、人工处理和文件取回。此可选插件只连接管理 MCP；网页导航、点击和读取
还需要 Agent 可用的 CDP 客户端，不会替换 DeepChat 自带的网页工具。

它与百智 Toolkit 是两个服务，需要自己的云浏览器账号和 Key。浏览器启动与运行
按产品说明计费，使用前阅读[接入与价格指南](https://capybrowser.app.baizhi.cloud/docs/installation.md)。
示例没有本地命令、hooks、Skills、自动批准或默认配置改动，属于社区接入示例，
不表示 DeepChat 认证或背书。

## 安装与连接

1. 使用提供「插件 → 从 ZIP 安装」及插件凭据设置的 DeepChat 版本。
   在含此示例的源码版本中，只打包该小目录，包括隐藏文件：

   ```sh
   cd examples/user-plugins/baizhi-cloud-browser
   archive_dir="$(mktemp -d)"
   zip -r "$archive_dir/baizhi-cloud-browser.zip" .codex-plugin .mcp.json README.md README.zh-CN.md LICENSE
   ```

   不要通过 Git 安装整个
   DeepChat 仓库，其归档可能超过文件数限制。不要包含 Key、`.env`、`.git` 或依赖目录。
2. 选择 ZIP，审阅唯一的 `baizhi-cloud-browser` MCP 及地址
   `https://capybrowser.app.baizhi.cloud/mcp`，勾选 MCP 并安装。
   初始状态是**禁用**，需到插件详情页明确启用。
3. 在插件的 `CAPYBROWSER_API_KEY` **密码框**填写自己的原始 Key，不带 `Bearer`，
   再「保存并重新连接」。前缀由宿主补充。变量名是凭据绑定标识，不能靠设置进程
   环境变量配置此插件。不要把真实 Key 写进 JSON、对话、Issue 或截图。
4. 在插件详情检查 MCP 连接状态及工具数量。保存 Key 不代表认证成功。
   普通 MCP 设置列表不显示插件拥有的服务；内置 Agent 的「高级设置 → 插件」
   可查看工具数量。此示例不为外部 ACP Agent 配置工具。

凭据经 DeepChat 的 SecretStore 单独保存，配置保留占位符，密码框不回显已存值。
若报告凭据保存失败，先解决宿主存储问题，不要改成明文写入配置。

## 使用与清理

创建付费运行前先阅读接入指南，验证身份、查看价格并确认页面操作能力。
工具参数发送至百智云，网页操作也会访问目标站点；使用前审阅服务条款及隐私说明，
发送敏感数据前取得许可。此示例不承诺数据保留期限或地域。

人工处理期间暂停 Agent 操作，保留同一运行，交还控制后再继续。
插件不会自动暂停第三方 Agent。结束自己创建的运行，分别核对资源释放和最终费用；
观看、等待或断线不会停止运行计费。

- **更换 Key：**在同一密码框输入新原始 Key，保存并确认连接后，到服务端撤销旧 Key。
- **更新：**使用「检查更新」审阅新快照。即使只改说明，新的文件快照也可能要求
  重新填写 Key。修改本地源码不会自动改动已安装插件。
- **禁用或卸载：**在插件详情操作。卸载移除该插件的本地配置与凭据绑定，
  不会结束云端运行、撤销云端 Key 或删除历史对话。自己创建的资源需单独结束，
  不再使用的 Key 需到服务端撤销；其他 MCP 连接独立管理。

缺少变量时，启用插件后在自己的凭据表单填写；401 时检查 Key 是否有效且未重复填写
Bearer 前缀。反馈连接或存储问题时附版本及脱敏诊断，不分享 Key 或私有输入，
不要反复重试可能计费的工具。

[产品](https://baizhibrowser.cloud/zh/) ·
[接入材料](https://github.com/ctcbyzx/baizhi-cloud-browser) ·
[DeepChat 插件说明](https://github.com/ThinkInAIXYZ/deepchat/blob/dev/docs/features/user-plugins/authoring.md)

示例文件采用与 DeepChat 一致的 [Apache-2.0](./LICENSE)；托管服务由百智云独立运营，
此目录不包含后端源码。
