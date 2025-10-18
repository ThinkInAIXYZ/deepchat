# Vue 组件重构指南

## TL;DR
- 聚焦痛点：职责失控、性能瓶颈、难以测试或扩展。
- 先识别可抽象的行为，再决定是拆成 composable、子组件还是交由 store。
- 每个拆分单元保留清晰 API，隐藏 DOM 细节，必要时添加缓存与防抖以提升性能。
- 用成果校验：体量下降、性能改善、行为可测试、迭代成本降低。

## 概述

本指南总结了复杂 Vue 3 组件重构的通用模式与检查项，适用于 DeepChat 及其他 Vue 3 项目。数字示例（如行数、百分比）仅作参考，重点在于识别重构信号、选择合适的拆分方式，并兼顾可维护性和性能。

## 重构的主要目标

- **可维护性**：职责收敛、文件结构清晰、协作成本降低。
- **可测试性**：关键行为可以通过单元/组件测试验证，避免人工回归。
- **性能与鲁棒性**：移除重复计算、昂贵 DOM 查询、无防抖的监听等隐患；为滚动、截图等高频操作提供缓存或节流。
- **可扩展性**：新增功能时能够通过增加 composable 或子组件实现，而非在同一文件继续堆叠逻辑。

## 何时需要重构

**出现以下信号之一时，要评估是否重构**：
- 组件体量持续膨胀（常见阈值：≈400 行以上）或职责超过 4~5 个。
- 模板中掺杂复杂事件/业务逻辑、难以定位 bug。
- 频繁触发昂贵的 DOM 操作、滚动监听、轮询等性能热点。
- 依赖隐式状态（如手动管理 refs）导致测试困难或行为不稳定。

## 核心原则

### 1. 单一职责原则

**组件应该只负责**：
- 协调子组件
- 管理局部 UI 状态
- 处理模板渲染

**其他所有内容 → 提取**：
- 业务逻辑 → Store 方法
- 功能逻辑 → Composables
- UI 片段 → 子组件

### 2. Composable 提取模式

**何时考虑提取为 Composable**：
- 逻辑块接近 40~60 行，且后续仍会增长。
- 维护内部状态或需要生命周期钩子。
- 相同模式可能在其它组件复用，或未来具备复用潜力。
- 行为边界清晰，可对外暴露有限方法。

**标准 Composable 结构**：
```typescript
// 1. 导入 (类型、stores、工具)
// 2. 接口定义
// 3. Composable 函数
export function useFeatureName(dependencies: Deps) {
  // 4. 本地状态 (ref/reactive)
  // 5. 内部辅助函数
  // 6. 公共方法
  // 7. 生命周期钩子 (onMounted, onUnmounted)
  // 8. 返回 API (只读状态 + 方法)
}
```

### 3. 组件提取模式

**何时提取 UI 片段**：
- 40+ 行模板代码
- 复杂的条件渲染
- 可跨视图复用
- 功能自包含

### 4. 样式处理规范

**重构过程中的样式要求**：
- 优先使用 Tailwind CSS 工具类直接在模板中编写样式（inline 方式）
- 充分利用 Tailwind 的响应式、状态变体等功能（如 `hover:`, `dark:`, `md:` 等）
- 复杂或重复的样式组合可考虑提取为 Tailwind 的 `@apply` 指令
- 特殊场景（动画关键帧、复杂伪元素等）才使用传统 CSS

**基础写法**（优先使用）：
```vue
<div class="flex items-center gap-2 rounded-lg bg-gray-100 p-4 hover:bg-gray-200 dark:bg-gray-800">
  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">内容</span>
</div>
```

**复杂场景**（使用 @apply）：
```vue
<template>
  <div class="custom-card">
    <span class="card-title">内容</span>
  </div>
</template>

<style scoped>
.custom-card {
  @apply flex items-center gap-2 rounded-lg bg-gray-100 p-4;
  @apply hover:bg-gray-200 dark:bg-gray-800;
}

.card-title {
  @apply text-sm font-medium text-gray-700 dark:text-gray-300;
}
</style>
```

**优势**：样式可见性高、无命名负担、利用设计系统约束、方便主题适配

## 架构模式

### DOM 操作 → Composable

