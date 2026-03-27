# Provider Deeplink Import 实施计划

## 1. 当前实现基线

### 1.1 Deeplink 现状

1. `src/main/presenter/deeplinkPresenter/index.ts` 已支持 `deepchat://start` 和 `deepchat://mcp/install`。
2. 设置窗口已经支持通过 `SETTINGS_EVENTS.NAVIGATE` 进行页面跳转。
3. 设置 App 已有 MCP deeplink 的初始化处理，可复用设置窗口 ready 后接收事件的模式。

### 1.2 Provider 设置页现状

1. Provider 列表与配置由 `providerStore` 驱动。
2. Provider 详情页可基于路由参数 `providerId` 切换目标 provider。
3. 自定义 provider 已有手动新增流程，可复用新增后的选中逻辑。

## 2. 设计决策

### 2.1 Payload 与共享类型

新增共享模块 `src/shared/providerDeeplink.ts`：

1. 常量：
  - `PROVIDER_INSTALL_ROUTE`
  - `PROVIDER_INSTALL_VERSION`
2. 类型：
  - `ProviderInstallDeeplinkPayload`
  - `ProviderInstallPreview`
3. 工具函数：
  - `maskApiKey`
  - custom type 校验

### 2.2 主进程事件流

入口：`deepchat://provider/install?v=1&data=...`

处理顺序：

1. `DeeplinkPresenter.handleDeepLink` 识别 `provider/install`
2. Base64 解码 + JSON 解析 + 字段校验
3. built-in：
  - 校验 `id`
  - 拒绝 `acp`
4. custom：
  - 校验 `name/type`
  - 校验 `type` 在允许列表中
  - 拒绝 `acp`
5. 创建/聚焦设置窗口
6. 发送：
  - `SETTINGS_EVENTS.NAVIGATE -> settings-provider`
  - `SETTINGS_EVENTS.PROVIDER_INSTALL -> preview`

错误策略：

1. 解析失败或 payload 不合法时，发 `NOTIFICATION_EVENTS.SHOW_ERROR`
2. 失败时不写任何 provider 配置

### 2.3 渲染进程事件流

`src/renderer/settings/App.vue`：

1. 监听 `SETTINGS_EVENTS.PROVIDER_INSTALL`
2. 确保 provider store 已初始化
3. built-in 导入时切到 `settings-provider/:providerId`
4. custom 导入时切到 `settings-provider`
5. 把 preview 放入新的 pending import store

`src/renderer/src/stores/providerDeeplinkImport.ts`：

1. 只维护当前 pending preview
2. 对话框开关由 preview 是否存在推导

### 2.4 对话框与落库行为

`ProviderDeeplinkImportDialog` 只负责展示解析结果，不自行写配置。

展示规则：

1. built-in：`icon + id`
2. custom：`icon + name`，并额外显示 `type`
3. 两类都展示 `baseUrl`
4. 两类都展示脱敏 `apiKey`
5. built-in 额外显示覆盖 warning

确认逻辑放在 `ModelProviderSettings.vue`：

1. built-in：
  - 更新 `baseUrl/apiKey`
  - 若未启用则自动启用
  - 刷新该 provider 模型
  - 切换到对应 provider 页面
2. custom：
  - 生成新 `id`
  - 创建 `custom: true` provider
  - 默认 `enable: true`
  - 刷新新 provider 模型
  - 切换到新 provider 页面
3. cancel：
  - 清空 pending preview
  - 不写配置

### 2.5 Provider 兼容策略

1. built-in provider 以 `id` 作为唯一匹配键，因此导入是覆盖语义。
2. custom provider 以 `type/apiType` 校验，但确认后总是新增实例，因此是追加语义。
3. `vertex`、`aws-bedrock`、`github-copilot` 等允许部分导入，即使后续仍需补专属字段，也不阻塞 `baseUrl/apiKey` 导入。
4. `acp` 独立于本流程，不进入 `settings-provider` 导入链路。

## 3. Manual Playground

新增：

- `test/manual/deeplink-playground.html`

页面结构：

1. `start`
2. `mcp/install`
3. `provider/install`
4. `provider/install builder`

规则：

1. built-in 列出当前所有默认 provider `id`，排除 `acp`
2. custom 列出当前所有允许导入的 `apiType`，排除 `acp`
3. 每项展示：
  - label
  - raw JSON
  - deeplink
  - `Open`
  - `Copy`
4. 示例数据全部使用假地址和假 key

## 4. 测试策略

### 4.1 Main

1. built-in payload 成功时：
  - 打开设置窗
  - 发送 `NAVIGATE`
  - 发送 `PROVIDER_INSTALL`
2. custom payload 成功时：
  - 发送 custom preview
3. 非法 payload：
  - 不发送导入事件
  - 发送错误通知

### 4.2 Renderer

1. `App.vue` 收到 `PROVIDER_INSTALL` 后正确导航并写入 preview store
2. `ModelProviderSettings.vue`：
  - built-in confirm 覆盖并启用 provider
  - custom confirm 新增并选中新 provider
  - cancel 不写配置
3. `ProviderDeeplinkImportDialog.vue` 正确展示 built-in/custom 解析结果

### 4.3 Manual

1. playground 中三类 deeplink 都能生成合法协议链接
2. built-in/custom 列表覆盖范围正确
3. builder 输出格式与应用解析格式一致

## 5. 风险与缓解

1. 风险：设置窗口创建后事件发送早于页面监听注册。  
缓解：复用现有 settings 事件通道，并在 App 侧做独立导航兜底。

2. 风险：部分 provider 启用后仍缺专属字段，模型刷新可能失败。  
缓解：允许部分导入；模型刷新失败只记录日志，不回滚导入。

3. 风险：手工验证页 provider 列表与真实支持集合漂移。  
缓解：built-in 与 custom 列表以当前代码中的 provider 集合为准，变更时同步更新此页。

## 6. 质量门槛

1. `pnpm run format`
2. `pnpm run i18n`
3. `pnpm run lint`
4. `pnpm run typecheck`
5. 关键 main/renderer 测试通过
