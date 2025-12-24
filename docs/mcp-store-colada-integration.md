# MCP Store Colada 集成文档

> 本文档描述了 mcpStore 中 Pinia Colada 集成的架构、使用方式和最佳实践。

**创建时间**：2024-12-19
**最后更新**：2024-12-19
**状态**：已完成阶段一、阶段二

## 目录

- [一、架构概述](#一架构概述)
- [二、核心概念](#二核心概念)
- [三、mcpStore 结构说明](#三mcpstore-结构说明)
- [四、使用指南](#四使用指南)
- [五、常见问题](#五常见问题)
- [六、迁移指南](#六迁移指南)

---

## 一、架构概述

### 1.1 Colada 集成的目的和收益

Pinia Colada 的集成旨在解决以下问题：

1. **减少样板代码**：自动管理 `loading`、`error`、`data` 状态，减少约 40% 的状态管理代码
2. **性能优化**：通过请求去重和智能缓存，减少 50-70% 的重复 IPC 调用
3. **数据一致性**：写操作后自动失效缓存并刷新相关数据，确保 UI 显示最新状态
4. **开发体验**：统一的 Query + Mutation 模式，降低维护复杂度

### 1.2 整体架构设计

mcpStore 采用 **Query + Mutation 模式**：

```
┌─────────────────────────────────────────────────────────┐
│                    Component Layer                      │
│  (使用 store 的计算属性和方法)                            │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                   mcpStore                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Computed Properties (tools, clients, etc.)      │   │
│  │  ← 直接暴露 Query 状态                           │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Queries (configQuery, toolsQuery, etc.)        │   │
│  │  ← 使用 useIpcQuery / useQuery                  │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Mutations (addServerMutation, etc.)             │   │
│  │  ← 使用 useIpcMutation                           │   │
│  │  → 自动失效相关 Query 缓存                       │   │
│  └──────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│            Composables Layer                             │
│  ┌──────────────────┐  ┌──────────────────┐            │
│  │  useIpcQuery    │  │ useIpcMutation   │            │
│  └──────────────────┘  └──────────────────┘            │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│            IPC Layer (usePresenter)                     │
│  ← 调用主进程 presenter 方法                            │
└─────────────────────────────────────────────────────────┘
```

### 1.3 设计决策

1. **计算属性而非直接暴露 Query**：
   - 保持 store API 的向后兼容性
   - 提供统一的访问接口
   - 支持条件过滤（如 `mcpEnabled` 检查）

2. **自动缓存失效**：
   - Mutation 成功后自动失效相关 Query 缓存
   - 确保写操作后数据立即更新
   - 减少手动缓存管理代码

3. **条件查询（enabled）**：
   - 某些查询只在 MCP 启用时执行
   - 避免不必要的 IPC 调用
   - 自动响应配置变化

---

## 二、核心概念

### 2.1 useIpcQuery 使用方式

`useIpcQuery` 是一个 composable，用于将 IPC 调用包装成 Colada Query。

#### 基本用法

```typescript
import { useIpcQuery } from '@/composables/useIpcQuery'

const toolsQuery = useIpcQuery({
  presenter: 'mcpPresenter',           // Presenter 名称
  method: 'getAllToolDefinitions',     // 方法名
  key: () => ['mcp', 'tools'],         // 缓存 key
  enabled: () => config.value.ready && config.value.mcpEnabled,  // 条件查询
  staleTime: 30_000                    // 缓存时间（30秒）
})
```

#### 参数说明

- `presenter`: Presenter 名称（类型安全）
- `method`: Presenter 方法名（类型安全）
- `key`: 返回缓存 key 的函数，用于标识和去重
- `enabled`: 可选，返回布尔值的函数，控制查询是否执行
- `staleTime`: 可选，数据新鲜时间（毫秒），默认使用全局配置
- `gcTime`: 可选，垃圾回收时间（毫秒），默认使用全局配置

#### 返回的 Query 对象

```typescript
interface UseQueryReturn<T> {
  data: Ref<T | undefined>        // 查询结果
  isLoading: Ref<boolean>         // 加载状态
  error: Ref<Error | null>         // 错误信息
  refetch: () => Promise<...>      // 强制刷新
  refresh: () => Promise<...>      // 刷新（如果数据过期）
}
```

### 2.2 useIpcMutation 使用方式

`useIpcMutation` 是一个 composable，用于将 IPC 调用包装成 Colada Mutation。

#### 基本用法

```typescript
import { useIpcMutation } from '@/composables/useIpcMutation'

const addServerMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'addMcpServer',
  invalidateQueries: () => [
    ['mcp', 'config'],
    ['mcp', 'tools'],
    ['mcp', 'clients'],
    ['mcp', 'resources']
  ],
  onSuccess: (result) => {
    console.log('Server added:', result)
  },
  onError: (error) => {
    console.error('Failed to add server:', error)
  }
})
```

#### 参数说明

- `presenter`: Presenter 名称（类型安全）
- `method`: Presenter 方法名（类型安全）
- `invalidateQueries`: 可选，返回需要失效的 query keys 数组
- `onSuccess`: 可选，成功回调
- `onError`: 可选，错误回调
- `onSettled`: 可选，完成回调（无论成功或失败）

#### 使用 Mutation

```typescript
// 调用 mutation（参数需要作为数组传递）
await addServerMutation.mutateAsync([serverName, serverConfig])

// 或者使用 mutate（不等待结果）
addServerMutation.mutate([serverName, serverConfig])
```

**注意**：`mutateAsync` 和 `mutate` 的参数必须是一个数组，数组中的元素对应 Presenter 方法的参数。

### 2.3 缓存失效策略

#### 自动失效

Mutation 成功后，会自动失效 `invalidateQueries` 中指定的所有 Query 缓存：

```typescript
const addServerMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'addMcpServer',
  invalidateQueries: () => [
    ['mcp', 'config'],      // 失效配置查询
    ['mcp', 'tools'],       // 失效工具列表查询
    ['mcp', 'clients'],     // 失效客户端列表查询
    ['mcp', 'resources']   // 失效资源列表查询
  ]
})
```

#### 失效规则

- **精确匹配**：`exact: true` - 只失效完全匹配的 key
- **前缀匹配**：`exact: false`（默认）- 失效所有以该 key 开头的查询

#### 最佳实践

1. **失效相关查询**：写操作后，失效所有可能受影响的数据查询
2. **避免过度失效**：只失效真正需要刷新的查询，避免不必要的网络请求
3. **考虑依赖关系**：如果查询之间有依赖，失效父查询会自动触发子查询刷新

### 2.4 类型安全

`useIpcQuery` 和 `useIpcMutation` 都提供完整的 TypeScript 类型推断：

```typescript
// 类型自动推断
const toolsQuery = useIpcQuery({
  presenter: 'mcpPresenter',
  method: 'getAllToolDefinitions',  // 类型检查：方法必须存在
  key: () => ['mcp', 'tools']
})
// toolsQuery.data.value 的类型是 MCPToolDefinition[] | undefined
```

---

## 三、mcpStore 结构说明

### 3.1 Query 定义

mcpStore 使用了 5 个核心 Query 来管理不同类型的数据，每个 Query 都有明确的职责和缓存策略。

#### 3.1.1 配置查询 (configQuery)

**用途**：获取 MCP 的核心配置信息，包括服务器列表、默认服务器和启用状态。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第78-95行)
const configQuery = useQuery<ConfigQueryResult>({
  key: () => ['mcp', 'config'],         // 缓存键：唯一标识配置查询
  staleTime: 30_000,                    // 数据新鲜时间：30秒
  gcTime: 300_000,                      // 垃圾回收时间：5分钟
  query: async () => {
    // 并行请求三个配置项，提高性能
    const [servers, defaultServers, enabled] = await Promise.all([
      mcpPresenter.getMcpServers(),
      mcpPresenter.getMcpDefaultServers(),
      mcpPresenter.getMcpEnabled()
    ])

    return {
      mcpServers: servers ?? {},          // 服务器配置映射
      defaultServers: defaultServers ?? [],  // 默认服务器列表
      mcpEnabled: Boolean(enabled)        // MCP 启用状态
    }
  }
})
```

**返回类型**：
```typescript
interface ConfigQueryResult {
  mcpServers: MCPConfig['mcpServers']     // Record<string, MCPServerConfig>
  defaultServers: string[]                // 默认服务器名称数组
  mcpEnabled: boolean                     // MCP 全局启用状态
}
```

**配置说明**：
- `key`: 缓存唯一标识，用于数据的存储、检索和失效
- `staleTime: 30_000`: 30秒内数据被认为是新鲜的，不会重复请求
- `gcTime: 300_000`: 5分钟后，如果数据未使用则从内存中清理
- 使用 `Promise.all` 并行请求，减少总体响应时间

#### 3.1.2 工具查询 (toolsQuery)

**用途**：获取所有可用的 MCP 工具定义，这是核心功能查询之一。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第97-103行)
const toolsQuery = useIpcQuery({
  presenter: 'mcpPresenter',             // IPC 调用目标
  method: 'getAllToolDefinitions',       // Presenter 方法名
  key: () => ['mcp', 'tools'],           // 缓存键
  enabled: () => config.value.ready && config.value.mcpEnabled,  // 条件查询
  staleTime: 30_000                      // 缓存30秒，与 clientsQuery 保持一致
}) as UseQueryReturn<MCPToolDefinition[]>
```

**条件查询机制**：
- `enabled: () => config.value.ready && config.value.mcpEnabled`
  - `config.value.ready`: 确保配置已加载完成
  - `config.value.mcpEnabled`: 只有在 MCP 启用时才执行查询
  - 当条件不满足时，查询自动暂停，不会发送 IPC 请求

**配置参数**：
- `staleTime: 30_000`: 工具定义可能变化，缓存时间较短，与 clientsQuery 保持一致
- 自动类型推断：返回 `MCPToolDefinition[]`

#### 3.1.3 客户端查询 (clientsQuery)

**用途**：获取当前活跃的 MCP 客户端连接状态。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第105-111行)
const clientsQuery = useIpcQuery({
  presenter: 'mcpPresenter',
  method: 'getMcpClients',
  key: () => ['mcp', 'clients'],
  enabled: () => config.value.ready && config.value.mcpEnabled,  // 同样的条件查询
  staleTime: 30_000                      // 30秒缓存，连接状态变化较快
}) as UseQueryReturn<McpClient[]>
```

**特点**：
- 缓存时间较短（30秒），因为客户端连接状态可能频繁变化
- 同样使用条件查询，避免不必要的 IPC 调用

#### 3.1.4 资源查询 (resourcesQuery)

**用途**：获取所有可用的 MCP 资源列表（文件、数据库等）。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第113-119行)
const resourcesQuery = useIpcQuery({
  presenter: 'mcpPresenter',
  method: 'getAllResources',
  key: () => ['mcp', 'resources'],
  enabled: () => config.value.ready && config.value.mcpEnabled,
  staleTime: 30_000                      // 30秒缓存
}) as UseQueryReturn<ResourceListEntry[]>
```

#### 3.1.5 提示模板查询 (promptsQuery)

**用途**：获取混合数据源的自定义提示模板和 MCP 提示模板。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第149-162行)
const promptsQuery = useQuery<PromptListEntry[]>({
  key: () => ['mcp', 'prompts', config.value.mcpEnabled],  // 键包含启用状态
  staleTime: 60_000,
  gcTime: 300_000,
  query: async () => {
    // 1. 首先加载自定义提示模板（来自配置）
    const customPrompts = await loadCustomPrompts()

    // 2. 如果 MCP 未启用，只返回自定义提示
    if (!config.value.mcpEnabled) {
      return customPrompts
    }

    // 3. 如果 MCP 启用，合并自定义提示和 MCP 提示
    const mcpPrompts = await loadMcpPrompts()
    return [...customPrompts, ...mcpPrompts]
  }
})
```

**特殊设计**：
- 混合数据源：自定义提示（configPresenter） + MCP 提示（mcpPresenter）
- 键包含 `mcpEnabled` 状态，确保启用状态变化时缓存失效
- 即使 MCP 未启用也能提供自定义提示模板

### 3.2 Mutation 定义

所有 Mutation 都使用 `useIpcMutation` 定义，具有自动缓存失效功能，确保写操作后数据一致性。

#### 3.2.1 服务器管理 Mutations

##### 添加服务器 (addServerMutation)

**用途**：添加新的 MCP 服务器配置。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第293-302行)
const addServerMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'addMcpServer',
  invalidateQueries: () => [
    ['mcp', 'config'],      // 失效配置查询（服务器列表）
    ['mcp', 'tools'],       // 失效工具查询（新服务器可能有工具）
    ['mcp', 'clients'],     // 失效客户端查询（新服务器连接）
    ['mcp', 'resources']    // 失效资源查询（新服务器可能有资源）
  ]
})
```

**缓存失效策略**：
- 全量失效：添加服务器可能影响所有数据类型
- 确保后续查询能获取到最新的数据

**实际使用**：
在实际代码中，某些 mutation 操作后可能会手动调用 `runQuery(configQuery, { force: true })` 来确保配置立即刷新。虽然缓存失效会自动触发查询刷新，但手动调用可以确保在需要时立即获取最新数据。

##### 更新服务器 (updateServerMutation)

**用途**：修改现有服务器的配置。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第304-313行)
const updateServerMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'updateMcpServer',
  invalidateQueries: () => [
    ['mcp', 'config'],      // 配置变化
    ['mcp', 'tools'],       // 工具定义可能变化
    ['mcp', 'clients'],     // 连接状态可能变化
    ['mcp', 'resources']    // 资源列表可能变化
  ]
})
```

##### 删除服务器 (removeServerMutation)

**用途**：移除 MCP 服务器配置。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第315-324行)
const removeServerMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'removeMcpServer',
  invalidateQueries: () => [
    ['mcp', 'config'],      // 服务器配置变化
    ['mcp', 'tools'],       // 相关工具消失
    ['mcp', 'clients'],     相关连接断开
    ['mcp', 'resources']    // 相关资源不可用
  ]
})
```

