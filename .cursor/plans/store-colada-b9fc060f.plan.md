<!-- b9fc060f-f4ec-4daf-9fde-d2f9a506e514 51ed5ed6-da96-4aa2-8075-59106c5fbcd0 -->
# Store Colada 集成优化计划

## 一、现有集成分析

### 1. mcp.ts - 已集成，可优化点

- ✅ 已使用 `useIpcQuery` 和 `useIpcMutation`
- ⚠️ `callTool` 方法仍使用手动 loading 状态和错误处理（line 586-626）
- ⚠️ `getPrompt` 和 `readResource` 方法可考虑使用 query
- ⚠️ 部分手动 `runQuery` 调用可以简化

### 2. settings.ts - 未集成

- ❌ 未使用 colada
- 📊 大量数据获取操作可受益：
- `refreshAllModels` (line 691) - 复杂的模型刷新逻辑
- `refreshProviderModels` (line 644) - 单个 provider 模型刷新
- `refreshOllamaModels` (line 1339) - Ollama 模型列表
- `initSettings` (line 301) - 初始化时的多个数据加载

## 二、建议集成的 Store

### 1. prompts.ts - 高优先级

**文件**: `src/renderer/src/stores/prompts.ts`

**现状**: 手动 try-catch，无缓存机制

**优化点**:

- `loadPrompts` → 使用 `useIpcQuery`
- `addPrompt`, `updatePrompt`, `deletePrompt` → 使用 `useIpcMutation` 并自动失效缓存

### 2. sync.ts - 中优先级

**文件**: `src/renderer/src/stores/sync.ts`

**现状**: 手动错误处理，无缓存

**优化点**:

- `refreshBackups` (line 146) → 使用 `useIpcQuery`
- `startBackup`, `importData` → 使用 `useIpcMutation`
- `initialize` 中的多个数据加载可合并为 queries

### 3. searchEngineStore.ts - 中优先级

**文件**: `src/renderer/src/stores/searchEngineStore.ts`

**现状**: 手动错误处理

**优化点**:

- `refreshSearchEngines` (line 29) → 使用 `useIpcQuery`
- `setSearchEngine` → 使用 `useIpcMutation` 并失效相关查询

### 4. theme.ts - 低优先级

**文件**: `src/renderer/src/stores/theme.ts`

**现状**: 简单，主要是设置操作

**建议**: 保持现状，colada 收益不大

## 三、优化实施步骤

### Phase 1: 优化现有集成 (mcp.ts)

1. 将 `callTool` 改为使用 `useIpcMutation`
2. 优化 `getPrompt` 和 `readResource` 使用 query（如果适用）
3. 简化手动 `runQuery` 调用

### Phase 2: 集成 prompts.ts

1. 将 `loadPrompts` 改为 `useIpcQuery`
2. 将 CRUD 操作改为 `useIpcMutation`
3. 配置自动缓存失效

### Phase 3: 集成 sync.ts

1. 将 `refreshBackups` 改为 `useIpcQuery`
2. 将 `startBackup` 和 `importData` 改为 `useIpcMutation`
3. 优化 `initialize` 中的数据加载

### Phase 4: 集成 searchEngineStore.ts

1. 将 `refreshSearchEngines` 改为 `useIpcQuery`
2. 将 `setSearchEngine` 改为 `useIpcMutation`

### Phase 5: 评估 settings.ts（可选）

- settings.ts 文件较大（1994行），需要仔细评估
- 建议先完成其他 store，再评估 settings.ts 的集成价值

## 四、注意事项

1. **保持向后兼容**: 确保现有 API 不变
2. **错误处理**: 使用 colada 的错误处理机制，但保留必要的用户提示
3. **缓存策略**: 合理设置 `staleTime` 和 `gcTime`
4. **事件监听**: 对于事件驱动的更新（如 upgrade.ts），保持现有模式
5. **文件大小**: 遵循 200 行限制，必要时拆分 store

## 五、架构决策：usePresenter vs useIpcQuery/useIpcMutation

### 不应该完全替换 usePresenter 的原因

