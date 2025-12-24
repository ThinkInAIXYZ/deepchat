---
name: Workspace Presenter 合并与高性能文件搜索优化
overview: 合并 acpWorkspacePresenter 和 workspacePresenter，使用 ripgrep 流式处理优化文件搜索，实现 workspace-scoped 的 @ 文件引用，并加入性能优化和安全机制。
todos:
  - id: merge-presenters
    content: 合并 acpWorkspacePresenter 和 workspacePresenter 为统一的 WorkspacePresenter，统一使用 WorkspaceFileNode 类型，移除 acpWorkspacePresenter 相关代码
    status: pending
  - id: update-types
    content: 删除 IAcpWorkspacePresenter 类型定义和相关类型，统一使用 IWorkspacePresenter
    status: pending
    dependencies:
      - merge-presenters
  - id: update-main-registration
    content: 更新主 Presenter 注册逻辑，移除 acpWorkspacePresenter 属性，统一使用 workspacePresenter
    status: pending
    dependencies:
      - merge-presenters
  - id: create-ripgrep-searcher
    content: 创建 ripgrepSearcher.ts，实现流式文件搜索，使用异步生成器避免内存爆炸，支持 JSON 输出解析和早期终止
    status: pending
  - id: create-file-searcher
    content: 创建 fileSearcher.ts，封装 ripgrepSearcher，提供高级搜索接口，实现结果分页、排序和缓存
    status: pending
    dependencies:
      - create-ripgrep-searcher
  - id: create-file-cache
    content: 创建 fileCache.ts，实现基于 mtime 的文件内容缓存，支持 TTL 和 LRU 淘汰
    status: pending
  - id: create-path-resolver
    content: 创建 pathResolver.ts，实现 workspace-scoped 路径解析，严格验证路径不超出 workspace 边界，支持相对路径和 ~ 扩展（仅在 main 层用于安全验证）
    status: pending
  - id: create-workspace-file-search
    content: 创建 workspaceFileSearch.ts，实现多策略文件搜索（精确路径、文件名匹配、模糊搜索），结果按相关性排序，接收纯字符串查询
    status: pending
    dependencies:
      - create-path-resolver
      - create-file-searcher
  - id: create-file-security
    content: 创建 fileSecurity.ts，实现敏感文件保护和二进制文件检测机制
    status: pending
  - id: create-concurrency-limiter
    content: 创建 concurrencyLimiter.ts，实现并发限制器，限制同时进行的文件操作数量
    status: pending
  - id: add-search-methods
    content: 在 WorkspacePresenter 中添加 searchFiles 方法，接收纯字符串查询（不处理 @ 符号）
    status: pending
    dependencies:
      - create-workspace-file-search
      - create-file-security
  - id: create-file-reference-extractor-renderer
    content: 在渲染层创建文件引用提取工具，在 suggestion.ts 中提取 @ 后面的查询字符串
    status: pending
  - id: create-workspace-mention-composable
    content: 创建 useWorkspaceMention.ts composable，监听 workspace 路径变化，在 agent 模式下使用防抖搜索文件并更新 mention 数据
    status: pending
    dependencies:
      - add-search-methods
  - id: update-mention-system
    content: 更新 mention suggestion 系统，在 agent/acp agent 模式下集成 workspace 文件搜索，优化结果显示顺序
    status: pending
    dependencies:
      - create-workspace-mention-composable
  - id: integrate-chatinput
    content: 在 ChatInput.vue 中集成 useWorkspaceMention，确保在 agent/acp agent 模式下启用 workspace 文件搜索
    status: pending
    dependencies:
      - update-mention-system
  - id: update-renderer-stores
    content: 更新渲染进程中的 stores 和组件，统一使用 workspacePresenter，移除所有对 acpWorkspacePresenter 的引用
    status: pending
    dependencies:
      - update-main-registration
  - id: delete-acp-workspace-presenter
    content: 删除 acpWorkspacePresenter 目录和相关文件，所有功能已合并到 workspacePresenter
    status: pending
    dependencies:
      - update-renderer-stores
  - id: optimize-ripgrep-args
    content: 优化 ripgrep 调用参数，添加线程数、文件大小、列数限制，跳过二进制文件
    status: pending
    dependencies:
      - create-ripgrep-searcher
---

# Workspace Presenter 合并与高性能文件搜索优化

## 目标

