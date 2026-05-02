# Provider Deeplink Import Tasks

## T0 规格与设计

- [x] 完成 `spec.md`
- [x] 完成 `plan.md`
- [x] 完成 `tasks.md`

## T1 共享协议与事件

- [x] 新增 provider deeplink 共享类型与协议常量
- [x] 新增 `SETTINGS_EVENTS.PROVIDER_INSTALL`
- [x] 补共享类型导出

## T2 主进程解析与分发

- [x] 在 `deeplinkPresenter` 新增 `provider/install` 入口
- [x] 校验 `v=1`
- [x] 校验 Base64 / JSON / 字段结构
- [x] built-in 导入按 `id` 匹配
- [x] custom 导入按 `type` 校验
- [x] 拒绝 `acp`
- [x] 发送设置页导航与 preview 事件
- [x] 非法 payload 显示错误通知

## T3 设置页预览与确认

- [x] 新增 pending import store
- [x] `App.vue` 监听 `PROVIDER_INSTALL`
- [x] built-in 导航到目标 provider
- [x] 新增 `ProviderDeeplinkImportDialog`
- [x] built-in confirm 覆盖 `baseUrl/apiKey` 并自动启用
- [x] custom confirm 新增启用中的 custom provider
- [x] cancel 只清空 pending preview

## T4 i18n 与测试

- [x] 补齐 provider import 对话框文案
- [x] 新增 main deeplink 测试
- [x] 新增 settings app 事件处理测试
- [x] 新增 provider settings confirm 测试

## T5 Manual Playground

- [x] 新增 `test/manual/deeplink-playground.html`
- [x] 覆盖 `start`
- [x] 覆盖 `mcp/install`
- [x] 覆盖 built-in provider import，排除 `acp`
- [x] 覆盖 custom provider import，排除 `acp`
- [x] 提供 builder、Open、Copy、raw JSON、deeplink 展示
- [x] 更新 `test/README.md`

## T6 质量检查

- [ ] `pnpm run format`
- [ ] `pnpm run i18n`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] 运行相关测试并记录结果