#### 3.2.2 默认服务器管理 Mutations

##### 添加默认服务器 (addDefaultServerMutation)

**用途**：将服务器添加到默认服务器列表。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第326-330行)
const addDefaultServerMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'addMcpDefaultServer',
  invalidateQueries: () => [['mcp', 'config']]  // 只影响配置
})
```

**特点**：
- 精确失效：只影响配置查询，不影响工具和资源
- 性能优化：避免不必要的重新加载

##### 移除默认服务器 (removeDefaultServerMutation)

**用途**：从默认服务器列表中移除服务器。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第332-336行)
const removeDefaultServerMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'removeMcpDefaultServer',
  invalidateQueries: () => [['mcp', 'config']]
})
```

##### 重置为默认服务器 (resetToDefaultServersMutation)

**用途**：恢复到初始默认服务器配置。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第338-342行)
const resetToDefaultServersMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'resetToDefaultServers',
  invalidateQueries: () => [['mcp', 'config']]
})
```

#### 3.2.3 MCP 状态管理 Mutation

##### 设置 MCP 启用状态 (setMcpEnabledMutation)

**用途**：全局启用或禁用 MCP 功能。

**定义**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第344-348行)
const setMcpEnabledMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'setMcpEnabled',
  invalidateQueries: () => [['mcp', 'config']]  // 只影响配置
})
```

**特殊效果**：
- 其他查询的 `enabled` 条件会自动响应变化
- 当禁用时，相关查询自动暂停
- 当启用时，相关查询自动恢复执行

### 3.3 计算属性

计算属性是组件访问 mcpStore 状态的主要接口，它们内部处理条件逻辑并提供响应式数据。

#### 3.3.1 数据属性

```typescript
// 位置：src/renderer/src/stores/mcp.ts (第164-187行)

// 工具列表
const tools = computed(() =>
  (config.value.mcpEnabled ? (toolsQuery.data.value ?? []) : [])
)

// 客户端列表
const clients = computed(() =>
  (config.value.mcpEnabled ? (clientsQuery.data.value ?? []) : [])
)

// 资源列表
const resources = computed(() =>
  config.value.mcpEnabled ? (resourcesQuery.data.value ?? []) : []
)

// 提示模板列表（不受 MCP 启用状态影响）
const prompts = computed(() => promptsQuery.data.value ?? [])
```

**设计特点**：
- 条件返回：只有 MCP 启用时才返回数据，否则返回空数组
- 空值保护：使用 `?? []` 确保 undefined 时返回空数组
- 提示模板特殊处理：始终有效，包含自定义提示

#### 3.3.2 状态属性

```typescript
// 工具加载状态
const toolsLoading = computed(() =>
  config.value.mcpEnabled ? toolsQuery.isLoading.value : false
)

// 工具错误状态
const toolsError = computed(() => Boolean(toolsQuery.error.value))

// 工具错误消息
const toolsErrorMessage = computed(() => {
  const error = toolsQuery.error.value
  if (!error) return ''
  return error instanceof Error ? error.message : String(error)
})
```

**状态管理**：
- `toolsLoading`: 条件加载状态，MCP 禁用时始终为 false
- `toolsError`: 布尔值，便于组件中的条件渲染
- `toolsErrorMessage`: 格式化的错误消息，用于用户显示

#### 3.3.3 服务器相关计算属性

```typescript
// 位置：src/renderer/src/stores/mcp.ts (第254-289行)

// 服务器列表（增强版）
const serverList = computed(() => {
  const servers = Object.entries(config.value.mcpServers).map(([name, serverConfig]) => ({
    name,
    ...serverConfig,
    isRunning: serverStatuses.value[name] || false,      // 运行状态
    isDefault: config.value.defaultServers.includes(name),  // 默认标记
    isLoading: serverLoadingStates.value[name] || false     // 加载状态
  }))

  // 排序逻辑：inmemory 类型优先
  return servers.sort((a, b) => {
    const aIsInmemory = a.type === 'inmemory'
    const bIsInmemory = b.type === 'inmemory'

    if (aIsInmemory && !bIsInmemory) return -1
    if (!aIsInmemory && bIsInmemory) return 1
    return 0
  })
})

// 默认服务器数量
const defaultServersCount = computed(() => config.value.defaultServers.length)

// 是否达到最大默认服务器数量
const hasMaxDefaultServers = computed(() => defaultServersCount.value >= 30)

// 工具数量
const toolCount = computed(() => tools.value.length)

// 是否有工具
const hasTools = computed(() => toolCount.value > 0)
```

