<!-- 420db26f-fd35-444b-9f1a-934872834f82 98947341-05f1-4e84-8350-1019aa898f59 -->
# Settings Store 和 ConfigPresenter 重构计划（更新版）

## 一、已完成部分 ✅

### 1.1 Main 层 Helper 类（已完成）

- ✅ `providerHelper.ts` - Provider 管理 Helper
- ✅ `modelStatusHelper.ts` - Model 状态管理 Helper  
- ✅ `providerModelHelper.ts` - Provider Model 存储 Helper
- ✅ `systemPromptHelper.ts` - 系统提示词 Helper
- ✅ `uiSettingsHelper.ts` - UI 设置 Helper
- ✅ ConfigPresenter 已注入这些 Helper，方法签名保持不变

### 1.2 Renderer 层 Store 基础结构（已完成）

- ✅ `providerStore.ts` - Provider 管理（基础结构）
- ✅ `modelStore.ts` - Model 管理（基础结构）
- ✅ `ollamaStore.ts` - Ollama 特殊处理（基础结构）
- ✅ `searchAssistantStore.ts` - 搜索助手模型（基础结构）
- ✅ `uiSettingsStore.ts` - UI 设置（已完成）
- ✅ `systemPromptStore.ts` - 系统提示词（已完成）
- ✅ `modelConfigStore.ts` - 模型配置（已完成）

## 二、剩余工作

### 2.1 settings.ts 中需要迁移的代码

#### 模型管理相关（迁移到 modelStore）

- `enabledModels`, `allProviderModels`, `customModels` 状态
- `refreshAllModels`, `refreshProviderModels`, `refreshStandardModels`, `refreshCustomModels`
- `updateModelStatus`, `addCustomModel`, `removeCustomModel`, `updateCustomModel`
- `enableAllModels`, `disableAllModels`
- `applyUserDefinedModelConfig`, `getLocalModelEnabledState`, `updateLocalModelStatus`
- `checkAndUpdateSearchAssistantModel`（与 searchAssistantStore 协调）
- `searchModels`, `findModelByIdOrName`
- `getProviderModelsQuery`, `getCustomModelsQuery`（query 管理）

#### 搜索助手模型相关（迁移到 searchAssistantStore）

- `searchAssistantModelRef`, `searchAssistantProviderRef`（状态）
- `findPriorityModel`, `setSearchAssistantModel`, `initOrUpdateSearchAssistantModel`
- `checkAndUpdateSearchAssistantModel`（完整实现）

#### Ollama 相关（迁移到 ollamaStore）

- `syncOllamaModelsToGlobal`
- `handleOllamaModelPullEvent`, `setupOllamaEventListeners`, `removeOllamaEventListeners`
- `getOllamaRunningModels`, `getOllamaLocalModels`, `getOllamaPullingModels`（包装方法）
- `refreshOllamaModels`, `pullOllamaModel`, `clearOllamaProviderData`
- `isOllamaModelRunning`, `isOllamaModelLocal`
- `updateOllamaPullingProgress`

#### Provider 相关（迁移到 providerStore）

- `updateProvider`, `updateProviderConfig`, `updateProviderApi`, `updateProviderAuth`
- `updateProviderStatus`, `addCustomProvider`, `removeProvider`
- `updateProvidersOrder`, `loadSavedOrder`
- `updateAwsBedrockProviderConfig`
- `checkProvider`
- `setAzureApiVersion`, `getAzureApiVersion` - Azure 特定配置
- `setGeminiSafety`, `getGeminiSafety` - Gemini 特定配置
- `setAwsBedrockCredential`, `getAwsBedrockCredential` - AWS Bedrock 配置

#### 其他杂项

- `mcpInstallCache`, `clearMcpInstallCache` - MCP 安装缓存（可移到 mcpStore）
- `artifactsEffectEnabled` - 效果开关（可移到 uiSettingsStore）
- `loggingEnabled`, `setLoggingEnabled` - 日志开关（可移到 uiSettingsStore）
- `cleanAllMessages` - 清理消息（Thread 相关，不应在 settings）
- `initSettings` - 初始化协调（需要协调各个 store）
- `setupProviderListener` - 事件监听（需要拆分到各个 store）
- `cleanup` - 清理方法（需要协调各个 store）