1. **合并两个 Presenter**：统一 `acpWorkspacePresenter` 和 `workspacePresenter` 为单一的 `WorkspacePresenter`
2. **高性能文件搜索**：使用 ripgrep 流式处理优化文件搜索，支持异步生成器和结果分页
3. **增强 @ 文件查询**：在 agent/acp agent 模式下支持 workspace-scoped 的文件搜索，使用优化的正则表达式提取 @ 引用
4. **性能优化**：实现缓存策略、并发限制、结果分页
5. **安全机制**：路径安全验证、敏感文件保护、二进制文件检测

## 实施步骤

### 阶段 1: 合并 Workspace Presenter

#### 1.1 创建统一的 WorkspacePresenter

- **文件**: `src/main/presenter/workspacePresenter/index.ts`
- **变更**:
- 统一使用 `WorkspaceFileNode` 类型（内部实现）
- 支持 `registerWorkdir` 方法（作为 `registerWorkspace` 的别名，用于 ACP 场景）
- 合并 `allowedWorkdirs` 和 `allowedWorkspaces` 为统一的 `allowedPaths` Set
- 统一路径检查逻辑，使用 `fs.realpathSync` 处理符号链接

### 阶段 2: 高性能 ripgrep 文件搜索

#### 2.1 创建流式文件搜索器

- **新文件**: `src/main/presenter/workspacePresenter/ripgrepSearcher.ts`
- **核心功能**:
- 实现异步生成器 `files(pattern, path): AsyncGenerator<string>` 进行流式处理
- 使用 `spawn` 调用 ripgrep，解析 JSON 输出流
- 自动排除 `.git`、`node_modules` 等常见忽略目录
- 支持结果限制和早期终止
- 错误处理和超时控制

**实现要点**：

```typescript
class RipgrepSearcher {
  static async *files(
    pattern: string,
    workspacePath: string,
    options?: { maxResults?: number; excludePatterns?: string[] }
  ): AsyncGenerator<string> {
    const args = [
      '--files',                    // 只列出文件
      '--glob', pattern || '**',    // glob 模式
      '--json',                     // JSON 输出
      workspacePath
    ]
    
    // 添加排除模式
    if (options?.excludePatterns) {
      for (const exclude of options.excludePatterns) {
        args.push('--glob', `!${exclude}`)
      }
    }
    
    const proc = spawn(rgPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    
    let count = 0
    for await (const line of proc.stdout) {
      const json = JSON.parse(line.toString())
      if (json.type === 'begin') {
        yield json.path
        count++
        if (options?.maxResults && count >= options.maxResults) {
          proc.kill()
          break
        }
      }
    }
  }
}
```



#### 2.2 创建文件搜索工具模块

- **新文件**: `src/main/presenter/workspacePresenter/fileSearcher.ts`
- **功能**:
- 封装 `RipgrepSearcher`，提供高级搜索接口
- 实现结果分页（支持 cursor 机制）
- 按修改时间排序（使用 `fs.stat` 获取 mtime）
- 结果缓存（基于文件路径和 mtime）
- 并发限制（最多 10 个并发搜索）

**API 设计**：

```typescript
interface SearchOptions {
  maxResults?: number
  cursor?: string
  sortBy?: 'name' | 'modified'
  excludePatterns?: string[]
}

interface SearchResult {
  files: string[]
  hasMore: boolean
  nextCursor?: string
  total?: number
}

async function searchFiles(
  workspacePath: string,
  pattern: string,
  options?: SearchOptions
): Promise<SearchResult>
```



#### 2.3 实现文件缓存机制

- **新文件**: `src/main/presenter/workspacePresenter/fileCache.ts`
- **功能**:
- 缓存文件内容和元数据（mtime）
- TTL 机制（默认 1 分钟）
- 基于 mtime 的缓存失效
- 内存限制和 LRU 淘汰

### 阶段 3: @ 文件引用系统（渲染层处理）

#### 3.1 在渲染层实现 @ 引用提取

- **文件**: `src/renderer/src/components/editor/mention/suggestion.ts`
- **功能**:
- 在 `items` 函数中检测 query 是否以 `@` 开头
- 如果以 `@` 开头，提取 `@` 后面的部分作为查询字符串
- 使用正则表达式：`/^@(.*)$/` 提取查询部分
- 将提取的查询字符串传递给 workspace 搜索

**实现要点**：