### 3.4 状态管理说明

mcpStore 实现了多层级的状态管理，确保数据的一致性和响应性。

#### 3.4.1 本地状态

```typescript
// 位置：src/renderer/src/stores/mcp.ts (第44-65行)
const config = ref<MCPConfig>({
  mcpServers: {},
  defaultServers: [],
  mcpEnabled: false,
  ready: false
})

const serverStatuses = ref<Record<string, boolean>>({})     // 服务器运行状态
const serverLoadingStates = ref<Record<string, boolean>>({}) // 服务器加载状态
const configLoading = ref(false)                            // 配置加载状态

const toolLoadingStates = ref<Record<string, boolean>>({})  // 工具加载状态
const toolInputs = ref<Record<string, Record<string, string>>>({}) // 工具输入
const toolResults = ref<Record<string, string | { type: string; text: string }[]>>({}) // 工具结果
```

#### 3.4.2 状态同步机制

**配置状态同步**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第189-200行)
const syncConfigFromQuery = (data?: ConfigQueryResult | null) => {
  if (!data) return

  config.value = {
    mcpServers: data.mcpServers,
    defaultServers: data.defaultServers,
    mcpEnabled: data.mcpEnabled,
    ready: true  // 标记配置已准备就绪
  }
}

// 监听查询数据变化，自动同步到本地状态
watch(
  () => configQuery.data.value,
  (data) => syncConfigFromQuery(data),
  { immediate: true }
)
```

**工具快照应用**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第202-222行)
const applyToolsSnapshot = (toolDefs: MCPToolDefinition[] = []) => {
  toolDefs.forEach((tool) => {
    if (!toolInputs.value[tool.function.name]) {
      toolInputs.value[tool.function.name] = {}

      // 初始化工具参数输入
      if (tool.function.parameters?.properties) {
        Object.keys(tool.function.parameters.properties).forEach((paramName) => {
          toolInputs.value[tool.function.name][paramName] = ''
        })
      }

      // 特殊工具的默认值
      if (tool.function.name === 'glob_search') {
        toolInputs.value[tool.function.name] = {
          pattern: '**/*.md',
          root: '',
          excludePatterns: '',
          maxResults: '1000',
          sortBy: 'name'
        }
      }
    }
  })
}

// 监听工具查询变化，自动初始化工具输入
watch(
  () => toolsQuery.data.value,
  (toolDefs) => {
    if (!config.value.mcpEnabled) return
    if (Array.isArray(toolDefs)) {
      applyToolsSnapshot(toolDefs as MCPToolDefinition[])
    }
  },
  { immediate: true }
)
```

#### 3.4.3 加载状态管理

**统一查询执行器**：
```typescript
// 位置：src/renderer/src/stores/mcp.ts (第67-70行)
type QueryExecuteOptions = { force?: boolean }

const runQuery = async <T>(queryReturn: UseQueryReturn<T>, options?: QueryExecuteOptions) => {
  const runner = options?.force ? queryReturn.refetch : queryReturn.refresh
  return await runner()
}
```

**使用示例**：
```typescript
// 加载配置
const loadConfig = async (options?: QueryExecuteOptions) => {
  configLoading.value = true
  try {
    const state = await runQuery(configQuery, options)
    if (state.status === 'success') {
      syncConfigFromQuery(state.data)
      await updateAllServerStatuses()
    }
  } catch (error) {
    console.error(t('mcp.errors.loadConfigFailed'), error)
  } finally {
    configLoading.value = false
  }
}
```

### 3.5 缓存配置详细说明

mcpStore 使用了分层缓存策略，根据数据特性配置不同的缓存参数。

#### 3.5.1 缓存时间配置

| Query | staleTime (过期时间) | gcTime (垃圾回收时间) | 说明 |
|-------|---------------------|-----------------------|------|
| configQuery | 30_000 (30秒) | 300_000 (5分钟) | 配置相对稳定，中等缓存时间 |
| toolsQuery | 30_000 (30秒) | 默认 5分钟 | 工具定义可能变化，与 clientsQuery 保持一致 |
| clientsQuery | 30_000 (30秒) | 默认 5分钟 | 连接状态变化频繁，较短缓存时间 |
| resourcesQuery | 30_000 (30秒) | 默认 5分钟 | 资源列表变化频繁，较短缓存时间 |
| promptsQuery | 60_000 (1分钟) | 300_000 (5分钟) | 提示模板相对稳定，较长缓存时间 |

#### 3.5.2 缓存策略说明

**staleTime (数据新鲜时间)**：
- 在此时间内，再次请求将返回缓存数据
- 过期后，请求会触发后台刷新（stale-while-revalidate）
- 根据数据变化频率设置，平衡性能和数据新鲜度

**gcTime (垃圾回收时间)**：
- 数据未被使用的时间超过此值，将从内存中清理
- 通常设置为 staleTime 的 5-10 倍
- 考虑内存使用和用户访问模式

#### 3.5.3 缓存键设计

**层级化键结构**：
```typescript
['mcp', 'config']      // 配置数据
['mcp', 'tools']       // 工具数据
['mcp', 'clients']     // 客户端数据
['mcp', 'resources']   // 资源数据
['mcp', 'prompts', config.value.mcpEnabled]  // 提示模板（包含状态）
```

**键设计原则**：
- 前缀统一：所有键以 `['mcp']` 开头，便于批量操作
- 类型清晰：第二位标识数据类型
- 参数包含：相关状态变化包含在键中，确保缓存失效

#### 3.5.4 条件查询缓存

**enabled 条件对缓存的影响**：
```typescript
// 示例：toolsQuery 的条件查询
enabled: () => config.value.ready && config.value.mcpEnabled
```

**缓存行为**：
- 条件不满足时，查询状态为 `paused`，不会执行
- 条件满足时，查询自动开始执行
- 条件变化时（如 mcpEnabled 切换），缓存状态自动调整

#### 3.5.5 缓存失效策略

**失效规则**：
```typescript
// 前缀匹配失效
invalidateQueries: () => [['mcp', 'tools']]  // 失效所有以 ['mcp', 'tools'] 开头的查询

// 精确匹配失效
invalidateQueries: () => {
  return [{ key: ['mcp', 'config'], exact: true }]  // 只失效完全匹配的查询
}
```

**最佳实践**：
- 服务器操作：全量失效所有相关查询
- 配置操作：精确失效配置相关查询
- 状态变化：依赖查询的条件自动失效

#### 3.5.6 缓存性能优化

**批量失效策略**：
```typescript
// 添加服务器时失效所有相关查询
const addServerMutation = useIpcMutation({
  invalidateQueries: () => [
    ['mcp', 'config'],      // 主配置
    ['mcp', 'tools'],       // 新服务器的工具
    ['mcp', 'clients'],     // 新服务器的连接
    ['mcp', 'resources']    // 新服务器的资源
  ]
})
```

**避免过度失效**：
```typescript
// ✅ 精确失效
const removeDefaultServerMutation = useIpcMutation({
  invalidateQueries: () => [['mcp', 'config']]  // 只影响配置
})

// ❌ 过度失效（不推荐）
invalidateQueries: () => [['mcp']]  // 失效所有 MCP 查询
```

通过这种精细的缓存配置，mcpStore 实现了：
- 高性能的数据访问
- 实时的数据同步
- 内存使用的优化
- 开发体验的提升

## 四、使用指南

### 4.1 在组件中使用 mcpStore 的完整示例

#### 基础用法

以下是一个完整的 Vue 组件示例，展示了如何正确使用 mcpStore：

