<!-- 420db26f-fd35-444b-9f1a-934872834f82 6f59b900-ce82-4b05-9e1f-90de11eb979e -->
# Settings Store 和 ConfigPresenter 重构计划

## 一、现状分析

### 1.1 settings.ts 职责过多（1994行）

- Provider 管理：CRUD、排序、状态管理
- Model 管理：标准模型、自定义模型、状态同步
- Ollama 特殊处理：运行中模型、本地模型、拉取进度
- 搜索助手模型：优先级匹配、自动选择
- UI 设置：字体大小、通知、搜索预览、投屏保护、Trace 调试
- 系统提示词：默认提示词、自定义提示词列表
- 模型配置：用户自定义配置管理

### 1.2 configPresenter/index.ts 职责过多（1599行）

- 基础设置：通用 getSetting/setSetting
- Provider 管理：CRUD、原子操作、批量更新
- Model 状态管理：启用/禁用、批量操作、缓存优化
- MCP 配置：已拆分到 mcpConfHelper
- 模型配置：已拆分到 modelConfigHelper
- 系统提示词：提示词列表、默认提示词
- 知识库配置：已拆分到 knowledgeConfHelper
- 快捷键配置：已拆分到 shortcutKeySettings
- 主题管理：主题切换、系统主题监听

## 二、重构目标

1. **单一职责**：每个 store/helper 只负责一个功能域
2. **Colada 集成**：使用 Query + Mutation 模式优化数据流
3. **易于维护**：新开发者能快速定位和修改代码
4. **结构稳定**：清晰的模块边界，减少耦合

## 三、拆分方案

### 3.1 Renderer 层 Store 拆分

#### 3.1.1 `providerStore.ts` - Provider 管理

**职责**：

- Provider 列表、排序、启用状态
- Provider CRUD 操作
- Provider 配置更新（API Key、Base URL、认证等）

**Colada 集成**：

- `providersQuery`: 查询所有 providers
- `providerQuery(providerId)`: 查询单个 provider
- `addProviderMutation`: 添加 provider
- `updateProviderMutation`: 更新 provider
- `removeProviderMutation`: 删除 provider
- `reorderProvidersMutation`: 重新排序

**从 settings.ts 迁移的方法**：

- `providers`, `providerOrder`, `sortedProviders`
- `updateProvider`, `updateProviderConfig`, `updateProviderApi`, `updateProviderAuth`
- `updateProviderStatus`, `addCustomProvider`, `removeProvider`
- `updateProvidersOrder`, `loadSavedOrder`, `optimizeProviderOrder`

#### 3.1.2 `modelStore.ts` - Model 管理

**职责**：

- 标准模型列表、自定义模型列表
- 模型启用状态管理
- 模型配置应用（用户自定义配置覆盖）

**Colada 集成**：

- `allModelsQuery(providerId)`: 查询 provider 的所有模型
- `enabledModelsQuery(providerId)`: 查询启用的模型
- `customModelsQuery(providerId)`: 查询自定义模型
- `updateModelStatusMutation`: 更新模型启用状态
- `addCustomModelMutation`: 添加自定义模型
- `updateCustomModelMutation`: 更新自定义模型
- `removeCustomModelMutation`: 删除自定义模型

**从 settings.ts 迁移的方法**：

- `enabledModels`, `allProviderModels`, `customModels`
- `refreshAllModels`, `refreshProviderModels`, `refreshStandardModels`, `refreshCustomModels`
- `updateModelStatus`, `addCustomModel`, `updateCustomModel`, `removeCustomModel`
- `enableAllModels`, `disableAllModels`
- `applyUserDefinedModelConfig`, `getLocalModelEnabledState`

#### 3.1.3 `ollamaStore.ts` - Ollama 特殊处理

**职责**：

- Ollama 运行中模型、本地模型
- 模型拉取进度
- Ollama 模型同步到全局模型列表

**Colada 集成**：

- `ollamaRunningModelsQuery(providerId)`: 查询运行中的模型
- `ollamaLocalModelsQuery(providerId)`: 查询本地模型
- `pullOllamaModelMutation`: 拉取模型

**从 settings.ts 迁移的方法**：

