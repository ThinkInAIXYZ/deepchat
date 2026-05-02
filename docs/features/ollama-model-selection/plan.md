# Ollama 模型可选性与跨窗口同步实施计划

## 1. 关键决策

1. 真源统一到 main/config 持久层，renderer `ollamaStore` 只保留 UI 状态。
2. Ollama provider 刷新时同时采集 `listModels()` 与 `listRunningModels()` 并合并。
3. 新发现模型通过 `ensureModelStatus(..., true)` 默认启用，但不覆盖已有显式状态。
4. 本次只做 SDK 审计，不升级 `ollama` 依赖版本。

## 2. main/config 设计

### 2.1 状态语义

1. 在 `ModelStatusHelper` 增加 `ensureModelStatus`。
2. 仅当状态尚未存在时写入默认值。
3. 直接写存储并更新 cache，不发送 `MODEL_STATUS_CHANGED`。

### 2.2 Ollama provider 列表构建

1. `fetchProviderModels()` 并行获取本地模型与运行中模型。
2. 使用 `model.name` 合并，优先保留本地模型主体字段。
3. 合并 `capabilities`、`model_info` 和已有缓存能力元数据。
4. 生成 `MODEL_META` 后写入 config provider models。

## 3. renderer 刷新链路

1. `ollamaStore.refreshOllamaModels(providerId)` 先更新设置页本地/运行中列表。
2. 随后调用 `llmP.refreshModels(providerId)` 让 main 重建持久化目录。
3. 当前窗口再调用 `modelStore.refreshProviderModels(providerId)` 收敛显示。
4. pull 成功事件复用同一刷新链路。

## 4. 回归点

1. 删除 `modelStore.updateModelStatus()` 中对 Ollama 的提前返回，确保显式启停会落到 config。
2. 聊天侧继续依赖 `modelStore.enabledModels`，不增加临时兼容分支。

## 5. 测试策略

### Main

1. `ModelStatusHelper.ensureModelStatus` 不覆盖显式关闭状态。
2. `OllamaProvider.fetchModels()` 合并本地与运行中模型并保留能力元数据。

### Renderer

1. `ollamaStore.refreshOllamaModels()` 会调用 `llmP.refreshModels()` 与 `modelStore.refreshProviderModels()`。
2. pull 成功事件会触发同样的刷新链路。
3. `ChatStatusBar`、`ModelSelect`、`ModelChooser` 显示 Ollama chat 模型并过滤 Ollama embedding 模型。
