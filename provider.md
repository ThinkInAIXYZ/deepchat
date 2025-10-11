# Provider 能力来源与解析设计（Provider DB 驱动）

本文档定义“模型能力来源统一到 Provider DB”的目标方案，并给出在 main 层、各 Provider 实现、以及渲染层（UI）中的接入方式与迁移步骤。目标是移除 provider 内部的硬编码名单（如 Dashscope 的 ENABLE_THINKING_MODELS/ENABLE_SEARCH_MODELS），改为以“用户目录缓存优先、内置 resources 兜底”的 Provider DB 作为单一事实源。

- 单一事实源：能力数据仅来自 Provider DB（用户目录缓存优先，resources/model-db/providers.json 兜底）。
- 能力集中解析：在 main/configPresenter 域提供“模型能力解析服务”，统一判断模型是否支持 reasoning/search 及其默认/策略/预算等。
- 精确匹配：严格以 providerId + modelId 的小写全等匹配；DB 无记录即判定不支持。
- Provider 与 UI 复用：Provider 发起调用前做能力判定，UI 展示/开关也通过相同来源获取，避免出现“一边显示支持一边不支持”的分裂。

## 现状与地基

- Provider DB 加载：`src/main/presenter/configPresenter/providerDbLoader.ts`
  - 读取路径：优先 `userData/provider-db/providers.json`，兜底 `resources/model-db/providers.json`。
  - 后台刷新：支持 TTL 与 `PROVIDER_DB_EVENTS.LOADED/UPDATED` 广播。
- DB Schema：`src/shared/types/model-db.ts`
  - `reasoning`（supported/default/budget）与 `search`（supported/default/forced_search/search_strategy）已定义并清洗。
- 默认模型配置合并：`src/main/presenter/configPresenter/modelConfig.ts`
  - 若提供 `providerId + modelId`，会把 DB 中的能力默认值并入 `ModelConfig`（如 `reasoning.default`、`search.default` 等）。
- 问题点：部分 Provider 与 UI 仍有硬编码名单与 substring 匹配逻辑，导致数据源分裂与维护成本高。

## 目标设计

### 1) 模型能力解析服务（集中式）

- 新增文件：`src/main/presenter/configPresenter/modelCapabilities.ts`
- 职责：
  - 从 Provider DB 读取并缓存 provider→model 映射，暴露能力查询接口。
  - 监听 `PROVIDER_DB_EVENTS.LOADED/UPDATED`，更新内存索引。
- 接口示例：
  - `supportsReasoning(providerId: string, modelId: string): boolean`
  - `getThinkingBudgetRange(providerId: string, modelId: string): { min?: number; max?: number; default?: number }`
  - `supportsSearch(providerId: string, modelId: string): boolean`
  - `getSearchDefaults(providerId: string, modelId: string): { default?: boolean; forced?: boolean; strategy?: 'turbo' | 'max' }`
- 约束：
  - 严格小写精确匹配：函数内部统一 `toLowerCase()`，DB 中 id 必须已清洗为小写。
  - DB 无记录即视为“不支持”，不做兼容/模糊匹配。

### 2) Provider 层接入（以 Dashscope 为例）

- 现状：`src/main/presenter/llmProviderPresenter/providers/dashscopeProvider.ts` 中硬编码 `ENABLE_THINKING_MODELS` 与 `ENABLE_SEARCH_MODELS`，并用 `includes` 判断。
- 方案：
  - 注入/获取 `modelCapabilities`，用 `supportsReasoning('dashscope', modelId)`、`supportsSearch('dashscope', modelId)` 判定。
  - 仍由各 Provider 负责把“能力”翻译为具体 API 参数（如 `enable_thinking`、`enable_search`、`forced_search`、`search_strategy` 等）。
  - 去掉硬编码名单与 substring 匹配逻辑。

伪代码片段：

```ts
const canReason = modelCapabilities.supportsReasoning(this.provider.id, modelId)
const canSearch = modelCapabilities.supportsSearch(this.provider.id, modelId)

if (canReason || canSearch) {
  const orig = this.openai.chat.completions.create.bind(this.openai.chat.completions)
  this.openai.chat.completions.create = ((params: any, options?: any) => {
    const modified = { ...params }
    if (canReason && modelConfig?.reasoning) {
      modified.enable_thinking = true
      const budget = modelCapabilities.getThinkingBudgetRange(this.provider.id, modelId)?.default
      if (modelConfig?.thinkingBudget ?? budget) {
        modified.thinking_budget = modelConfig?.thinkingBudget ?? budget
      }
    }
    if (canSearch && modelConfig?.enableSearch) {
      const defaults = modelCapabilities.getSearchDefaults(this.provider.id, modelId)
      modified.enable_search = true
      if (modelConfig?.forcedSearch ?? defaults?.forced) modified.forced_search = true
      if (modelConfig?.searchStrategy ?? defaults?.strategy) {
        modified.search_strategy = modelConfig?.searchStrategy ?? defaults!.strategy
      }
    }
    return orig(modified, options)
  }) as any
  try {
    const effective = { ...modelConfig, reasoning: false, enableSearch: false }
    yield* super.coreStream(messages, modelId, effective, temperature, maxTokens, mcpTools)
  } finally {
    this.openai.chat.completions.create = orig
  }
} else {
  yield* super.coreStream(messages, modelId, modelConfig, temperature, maxTokens, mcpTools)
}
```