- `ollamaRunningModels`, `ollamaLocalModels`, `ollamaPullingModels`
- `getOllamaRunningModels`, `getOllamaLocalModels`, `getOllamaPullingModels`
- `refreshOllamaModels`, `pullOllamaModel`, `syncOllamaModelsToGlobal`
- `isOllamaModelRunning`, `isOllamaModelLocal`, `clearOllamaProviderData`
- `setupOllamaEventListeners`, `handleOllamaModelPullEvent`

#### 3.1.4 `searchAssistantStore.ts` - 搜索助手模型

**职责**：

- 搜索助手模型选择和管理
- 优先级匹配逻辑

**Colada 集成**：

- `searchAssistantModelQuery`: 查询当前搜索助手模型
- `setSearchAssistantModelMutation`: 设置搜索助手模型

**从 settings.ts 迁移的方法**：

- `searchAssistantModel`, `searchAssistantModelPriorities`
- `setSearchAssistantModel`, `initOrUpdateSearchAssistantModel`
- `findPriorityModel`, `checkAndUpdateSearchAssistantModel`

#### 3.1.5 `uiSettingsStore.ts` - UI 设置

**职责**：

- 字体大小、通知、搜索预览、投屏保护
- Trace 调试、复制时包含 CoT、日志开关

**Colada 集成**：

- `fontSizeQuery`: 查询字体大小级别
- `notificationsQuery`: 查询通知设置
- `searchPreviewQuery`: 查询搜索预览设置
- `contentProtectionQuery`: 查询投屏保护设置
- `updateFontSizeMutation`: 更新字体大小
- `setNotificationsMutation`: 设置通知
- `setSearchPreviewMutation`: 设置搜索预览
- `setContentProtectionMutation`: 设置投屏保护

**从 settings.ts 迁移的方法**：

- `fontSizeLevel`, `fontSizeClass`, `notificationsEnabled`
- `searchPreviewEnabled`, `contentProtectionEnabled`, `copyWithCotEnabled`
- `traceDebugEnabled`, `loggingEnabled`
- `updateFontSizeLevel`, `setNotificationsEnabled`, `setSearchPreviewEnabled`
- `setContentProtectionEnabled`, `setCopyWithCotEnabled`, `setTraceDebugEnabled`
- `setLoggingEnabled`
- 所有 `setup*Listener` 方法

#### 3.1.6 `systemPromptStore.ts` - 系统提示词

**职责**：

- 系统提示词列表、默认提示词
- 提示词 CRUD 操作

**Colada 集成**：

- `systemPromptsQuery`: 查询所有系统提示词
- `defaultSystemPromptQuery`: 查询默认提示词
- `addSystemPromptMutation`: 添加提示词
- `updateSystemPromptMutation`: 更新提示词
- `deleteSystemPromptMutation`: 删除提示词
- `setDefaultSystemPromptMutation`: 设置默认提示词

**从 settings.ts 迁移的方法**：

- `getDefaultSystemPrompt`, `setDefaultSystemPrompt`
- `resetToDefaultPrompt`, `clearSystemPrompt`
- `getSystemPrompts`, `setSystemPrompts`, `addSystemPrompt`
- `updateSystemPrompt`, `deleteSystemPrompt`
- `setDefaultSystemPromptId`, `getDefaultSystemPromptId`

#### 3.1.7 `modelConfigStore.ts` - 模型配置

**职责**：

- 用户自定义模型配置管理
- 配置读取和应用

**Colada 集成**：

- `modelConfigQuery(providerId, modelId)`: 查询模型配置
- `setModelConfigMutation`: 设置模型配置
- `resetModelConfigMutation`: 重置模型配置

**从 settings.ts 迁移的方法**：

- `getModelConfig`, `setModelConfig`, `resetModelConfig`

### 3.2 Main 层 ConfigPresenter 拆分

#### 3.2.1 `providerHelper.ts` - Provider 管理 Helper

**职责**：

- Provider 存储和检索
- Provider 原子操作（add/update/remove/reorder）
- Provider 批量更新

**从 index.ts 迁移的方法**：

- `getProviders()`, `setProviders()`, `getProviderById()`, `setProviderById()`
- `updateProviderAtomic()`, `updateProvidersBatch()`
- `addProviderAtomic()`, `removeProviderAtomic()`, `reorderProvidersAtomic()`
- `getDefaultProviders()`, `getEnabledProviders()`