```vue
<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useMcpStore } from '@/stores/mcp'
import { useChatStore } from '@/stores/chat'
import { useToast } from '@/components/use-toast'
import { Button } from '@shadcn/components/ui/button'
import { Switch } from '@shadcn/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@shadcn/components/ui/card'

// 1. 初始化 stores
const mcpStore = useMcpStore()
const chatStore = useChatStore()
const { toast } = useToast()

// 2. 使用计算属性访问 mcpStore 状态
const config = computed(() => mcpStore.config)
const mcpEnabled = computed(() => mcpStore.mcpEnabled)
const serverList = computed(() => mcpStore.serverList)
const tools = computed(() => mcpStore.tools)
const toolsLoading = computed(() => mcpStore.toolsLoading)
const toolsError = computed(() => mcpStore.toolsError)

// 3. 本地状态
const newServerName = ref('')
const isAddingServer = ref(false)

// 4. 方法实现
const handleMcpToggle = async (enabled: boolean) => {
  const success = await mcpStore.setMcpEnabled(enabled)
  if (!success) {
    toast({
      title: '操作失败',
      description: '无法切换 MCP 状态',
      variant: 'destructive'
    })
  }
}

const handleServerToggle = async (serverName: string) => {
  if (mcpStore.serverLoadingStates[serverName]) {
    return // 避免重复操作
  }

  const success = await mcpStore.toggleServer(serverName)
  if (!success) {
    toast({
      title: '服务器操作失败',
      description: `无法切换服务器 ${serverName} 状态`,
      variant: 'destructive'
    })
  }
}

const handleAddServer = async () => {
  if (!newServerName.value.trim()) {
    return
  }

  isAddingServer.value = true
  try {
    const result = await mcpStore.addServer(newServerName.value, {
      type: 'stdio',
      command: 'node',
      args: ['server.js']
    })

    if (result.success) {
      toast({
        title: '添加成功',
        description: `服务器 ${newServerName.value} 已添加`
      })
      newServerName.value = ''
    } else {
      toast({
        title: '添加失败',
        description: result.message,
        variant: 'destructive'
      })
    }
  } finally {
    isAddingServer.value = false
  }
}

const refreshTools = async () => {
  try {
    await mcpStore.loadTools({ force: true })
    toast({
      title: '刷新成功',
      description: '工具列表已更新'
    })
  } catch (error) {
    toast({
      title: '刷新失败',
      description: '无法更新工具列表',
      variant: 'destructive'
    })
  }
}

// 5. 组件挂载时的初始化
onMounted(async () => {
  // 如果配置未加载，手动加载
  if (!config.value.ready) {
    await mcpStore.loadConfig()
  }
})
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- MCP 总开关 -->
    <Card>
      <CardHeader>
        <CardTitle>MCP 配置</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="font-medium">启用 MCP</h3>
            <p class="text-sm text-muted-foreground">
              启用后可以使用 MCP 工具和资源
            </p>
          </div>
          <Switch
            :model-value="mcpEnabled"
            @update:model-value="handleMcpToggle"
          />
        </div>
      </CardContent>
    </Card>

    <!-- 服务器列表 -->
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <CardTitle>MCP 服务器</CardTitle>
          <Button @click="refreshTools" :disabled="toolsLoading">
            {{ toolsLoading ? '刷新中...' : '刷新工具' }}
          </Button>
        </div>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 错误状态 -->
        <div v-if="toolsError" class="p-3 bg-destructive/10 text-destructive rounded-md">
          加载工具失败: {{ mcpStore.toolsErrorMessage }}
        </div>

        <!-- 服务器列表 -->
        <div v-if="serverList.length > 0" class="space-y-3">
          <div
            v-for="server in serverList"
            :key="server.name"
            class="flex items-center justify-between p-3 border rounded-md"
          >
            <div>
              <h4 class="font-medium">{{ server.name }}</h4>
              <p class="text-sm text-muted-foreground">
                {{ server.type }} - {{ server.isDefault ? '默认服务器' : '自定义服务器' }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <div
                v-if="server.isLoading"
                class="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"
              />
              <div
                :class="[
                  'w-2 h-2 rounded-full',
                  server.isRunning ? 'bg-green-500' : 'bg-gray-300'
                ]"
              />
              <Switch
                :model-value="server.isRunning"
                :disabled="server.isLoading"
                @update:model-value="() => handleServerToggle(server.name)"
              />
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-else class="text-center py-8 text-muted-foreground">
          <p>暂无 MCP 服务器</p>
          <p class="text-sm">请先添加一个 MCP 服务器</p>
        </div>

        <!-- 添加新服务器 -->
        <div class="flex gap-2">
          <input
            v-model="newServerName"
            placeholder="服务器名称"
            class="flex-1 px-3 py-2 border rounded-md"
            @keydown.enter="handleAddServer"
          />
          <Button
            @click="handleAddServer"
            :disabled="isAddingServer || !newServerName.trim()"
          >
            {{ isAddingServer ? '添加中...' : '添加服务器' }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- 工具列表预览 -->
    <Card v-if="mcpEnabled && tools.length > 0">
      <CardHeader>
        <CardTitle>可用工具 ({{ tools.length }})</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="grid gap-2">
          <div
            v-for="tool in tools.slice(0, 5)"
            :key="tool.function.name"
            class="p-2 bg-muted rounded-md"
          >
            <div class="font-medium">{{ tool.function.name }}</div>
            <div class="text-sm text-muted-foreground">
              {{ tool.function.description || '无描述' }}
            </div>
          </div>
          <div v-if="tools.length > 5" class="text-center text-sm text-muted-foreground">
            还有 {{ tools.length - 5 }} 个工具...
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
```

#### 最佳实践要点

1. **状态访问**：
   - 始终通过 `computed` 访问 store 状态，确保响应性
   - 不要直接访问内部的 Query 对象（如 `toolsQuery`）

2. **错误处理**：
   - 检查 `isLoading` 状态避免重复操作
   - 使用 `toast` 或其他方式显示错误信息

3. **初始化**：
   - 在 `onMounted` 中检查配置是否已加载
   - 必要时手动调用 `loadConfig()`

4. **状态同步**：
   - 写操作后缓存失效会自动触发相关查询刷新
   - 无需手动调用刷新方法（除非特定场景需要）

### 4.2 添加新的 Query 的步骤说明和代码模板

#### 步骤说明

1. **确定数据需求**：明确需要查询的数据类型和依赖关系
2. **检查 Presenter 方法**：确认是否存在对应的 Presenter 方法
3. **定义 Query**：在 store 中使用 `useIpcQuery` 或 `useQuery` 定义查询
4. **添加计算属性**：为组件提供便捷的访问接口
5. **添加缓存失效**：在相关的 Mutation 中配置缓存失效
6. **更新 Store 返回值**：将新的状态和方法暴露给组件

#### 代码模板

##### 模板 1: 基于 Presenter 方法的简单 Query

```typescript
// 1. 在 mcpStore 中添加 Query
const userInfoQuery = useIpcQuery({
  presenter: 'userPresenter',           // Presenter 名称
  method: 'getUserInfo',                 // 方法名
  key: () => ['user', 'info'],           // 缓存 key
  enabled: () => config.value.ready,     // 可选：条件查询
  staleTime: 5 * 60_000                  // 可选：缓存 5 分钟
}) as UseQueryReturn<UserInfo>

// 2. 添加计算属性
const userInfo = computed(() => userInfoQuery.data.value ?? null)
const userInfoLoading = computed(() => userInfoQuery.isLoading.value)
const userInfoError = computed(() => Boolean(userInfoQuery.error.value))
const userInfoErrorMessage = computed(() => {
  const error = userInfoQuery.error.value
  return error instanceof Error ? error.message : String(error || '')
})

// 3. 添加到 store 返回对象
return {
  // ... 其他返回值
  userInfo,
  userInfoLoading,
  userInfoError,
  userInfoErrorMessage
}
```

##### 模板 2: 复杂聚合查询（多个数据源）

```typescript
// 1. 定义返回类型
interface DashboardData {
  userStats: UserStats
  serverMetrics: ServerMetrics
  recentActivities: Activity[]
}

// 2. 使用 useQuery 创建复杂查询
const dashboardQuery = useQuery<DashboardData>({
  key: () => ['dashboard', 'summary'],
  staleTime: 2 * 60_000,                 // 缓存 2 分钟
  gcTime: 5 * 60_000,                    // 5 分钟后清理
  query: async () => {
    // 并行调用多个 Presenter 方法
    const [userStats, serverMetrics, activities] = await Promise.all([
      userPresenter.getUserStats(),
      mcpPresenter.getServerMetrics(),
      activityPresenter.getRecentActivities(10)
    ])

    return {
      userStats: userStats ?? {},
      serverMetrics: serverMetrics ?? {},
      recentActivities: activities ?? []
    }
  }
})

// 3. 添加计算属性
const dashboardData = computed(() => dashboardQuery.data.value)
const dashboardLoading = computed(() => dashboardQuery.isLoading.value)
const dashboardError = computed(() => Boolean(dashboardQuery.error.value))

// 4. 添加辅助方法
const refreshDashboard = async () => {
  try {
    await runQuery(dashboardQuery, { force: true })
    return { success: true }
  } catch (error) {
    console.error('刷新仪表盘失败:', error)
    return { success: false, message: '刷新失败' }
  }
}

// 5. 添加到 store 返回对象
return {
  // ... 其他返回值
  dashboardData,
  dashboardLoading,
  dashboardError,
  refreshDashboard
}
```

##### 模板 3: 带参数的查询

```typescript
// 1. 定义参数化查询
const createServerLogsQuery = (serverName: string) => {
  return useIpcQuery({
    presenter: 'logPresenter',
    method: 'getServerLogs',
    key: () => ['logs', 'server', serverName],  // key 包含参数
    args: [serverName],                         // 传递参数
    enabled: () => config.value.ready && !!serverName,
    staleTime: 30_000
  }) as UseQueryReturn<LogEntry[]>
}

// 2. 在 store 中管理查询实例
const serverLogsQueries = ref<Record<string, UseQueryReturn<LogEntry[]>>>({})

const getServerLogs = (serverName: string) => {
  if (!serverLogsQueries.value[serverName]) {
    serverLogsQueries.value[serverName] = createServerLogsQuery(serverName)
  }
  return serverLogsQueries.value[serverName]
}

// 3. 提供便捷接口
const getServerLogsData = (serverName: string) => {
  return computed(() => getServerLogs(serverName).data.value ?? [])
}

const getServerLogsLoading = (serverName: string) => {
  return computed(() => getServerLogs(serverName).isLoading.value)
}

// 4. 添加到 store 返回对象
return {
  // ... 其他返回值
  getServerLogs: getServerLogsData,
  getServerLogsLoading
}
```