> 注：以上逻辑仅展示“用能力判断替换硬编码名单”的方式；具体字段名与 Provider API 对齐已在现有 Provider 中实践，迁移时保持原有调用路径即可。

### 3) 渲染层（UI）接入

- 现状：`ChatConfig.vue`、`ModelConfigDialog.vue` 等包含 Dashscope/Gemini/Grok 的硬编码模型名单。
- 方案：
  - 显示默认值：继续通过 `configPresenter.getModelConfig(providerId, modelId)` 获取默认开关（已合并 Provider DB 的 default）。
  - 显示“是否支持”：新增 IPC 到 main，调用 `modelCapabilities` 的 `supportsReasoning/SupportsSearch`，决定是否展示相关配置项与提示。
  - 彻底移除 UI 侧名单/substring 匹配，避免 UI 与 Provider 判断不一致。

### 4) 聚合脚本与数据质量

- 聚合生成：`scripts/fetch-provider-db.mjs` 负责生成 `resources/model-db/providers.json`。
- 要求：
  - 各 Provider 模型在聚合结果中尽量补齐 `reasoning/search` 字段（至少 `supported`），有默认值/策略/预算时写入。
  - CI 校验：在构建环节对聚合结果跑 schema 校验（基于已有 `sanitizeAggregate`），失败时阻断。

## 迁移步骤

1) 新增 `modelCapabilities.ts`，实现与事件监听；写单测覆盖 reasoning/search 判定、默认值读取、大小写匹配、DB 缺失等场景。
2) Provider 侧替换：
   - Dashscope、Grok、Siliconcloud 等移除硬编码名单与 substring 判断，改为调用 `modelCapabilities`。
   - 保持参数注入与原有 API 调用节奏不变。
3) UI 侧替换：
   - 移除 `ChatConfig.vue`、`ModelConfigDialog.vue` 内硬编码名单与判断。
   - 通过 `getModelConfig` 显示默认值；通过新增 IPC 调 `modelCapabilities` 决定是否展示配置项。
4) 文档与开发者共识：
   - 把本方案作为“Provider 能力来源唯一规范”，今后新增 Provider/模型，不再在代码中硬编码名单。

## 注意事项与约束

- ID 规范：DB 中 providerId/modelId 必须小写，调用侧统一 `toLowerCase()` 再匹配；不做兼容匹配。
- 失败策略：DB 无记录即视为不支持，避免“看似支持但服务端报错”的不确定性。
- 性能：能力查询是内存 map 查找；可在 `modelCapabilities` 初始化/更新时预构建索引，查询 O(1)。
- 时序：`ConfigPresenter` 构造中已 `providerDbLoader.initialize()`；`modelCapabilities` 需在首次查询时容忍“DB 尚未加载完成”的情况（此时返回不支持或延迟读），并在 `UPDATED` 事件后刷新。

## 方案选择：集中式

- 集中式（本方案）：
  - 优点：单一事实源、复用、低重复、易测试、演进成本低。
  - 缺点：新增一个公共依赖，需要少量主线程 IPC 暴露给渲染层。

结论：选择集中式能力解析服务，结合 Provider DB 作为唯一事实源，更符合中大型项目的可维护性与一致性要求。

## 任务清单（建议执行顺序）

- 新增 `src/main/presenter/configPresenter/modelCapabilities.ts` 并接线事件。
- Provider 迁移：Dashscope → Grok → Siliconcloud（逐步替换硬编码名单）。
- UI 迁移：移除硬编码名单，改用 `getModelConfig` + 新增 IPC（supportsReasoning/supportsSearch）。
- 脚本与校验：完善 `scripts/fetch-provider-db.mjs` 输出与 schema 校验，确保数据质量。
- 单测：为 `modelCapabilities`、Provider 判定、UI 显示开关添加覆盖。

---

如需，我可以在后续 PR 中补充 `modelCapabilities.ts` 的具体实现骨架与示例单测用例，便于你直接套用与扩展。