**适用场景**：复杂截图、拖拽、粘贴、键盘导航等依赖原生 DOM 的功能，且当前实现包含重复查询或缺少清理。

**重构前**：组件中散落的 DOM 查询
```typescript
// ComplexComponent.vue - DOM 操作分散在组件内
const findElement = () => document.querySelector(...)
const calculateBounds = () => { /* 复杂计算逻辑 */ }
const handleCapture = () => { /* 截图/导出逻辑 */ }
```

**重构后**：封装在专用 Composable 中
```typescript
// useElementCapture.ts - 集中管理 DOM 操作
export function useElementCapture() {
  // 所有 DOM 操作逻辑
  // 缓存策略
  // 卸载时清理
  return {
    capture,      // 执行捕获操作
    isCapturing,  // 捕获状态
    reset         // 重置缓存
  }
}
```

**关键要点**：
- 尽可能缓存 DOM 引用，避免重复 query。
- 在 `onUnmounted` 中清理缓存或解绑事件。
- 暴露最小化 API，隐藏实现细节，配合错误处理与超时保护。

### 滚动管理 → Composable

**适用场景**：长列表、消息流、滚动同步等需要控制滚动行为或统计滚动状态的组件。

**常见模式**：滚动逻辑 + IntersectionObserver + 自动滚动

**提取为**：`useScrollBehavior.ts` 或 `use[Feature]Scroll.ts`

**典型职责**：
- 滚动位置跟踪（防抖）
- IntersectionObserver 生命周期管理
- 滚动方法（scrollToTop, scrollToBottom, scrollToElement）
- 阈值检测（是否接近顶部/底部）
- 滚动状态（isScrolling, direction）

**性能提示**：将滚动更新防抖至 ~60fps (16ms)

### 对话框状态 → Composable

**适用场景**：组件内部弹窗、确认框、快捷浮层需要隔离状态时。

**简单对话框的最小模式**：
```typescript
export function useFeatureDialog() {
  const isOpen = ref(false)
  const open = () => { isOpen.value = true }
  const cancel = () => { isOpen.value = false }
  const confirm = async () => {
    // 业务逻辑
    isOpen.value = false
  }
  return { isOpen, open, cancel, confirm }
}
```

### 模板 Refs 管理 → Composable

**挑战**：管理动态列表的 refs

**解决方案**：使用 Map 模式
```typescript
export function useComponentRefs(items: Ref<Item[]>) {
  const refs = ref(new Map<number, any>())

  const setRef = (index: number) => (el: any) => {
    if (el) refs.value.set(index, el)
    else refs.value.delete(index)
  }

  return { setRef, getRefs: () => refs.value }
}
```

**优势**：类型安全、自动清理、清晰的 API

### 重复结构的配置化模式

**适用场景**：模板里出现 3 个以上结构相同但数据不同的代码块

**核心思想**：拆分结构与数据，用配置数组 + 循环渲染代替复制粘贴

**识别信号**：
- 改动只影响变量名、文案或绑定参数
- 新增同类功能靠复制整段模板
- 差异能用数据描述（字符串、数值、回调等）

**反模式示例**：
```vue
<template>
  <div class="field">
    <label>字段 A</label>
    <input v-model="fieldA" />
    <span>提示 A</span>
  </div>

  <div class="field">
    <label>字段 B</label>
    <input v-model="fieldB" />
    <span>提示 B</span>
  </div>
</template>
```

**配置化重构**：

步骤 1：找出不变结构与可变数据
- 不变：`div.field > label + input + span`
- 可变：标签文案、绑定的字段、提示信息

步骤 2：收敛状态与配置
```typescript
const form = reactive({
  fieldA: '',
  fieldB: ''
})

const fields = [
  { key: 'fieldA', label: '字段 A', hint: '提示 A' },
  { key: 'fieldB', label: '字段 B', hint: '提示 B' }
]
```

步骤 3：用循环渲染结构
```vue
<template>
  <div v-for="field in fields" :key="field.key" class="field">
    <label>{{ field.label }}</label>
    <input v-model="form[field.key]" />
    <span>{{ field.hint }}</span>
  </div>
</template>
```

**何时抽成子组件**：
- 区块超过 10 行或含复杂条件
- 需要跨页面复用
- 逻辑独立，单独测试更划算