1. **职责分离原则**
   - `usePresenter`: 通用底层接口，用于所有类型的 IPC 调用
   - `useIpcQuery`: 专门用于**可缓存的读取操作**
   - `useIpcMutation`: 专门用于**数据变更操作**

2. **不适合用 Query 的场景**

   - **流式接口**: `startStreamCompletion`, `continueStreamCompletion` (chat.ts)
     - 原因: 持续数据流，不是一次性查询，无法缓存
   - **副作用操作**: `sendMessage`, `retryMessage` (chat.ts)
     - 原因: 这些是变更操作，应该用 mutation
   - **工具调用**: `callTool` (mcp.ts line 586)
     - 原因: 可能产生副作用，结果可能不需要长期缓存
   - **事件驱动的操作**: upgrade.ts 中的更新检查
     - 原因: 主要通过事件监听，不是查询模式

3. **缓存生命周期管理**

   - Query 适合: 相对静态的数据（配置、列表等）
   - Mutation 适合: 会改变服务器状态的操作
   - usePresenter 适合: 流式、副作用、一次性操作

### 推荐的使用模式

```typescript
// ✅ 读取操作 - 使用 useIpcQuery
const promptsQuery = useIpcQuery({
  presenter: 'configPresenter',
  method: 'getCustomPrompts',
  key: () => ['prompts', 'custom'],
  staleTime: 60_000
})

// ✅ 变更操作 - 使用 useIpcMutation
const addPromptMutation = useIpcMutation({
  presenter: 'configPresenter',
  method: 'addCustomPrompt',
  invalidateQueries: () => [['prompts', 'custom']]
})

// ✅ 流式/副作用 - 继续使用 usePresenter
const threadP = usePresenter('threadPresenter')
await threadP.startStreamCompletion(...)
```

### 判断标准

| 操作类型 | 使用工具 | 示例 |

|---------|---------|------|

| 读取配置/列表 | `useIpcQuery` | `getCustomPrompts`, `getMcpServers` |

| 数据变更 | `useIpcMutation` | `addMcpServer`, `updateCustomPrompt` |

| 流式数据 | `usePresenter` | `startStreamCompletion` |

| 一次性操作 | `usePresenter` | `callTool`, `sendMessage` |

| 事件驱动 | `usePresenter` | `checkUpdate` (配合事件监听) |

## 六、预期收益

- ✅ 统一的数据加载和错误处理模式
- ✅ 自动缓存管理，减少不必要的请求
- ✅ 更好的 loading 状态管理
- ✅ 代码更简洁，减少样板代码
- ✅ 更好的类型安全
- ✅ 清晰的职责分离，避免缓存生命周期问题

### To-dos

- [x] 优化 mcp.ts 中的 callTool 方法，使用 useIpcMutation 替代手动 loading 状态管理
- [x] 为 prompts.ts 集成 colada：loadPrompts 使用 useIpcQuery，CRUD 操作使用 useIpcMutation
- [x] 为 sync.ts 集成 colada：refreshBackups 使用 useIpcQuery，startBackup 和 importData 使用 useIpcMutation
- [x] 为 searchEngineStore.ts 集成 colada：refreshSearchEngines 使用 useIpcQuery，setSearchEngine 使用 useIpcMutation
- [ ] 评估 settings.ts 的 colada 集成价值，确定是否需要集成（文件较大，需谨慎）

### 最新进展

- 通过 useIpcMutation 简化了 mcp 中的 callTool，colada 现在处理工具调用的成功/错误，并继续维护 per-tool loading/result 状态。
- prompts.ts 现在用 useIpcQuery 获取自定义 prompts，CRUD 操作都通过 useIpcMutation 并自动失效缓存。
- sync.ts 中的备份列表从 query 读取，startBackup/importData 依赖 mutation，调用结束后会刷新缓存。
- searchEngineStore.ts 通过 query 组合线程默认和自定义引擎列表，并用 mutation 设置活跃引擎，当前设置也会自动写入配置。
- settings.ts 的 colada 评估仍未展开，需要等待其他 store 稳定再评估是否值得整合。