#### 3.2.2 `modelStatusHelper.ts` - Model 状态管理 Helper

**职责**：

- Model 启用状态存储（使用内存缓存优化）
- 批量状态操作

**从 index.ts 迁移的方法**：

- `getModelStatus()`, `setModelStatus()`, `getBatchModelStatus()`
- `enableModel()`, `disableModel()`, `batchSetModelStatus()`
- `clearModelStatusCache()`, `clearProviderModelStatusCache()`
- `getModelStatusKey()` (private)

#### 3.2.3 `providerModelHelper.ts` - Provider Model 存储 Helper

**职责**：

- Provider 标准模型和自定义模型的存储
- 模型列表的 CRUD

**从 index.ts 迁移的方法**：

- `getProviderModels()`, `setProviderModels()`
- `getCustomModels()`, `setCustomModels()`
- `addCustomModel()`, `removeCustomModel()`, `updateCustomModel()`
- `getProviderModelStore()` (private)

#### 3.2.4 `systemPromptHelper.ts` - 系统提示词 Helper

**职责**：

- 系统提示词存储和管理
- 默认提示词管理

**从 index.ts 迁移的方法**：

- `getSystemPrompts()`, `setSystemPrompts()`
- `addSystemPrompt()`, `updateSystemPrompt()`, `deleteSystemPrompt()`
- `getDefaultSystemPrompt()`, `setDefaultSystemPrompt()`
- `resetToDefaultPrompt()`, `clearSystemPrompt()`
- `setDefaultSystemPromptId()`, `getDefaultSystemPromptId()`

#### 3.2.5 `appSettingsHelper.ts` - 应用基础设置 Helper

**职责**：

- 通用设置存储（getSetting/setSetting）
- 应用级设置（语言、代理、同步等）

**保留在 index.ts 的方法**：

- `getSetting()`, `setSetting()` (核心方法，保留在 ConfigPresenter)
- `getLanguage()`, `setLanguage()`
- `getProxyMode()`, `setProxyMode()`, `getCustomProxyUrl()`, `setCustomProxyUrl()`
- `getSyncEnabled()`, `setSyncEnabled()`, `getSyncFolderPath()`, `setSyncFolderPath()`
- `getLastSyncTime()`, `setLastSyncTime()`
- `getLoggingEnabled()`, `setLoggingEnabled()`, `getLoggingFolderPath()`, `openLoggingFolder()`
- `getSoundEnabled()`, `setSoundEnabled()`
- `getCloseToQuit()`, `setCloseToQuit()`
- `getFloatingButtonEnabled()`, `setFloatingButtonEnabled()`
- `getTheme()`, `setTheme()`, `getCurrentThemeIsDark()`, `getSystemTheme()`, `initTheme()`

#### 3.2.6 `uiSettingsHelper.ts` - UI 设置 Helper

**职责**：

- UI 相关设置的存储和事件通知

**从 index.ts 迁移的方法**：

- `getSearchPreviewEnabled()`, `setSearchPreviewEnabled()`
- `getContentProtectionEnabled()`, `setContentProtectionEnabled()`
- `getCopyWithCotEnabled()`, `setCopyWithCotEnabled()`
- `setTraceDebugEnabled()` (getTraceDebugEnabled 使用 getSetting)
- `getNotificationsEnabled()`, `setNotificationsEnabled()`
- 字体大小相关方法（通过 getSetting/setSetting 实现）

## 四、实施步骤

### 阶段一：Main 层 Helper 拆分（基础架构）

1. 创建 `providerHelper.ts`，迁移 Provider 相关方法
2. 创建 `modelStatusHelper.ts`，迁移 Model 状态管理方法
3. 创建 `providerModelHelper.ts`，迁移 Model 存储方法
4. 创建 `systemPromptHelper.ts`，迁移系统提示词方法
5. 创建 `uiSettingsHelper.ts`，迁移 UI 设置方法
6. 在 `ConfigPresenter` 中注入这些 Helper，保持接口不变

### 阶段二：Renderer 层 Store 拆分（按功能域）