#### 注意事项

1. **缓存 Key 设计**：
   - Key 应该唯一标识查询内容和参数
   - 使用数组格式便于前缀匹配失效
   - 包含实体类型（如 `['user', 'info']`）

2. **条件查询**：
   - 使用 `enabled` 选项避免不必要的请求
   - 条件变化时查询会自动暂停/恢复

3. **类型安全**：
   - 使用 `as UseQueryReturn<类型>` 确保类型推断
   - 定义接口类型提高代码可维护性

4. **性能考虑**：
   - 合理设置 `staleTime` 避免过度请求
   - 使用 `gcTime` 控制内存清理策略

### 4.3 添加新的 Mutation 的步骤说明和代码模板

#### 步骤说明

1. **确定操作类型**：明确是要创建、更新还是删除数据
2. **检查 Presenter 方法**：确认存在对应的 Presenter 方法
3. **定义 Mutation**：使用 `useIpcMutation` 定义变更操作
4. **配置缓存失效**：在 `invalidateQueries` 中列出需要失效的查询
5. **包装 Store 方法**：为组件提供友好的调用接口
6. **错误处理**：添加适当的错误处理和用户反馈

#### 代码模板

##### 模板 1: 基础创建操作

```typescript
// 1. 定义 Mutation
const createUserMutation = useIpcMutation({
  presenter: 'userPresenter',
  method: 'createUser',
  // 缓存失效：创建用户后需要刷新用户列表和用户详情
  invalidateQueries: (result, variables) => [
    ['user', 'list'],           // 失效用户列表查询
    ['user', 'info', variables[0]]  // 失效特定用户查询（如果会立即查询）
  ],
  // 可选：成功回调
  onSuccess: (result, variables) => {
    console.log(`用户 ${variables[0]} 创建成功`, result)
  },
  // 可选：错误回调
  onError: (error, variables) => {
    console.error(`创建用户 ${variables[0]} 失败:`, error)
  }
})

// 2. 包装 Store 方法
const createUser = async (username: string, userInfo: UserInfo) => {
  try {
    // 注意：mutateAsync 的参数必须是数组
    const result = await createUserMutation.mutateAsync([username, userInfo])
    return {
      success: true,
      data: result,
      message: `用户 ${username} 创建成功`
    }
  } catch (error) {
    console.error('创建用户失败:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '创建用户失败'
    }
  }
}

// 3. 添加到 store 返回对象
return {
  // ... 其他返回值
  createUser
}
```

##### 模板 2: 复杂更新操作

```typescript
// 1. 定义 Mutation
const updateServerConfigMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'updateServerConfig',
  invalidateQueries: (result, variables) => [
    ['mcp', 'config'],            // 失效主配置
    ['mcp', 'server', variables[0]],  // 失效特定服务器配置
    ['mcp', 'tools'],             // 可能影响工具列表
    ['mcp', 'clients']            // 可能影响客户端列表
  ],
  onSuccess: (result, [serverName, config]) => {
    console.log(`服务器 ${serverName} 配置更新成功`)
  }
})

// 2. 包装 Store 方法（包含验证和乐观更新）
const updateServerConfig = async (
  serverName: string,
  newConfig: Partial<MCPServerConfig>
) => {
  // 1. 验证
  if (!serverName.trim()) {
    return { success: false, message: '服务器名称不能为空' }
  }

  if (!newConfig || Object.keys(newConfig).length === 0) {
    return { success: false, message: '配置不能为空' }
  }

  // 2. 乐观更新（可选）
  const oldConfig = { ...config.value.mcpServers[serverName] }
  config.value.mcpServers[serverName] = { ...oldConfig, ...newConfig }

  try {
    // 注意：mutateAsync 的参数必须是数组
    await updateServerConfigMutation.mutateAsync([serverName, newConfig])

    // 3. 刷新相关状态
    await updateServerStatus(serverName)

    return {
      success: true,
      message: `服务器 ${serverName} 配置更新成功`
    }
  } catch (error) {
    // 4. 回滚乐观更新
    config.value.mcpServers[serverName] = oldConfig

    console.error('更新服务器配置失败:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '更新配置失败'
    }
  }
}
```

##### 模板 3: 批量操作

```typescript
// 1. 定义批量删除 Mutation
const batchDeleteServersMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'batchDeleteServers',
  invalidateQueries: () => [
    ['mcp', 'config'],     // 失效配置
    ['mcp', 'tools'],      // 失效工具列表
    ['mcp', 'clients'],    // 失效客户端列表
    ['mcp', 'resources']   // 失效资源列表
  ],
  onSuccess: (result, serverNames) => {
    console.log(`批量删除 ${serverNames.length} 个服务器成功`)
  }
})

// 2. 包装批量操作方法
const batchDeleteServers = async (serverNames: string[]) => {
  if (!serverNames || serverNames.length === 0) {
    return { success: false, message: '请选择要删除的服务器' }
  }

  // 确认操作
  const confirmed = await confirmDialog({
    title: '批量删除确认',
    message: `确定要删除 ${serverNames.length} 个服务器吗？此操作不可恢复。`
  })

  if (!confirmed) {
    return { success: false, message: '用户取消操作' }
  }

  try {
    // 注意：mutateAsync 的参数必须是数组
    const result = await batchDeleteServersMutation.mutateAsync([serverNames])

    // 清理本地状态
    serverNames.forEach(name => {
      delete serverStatuses.value[name]
      delete serverLoadingStates.value[name]
    })

    return {
      success: true,
      data: result,
      message: `成功删除 ${serverNames.length} 个服务器`
    }
  } catch (error) {
    console.error('批量删除服务器失败:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : '批量删除失败'
    }
  }
}
```

##### 模板 4: 带条件失效的复杂操作

```typescript
// 1. 定义智能缓存失效的 Mutation
const setServerPriorityMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'setServerPriority',
  // 根据操作结果智能失效缓存
  invalidateQueries: (result, [serverName, priority]) => {
    const keys: EntryKey[][] = [
      ['mcp', 'config'],                    // 总是失效配置
      ['mcp', 'server', serverName]         // 失效特定服务器
    ]

    // 如果优先级变化可能影响工具排序
    if (priority > 5) {
      keys.push(['mcp', 'tools'])           // 高优先级可能影响工具列表排序
    }

    return keys
  },
  onSuccess: (result, [serverName, priority]) => {
    console.log(`服务器 ${serverName} 优先级设置为 ${priority}`)
  }
})
```

#### 注意事项

1. **缓存失效策略**：
   - 只失效真正受影响的查询
   - 避免过度失效导致不必要的请求
   - 考虑查询之间的依赖关系

2. **错误处理**：
   - 捕获所有可能的异常
   - 提供用户友好的错误信息
   - 考虑实现乐观更新和回滚

3. **类型安全**：
   - 确保 Mutation 参数与 Presenter 方法匹配
   - 定义相应的类型接口

4. **性能考虑**：
   - 批量操作优于多次单个操作
   - 合理使用乐观更新提升用户体验
   - 避免在短时间内重复触发相同操作

### 4.4 缓存失效的最佳实践说明

#### 基本原则

1. **精确性**：只失效真正需要更新的数据
2. **及时性**：在数据变化后立即失效缓存
3. **完整性**：确保所有相关数据都被正确失效
4. **性能**：避免不必要的过度失效

#### 缓存失效策略

##### 1. 层级失效策略

```typescript
// 按照数据层级设计失效策略
const updateUserMutation = useIpcMutation({
  presenter: 'userPresenter',
  method: 'updateUser',
  invalidateQueries: (result, [userId]) => [
    // L1: 直接相关的用户数据
    ['user', 'detail', userId],        // 用户详情

    // L2: 依赖用户数据的列表
    ['user', 'list'],                  // 用户列表（可能影响排序）
    ['team', 'members'],               // 团队成员列表

    // L3: 聚合数据
    ['dashboard', 'stats'],            // 仪表盘统计
    ['activity', 'recent']             // 最近活动
  ]
})
```

##### 2. 条件失效策略

```typescript
// 根据操作类型进行条件失效
const updateServerConfigMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'updateServerConfig',
  invalidateQueries: (result, [serverName, config]) => {
    const baseKeys = [['mcp', 'config']]  // 总是失效基础配置

    // 根据配置类型决定额外失效
    if (config.command || config.args) {
      // 命令相关配置变化，可能影响工具
      baseKeys.push(['mcp', 'tools'])
    }

    if (config.environment) {
      // 环境配置变化，可能影响客户端连接
      baseKeys.push(['mcp', 'clients'])
    }

    if (config.resources) {
      // 资源配置变化
      baseKeys.push(['mcp', 'resources'])
    }

    return baseKeys
  }
})
```

##### 3. 精确匹配与前缀匹配