```typescript
// 在 suggestion.ts 的 items 函数中
items: ({ query }) => {
  // 检测是否为 @ 文件引用
  if (query?.startsWith('@')) {
    // 提取 @ 后面的查询字符串（去除 @ 符号）
    const fileQuery = query.slice(1)  // 移除 @ 符号
    
    // 调用 workspace 搜索（传入纯字符串查询）
    if (workspaceMention) {
      workspaceMention.searchWorkspaceFiles(fileQuery)
    }
    
    // 返回 workspace 文件结果
    return workspaceFileResults.value
  }
  
  // 原有的其他 mention 逻辑...
}
```



#### 3.2 实现 workspace-scoped 路径解析（main 层用于安全验证）

- **文件**: `src/main/presenter/workspacePresenter/pathResolver.ts`
- **功能**:
- `resolveWorkspacePath(workspaceRoot: string, inputPath: string): string | null`
- 支持相对路径（`.` 和 `..`）
- 支持 `~` 扩展（仅当结果在 workspace 内时）
- 严格验证：拒绝任何解析后超出 workspace 边界的路径
- 使用 `fs.realpathSync` 解析符号链接
- 返回 null 如果路径无效

**安全验证逻辑**：

```typescript
function resolveWorkspacePath(
  workspaceRoot: string,
  inputPath: string
): string | null {
  // 1. 展开 ~
  const expanded = inputPath.replace(/^~/, os.homedir())
  
  // 2. 解析为绝对路径
  const absolute = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(workspaceRoot, expanded)
  
  // 3. 规范化路径
  const normalized = path.normalize(absolute)
  
  // 4. 解析符号链接
  const realPath = fs.realpathSync(normalized)
  
  // 5. 验证在 workspace 边界内
  const workspaceReal = fs.realpathSync(workspaceRoot)
  if (!realPath.startsWith(workspaceReal + path.sep) && 
      realPath !== workspaceReal) {
    return null  // 超出边界
  }
  
  return realPath
}
```



#### 3.3 创建 workspace 文件搜索服务（main 层，接收纯字符串查询）

- **新文件**: `src/main/presenter/workspacePresenter/workspaceFileSearch.ts`
- **功能**:
- `searchWorkspaceFiles(workspacePath: string, query: string): Promise<FileMatch[]>`
- **重要**：query 参数是纯字符串，不包含 `@` 符号（由渲染层处理）
- 先尝试精确路径解析（使用 `pathResolver`，query 可能是 `src/index.ts`）
- 如果解析成功，直接返回该文件
- 如果解析失败或路径模糊，使用 ripgrep 进行模糊搜索
- 支持文件名部分匹配（如 `index` 匹配 `index.ts`）
- 结果按相关性排序（精确匹配 > 文件名匹配 > 路径匹配）

**搜索策略**（query 不包含 @）：

1. 精确路径解析（query: `src/index.ts`）
2. 文件名精确匹配（query: `index.ts`）
3. 文件名部分匹配（query: `index`）
4. 路径包含匹配（query: `src/index`）

#### 3.4 在 WorkspacePresenter 中添加搜索方法

- **文件**: `src/main/presenter/workspacePresenter/index.ts`
- **新增方法**:
  ```typescript
    async searchFiles(workspacePath: string, query: string): Promise<WorkspaceFileNode[]>
  ```




- **重要**：query 参数是纯字符串，不包含 `@` 符号
- 验证 workspacePath 在 allowedPaths 内
- 调用 `workspaceFileSearch.searchWorkspaceFiles`
- 返回匹配的文件节点列表

### 阶段 4: 安全机制

#### 4.1 敏感文件保护

- **新文件**: `src/main/presenter/workspacePresenter/fileSecurity.ts`
- **功能**:
- 定义敏感文件模式（`.env`, `.pem`, `.key`, `credentials`, `secret`, `password`）
- `checkSensitiveFile(filePath: string): void` 方法
- 白名单机制（允许特定路径的敏感文件）

#### 4.2 二进制文件检测

- **文件**: `src/main/presenter/workspacePresenter/fileSecurity.ts`
- **功能**:
- 定义二进制文件扩展名列表
- `isBinaryFile(filePath: string): boolean` 基于扩展名
- `isBinaryContent(content: string): boolean` 基于内容检测（检查 null 字节和不可打印字符比例）

**二进制内容检测算法**：

```typescript
function isBinaryContent(content: string): boolean {
  const length = Math.min(content.length, 10000)
  let nonPrintable = 0
  
  for (let i = 0; i < length; i++) {
    const code = content.charCodeAt(i)
    // 检查 null 字节
    if (code === 0) return true
    // 检查不可打印字符（排除 tab、换行、回车）
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      nonPrintable++
    }
  }
  
  // 阈值：30% 不可打印字符
  return (nonPrintable / length) > 0.3
}
```



