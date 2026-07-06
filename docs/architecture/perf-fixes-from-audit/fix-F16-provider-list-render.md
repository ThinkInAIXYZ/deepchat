# 修复 F16：Provider 列表首屏渲染收敛

## 目标
- 降低 Settings provider 页首次进入时的同步挂载成本，优先解决 disabled provider 区块一次性渲染全部行的问题。
- 保留现有 provider 排序与图标匹配语义，不在本轮修复中扩大交互或匹配规则变更范围。
- 主方案仅覆盖 disabled 区折叠与 `ModelIcon` 的 `iconKey` 命中优化；enabled 区保持现状，避免把风险扩散到主列表排序交互。

## 定位
- enabled provider 区当前始终渲染 `draggable` 列表，列表起点位于 [src/renderer/settings/components/ModelProviderSettings.vue#L61](../../../src/renderer/settings/components/ModelProviderSettings.vue#L61)。
- disabled provider 区同样始终渲染 `draggable` 列表，列表起点位于 [src/renderer/settings/components/ModelProviderSettings.vue#L124](../../../src/renderer/settings/components/ModelProviderSettings.vue#L124)。这意味着首次进入页面时，enabled + disabled 两块都会立即挂载完整 provider 行。
- provider 列表当前通过 `allEnabledProviders` / `allDisabledProviders` 分组，再由 `enabledProviders` / `disabledProviders` 结合搜索结果生成展示列表，相关分组逻辑位于 [src/renderer/settings/components/ModelProviderSettings.vue#L650](../../../src/renderer/settings/components/ModelProviderSettings.vue#L650)。
- `ModelIcon` 的 `iconKey` 仍是模糊子串匹配：先取 `modelIcons` 的声明顺序 key，再执行 `modelIdLower.includes(key)`，未命中时再对 `apiType.includes(key)` 做第二轮扫描。这不是精确 `Map.get` 语义，像 `gpt-4 -> gpt`、`claude-3 -> claude` 依赖的正是 `includes`。
- `ProviderModelList` 已在模型明细区使用 `RecycleScroller`，见 [src/renderer/settings/components/ProviderModelList.vue#L206](../../../src/renderer/settings/components/ProviderModelList.vue#L206) 与导入位置 [src/renderer/settings/components/ProviderModelList.vue#L326](../../../src/renderer/settings/components/ProviderModelList.vue#L326)。这说明仓库已有虚拟列表实践，但 provider 总览页当前问题更集中在“首屏无条件全量挂载 disabled 列表”，不必默认把 enabled 区或整页都改成虚拟滚动。

## 修复方案

### 主方案 A：disabled 区默认折叠
- 增加 `isDisabledProvidersExpanded` 状态，默认 `false`。
- 首屏仅渲染 disabled 区标题、数量、展开按钮；只有用户主动展开时才挂载 disabled provider 行。
- 搜索命中 disabled provider 时允许自动展开，避免“有结果但不可见”。
- enabled 区本轮不改，继续沿用现有 `draggable` 与点击/路由高亮行为，降低回归面。

这个方案直接针对 F16 的首屏挂载热点，且不影响 enabled provider 的既有排序入口与交互心智。

### 主方案 B：保留 `includes` 语义的 `iconKey` 优化
- 撤回“改成精确 `Map.get(modelIdLower)`”的说法；当前代码依赖模糊匹配，不能直接换成精确键查找。
- 可采用两类低风险优化：
  1. 预建候选 key 数组并保留 `modelIcons` 声明顺序，继续使用 `includes`，但避免每次计算都重新 `Object.keys(modelIcons)`；
  2. 对 `modelId/apiType -> iconKey` 命中结果做缓存，减少重复渲染时的全量候选扫描。
- 不按 key 长度重排候选；当前匹配语义是声明顺序的 first-match，优化不能改变这个优先级。

示意：
```ts
const ICON_CANDIDATE_KEYS = Object.keys(modelIcons) as ModelIconKey[]

const iconMatchCache = new Map<string, string>()

function resolveIconKey(source: string | undefined): string | undefined {
  if (!source) return undefined
  const normalized = source.toLowerCase()
  const cached = iconMatchCache.get(normalized)
  if (cached) return cached

  const matched = ICON_CANDIDATE_KEYS.find((key) => normalized.includes(key))
  if (matched) {
    iconMatchCache.set(normalized, matched)
  }
  return matched
}
```

这里仍然是 `includes` 语义，只是把候选集构建与命中缓存前移，避免每次 computed 都重新扫描原始 key 列表。

### 可选后续：enabled 区拖拽按需启用
- 这项不纳入主方案。
- 若后续审计表明 enabled 区 `draggable` 仍是明显热点，可再单独评估“默认 readonly、编辑态才挂载 draggable”。
- 该改动会影响排序入口可发现性与交互习惯，风险显著高于 disabled 区折叠，因此应作为后续优化项，而不是本次修复内容。

## 步骤拆分
- 本轮只修改 provider 总览页首屏渲染路径，不改 provider 模型明细区的 `RecycleScroller` 策略。
- 本轮不把 enabled provider 区改成折叠，也不改成“仅编辑态可拖拽”。
- 本轮不改变 provider 排序持久化协议，不调整 `enabledProviders` / `disabledProviders` setter 的重排规则。
- 本轮不改变 `iconKey` 的模糊匹配语义，只优化候选构建与重复命中成本。

## 验证
- 性能验证：对比 `18-provider-readonly-route` 的进入耗时，确认 disabled 区折叠后首屏挂载时间下降。
- 交互回归：
  - disabled 区默认折叠、手动展开、搜索命中自动展开行为正确；
  - 展开后 provider 行点击切换正常，路由高亮状态仍与 `route.params.providerId` 一致；
  - enabled 区现有点击、开关切换、拖拽排序行为保持不变。
- 排序相关回归：
  - 拖拽排序后的顺序可正确持久化；
  - 搜索过滤条件下拖拽排序后，`enabledProviders` / `disabledProviders` setter 仍按现有规则合并回全量列表；
  - 展开 disabled 区后执行拖拽、点击切换，再次进入页面时顺序与选中态正常。
- 图标回归：覆盖 `gpt-*`、`claude-*`、`gemini-*`、自定义 provider `apiType` 等常见命中路径，确认优化前后图标结果一致。
- 基础检查：文档修订无需运行应用代码；若后续落实代码修复，再执行仓库要求的 `pnpm run format`、`pnpm run i18n`、`pnpm run lint`。

## 风险
- icon 匹配顺序回归风险：即使仍使用 `includes`，一旦候选遍历顺序变化，就可能改变优先命中结果，导致个别 provider 图标切换。
- disabled 区折叠会改变默认信息密度；若计数、展开文案或搜索自动展开提示不清晰，用户可能误以为 provider 丢失。
- 若未来引入“编辑态才可拖拽”的 enabled 区优化，存在明显的可发现性风险：用户可能找不到排序入口，需额外的按钮、提示文案或引导设计支撑。
- 搜索过滤下的排序与折叠状态叠加后，若状态同步处理不严谨，容易出现顺序持久化异常或展开态与结果不一致的问题。
