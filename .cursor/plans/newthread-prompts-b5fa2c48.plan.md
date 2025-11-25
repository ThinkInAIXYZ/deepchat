<!-- b5fa2c48-9b3d-4ac7-93ce-d476454c3365 09df8c55-54ad-4e4c-9a03-93c0aea40b22 -->
# 修复 NewThread 中 prompts 加载时序问题

## 问题分析

1. **问题现象**：新建窗口后，`mcp.ts` store 中的 `prompts` 有数据，但在 `NewThread.vue` 的输入框中输入 `@` 时，prompts 列表为空。

2. **根本原因**：

- `useMentionData.ts` 中的 watch 监听 `mcpStore.prompts` 时没有设置 `immediate: true`
- 当 watch 设置时，如果 `prompts` 已经有数据，watch 不会立即执行
- 如果 `prompts` 在 watch 设置之后才加载完成，watch 应该会触发，但可能存在时序问题

3. **相关代码位置**：

- `src/renderer/src/components/chat-input/composables/useMentionData.ts` - prompts watch 缺少 `immediate: true`
- `src/renderer/src/stores/mcp.ts` - promptsQuery 的初始化逻辑

## 解决方案

采用**方案 1：为 prompts watch 添加 immediate: true**

在 `useMentionData.ts` 中，为所有 watch（特别是 prompts 的 watch）添加 `immediate: true`，确保在 watch 设置时立即执行一次，同步当前已有的数据。

**修改文件**：`src/renderer/src/components/chat-input/composables/useMentionData.ts`

- 为 prompts 的 watch 添加 `{ immediate: true }`
- 同时检查并统一其他 watch（resources, tools, files）的 immediate 配置，保持一致性
- 这样可以确保在组件初始化时，如果 store 中已经有数据，watch 会立即执行并更新 mentionData

## 实施步骤

1. 修改 `useMentionData.ts`，为 prompts watch 添加 `immediate: true`
2. 检查其他 watch（resources, tools）是否也需要添加 `immediate: true` 以保持一致性
3. 测试验证：新建窗口后，输入 `@` 应该能立即看到 prompts 列表

## 注意事项

- 添加 `immediate: true` 后，watch 会在设置时立即执行一次，需要确保此时 `prompts` 的值是合理的（可能是空数组，这是正常的）
- 如果 prompts 数据是异步加载的，watch 会在数据加载完成后再次触发，更新 mentionData

### To-dos

- [ ] 在 useMentionData.ts 中为 prompts watch 添加 immediate: true，确保在 watch 设置时立即同步数据
- [ ] 检查并统一其他 watch（resources, tools）的 immediate 配置，保持一致性
- [ ] 测试验证：新建窗口后输入 @ 能立即看到 prompts 列表