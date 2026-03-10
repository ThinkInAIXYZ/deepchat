# 默认模型与默认视觉模型 Tasks

## T0 规格确认

- [x] 完成 `spec.md`
- [x] 完成 `plan.md`
- [x] 完成 `tasks.md`

## T1 配置层

- [ ] 在配置体系新增 `defaultModel` 设置读写（`providerId/modelId`）。
- [ ] 在配置体系新增 `defaultVisionModel` 设置读写（`providerId/modelId`）。
- [ ] 为设置页提供读取/保存接口（复用 `configPresenter.getSetting/setSetting`）。

## T2 新建会话默认模型（Renderer + Main）

- [ ] 调整 `src/renderer/src/components/NewThread.vue` 初始化模型优先级：非 ACP 时优先 `defaultModel`。
- [ ] 保持手动选模可覆盖默认值（仅默认初始化受影响）。
- [ ] 在 `src/main/presenter/sessionPresenter/managers/conversationManager.ts` 中补主进程兜底：未显式模型且非 ACP 时应用 `defaultModel`。
- [ ] 验证主进程自动建会话入口（如 in-memory server 调用 `createConversation`）同样生效。
- [ ] 验证 `forkConversation` 路径不受影响。

## T3 设置页 UI

- [ ] 在设置页新增“默认模型”选择项（全模型，排除 ACP provider）。
- [ ] 在设置页新增“默认视觉模型”选择项（仅 `vision=true`）。
- [ ] 补齐 i18n 文案（至少 `zh-CN` + `en-US`）。
- [ ] 视觉模型保存时增加校验与错误提示。

## T4 imageServer 改造

- [ ] 修改 `src/main/presenter/mcpPresenter/inMemoryServers/imageServer.ts`：移除构造注入 provider/model，改为运行时读取 `defaultVisionModel`。
- [ ] 修改 `src/main/presenter/mcpPresenter/inMemoryServers/builder.ts`：`imageServer` 改为无参构造。
- [ ] 修改 `src/renderer/src/components/mcp-config/mcpServerForm.vue`：删除 `imageServer` 模型选择 UI、args 反解析与写回逻辑。
- [ ] 保持其他 inmemory server 的 args 行为不变。

## T5 失败处理与提示

- [ ] `defaultVisionModel` 缺失时，`imageServer` 返回可读错误。
- [ ] `defaultVisionModel` 指向非视觉或不可用模型时，`imageServer` 返回可读错误。
- [ ] 错误提示文案包含“去设置中配置默认视觉模型”。

## T6 测试

- [ ] Main：`createConversation` 非 ACP 默认模型应用测试。
- [ ] Main：ACP 场景不应用默认模型测试。
- [ ] Main：`forkConversation` 不受影响测试。
- [ ] Main：`imageServer` 读取 `defaultVisionModel` 成功/失败测试。
- [ ] Renderer：默认视觉模型只展示 vision 模型测试。
- [ ] Renderer：`mcpServerForm` 不再出现 `imageServer` 专属模型配置测试。

## T7 质量检查

- [ ] `pnpm run format`
- [ ] `pnpm run lint`
- [ ] `pnpm run typecheck`
- [ ] 跑相关测试并记录结果