**配置组织方式**：
- 简单场景：组件内直接声明数组
- 响应式依赖：用 `computed` 生成
- 多处使用：提取到 composable（如 `useFieldConfigs`）

**注意事项**：
- 特殊逻辑可保留单独处理
- 为配置对象声明类型，保障 IDE 提示
- 配置驱动不等于无脑统一，保留必要差异

**收益**：
- 模板体积可降 50%+
- 新增项只需补配置
- UI 结构统一，方便国际化、主题、批量校验

### 状态协调 → Composable

**适用场景**：需要协调多个 Store 或跨组件状态同步的复杂交互

**示例**：
```typescript
export function useFeatureCoordination(sharedState: Ref<State>) {
  const store1 = useStore1()
  const store2 = useStore2()

  const handleInteraction = () => {
    // 协调多个 stores
    // 维护功能特定状态
  }

  return { state, handleInteraction }
}
```

## 导入组织

**严格顺序**（使用分段注释）：
```typescript
// === Vue Core ===
import { ref, computed, onMounted } from 'vue'

// === Types ===
import type { Item, Config } from '@shared/types'

// === Components ===
import ChildComponent from './ChildComponent.vue'

// === Composables ===
import { useFeature } from '@/composables/useFeature'

// === Stores ===
import { useStore } from '@/stores/store'
```

## Script 组织

**标准分段**（使用分段注释）：
```typescript
// === Props & Emits ===
const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// === Stores ===
const store = useStore()

// === Composable Integrations ===
const feature1 = useFeature1()
const feature2 = useFeature2(feature1.sharedState)

// === Local State ===
const localRef = ref()

// === Computed ===
const computedValue = computed(() => {})

// === Event Handlers ===
const handleEvent = () => {}

// === Lifecycle Hooks ===
onMounted(() => {})

// === Expose ===
defineExpose({ publicMethod })
```

## 性能模式

### 防抖更新

**适用场景**：
- 滚动事件 (16ms / ~60fps)
- 窗口大小调整处理器 (100ms)
- 输入监听器 (300ms)

```typescript
import { useDebounceFn } from '@vueuse/core'

const update = useDebounceFn(() => {
  // 昂贵操作
}, 16)
```

### Watcher 优化

**添加选项**：
```typescript
watch(source, handler, {
  flush: 'post',  // DOM 更新后执行
  deep: false     // 尽量避免深度监听
})
```

**对于高度变化**：对处理函数防抖，而非 watcher 本身

### DOM 查询缓存

```typescript
let cache: Element | null = null

const getElement = () => {
  if (!cache) {
    cache = document.querySelector('.selector')
  }
  return cache
}

onUnmounted(() => { cache = null })
```

## 类型安全

### 只读导出

**防止外部修改**：
```typescript
const state = reactive({ count: 0 })

return {
  state: readonly(state),  // 只读引用
  increment: () => state.count++
}
```

### 类型化依赖

**将共享状态作为类型化参数传递**：
```typescript
export function useFeature(
  sharedState: DeepReadonly<SharedState>
) {
  // 安全使用 sharedState
}
```

## 测试策略

### Composable 测试（高优先级）

- Mock stores 和外部依赖
- 测试状态转换
- 测试错误处理
- 测试清理 (onUnmounted)

### 组件测试（集成）

- 测试 composable 协调
- 测试事件处理
- 测试计算属性
- 验证模板渲染

## 常见陷阱

### ❌ 避免

1. **过度提取**：不要为了"分层"而将 20 多行的简单逻辑强行拆成 composable
2. **紧耦合**：Composables 不应依赖特定组件结构
3. **共享可变状态**：对共享响应式状态使用 readonly()
4. **缺少清理**：始终在 onUnmounted 中清理
5. **性能倒退**：对滚动/调整大小处理器进行前后测量
6. **UI 细节丢失**：重构时丢失原有的提示文本、验证信息、辅助说明等 UI 元素
7. **过度统一**：为了使用配置化模式而牺牲特殊字段的合理需求

### ✅ 应该做