1. 创建 `providerStore.ts`，使用 Colada 集成 Provider 管理
2. 创建 `modelStore.ts`，使用 Colada 集成 Model 管理
3. 创建 `ollamaStore.ts`，使用 Colada 集成 Ollama 管理
4. 创建 `searchAssistantStore.ts`，使用 Colada 集成搜索助手模型
5. 创建 `uiSettingsStore.ts`，使用 Colada 集成 UI 设置
6. 创建 `systemPromptStore.ts`，使用 Colada 集成系统提示词
7. 创建 `modelConfigStore.ts`，使用 Colada 集成模型配置

### 阶段三：迁移和兼容（渐进式迁移）

1. 在旧 `settings.ts` 中保留代理方法，调用新 store
2. 逐步迁移组件使用新 store
3. 移除旧 `settings.ts` 的实现，只保留类型导出

### 阶段四：清理和优化

1. 移除所有代理代码
2. 统一事件命名和通知机制
3. 优化 Colada Query 的缓存策略
4. 添加单元测试

## 五、技术细节

### 5.1 Colada Query 缓存策略

- Provider/Model 查询：`staleTime: 30_000` (30秒)
- UI 设置查询：`staleTime: 60_000` (60秒，变化频率低)
- 系统提示词查询：`staleTime: 60_000` (60秒)

### 5.2 事件通知机制

- Helper 层通过 EventBus 发送事件
- Store 层监听事件并自动失效相关 Query 缓存
- 保持与现有事件系统兼容

### 5.3 向后兼容

- 阶段三保留代理方法，确保现有组件无需立即修改
- 提供迁移指南，逐步迁移组件

## 六、文件结构

```
src/renderer/src/stores/
  ├── providerStore.ts          # Provider 管理
  ├── modelStore.ts             # Model 管理
  ├── ollamaStore.ts            # Ollama 特殊处理
  ├── searchAssistantStore.ts   # 搜索助手模型
  ├── uiSettingsStore.ts        # UI 设置
  ├── systemPromptStore.ts      # 系统提示词
  ├── modelConfigStore.ts       # 模型配置
  └── settings.ts                # 保留类型导出和代理（阶段三后移除）

src/main/presenter/configPresenter/
  ├── index.ts                   # 主入口，注入 Helper
  ├── providerHelper.ts          # Provider 管理 Helper
  ├── modelStatusHelper.ts       # Model 状态管理 Helper
  ├── providerModelHelper.ts     # Provider Model 存储 Helper
  ├── systemPromptHelper.ts      # 系统提示词 Helper
  ├── uiSettingsHelper.ts        # UI 设置 Helper
  ├── appSettingsHelper.ts       # 应用基础设置 Helper（可选，或保留在 index.ts）
  ├── mcpConfHelper.ts           # MCP 配置（已存在）
  ├── modelConfig.ts             # 模型配置（已存在）
  ├── knowledgeConfHelper.ts     # 知识库配置（已存在）
  └── shortcutKeySettings.ts    # 快捷键配置（已存在）
```

## 七、注意事项

1. **事件监听器管理**：每个 store 需要正确设置和清理事件监听器（在 `onMounted` 中设置，提供 `cleanup` 方法）
2. **初始化顺序**：确保 store 初始化顺序正确（providerStore 需要在 modelStore 之前）
3. **类型定义**：保持类型定义在 `@shared/presenter` 中，确保类型安全
4. **直接替换**：拆分的同时更新所有调用点，不做代理方法，一次性完成迁移
5. **ConfigPresenter 接口**：保证方法签名不变，内部实现委托给 Helper
6. **测试验证**：每个阶段完成后验证功能正常，最后添加单元测试

### To-dos

- [x] 阶段一：拆分 Main 层 ConfigPresenter 为多个 Helper 类（providerHelper, modelStatusHelper, providerModelHelper, systemPromptHelper, uiSettingsHelper）
- [ ] 阶段二：拆分 Renderer 层 settings.ts 为多个 Store（providerStore, modelStore, ollamaStore, searchAssistantStore, uiSettingsStore, systemPromptStore, modelConfigStore）
- [ ] 为所有新 Store 集成 Colada Query + Mutation 模式，优化数据流和缓存
- [ ] 阶段三：在旧 settings.ts 中保留代理方法，确保现有组件无需立即修改
- [ ] 逐步迁移组件使用新 Store，更新所有引用
- [ ] 阶段四：移除代理代码，统一事件命名，优化缓存策略，添加单元测试