## 三、实施步骤

### 阶段一：完善各 Store 的功能（迁移剩余代码）

#### 1.1 完善 modelStore.ts

1. 迁移模型列表状态：`enabledModels`, `allProviderModels`, `customModels`
2. 迁移模型刷新方法：`refreshAllModels`, `refreshProviderModels`, `refreshStandardModels`, `refreshCustomModels`
3. 迁移模型操作方法：`updateModelStatus`, `addCustomModel`, `removeCustomModel`, `updateCustomModel`
4. 迁移批量操作方法：`enableAllModels`, `disableAllModels`
5. 迁移辅助方法：`applyUserDefinedModelConfig`, `getLocalModelEnabledState`, `updateLocalModelStatus`
6. 迁移查询管理：`getProviderModelsQuery`, `getCustomModelsQuery`
7. 迁移搜索方法：`searchModels`, `findModelByIdOrName`

#### 1.2 完善 searchAssistantStore.ts

1. 迁移状态：`searchAssistantModelRef`, `searchAssistantProviderRef`
2. 迁移方法：`findPriorityModel`, `setSearchAssistantModel`, `initOrUpdateSearchAssistantModel`
3. 完善 `checkAndUpdateSearchAssistantModel`（依赖 modelStore）

#### 1.3 完善 ollamaStore.ts

1. 迁移方法：`syncOllamaModelsToGlobal`
2. 迁移事件处理：`handleOllamaModelPullEvent`, `setupOllamaEventListeners`, `removeOllamaEventListeners`
3. 迁移包装方法：`getOllamaRunningModels`, `getOllamaLocalModels`, `getOllamaPullingModels`
4. 迁移操作方法：`refreshOllamaModels`, `pullOllamaModel`, `clearOllamaProviderData`
5. 迁移查询方法：`isOllamaModelRunning`, `isOllamaModelLocal`
6. 迁移进度更新：`updateOllamaPullingProgress`

#### 1.4 完善 providerStore.ts

1. 迁移方法：`updateProvider`, `updateProviderConfig`, `updateProviderApi`, `updateProviderAuth`
2. 迁移状态管理：`updateProviderStatus`, `addCustomProvider`, `removeProvider`
3. 迁移排序方法：`updateProvidersOrder`, `loadSavedOrder`
4. 迁移特定配置：`updateAwsBedrockProviderConfig`, `checkProvider`
5. 迁移 Provider 特定配置：`setAzureApiVersion`, `getAzureApiVersion`, `setGeminiSafety`, `getGeminiSafety`, `setAwsBedrockCredential`, `getAwsBedrockCredential`

#### 1.5 完善 uiSettingsStore.ts

1. 迁移状态：`artifactsEffectEnabled`, `loggingEnabled`
2. 迁移方法：`setLoggingEnabled`

### 阶段二：处理事件监听和初始化协调

#### 2.1 创建初始化协调器

1. 创建 `initSettings` 的协调逻辑（可在 App.vue 或专门的 composable 中）
2. 确保各 store 初始化顺序正确：providerStore -> modelStore -> ollamaStore -> searchAssistantStore

#### 2.2 拆分事件监听

1. 将 `setupProviderListener` 中的 Provider 相关监听移到 `providerStore`
2. 将 `setupProviderListener` 中的 Model 相关监听移到 `modelStore`
3. 将 `setupProviderListener` 中的 Ollama 相关监听移到 `ollamaStore`
4. 统一清理逻辑：各 store 提供 `cleanup` 方法

### 阶段三：更新所有调用点（直接替换）

#### 3.1 搜索和替换 useSettingsStore

1. 搜索所有 `useSettingsStore` 的使用位置（35个文件）
2. 根据功能域替换为对应的新 store
3. 更新组件中的 import 语句
4. 更新 store 方法调用

#### 3.2 处理特殊调用

1. `initSettings` - 替换为各 store 的初始化调用
2. `cleanAllMessages` - 移到 threadStore 或直接调用 threadPresenter
3. `mcpInstallCache` - 移到 mcpStore 或保留在专门的 composable

### 阶段四：清理和验证

#### 4.1 删除旧代码

1. 删除 `settings.ts` 文件
2. 清理未使用的 import

#### 4.2 验证功能