### 阶段 5: 渲染进程集成

#### 5.1 创建 workspace mention composable

- **新文件**: `src/renderer/src/components/chat-input/composables/useWorkspaceMention.ts`
- **功能**:
- 监听 workspace 路径变化
- 在 agent/acp agent 模式下，当用户输入 @ 时，异步搜索 workspace 文件
- 使用防抖（debounce）优化搜索频率
- 更新 mention 数据，添加 workspace 文件结果
- **重要**：接收的 query 参数是纯字符串（不包含 @ 符号）

**实现要点**：

```typescript
export function useWorkspaceMention(options: {
  workspacePath: Ref<string | null>
  chatMode: Ref<'chat' | 'agent' | 'acp agent'>
  conversationId: Ref<string | null>
}) {
  const workspacePresenter = usePresenter('workspacePresenter')
  const workspaceFileResults = ref<CategorizedData[]>([])
  
  // 防抖搜索（query 不包含 @ 符号）
  const searchWorkspaceFiles = debounce(async (query: string) => {
    if (!options.workspacePath.value || 
        !['agent', 'acp agent'].includes(options.chatMode.value)) {
      workspaceFileResults.value = []
      return
    }
    
    // query 已经是纯字符串，直接传递给 main 层
    const results = await workspacePresenter.searchFiles(
      options.workspacePath.value,
      query  // 不包含 @ 符号
    )
    
    // 转换为 mention 数据格式
    workspaceFileResults.value = results.map(file => ({
      id: file.path,
      label: file.name,
      icon: file.isDirectory ? 'lucide:folder' : 'lucide:file',
      type: 'item' as const,
      category: 'workspace' as const,
      path: file.path
    }))
  }, 300)
  
  return { searchWorkspaceFiles, workspaceFileResults }
}
```



#### 5.2 更新 mention 系统（在渲染层提取 @ 引用）

- **文件**: `src/renderer/src/components/editor/mention/suggestion.ts`
- **变更**:
- 在 `items` 函数中，检测 query 是否以 `@` 开头
- 如果以 `@` 开头，提取 `@` 后面的部分（去除 @ 符号）
- 检测当前是否为 agent/acp agent 模式
- 如果有 workspace 路径且处于 agent 模式，调用 `useWorkspaceMention` 的搜索方法
- 将搜索结果添加到 mention 数据中，标记为 `workspace` category
- 优化搜索结果的显示顺序（精确匹配优先）

**实现要点**：

```typescript
// 在 suggestion.ts 中
export default {
  items: ({ query }) => {
    // 检测是否为 @ 文件引用（渲染层处理 @ 提取）
    if (query?.startsWith('@')) {
      const fileQuery = query.slice(1)  // 移除 @ 符号，得到纯查询字符串
      
      // 在 agent 模式下搜索 workspace 文件
      if (workspaceMention && isAgentMode) {
        workspaceMention.searchWorkspaceFiles(fileQuery)  // 传入纯字符串
        return workspaceMention.workspaceFileResults.value
      }
      
      return []
    }
    
    // 原有的其他 mention 逻辑...
  }
}
```



#### 5.3 集成到 ChatInput

- **文件**: `src/renderer/src/components/chat-input/ChatInput.vue`
- **变更**:
- 在 `useMentionData` 之后，添加 `useWorkspaceMention` composable
- 传入 `workspace.workspacePath` 和 `chatMode.currentMode`
- 确保只在 agent/acp agent 模式下启用

### 阶段 6: 性能优化

#### 6.1 实现并发限制器

- **新文件**: `src/main/presenter/workspacePresenter/concurrencyLimiter.ts`
- **功能**:
- 限制同时进行的文件操作数量（默认 10）
- 队列机制处理超出限制的请求
- Promise-based 接口

#### 6.2 优化 ripgrep 调用

- **文件**: `src/main/presenter/workspacePresenter/ripgrepSearcher.ts`
- **优化**:
- 添加 `--threads` 参数限制线程数
- 添加 `--max-filesize` 限制文件大小
- 添加 `--max-columns` 限制列数
- 使用 `--binary-files=without-match` 跳过二进制文件

## 技术细节

### ripgrep 流式处理

