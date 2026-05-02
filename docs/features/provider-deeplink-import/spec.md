# Provider Deeplink Import 规格

## 概述

新增 provider 导入 deeplink：

- `deepchat://provider/install?v=1&data=<base64(JSON)>`

其中 `data` 只接受两种结构，且 `id` 与 `type` 必须二选一：

1. `{ id, baseUrl, apiKey }`
2. `{ name, type, baseUrl, apiKey }`

导入后统一进入 Provider Settings，先展示确认对话框；用户确认后才写入配置，取消则直接丢弃。

## 背景与动机

1. 用户经常需要在多个 built-in provider 与 custom provider 之间切换配置。
2. 当前 provider 配置主要依赖手动录入，分享和一键导入成本高。
3. DeepLink 已经用于 `start` 和 `mcp/install`，provider 导入应沿用同一套唤起能力。
4. 需要一个独立的手工验证页，降低联调和回归验证成本。

## 用户故事

### US-1：一键导入内置 Provider

作为用户，我希望点击一个 deeplink 后直接进入对应 provider 设置，并在确认后覆盖它的 `baseUrl` 与 `apiKey`。

### US-2：一键新增 Custom Provider

作为用户，我希望通过 deeplink 快速新增一个 custom provider，而不是手动新建并逐项填写。

### US-3：导入前确认

作为用户，我希望在真正写入前看到解析结果，避免误覆盖现有配置。

### US-4：手工验证入口

作为开发者或测试者，我希望仓库里有一个静态网页，能集中打开所有支持的 deeplink。

## 功能需求

### A. Provider Deeplink 协议

- [ ] 新增 `deepchat://provider/install?v=1&data=<base64(JSON)>`
- [ ] `v=1` 是当前唯一支持版本
- [ ] `data` Base64 解码后必须是 JSON object
- [ ] payload 只允许两种结构：
  - [ ] `{ id, baseUrl, apiKey }`
  - [ ] `{ name, type, baseUrl, apiKey }`
- [ ] `id` 与 `type` 同时存在或同时缺失时，必须拒绝

### B. 内置 Provider 导入

- [ ] 当 payload 包含 `id` 时，按内置 provider id 匹配
- [ ] `id='acp'` 必须拒绝
- [ ] unknown `id` 必须拒绝
- [ ] 确认后覆盖目标 provider 的 `baseUrl` 与 `apiKey`
- [ ] 若目标 provider 当前未启用，确认后自动启用
- [ ] 完成后停留在对应 provider 设置页
- [ ] 若是 `vertex`、`aws-bedrock`、`github-copilot` 等仍需额外字段的 provider，允许部分导入，不阻塞确认

### C. Custom Provider 导入

- [ ] 当 payload 包含 `type` 时，按 provider `apiType` 匹配
- [ ] `type='acp'` 必须拒绝
- [ ] unknown `type` 必须拒绝
- [ ] custom payload 必须包含 `name`
- [ ] 确认后总是新增一条 custom provider，不复用旧条目
- [ ] 新 provider 默认 `enable=true`
- [ ] 完成后停留在新 provider 设置页

### D. 设置页行为

- [ ] deeplink 唤起后自动进入 `settings-provider`
- [ ] 在真正写入前弹出 `Import Provider` 对话框
- [ ] built-in 对话框只展示：
  - [ ] `id + icon`
  - [ ] `baseUrl`
  - [ ] 脱敏 `apiKey`
- [ ] custom 对话框只展示：
  - [ ] `name + icon`
  - [ ] `type`
  - [ ] `baseUrl`
  - [ ] 脱敏 `apiKey`
- [ ] built-in 导入需要展示“将覆盖当前配置”的提示
- [ ] 取消后不写入任何 provider 配置

### E. 错误处理

- [ ] 非法 Base64、非法 JSON、非法版本、缺字段、unknown `id/type` 均必须拒绝
- [ ] 非法 deeplink 需要有可见错误提示
- [ ] 拒绝场景不得写入 provider 配置

### F. Manual Playground

- [ ] 新增 `test/manual/deeplink-playground.html`
- [ ] 页面覆盖三类 deeplink：
  - [ ] `start`
  - [ ] `mcp/install`
  - [ ] `provider/install`
- [ ] `provider/install` 区块必须列出：
  - [ ] 所有 built-in provider `id`，排除 `acp`
  - [ ] 所有允许的 custom `apiType`，排除 `acp`
- [ ] 每项都提供 `Open` 和 `Copy`
- [ ] 每项都展示原始 JSON 与最终 deeplink
- [ ] 页面提供一个可编辑 builder，用于临时生成 deeplink
- [ ] 所有示例数据必须为 fake data

## 验收标准

- [ ] 打开 built-in provider deeplink 时，设置窗进入对应 provider，并弹出确认对话框
- [ ] 确认 built-in provider 导入后，`baseUrl/apiKey` 被覆盖，provider 被自动启用
- [ ] 打开 custom provider deeplink 时，设置窗进入 provider 设置页，并弹出确认对话框
- [ ] 确认 custom provider 导入后，会新增一条启用中的 custom provider
- [ ] 取消导入时，不产生任何配置写入
- [ ] 非法 payload 只显示错误，不进入确认流程
- [ ] 手工验证页可直接生成并打开三类 deeplink

## 非目标

1. 不扩展 provider deeplink 的版本协商机制，本次仅支持 `v=1`。
2. 不新增 provider 专属迁移脚本或持久化 schema。
3. 不为 `acp` provider 引入导入能力。
4. 不修改现有 `start` 与 `mcp/install` 的协议格式。

## 约束

1. 保持现有 Presenter + EventBus 架构。
2. 所有用户可见文案必须走 i18n。
3. 不破坏现有 provider 配置存储结构。
4. Manual playground 不打包进应用，仅作为仓库内测试辅助页。

## 开放问题

无。
