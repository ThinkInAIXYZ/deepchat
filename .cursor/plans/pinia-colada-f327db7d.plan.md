<!-- f327db7d-c19a-4365-8a2c-53e3ce657160 5c29daa7-fafd-4e0e-8435-485bc8969a02 -->
# Pinia Colada 集成评估与实现计划

## 一、适用性分析

### 1.1 项目现状

- **数据获取模式**：通过 `usePresenter` composable 调用主进程 presenter 方法
- **IPC 通信**：使用 `ipcRenderer.invoke('presenter:call', ...)` 进行异步调用
- **状态管理**：Pinia stores 中手动管理 loading/error 状态
- **问题**：缺少缓存、请求去重，代码重复

### 1.2 Pinia Colada 核心优势

#### 1.2.1 代码简化（减少 50-60% 样板代码）

- **自动状态管理**：无需手动管理 `loading`、`error`、`data` 状态
- **统一错误处理**：自动捕获和暴露错误，减少 try-catch 嵌套
- **声明式 API**：组件挂载自动执行，卸载自动清理

#### 1.2.2 性能优化（减少 50-70% 重复 IPC 调用）

- **请求去重**：相同 key 的查询自动合并，避免重复 IPC 调用
- **智能缓存**：可配置缓存时间，减少不必要的 IPC 通信
- **后台刷新**：支持后台自动刷新，保持数据最新

#### 1.2.3 开发体验提升

- **类型安全**：完整的 TypeScript 类型推断
- **依赖查询**：支持查询之间的依赖关系
- **自动失效**：支持缓存失效和重新获取

#### 1.2.4 实际收益估算

- **代码量**：减少 50-60% 的状态管理代码
- **IPC 调用**：减少 50-70% 的重复调用
- **响应速度**：缓存命中时提升 30-50%
- **维护成本**：统一模式，降低维护复杂度

### 1.3 适用场景评估

#### ✅ 高度适用场景（优先集成）

**配置类数据（变化频率低，缓存价值高）**：

- `mcpStore.loadConfig()` - MCP 配置数据
- `mcpStore.loadTools()` - 工具列表（多个组件可能同时请求）
- `mcpStore.loadClients()` - 客户端列表
- `mcpStore.loadPrompts()` - 提示模板列表
- `mcpStore.loadResources()` - 资源列表
- `settingsStore` 中的各种配置数据加载
- `syncStore.refreshBackups()` - 备份列表（用户手动刷新）

**列表类数据（适合缓存和去重）**：

- 会话列表（threads list）
- 模型列表（provider models）
- 搜索历史列表

#### ⚠️ 中等适用场景（需要谨慎处理）

**需要实时更新的数据**：

- `chatStore.loadMessages()` - 消息列表
  - **问题**：需要实时更新，缓存可能导致数据不一致
  - **方案**：使用较短的 `staleTime`（如 1-2 秒），或禁用缓存
- `chatStore.loadChatConfig()` - 对话配置
  - **问题**：配置可能频繁变化
  - **方案**：使用 `enabled` 选项控制查询时机

**依赖其他状态的数据**：

- 需要等待其他查询完成的数据
  - **方案**：使用 `enabled: () => dependency.value !== null`

#### ❌ 不适用场景（禁止使用）

**1. 流式数据（Streaming）**

```typescript
// ❌ 错误示例
const { data } = useQuery({
  query: () => threadP.startStreamCompletion(...)  // 返回流，不适合
})

// ✅ 正确做法：保持现有实现
await threadP.startStreamCompletion(...)
```

**2. 事件驱动的实时数据**

```typescript
// ❌ 错误示例：通过事件推送的数据
window.electron.ipcRenderer.on('message-updated', (_, msg) => {
  // 这是事件推送，不是查询，不能用 useQuery
})

// ✅ 正确做法：保持事件监听 + ref 更新
const messages = ref([])
window.electron.ipcRenderer.on('message-updated', (_, msg) => {
  messages.value.push(msg)
})
```

**3. 需要立即响应的用户操作**

```typescript
// ❌ 错误示例：用户点击按钮需要立即执行
const handleClick = () => {
  useQuery({ query: () => doSomething() })  // 错误！useQuery 是声明式的
}

// ✅ 正确做法：使用 useMutation 或直接调用
const { mutate } = useMutation({
  mutation: () => doSomething()
})
```

**4. 一次性初始化操作**

```typescript
// ❌ 错误示例：应用启动时的初始化
useQuery({ query: () => initializeApp() })  // 不需要缓存和去重

// ✅ 正确做法：直接调用或使用 onMounted
onMounted(() => {
  initializeApp()
})
```

**5. 需要精确控制时机的操作**

```typescript
// ❌ 错误示例：需要用户确认后才执行
const { data } = useQuery({
  query: () => deleteFile(),  // 会在组件挂载时自动执行，错误！
})

// ✅ 正确做法：使用 useMutation
const { mutate } = useMutation({
  mutation: () => deleteFile()
})
// 在用户确认后调用 mutate()
```

**6. 副作用操作（非数据获取）**