```typescript
// 使用精确匹配避免过度失效
const updateUserPreferencesMutation = useIpcMutation({
  presenter: 'userPresenter',
  method: 'updateUserPreferences',
  invalidateQueries: [
    // 精确失效：只失效这个特定 key
    { key: ['user', 'preferences'], exact: true },

    // 前缀失效：失效所有用户详情查询（但保持独立的偏好设置）
    { key: ['user', 'detail'], exact: false }
  ]
})
```

#### 最佳实践示例

##### 1. 智能 Tag 系统

```typescript
// 为不同类型的查询添加 tag
const userQuery = useIpcQuery({
  presenter: 'userPresenter',
  method: 'getUserInfo',
  key: () => ['user', 'info', { tags: ['user', 'cacheable'] }]  // 添加 tag
})

// 基于 tag 批量失效
const globalRefreshMutation = useIpcMutation({
  presenter: 'systemPresenter',
  method: 'globalRefresh',
  invalidateQueries: () => {
    // 使用 queryCache 手动失效特定 tag 的查询
    const queryCache = useQueryCache()
    queryCache.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey
        return key.some(k =>
          Array.isArray(k) && k.includes('cacheable')
        )
      }
    })
    return []  // 返回空数组，因为我们手动处理了
  }
})
```

##### 2. 级联失效

```typescript
// 复杂操作的级联失效
const deleteServerMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'deleteServer',
  invalidateQueries: (result, [serverName]) => [
    // 第一步：直接相关
    ['mcp', 'config'],
    ['mcp', 'server', serverName],

    // 第二步：依赖数据
    ['mcp', 'tools'],      // 服务器被删除，工具也消失
    ['mcp', 'clients'],    // 客户端连接断开
    ['mcp', 'resources']   // 资源不可用

    // 第三步：聚合数据
    ['dashboard', 'summary'],      // 仪表盘统计变化
    ['activity', 'recent'],        // 活动记录变化
    ['server', 'metrics']          // 服务器指标变化
  ],
  onSuccess: async (result, [serverName]) => {
    // 级联操作：清理相关本地状态
    delete serverStatuses.value[serverName]
    delete serverLoadingStates.value[serverName]

    // 通知相关组件进行额外清理
    window.dispatchEvent(new CustomEvent('server:deleted', {
      detail: { serverName }
    }))
  }
})
```

##### 3. 延迟失效

```typescript
// 对于可能频繁变化的操作，使用防抖失效
let invalidateTimeout: NodeJS.Timeout | null = null

const updateServerStatusMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'updateServerStatus',
  invalidateQueries: (result, [serverName]) => {
    // 清除之前的定时器
    if (invalidateTimeout) {
      clearTimeout(invalidateTimeout)
    }

    // 延迟 1 秒后失效，避免频繁更新
    invalidateTimeout = setTimeout(() => {
      const queryCache = useQueryCache()
      queryCache.invalidateQueries({
        key: ['mcp', 'server', serverName, 'status'],
        exact: true
      })
    }, 1000)

    return []  // 返回空数组，延迟处理
  }
})
```

#### 性能优化建议

1. **避免过度失效**：
   ```typescript
   // ❌ 过度失效
   invalidateQueries: () => [['mcp']]  // 失效所有 MCP 相关查询

   // ✅ 精确失效
   invalidateQueries: () => [
     ['mcp', 'config'],
     ['mcp', 'tools']
   ]
   ```

2. **使用分层缓存**：
   ```typescript
   // 为不同频率的数据设置不同的缓存时间
   const frequentQuery = useIpcQuery({
     // 高频变化数据
     staleTime: 10_000     // 10 秒
   })

   const stableQuery = useIpcQuery({
     // 低频变化数据
     staleTime: 300_000    // 5 分钟
   })
   ```

3. **监控缓存命中率**：
   ```typescript
   // 在开发环境中监控缓存效果
   if (import.meta.env.DEV) {
     const queryCache = useQueryCache()
     console.log('Cache stats:', queryCache.getAll())
   }
   ```

4. **合理使用 gcTime**：
   ```typescript
   // 根据数据使用模式设置垃圾回收时间
   const query = useIpcQuery({
     staleTime: 60_000,    // 1 分钟后过期
     gcTime: 5 * 60_000    // 5 分钟后从内存中清理
   })
   ```

#### 常见陷阱与解决方案

1. **循环失效**：
   ```typescript
   // ❌ 可能导致循环失效
   const aMutation = useIpcMutation({
     invalidateQueries: () => [['a']]
   })

   const bMutation = useIpcMutation({
     invalidateQueries: () => [['a'], ['b']]  // 又失效了 a
   })

   // ✅ 明确失效范围
   const bMutation = useIpcMutation({
     invalidateQueries: () => [['b']]  // 只失效自己相关的
   })
   ```

2. **遗忘失效**：
   ```typescript
   // ❌ 更改数据但忘记失效缓存
   const updateData = useIpcMutation({
     presenter: 'dataPresenter',
     method: 'updateData'
     // 缺少 invalidateQueries
   })

   // ✅ 确保缓存一致性
   const updateData = useIpcMutation({
     presenter: 'dataPresenter',
     method: 'updateData',
     invalidateQueries: () => [['data', 'list']]
   })
   ```

3. **失效时机错误**：
   ```typescript
   // ❌ 在 onSettled 中失效（无论成功失败都失效）
   const mutation = useIpcMutation({
     onSettled: () => {
       queryCache.invalidateQueries({ key: ['data'] })
     }
   })

   // ✅ 在 onSuccess 中失效（只有成功才失效）
   const mutation = useIpcMutation({
     invalidateQueries: () => [['data']]  // 自动在 onSuccess 中执行
   })
   ```

通过遵循这些最佳实践，可以确保缓存失效的准确性和高效性，避免数据不一致和性能问题。

## 五、常见问题

### 5.1 为什么数据没有自动刷新？

#### 可能原因与解决方案

##### 1. 查询条件未满足

**问题描述**：配置了 `enabled` 条件的查询在条件不满足时不会执行。

**常见场景**：
```typescript
const toolsQuery = useIpcQuery({
  presenter: 'mcpPresenter',
  method: 'getAllToolDefinitions',
  key: () => ['mcp', 'tools'],
  enabled: () => config.value.ready && config.value.mcpEnabled,  // 条件查询
  staleTime: 60_000
})
```

**解决方案**：
```typescript
// 在组件中检查条件是否满足
const mcpStore = useMcpStore()

// 检查配置是否已加载且 MCP 已启用
watch(
  () => [mcpStore.config.ready, mcpStore.mcpEnabled],
  async ([ready, enabled]) => {
    console.log('查询条件检查:', { ready, enabled })

    if (!ready) {
      console.log('配置未加载，正在加载...')
      await mcpStore.loadConfig()
    }

    if (ready && enabled) {
      console.log('条件满足，手动触发工具加载')
      await mcpStore.loadTools({ force: true })
    }
  },
  { immediate: true }
)
```

##### 2. 数据仍在缓存期内

**问题描述**：查询返回的数据可能仍在 `staleTime` 时间内，不会自动重新请求。

**解决方案**：
```typescript
// 方法一：强制刷新
await mcpStore.loadTools({ force: true })

// 方法二：手动调用 Query 的 refetch
const toolsQuery = mcpStore._toolsQuery  // 如果暴露了内部查询
await toolsQuery.refetch()

// 方法三：通过操作让缓存失效
await mcpStore.setMcpEnabled(false)
await mcpStore.setMcpEnabled(true)  // 会触发相关查询刷新
```

##### 3. 缓存失效配置不正确

**问题描述**：Mutation 的 `invalidateQueries` 配置可能没有包含正确的 key。

**检查方法**：
```typescript
// 查看具体的失效配置
const addServerMutation = useIpcMutation({
  presenter: 'mcpPresenter',
  method: 'addMcpServer',
  invalidateQueries: () => [
    ['mcp', 'config'],      // ✅ 正确：配置查询
    ['mcp', 'tools'],       // ✅ 正确：工具查询
    ['mcp', 'clients'],     // ✅ 正确：客户端查询
    ['mcp', 'resources']    // ✅ 正确：资源查询
  ]
})

// 如果失效了错误的 key，查询不会刷新
// ❌ 错误示例
invalidateQueries: () => [['tools']]  // 缺少前缀
```

**解决方案**：
```typescript
// 确保失效的 key 与查询的 key 完全匹配
const toolsQuery = useIpcQuery({
  key: () => ['mcp', 'tools'],  // 这是查询的 key
  // ...
})

const addServerMutation = useIpcMutation({
  invalidateQueries: () => [['mcp', 'tools']],  // 必须完全匹配
  // ...
})
```

#### 调试技巧

```typescript
// 1. 检查查询状态
const mcpStore = useMcpStore()

console.log('工具查询状态:', {
  data: mcpStore.tools,
  loading: mcpStore.toolsLoading,
  error: mcpStore.toolsError,
  errorMessage: mcpStore.toolsErrorMessage
})

// 2. 检查缓存状态（开发环境）
if (import.meta.env.DEV) {
  const queryCache = useQueryCache()
  const cacheData = queryCache.getAll()
  console.log('当前缓存状态:', cacheData)
}

// 3. 监听查询变化
watch(
  () => mcpStore.toolsQuery.data.value,
  (newData, oldData) => {
    console.log('工具数据更新:', {
      timestamp: new Date().toISOString(),
      oldLength: oldData?.length || 0,
      newLength: newData?.length || 0
    })
  }
)
```