1. **清晰边界**：每个 composable = 一个功能
2. **最小化 API**：只返回必要的内容
3. **类型安全**：严格类型，避免 `any`
4. **文档化复杂逻辑**：为非显而易见的行为添加 JSDoc
5. **测试 composables**：它们比完整组件更容易测试
6. **重构前对比检查**：使用 `git diff` 仔细检查所有 UI 变化，确保不丢失原有功能
7. **渐进式抽象**：先重构主流程，复杂的特殊情况可以保留直接处理

## 重构活动建议

请根据组件复杂度和时间窗口自行组合以下活动；无需线性完成，也不必全部执行。

### 了解现状
- 列出组件承担的职责与痛点（维护困难、性能热点、缺考测试等）。
- 标注潜在拆分点：状态管理、DOM 操作、复杂事件、可独立的 UI 片段。
- 收集性能线索：滚动掉帧、重复渲染、昂贵查询。

### 拆分与迁移
- 为每个痛点选择合适的落地形式（composable / 子组件 / store 方法）。
- 分批迁移代码，每次迁移后执行局部测试，确保行为不变。
- 迁移过程中同时补充缓存、防抖或错误处理，避免遗留性能隐患。

### 整理与优化
- 统一导入顺序与脚本结构（Core / Types / Components / Composables / Stores）。
- 清理废弃样式和无用 watch，替换成更轻量的事件或侦听器。
- 对滚动、捕获、轮询等高频操作做性能自检（例如记录渲染耗时、观察帧率）。

### 校验与交付
- 编写或更新针对关键 composable 的单元测试，覆盖主要分支和错误路径。
- 运行 lint / typecheck / 关键手动用例，确认无回归。
- 更新文档与 commit message，记录主要拆分点与性能收益。

## 成功指标

**量化指标**：
- 组件大小：-40% 到 -60%
- 职责数：主组件 ≤3 个
- 创建的 Composables：3-5 个
- 测试覆盖率：composables >60%
- 性能指标：滚动掉帧明显减少、DOM 查询次数下降或关键交互耗时收敛。

**质化指标**：
- 易于找到特定逻辑
- 清晰的关注点分离
- 可测试单元
- 提取的可复用逻辑

## 项目特定说明

### EventBus 集成

提取 presenter 交互时：
```typescript
// 保留在 composable 中
const presenter = usePresenter('featurePresenter')
```

### Store 访问

Composables 可以直接使用 stores：
```typescript
export function useFeature() {
  const store = useFeatureStore()
  // 使用 store 方法/状态
}
```

### Composables 中的 i18n

```typescript
export function useFeature() {
  const { t } = useI18n()
  // 使用 t() 进行翻译
}
```

## 重构目标示例

**寻找具有以下特征的组件**：
- 多个滚动处理器
- 截图/导出逻辑
- 复杂表单验证
- 状态机
- 重试/轮询逻辑
- 多步骤工作流
- 大量 DOM 操作

**典型提取模式**（用实际功能名替换 `[Feature]`）：
- `use[Feature]Scroll` - 滚动管理（如 `useMessageListScroll`, `useDataTableScroll`）
- `use[Feature]Capture` - 导出/截图（如 `useScreenCapture`, `useChartExport`）
- `use[Feature]State` - 复杂状态机（如 `useWorkflowState`, `useFormState`）
- `use[Feature]Validation` - 表单验证（如 `useFormValidation`, `useInputValidation`）
- `use[Feature]Polling` - 异步操作（如 `useDataPolling`, `useStatusPolling`）
- `use[Feature]Interaction` - 交互逻辑（如 `useDragAndDrop`, `useKeyboardNav`）

## 快速检查清单

在提交重构前，确认以下要点：
- [ ] 已识别并拆分主要职责，主组件仅保留协调与渲染逻辑。
- [ ] 关键行为（滚动、截图、重试等）有独立 composable，并包含缓存/防抖或必要的错误处理。
- [ ] 新增或更新了相应测试，至少涵盖主要分支和失败路径。
- [ ] 手动验证过性能或交互改动（如滚动是否顺滑、按钮动画是否正常）。
- [ ] 文档与代码注释同步更新，说明新 API 与约束。

## 结论

本指南提供了经过实战检验的组件重构模式。渐进式应用这些原则——并非所有组件都需要激进的重构。专注于痛点：难以维护的代码、不可测试的逻辑和性能瓶颈。

**记住**：目标是可维护性，而非完美。每次重构都应该让代码库变得更好。