- 使用异步生成器避免内存爆炸
- 解析 JSON 输出流（`--json` 模式）
- 支持早期终止（达到 maxResults 时 kill 进程）
- 错误处理和超时控制

### @ 引用处理（渲染层）

- 在 `suggestion.ts` 的 `items` 函数中检测 query 是否以 `@` 开头
- 提取 `@` 后面的部分作为纯查询字符串（去除 @ 符号）
- main 层只接收纯字符串查询，不需要知道 @ 的存在
- 这样设计的好处：
- **职责分离**：渲染层处理 UI 交互，main 层只处理文件搜索
- **减少 IPC 通信**：不需要在 main 层处理 @ 符号
- **更好的用户体验**：可以在输入时就实时解析

### 安全边界

- 所有路径操作前必须验证在 `allowedPaths` 内
- 使用 `fs.realpathSync` 解析符号链接
- 路径规范化使用 `path.normalize` 和 `path.resolve`
- 敏感文件检查和二进制文件检测

### 性能优化策略

1. **流式处理**：使用异步生成器避免一次性加载所有结果
2. **结果分页**：支持 cursor 机制，避免返回过多结果
3. **缓存策略**：基于 mtime 的文件内容缓存
4. **并发限制**：限制同时进行的操作数量
5. **防抖优化**：在渲染进程中对搜索请求进行防抖

### 代码清理

- 完全移除 `IAcpWorkspacePresenter` 接口和相关类型
- 完全移除 `acpWorkspacePresenter` 属性
- 所有引用统一使用 `workspacePresenter` 和 `IWorkspacePresenter`
- 删除 `src/main/presenter/acpWorkspacePresenter/` 目录
- 删除 `src/shared/types/presenters/acp-workspace.d.ts` 文件

## 文件清单

### 需要修改的文件

1. `src/main/presenter/workspacePresenter/index.ts` - 统一实现，支持 registerWorkdir 方法
2. `src/main/presenter/index.ts` - 移除 acpWorkspacePresenter，统一使用 workspacePresenter
3. `src/shared/types/presenters/index.d.ts` - 移除 ACP 相关类型导出
4. `src/renderer/src/stores/workspace.ts` - 移除 acpWorkspacePresenter 引用，统一使用 workspacePresenter
5. `src/renderer/src/components/editor/mention/suggestion.ts` - 添加 workspace 搜索
6. `src/renderer/src/components/chat-input/ChatInput.vue` - 集成 workspace mention
7. `src/renderer/src/components/workspace/WorkspaceFileNode.vue` - 如有引用需要更新

### 需要创建的文件

1. `src/main/presenter/workspacePresenter/ripgrepSearcher.ts` - ripgrep 流式搜索封装
2. `src/main/presenter/workspacePresenter/fileSearcher.ts` - 高级文件搜索接口
3. `src/main/presenter/workspacePresenter/fileCache.ts` - 文件缓存机制
4. `src/main/presenter/workspacePresenter/pathResolver.ts` - 路径解析工具（用于安全验证）
5. `src/main/presenter/workspacePresenter/workspaceFileSearch.ts` - workspace 文件搜索服务（接收纯字符串查询）
6. `src/main/presenter/workspacePresenter/fileSecurity.ts` - 安全机制
7. `src/main/presenter/workspacePresenter/concurrencyLimiter.ts` - 并发限制器
8. `src/renderer/src/components/chat-input/composables/useWorkspaceMention.ts` - workspace mention composable（处理 @ 提取）

### 需要删除的文件

- `src/main/presenter/acpWorkspacePresenter/index.ts` - 功能已合并到 workspacePresenter
- `src/main/presenter/acpWorkspacePresenter/directoryReader.ts` - 移动到 workspacePresenter 或共享
- `src/main/presenter/acpWorkspacePresenter/planStateManager.ts` - 移动到 workspacePresenter 或共享
- `src/shared/types/presenters/acp-workspace.d.ts` - 类型已统一到 workspace.d.ts

## 测试要点

1. **Presenter 合并**：验证 agent 和 acp agent 模式都能正常工作
2. **流式搜索**：验证大量文件时不会内存溢出
3. **@ 文件查询**：验证在 agent 模式下输入 @ 能搜索到 workspace 文件
4. **路径安全**：验证超出 workspace 的路径被正确拒绝
5. **敏感文件保护**：验证 `.env` 等敏感文件被正确阻止
6. **二进制检测**：验证二进制文件被正确识别
7. **性能测试**：验证搜索大量文件时的响应时间