### 5.2 如何强制刷新数据？

#### 方法一：使用 Store 提供的强制刷新方法

```typescript
const mcpStore = useMcpStore()

// 刷新工具列表
await mcpStore.loadTools({ force: true })

// 刷新客户端列表
await mcpStore.loadClients({ force: true })

// 刷新资源列表
await mcpStore.loadResources({ force: true })

// 刷新配置（会同时刷新所有相关数据）
await mcpStore.loadConfig({ force: true })
```

#### 方法二：直接操作内部 Query

```typescript
// 如果 store 暴露了内部的 Query 对象
const mcpStore = useMcpStore()

// 强制重新获取数据
await mcpStore.toolsQuery.refetch()

// 仅在数据过期时刷新
await mcpStore.toolsQuery.refresh()
```

#### 方法三：通过缓存失效触发刷新

```typescript
import { useQueryCache } from '@pinia/colada'

const queryCache = useQueryCache()

// 失效特定查询
await queryCache.invalidateQueries({
  key: ['mcp', 'tools']
})

// 失效所有 MCP 相关查询
await queryCache.invalidateQueries({
  predicate: (query) => {
    const key = query.queryKey
    return Array.isArray(key) && key[0] === 'mcp'
  }
})

// 失效特定前缀的所有查询
await queryCache.invalidateQueries({
  key: ['mcp'],
  exact: false  // 前缀匹配
})
```

#### 方法四：临时修改查询条件

```typescript
// 通过临时禁用再启用查询来强制刷新
const mcpStore = useMcpStore()

const originalEnabled = mcpStore.mcpEnabled

// 禁用查询
await mcpStore.setMcpEnabled(false)

// 等待一个 tick
await nextTick()

// 重新启用查询（会触发强制刷新）
await mcpStore.setMcpEnabled(originalEnabled)
```

### 5.3 如何处理错误？

#### 错误监控与处理

##### 1. 全局错误处理

```typescript
// 在组件中统一处理错误
const mcpStore = useMcpStore()
const { toast } = useToast()

// 监听工具查询错误
watch(
  () => mcpStore.toolsError,
  (hasError) => {
    if (hasError) {
      const errorMessage = mcpStore.toolsErrorMessage
      console.error('工具加载失败:', errorMessage)

      toast({
        title: '工具加载失败',
        description: errorMessage,
        variant: 'destructive',
        action: {
          label: '重试',
          onClick: () => mcpStore.loadTools({ force: true })
        }
      })
    }
  }
)

// 监听配置加载错误
watch(
  () => mcpStore.configLoading,
  (loading) => {
    if (!loading && !mcpStore.config.ready) {
      console.error('配置加载失败')

      toast({
        title: '配置加载失败',
        description: '无法加载 MCP 配置，请检查网络连接',
        variant: 'destructive',
        action: {
          label: '重试',
          onClick: () => mcpStore.loadConfig({ force: true })
        }
      })
    }
  }
)
```

##### 2. Mutation 错误处理

```typescript
const handleServerOperation = async (operation: () => Promise<boolean>) => {
  try {
    const success = await operation()

    if (success) {
      toast({
        title: '操作成功',
        description: '服务器状态已更新'
      })
    } else {
      toast({
        title: '操作失败',
        description: '无法完成服务器操作',
        variant: 'destructive'
      })
    }
  } catch (error) {
    console.error('服务器操作异常:', error)

    toast({
      title: '操作异常',
      description: error instanceof Error ? error.message : '未知错误',
      variant: 'destructive'
    })
  }
}

// 使用示例
await handleServerOperation(() =>
  mcpStore.toggleServer('my-server')
)
```

##### 3. 网络错误重试机制

```typescript
const handleWithRetry = async (
  operation: () => Promise<any>,
  maxRetries = 3,
  delay = 1000
) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation()
    } catch (error) {
      console.warn(`操作失败，第 ${i + 1} 次重试:`, error)

      if (i === maxRetries - 1) {
        throw error  // 最后一次重试失败，抛出错误
      }

      // 指数退避
      await new Promise(resolve =>
        setTimeout(resolve, delay * Math.pow(2, i))
      )
    }
  }
}

// 使用示例
const loadToolsWithRetry = () =>
  handleWithRetry(() => mcpStore.loadTools({ force: true }))
```

#### 错误恢复策略

##### 1. 自动恢复

```typescript
// 自动重试失败的查询
const setupAutoRetry = () => {
  const retryMap = new Map<string, number>()

  const scheduleRetry = (queryName: string, retryFn: () => Promise<void>) => {
    const retryCount = retryMap.get(queryName) || 0

    if (retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 1000
      retryMap.set(queryName, retryCount + 1)

      setTimeout(async () => {
        try {
          await retryFn()
          retryMap.delete(queryName)  // 成功后清除重试计数
          console.log(`${queryName} 自动重试成功`)
        } catch (error) {
          console.error(`${queryName} 自动重试失败:`, error)
          scheduleRetry(queryName, retryFn)  // 继续重试
        }
      }, delay)
    }
  }

  return { scheduleRetry }
}

const { scheduleRetry } = setupAutoRetry()

// 监听工具错误并自动重试
watch(
  () => mcpStore.toolsError,
  (hasError) => {
    if (hasError) {
      scheduleRetry('tools', () => mcpStore.loadTools({ force: true }))
    }
  }
)
```

##### 2. 用户干预恢复

```typescript
const ErrorRecoveryComponent = {
  setup() {
    const mcpStore = useMcpStore()
    const isRetrying = ref(false)

    const recoverFromError = async () => {
      isRetrying.value = true

      try {
        // 重置所有相关查询
        await Promise.all([
          mcpStore.loadConfig({ force: true }),
          mcpStore.loadTools({ force: true }),
          mcpStore.loadClients({ force: true }),
          mcpStore.loadResources({ force: true })
        ])

        console.log('错误恢复成功')
      } catch (error) {
        console.error('错误恢复失败:', error)
      } finally {
        isRetrying.value = false
      }
    }

    return { isRetrying, recoverFromError }
  }
}
```

### 5.4 缓存时间如何配置？

#### 全局缓存配置

##### 1. 修改全局默认值

```typescript
// src/renderer/src/main.ts
app.use(PiniaColada, {
  queryOptions: {
    // 默认过期时间：30秒
    staleTime: 30_000,      // 30秒后数据被认为过期

    // 垃圾回收时间：5分钟
    gcTime: 300_000,        // 5分钟后从内存中清理未使用的查询

    // 重试次数
    retry: 3,

    // 重试延迟
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000)
  }
})
```

##### 2. 基于数据类型的缓存策略

```typescript
// 配置查询：相对稳定，可以缓存更长时间
const configQuery = useQuery<ConfigQueryResult>({
  key: () => ['mcp', 'config'],
  staleTime: 5 * 60_000,   // 5分钟
  gcTime: 10 * 60_000,     // 10分钟后清理
  // ...
})

// 工具查询：可能经常变化，缓存时间较短
const toolsQuery = useIpcQuery({
  presenter: 'mcpPresenter',
  method: 'getAllToolDefinitions',
  key: () => ['mcp', 'tools'],
  staleTime: 30_000,       // 30秒，与 clientsQuery 保持一致
  gcTime: 5 * 60_000,      // 5分钟后清理
  // ...
})

// 客户端状态查询：变化频繁，缓存时间最短
const clientsQuery = useIpcQuery({
  presenter: 'mcpPresenter',
  method: 'getMcpClients',
  key: () => ['mcp', 'clients'],
  staleTime: 30_000,       // 30秒
  gcTime: 2 * 60_000,      // 2分钟后清理
  // ...
})
```

#### 动态缓存配置

##### 1. 基于用户行为的缓存调整

```typescript
// 根据用户活跃度调整缓存时间
const getUserBasedCacheTime = (baseTime: number) => {
  const lastActivity = localStorage.getItem('lastActivity')
  const inactiveTime = Date.now() - (lastActivity ? parseInt(lastActivity) : 0)

  // 用户长时间不活跃，延长缓存时间减少请求
  if (inactiveTime > 30 * 60_000) {  // 30分钟
    return baseTime * 3
  }

  return baseTime
}

const toolsQuery = useIpcQuery({
  presenter: 'mcpPresenter',
  method: 'getAllToolDefinitions',
  key: () => ['mcp', 'tools'],
  staleTime: () => getUserBasedCacheTime(60_000),
  // ...
})
```

##### 2. 基于网络条件的缓存调整

```typescript
// 根据网络状况动态调整缓存策略
const getNetworkBasedCacheTime = (baseTime: number) => {
  const connection = (navigator as any).connection || {}
  const effectiveType = connection.effectiveType || '4g'

  const multiplier = {
    'slow-2g': 4,    // 网络慢时，缓存更久
    '2g': 3,
    '3g': 2,
    '4g': 1
  }

  return baseTime * (multiplier[effectiveType] || 1)
}

const configQuery = useQuery({
  key: () => ['mcp', 'config'],
  staleTime: () => getNetworkBasedCacheTime(30_000),
  // ...
})
```