```typescript
// ❌ 错误示例：发送消息、保存文件等
useQuery({ query: () => sendMessage() })  // 这是 mutation，不是 query

// ✅ 正确做法：使用 useMutation
const { mutate } = useMutation({
  mutation: (content) => sendMessage(content)
})
```

**7. 需要取消的操作**

```typescript
// ❌ 错误示例：需要支持取消的长时间操作
const { data } = useQuery({
  query: () => longRunningOperation()  // colada 的取消机制可能不够灵活
})

// ✅ 正确做法：使用 AbortController 或保持现有实现
```

### 1.4 判断标准（决策树）

使用以下标准判断是否适合使用 `useQuery`：

```
是否用于获取数据？
├─ 否 → 使用 useMutation 或直接调用
└─ 是 → 数据是否通过 IPC 调用获取？
    ├─ 否 → 使用其他方式
    └─ 是 → 是否需要实时更新？
        ├─ 是（事件推送）→ ❌ 不使用 useQuery，保持事件监听
        └─ 否 → 是否需要缓存？
            ├─ 否 → ⚠️ 谨慎使用，设置 staleTime: 0
            └─ 是 → 是否会被多个组件同时调用？
                ├─ 是 → ✅ 非常适合，自动去重
                └─ 否 → ✅ 可以使用，获得缓存和状态管理优势
```

## 二、实现方案

### 2.1 创建 IPC Query Adapter

在 `src/renderer/src/composables/useIpcQuery.ts` 创建适配器：

```typescript
import { useQuery } from '@pinia/colada'
import { usePresenter } from './usePresenter'

// 将 IPC 调用包装成 query 函数
export function useIpcQuery<T>(
  presenterName: string,
  method: string,
  key: () => unknown[],
  options?: { enabled?: () => boolean }
) {
  const presenter = usePresenter(presenterName)
  
  return useQuery({
    key,
    query: () => presenter[method](),
    enabled: options?.enabled
  })
}
```

### 2.2 渐进式集成策略

**阶段 1：试点集成（低风险）**

- 选择 `mcpStore.loadConfig()` 作为试点
- 保持现有代码不变，新增 colada 版本
- 验证缓存和去重效果

**阶段 2：扩展集成**

- 扩展到其他配置类数据获取
- 创建通用的 `useIpcQuery` composable
- 逐步替换 store 中的数据获取方法

**阶段 3：Mutation 集成**

- 使用 `useMutation` 处理写操作
- 实现自动缓存失效（invalidateQueries）

### 2.3 具体实现步骤

1. **安装依赖**
   ```bash
   # 注意：Electron 项目中，renderer 进程使用的库应安装到 devDependencies
   pnpm add -D @pinia/colada
   ```


**说明**：在 Electron 项目中，renderer 进程的代码会被打包到应用中，所以这些依赖不需要在生产环境的 `dependencies` 中，应该放在 `devDependencies` 中。

2. **配置 Pinia Colada**

   - 在 `src/renderer/src/main.ts` 中安装插件
   - 配置缓存策略

3. **创建适配器层**

   - `useIpcQuery.ts` - 查询适配器
   - `useIpcMutation.ts` - 变更适配器（可选）

4. **重构示例 Store**

   - 从 `mcpStore` 开始
   - 将 `loadConfig()` 等改为使用 `useQuery`
   - 保持向后兼容

5. **测试验证**

   - 验证缓存机制
   - 验证请求去重
   - 验证错误处理

## 三、注意事项

### 3.1 IPC 特殊性

- IPC 调用可能返回 `null`（错误时），需要处理
- 某些数据需要实时更新，不适合缓存
- 事件驱动的数据更新需要结合事件监听

### 3.2 兼容性考虑

- 保持现有 API 不变，避免破坏性变更
- 可以同时使用 colada 和传统方式
- 逐步迁移，不强制一次性替换

### 3.3 性能考虑

- 缓存策略需要根据数据特性调整
- 某些频繁变化的数据可能需要禁用缓存
- 注意内存使用，避免缓存过多数据

## 四、推荐实施范围

**优先集成**：

- MCP 相关配置和工具列表
- Settings store 中的配置数据
- Sync store 中的备份列表

**后续考虑**：

- Chat store 中的配置数据（非消息列表）
- 其他配置类数据获取

**不建议集成**：

- 实时消息流
- 事件驱动的状态更新
- 需要立即响应的用户操作

## 五、风险评估

**低风险**：

- 渐进式集成，不影响现有功能
- 可以回退到原有实现

**中风险**：

- 需要团队学习新 API
- 某些复杂场景可能需要自定义实现

**建议**：

- 先在非关键路径试点
- 充分测试后再推广
- 保留原有实现作为备选

### To-dos

- [ ] 安装 @pinia/colada 依赖包
- [ ] 在 main.ts 中配置 Pinia Colada 插件
- [ ] 创建 useIpcQuery composable 适配器，将 IPC 调用包装成 query 函数
- [ ] 在 mcpStore 中试点集成，重构 loadConfig() 使用 useQuery
- [ ] 测试验证缓存机制、请求去重和错误处理
- [ ] 扩展到其他配置类数据获取（tools, clients, prompts, resources）
- [ ] 创建 useIpcMutation 适配器处理写操作（可选）