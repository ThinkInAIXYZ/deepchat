# Context Files（动态上下文文件体系）实施计划 v2.0

## 0) 核心设计原则
- **Runtime Capability（非 MCP）**：直接集成到主进程，类似 Yo Browser
- **完全解耦**：export/import 独立于用户态 export
- **全局可用**：所有聊天模式可用（不限于 agent）
- **工具命名**：使用 `context_*` 前缀（`context_list`, `context_read`, `context_tail`, `context_grep`）

## 1) 架构组件
### 1.1 Presenter 层
- `IContextFilePresenter`: Presenter 接口定义（`src/shared/types/presenters/contextFiles.presenter.d.ts`）
- `ContextFilePresenter`: 主实现类（`src/main/presenter/contextFiles/ContextFilePresenter.ts`）

### 1.2 Tool 层
- `ContextToolManager`: 工具管理器（`src/main/presenter/contextFiles/ContextToolManager.ts`）
- `tools/types.ts`: Tool 类型定义
- `tools/list.ts`: `context_list` 实现
- `tools/read.ts`: `context_read` 实现（含 `readChunk` helper）
- `tools/tail.ts`: `context_tail` 实现（含 `readTail` helper）
- `tools/grep.ts`: `context_grep` 实现（含 `grepFile`, `runRipgrep`, `runJavaScriptGrep`）

### 1.3 Storage 层
- `ContextStore`: 存储层（`src/main/presenter/contextFiles/contextStore.ts`）- 已存在，无需修改

## 2) 工具列表（context_* 前缀）

### `context_list`
- 列出当前会话已有的 ContextRef（按 kind 过滤）
- 输入：`kind?: 'artifact' | 'history' | 'catalog'`, `limit?: number`（默认 50）
- 输出：`{ items: ContextRef[] }`

### `context_read`
- 分页读取文件内容（避免一次性把大文件塞进上下文）
- 输入：`id`, `offset`（字节偏移，UTF-8）, `limit`（默认 8192, 最大 64KB）
- 输出：`{ id, offset, limit, done, content }`

### `context_tail`
- 读取末尾 N 行（优先用于排障：先看错误段落）
- 输入：`id`, `lines`（默认 200, 最大 2000）
- 输出：`{ id, lines, content }`

### `context_grep`
- 正则搜索（在大输出/历史里快速定位关键词/错误堆栈）
- 输入：`id`, `pattern`, `maxResults`（默认 50）, `contextLines`（默认 0）, `caseSensitive`（默认 false）
- 输出：`{ totalMatches, matches: Array<{ line, content, before?, after? }> }`
- 优先使用 ripgrep（若可用），否则使用 JavaScript 扫描

## 3) 集成点
### 3.1 Presenter 初始化
- `src/main/presenter/index.ts`:
  - 创建 `ContextFilePresenter` 实例
  - 传递给 `ToolPresenter`

### 3.2 ToolManager 集成
- `src/main/presenter/agentPresenter/acp/agentToolManager.ts`:
  - 构造函数接收 `contextFilePresenter: IContextFilePresenter`
  - `getAllToolDefinitions()`: 添加 context tools（所有模式可用）
  - `callTool()`: routing `context_*` 工具到 `ContextFilePresenter`
  - 传递 `conversationId` 给 `ContextFilePresenter.callTool()`

### 3.3 ToolPresenter 集成
- `src/main/presenter/toolPresenter/index.ts`:
  - 构造函数接收 `contextFilePresenter: IContextFilePresenter`
  - 传递给 `AgentToolManager` 初始化

### 3.4 Loop Handler 集成
- `src/main/presenter/agentPresenter/loop/agentLoopHandler.ts`:
  - 初始化 `ToolPresenter` 时传递 `contextFilePresenter`
  - 确保依赖检查包括 `contextFilePresenter`

## 4) Export/Import（完全解耦）
通过 `ContextFilePresenter` 提供：

### `export(conversationId): Promise<ContextExportData>`
- 导出所有 eager 文件
- 返回：
  ```typescript
  {
    conversationId: string
    exportedAt: number
    version: 1
    items: ContextRef[]
    files: Record<string, string>  // 相对路径 -> 内容
  }
  ```

### `import(conversationId, data): Promise<void>`
- 恢复文件到正确路径
- 重建 ContextRef 信息
- lazy refs 在 import 时跳过，按需重建时再生成

### 独立性
- 不随 conversation export 自动执行
- 独立存储，可单独 UI 触发
- 与用户态 export 完全分离

## 5) 实施状态（已完成）
- [x] 1.1 创建 `IContextFilePresenter` 接口
- [x] 1.2 实现 `ContextFilePresenter` 类
- [x] 2.1 创建 `ContextToolManager`
- [x] 2.2 实现 `context_list` tool
- [x] 2.3 实现 `context_read` tool（含 helpers）
- [x] 2.4 实现 `context_tail` tool（含 helpers）
- [x] 2.5 实现 `context_grep` tool（含 helpers）
- [x] 3.1 集成到 main Presenter
- [x] 3.2 集成到 AgentToolManager
- [x] 3.3 集成到 ToolPresenter
- [x] 3.4 集成到 Loop Handler
- [x] 4.1 实现 export API
- [x] 4.2 实现 import API
- [x] 5.1 移除 MCP `ContextServer`
- [x] 5.2 移除 MCP builder registration
- [x] 5.3 移除 MCP config entries
- [x] 5.4 更新 spec.md
- [x] 5.5 更新 plan.md（本文档）

## 6) 测试计划
### 单元测试
- [ ] `ContextFilePresenter` 方法测试
- [ ] `ContextToolManager` tool routing 测试
- [ ] 各个 tool 的实现测试（list, read, tail, grep）
- [ ] export/import 功能测试

### 集成测试
- [ ] `AgentToolManager` 与 `ContextFilePresenter` 集成测试
- [ ] Tool routing 正确性测试（`context_*` 前缀）
- [ ] conversationId 传递正确性测试

### 类型检查与 Lint
- [x] `pnpm run typecheck` 通过
- [x] `pnpm run lint` 通过

## 7) 兼容性
- ✅ `ContextStore` 接口保持不变，完全复用
- ✅ 现有架构无需修改，仅添加新组件
- ✅ 不影响现有 MCP 服务和工具
- ✅ 向后兼容（ContextRef 数据结构保持一致）

## 8) 与 Browser 模式的对比
| 维度 | Browser | Context Files |
|------|---------|---------------|
| 实现方式 | `YoBrowserPresenter` + `BrowserToolManager` | `ContextFilePresenter` + `ContextToolManager` |
| 工具前缀 | `browser_*` | `context_*` |
| 可用范围 | 所有模式（不限于 agent） | 所有模式（不限于 agent） |
| 集成点 | `AgentToolManager` + `ToolPresenter` | `AgentToolManager` + `ToolPresenter` |
| conversationId 传递 | 不需要 | `AgentToolManager.callTool()` → `ContextFilePresenter.callTool()` |
| Export/Import | 不适用 | 完全解耦的独立 API |

## 9) 未来扩展
- 懒加载支持（目前只实现了基础导出 eager 文件）
- 配置化阈值（read limit, tail lines, grep maxResults 等）
- LRU 清理机制（lazy refs）
- 搜索优化（全文检索索引）
- UI 集成（context browser, export/import 界面）