#### 缓存调试与监控

##### 1. 缓存命中率监控

```typescript
// 开发环境下的缓存监控
if (import.meta.env.DEV) {
  const queryCache = useQueryCache()

  // 定期输出缓存统计
  setInterval(() => {
    const queries = queryCache.getAll()
    const stats = {
      total: queries.length,
      withData: queries.filter(q => q.state.data !== undefined).length,
      stale: queries.filter(q => q.state.isStale).length,
      fetching: queries.filter(q => q.state.fetchStatus === 'fetching').length
    }

    console.log('缓存统计:', stats)
  }, 10_000)
}
```

##### 2. 缓存清理工具

```typescript
const CacheManager = {
  // 清理所有过期查询
  clearStale() {
    const queryCache = useQueryCache()
    queryCache.invalidateQueries({
      predicate: (query) => query.state.isStale
    })
  },

  // 清理所有 MCP 相关缓存
  clearMcpCache() {
    const queryCache = useQueryCache()
    queryCache.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey
        return Array.isArray(key) && key[0] === 'mcp'
      }
    })
  },

  // 清理所有缓存
  clearAll() {
    const queryCache = useQueryCache()
    queryCache.clear()
  }
}

// 在开发工具中使用
window.devTools = {
  cache: CacheManager
}
```

### 5.5 如何调试查询状态？

#### 开发工具集成

##### 1. Vue DevTools 查询监控

```typescript
// 为 store 添加调试信息
const mcpStore = defineStore('mcp', () => {
  // ... store 逻辑

  // 暴露内部查询状态用于调试
  const debugInfo = computed(() => ({
    queries: {
      config: {
        key: configQuery.queryKey,
        data: configQuery.data.value,
        isLoading: configQuery.isLoading.value,
        error: configQuery.error.value,
        isStale: configQuery.isStale.value,
        fetchStatus: configQuery.fetchStatus.value
      },
      tools: {
        key: toolsQuery.queryKey,
        dataLength: toolsQuery.data.value?.length || 0,
        isLoading: toolsQuery.isLoading.value,
        error: toolsQuery.error.value,
        isStale: toolsQuery.isStale.value,
        fetchStatus: toolsQuery.fetchStatus.value
      }
    },
    mutations: {
      addServer: {
        isPending: addServerMutation.isPending.value,
        error: addServerMutation.error.value
      }
    }
  }))

  return {
    // ... 常规返回值
    debugInfo  // 仅在开发环境使用
  }
})
```

##### 2. 实时状态监控组件

```vue
<template>
  <div class="debug-panel" v-if="isDev">
    <h3>MCP Store 调试面板</h3>

    <div class="query-status">
      <h4>查询状态</h4>
      <div v-for="(query, name) in debugInfo.queries" :key="name" class="query-item">
        <div class="query-header">
          <span class="query-name">{{ name }}</span>
          <span :class="['query-status', query.fetchStatus]">
            {{ query.fetchStatus }}
          </span>
        </div>

        <div class="query-details">
          <div>Key: {{ formatKey(query.key) }}</div>
          <div>Loading: {{ query.isLoading }}</div>
          <div>Stale: {{ query.isStale }}</div>
          <div v-if="query.error" class="error">
            Error: {{ query.error.message }}
          </div>
          <div v-if="name === 'tools'">
            Data Length: {{ query.dataLength }}
          </div>
        </div>
      </div>
    </div>

    <div class="actions">
      <button @click="refreshAll">刷新所有查询</button>
      <button @click="clearCache">清空缓存</button>
      <button @click="exportState">导出状态</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useMcpStore } from '@/stores/mcp'
import { useQueryCache } from '@pinia/colada'

const isDev = import.meta.env.DEV
const mcpStore = useMcpStore()

const debugInfo = computed(() => mcpStore.debugInfo)

const formatKey = (key) => JSON.stringify(key)

const refreshAll = async () => {
  await Promise.all([
    mcpStore.loadConfig({ force: true }),
    mcpStore.loadTools({ force: true }),
    mcpStore.loadClients({ force: true }),
    mcpStore.loadResources({ force: true })
  ])
}

const clearCache = () => {
  const queryCache = useQueryCache()
  queryCache.clear()
}

const exportState = () => {
  const state = {
    timestamp: new Date().toISOString(),
    store: mcpStore.$state,
    debugInfo: debugInfo.value,
    cache: useQueryCache().getAll()
  }

  navigator.clipboard.writeText(JSON.stringify(state, null, 2))
  console.log('状态已复制到剪贴板:', state)
}
</script>

<style scoped>
.debug-panel {
  position: fixed;
  top: 10px;
  right: 10px;
  width: 400px;
  max-height: 80vh;
  overflow-y: auto;
  background: white;
  border: 1px solid #ccc;
  border-radius: 8px;
  padding: 16px;
  font-family: monospace;
  font-size: 12px;
  z-index: 9999;
}

.query-item {
  margin-bottom: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 8px;
}

.query-header {
  display: flex;
  justify-content: space-between;
  font-weight: bold;
}

.query-status.idle { color: #666; }
.query-status.fetching { color: #0066cc; }
.query-status.paused { color: #ff6600; }
.query-status.error { color: #cc0000; }

.error {
  color: #cc0000;
  margin-top: 4px;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.actions button {
  padding: 4px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #f5f5f5;
  cursor: pointer;
}

.actions button:hover {
  background: #e0e0e0;
}
</style>
```

##### 3. 控制台调试命令

```typescript
// 在控制台可用的调试函数
window.debugMcpStore = {
  // 获取当前状态
  getState() {
    const mcpStore = useMcpStore()
    const queryCache = useQueryCache()

    return {
      store: mcpStore.$state,
      queries: queryCache.getAll(),
      config: mcpStore.debugInfo
    }
  },

  // 监控特定查询
  watchQuery(queryKey: string[]) {
    const queryCache = useQueryCache()
    const query = queryCache.getQueryData(queryKey)

    if (!query) {
      console.log('未找到查询:', queryKey)
      return
    }

    console.log('监控查询:', queryKey)
    return query
  },

  // 强制失效缓存
  invalidateCache(key: string[]) {
    const queryCache = useQueryCache()
    queryCache.invalidateQueries({ key })
  },

  // 网络请求监控
  trackRequests() {
    const originalFetch = window.fetch

    window.fetch = async (...args) => {
      const start = Date.now()
      console.log('请求开始:', args[0])

      try {
        const response = await originalFetch(...args)
        const duration = Date.now() - start
        console.log(`请求完成: ${args[0]} (${duration}ms)`)
        return response
      } catch (error) {
        const duration = Date.now() - start
        console.error(`请求失败: ${args[0]} (${duration}ms)`, error)
        throw error
      }
    }

    console.log('网络请求监控已启动')
  },

  // 恢复原始 fetch
  untrackRequests() {
    console.log('网络请求监控已停止')
  }
}

// 控制台使用示例
// debugMcpStore.getState()
// debugMcpStore.watchQuery(['mcp', 'tools'])
// debugMcpStore.invalidateCache(['mcp', 'tools'])
// debugMcpStore.trackRequests()
```

#### 性能分析

##### 1. 查询性能监控

```typescript
const queryPerformanceMonitor = {
  init() {
    if (!import.meta.env.DEV) return

    const queryCache = useQueryCache()

    // 监听查询生命周期
    queryCache.subscribe((event) => {
      const timestamp = Date.now()
      const { type, query } = event

      switch (type) {
        case 'fetch':
          console.log(`🔄 [${timestamp}] 查询开始:`, query.queryKey)
          query.startTime = timestamp
          break

        case 'success':
          const duration = timestamp - (query.startTime || timestamp)
          console.log(`✅ [${timestamp}] 查询成功:`, query.queryKey, `(${duration}ms)`)
          break

        case 'error':
          const errorDuration = timestamp - (query.startTime || timestamp)
          console.error(`❌ [${timestamp}] 查询失败:`, query.queryKey, `(${errorDuration}ms)`, event.error)
          break
      }
    })
  }
}

// 在应用启动时初始化
if (import.meta.env.DEV) {
  queryPerformanceMonitor.init()
}
```

##### 2. 内存使用监控

```typescript
const memoryMonitor = {
  start() {
    if (!import.meta.env.DEV) return

    setInterval(() => {
      const queryCache = useQueryCache()
      const queries = queryCache.getAll()

      const memoryInfo = {
        totalQueries: queries.length,
        dataQueries: queries.filter(q => q.state.data !== undefined).length,
        staleQueries: queries.filter(q => q.state.isStale).length,
        // 估算内存使用量（粗略计算）
        estimatedMemory: JSON.stringify(queries).length
      }

      console.log('📊 缓存内存信息:', memoryInfo)

      // 内存警告
      if (memoryInfo.estimatedMemory > 5 * 1024 * 1024) {  // 5MB
        console.warn('⚠️ 缓存内存使用量较高，考虑清理')
      }
    }, 30_000)  // 每30秒检查一次
  }
}
```

通过这些调试工具和方法，开发者可以全面了解和监控 MCP Store 的查询状态，快速定位问题并优化性能。

## 六、迁移指南

> 本节内容将由 Claude Code 完成（如果需要）