1. 测试所有 Provider 相关功能
2. 测试所有 Model 相关功能
3. 测试 Ollama 相关功能
4. 测试搜索助手模型功能
5. 测试 UI 设置功能
6. 测试系统提示词功能
7. 测试模型配置功能

#### 4.3 代码质量检查

1. 确保没有循环依赖
2. 确保事件监听器正确清理
3. 确保初始化顺序正确
4. 运行 lint 和 typecheck

## 四、技术细节

### 4.1 Store 实现模式

- 使用 Pinia `defineStore` 的 Composition API 风格
- 使用 `ref` 和 `computed` 管理响应式状态
- 通过 `usePresenter` 调用 Main 进程方法
- 监听 CONFIG_EVENTS 事件更新状态
- 在 `onMounted` 中设置事件监听器，提供 `cleanup` 方法清理

### 4.2 事件通知机制

- Helper 层通过 EventBus 发送事件（保持现有机制）
- Store 层监听对应事件更新本地状态
- 保持与现有事件系统兼容
- 各 store 负责监听自己相关的事件

### 4.3 Store 间依赖

- `searchAssistantStore` 依赖 `modelStore`（需要获取可用模型列表）
- `modelConfigStore` 依赖 `modelStore`（配置更新后需要刷新模型列表）
- `modelStore` 依赖 `providerStore`（需要获取 provider 列表）
- 初始化顺序：providerStore -> modelStore -> ollamaStore -> searchAssistantStore

### 4.4 初始化协调

- 可在 App.vue 或专门的 composable 中协调各 store 的初始化
- 确保依赖的 store 先初始化
- 提供统一的初始化入口

## 五、注意事项

1. **事件监听器管理**：每个 store 需要正确设置和清理事件监听器
2. **初始化顺序**：确保 store 初始化顺序正确
3. **类型定义**：保持类型定义在 `@shared/presenter` 中，确保类型安全
4. **直接替换**：拆分的同时更新所有调用点，不做代理方法，一次性完成迁移
5. **Store 间协调**：注意 store 间的依赖关系，避免循环依赖
6. **代码质量**：遵循单一职责原则，每个 store 职责清晰，代码不超过 200 行
7. **测试验证**：每个阶段完成后验证功能正常

**注意**：本次重构不进行 Colada 集成，只做拆分。Colada 集成留待后续优化。

### To-dos

- [x] 完善 modelStore.ts：迁移模型列表状态、刷新方法、操作方法、批量操作、辅助方法、查询管理、搜索方法
- [x] 完善 searchAssistantStore.ts：迁移状态和方法，完善 checkAndUpdateSearchAssistantModel
- [x] 完善 ollamaStore.ts：迁移所有 Ollama 相关方法和事件处理
- [x] 完善 providerStore.ts：迁移 Provider 操作方法、状态管理、排序方法、特定配置
- [x] 完善 uiSettingsStore.ts：迁移 artifactsEffectEnabled、loggingEnabled、setLoggingEnabled
- [x] 拆分 setupProviderListener 到各个 store，各 store 负责监听自己相关的事件
- [x] 创建初始化协调器，确保各 store 按正确顺序初始化
- [x] 更新所有剩余文件中的 useSettingsStore 调用为对应的新 store（剩余：BedrockProviderSettingsDetail.vue、AnthropicProviderSettingsDetail.vue、GitHubCopilotOAuth.vue、BuiltinKnowledgeSettings.vue、ModelConfigDialog.vue、ModelCheckDialog.vue、ModelIcon.vue、MessageToolbar.vue、MessageItemAssistant.vue、mcp-config/mcpServerForm.vue、mcp-config/components/McpServers.vue、useRateLimitStatus.ts、usePromptInputConfig.ts、useModelTypeDetection.ts）
- [x] 处理特殊调用：initSettings、cleanAllMessages、mcpInstallCache（迁移/清理后删除 settings.ts）
- [x] 删除旧的 settings.ts 文件，清理未使用的 import
- [ ] 验证所有功能正常工作：Provider、Model、Ollama、搜索助手、UI 设置、系统提示词、模型配置
- [ ] 代码质量检查：确保没有循环依赖、事件监听器正确清理、初始化顺序正确、运行 lint 和 typecheck
