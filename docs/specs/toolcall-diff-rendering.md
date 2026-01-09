# 工具调用差异展示功能 - 实施计划

## 背景和目标

### 背景
项目中的 `markstream-vue` 依赖提供了一个 codeblock node，支持渲染代码差异（diff）展示。该 node 的核心参数包括：
```typescript
diff?: boolean;
originalCode?: string;
updatedCode?: string;
```
前端将使用 `CodeBlockNode` 作为渲染组件，使用方式如下：
```typescript
import { CodeBlockNode } from 'markstream-vue'
```
```vue
<CodeBlockNode
  :diff="true"
  :original-code="diffData.originalCode"
  :updated-code="diffData.updatedCode"
/>
```

### 目标
为两个内置工具（`EditText` 和 `TextReplace`）的调用结果提供差异可视化展示：
1. 修改 `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts` 中的返回数据，包含详细的编辑差异
2. 修改 `src/renderer/src/components/message/MessageBlockToolCall.vue`，对成功的工具调用使用 markstream 的 code node 展示 diff
3. 确保向后兼容，不影响其他工具的展示

## 当前状况分析

### 后端实现（agentFileSystemHandler.ts）

#### EditText 方法（713-749 行）
- **当前返回**：直接返回 `diff` 字符串（统一 diff 格式）
- **问题**：缺少结构化的原始代码和更新后的代码
- **位置**：`src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts:748`

#### TextReplace 方法（795-814 行）
- **当前返回**：调用 `replaceTextInFile` 返回的 `TextReplaceResult`，成功时返回 `result.diff || ''`
- **问题**：同上，缺少结构化的原始/更新代码
- **位置**：`src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts:813`

### 前端实现（MessageBlockToolCall.vue）

- **当前渲染**：使用 `<pre>` 标签展示 `responseText`（纯文本 diff）
- **位置**：`src/renderer/src/components/message/MessageBlockToolCall.vue:74-77`
- **问题**：无法利用 markstream 的 diff 渲染能力

## 实施计划

### 阶段一：增强后端响应数据

#### 任务 1.1：定义结构化响应接口
**目标**：为 `EditText` 和 `TextReplace` 定义统一的响应格式

**实现细节**：
```typescript
// 成功响应
interface DiffToolSuccessResponse {
  success: true
  originalCode: string  // 原始代码（用于 markstream 渲染）
  updatedCode: string   // 更新后代码（用于 markstream 渲染）
  replacements?: number  // 替换次数（仅 TextReplace）
}

// 失败响应
interface DiffToolErrorResponse {
  success: false
  error: string
}

type DiffToolResponse = DiffToolSuccessResponse | DiffToolErrorResponse
```

**修改位置**：
- `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts`（在现有接口定义后添加）

#### 任务 1.2：修改 EditText 方法
**目标**：返回包含原始/更新代码的结构化响应

**实现细节**：
1. 读取文件后保存原始内容到 `originalCode`
2. 执行编辑操作后保存修改后内容到 `updatedCode`
3. 在返回前对 `originalCode` 和 `updatedCode` 做截断和隐藏处理（仅保留变化块与前后各 3 行）
4. 返回 JSON 格式的响应对象

**修改位置**：`src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts:713-749`

**伪代码**：
```typescript
async editText(args: unknown, baseDirectory?: string): Promise<string> {
  const parsed = EditTextArgsSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`Invalid arguments: ${parsed.error}`)
  }
  const validPath = await this.validatePath(parsed.data.path, baseDirectory)
  const originalContent = await fs.readFile(validPath, 'utf-8')
  let modifiedContent = originalContent

  // ... 编辑逻辑 ...

  if (!parsed.data.dryRun) {
    await fs.writeFile(validPath, modifiedContent, 'utf-8')
  }

  const { originalCode, updatedCode } = truncateDiffContext(originalContent, modifiedContent, {
    contextLines: 3
  })

  // 返回结构化响应
  const response: DiffToolResponse = {
    success: true,
    originalCode,
    updatedCode
  }
  return JSON.stringify(response)
}
```

#### 任务 1.3：修改 TextReplace 方法
**目标**：返回包含原始/更新代码的结构化响应

**实现细节**：
1. 修改 `replaceTextInFile` 方法返回类型，包含 `originalContent` 和 `modifiedContent`
2. 调用方接收这些数据并构造结构化响应
3. 返回 JSON 格式的响应对象

**修改位置**：
- `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts:564-632`（`replaceTextInFile` 方法）
- `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts:795-814`（`textReplace` 方法）

**伪代码**：
```typescript
private async replaceTextInFile(
  filePath: string,
  pattern: string,
  replacement: string,
  options: {
    global?: boolean
    caseSensitive?: boolean
    dryRun?: boolean
  } = {}
): Promise<TextReplaceResult & { originalContent?: string; modifiedContent?: string }> {
  // ... 现有逻辑 ...

  const originalContent = await fs.readFile(filePath, 'utf-8')
  const normalizedOriginal = this.normalizeLineEndings(originalContent)
  // ... 替换逻辑 ...

  return {
    success: true,
    replacements,
    originalContent: normalizedOriginal,
    modifiedContent
  }
}

async textReplace(args: unknown, baseDirectory?: string): Promise<string> {
  // ... 验证逻辑 ...

  const result = await this.replaceTextInFile(
    validPath,
    parsed.data.pattern,
    parsed.data.replacement,
    {
      global: parsed.data.global,
      caseSensitive: parsed.data.caseSensitive,
      dryRun: parsed.data.dryRun
    }
  )

  const response: DiffToolResponse = {
    success: result.success,
    originalCode: result.originalContent,
    updatedCode: result.modifiedContent,
    replacements: result.replacements,
    error: result.error
  }
  return JSON.stringify(response)
}
```

#### 任务 1.4：响应内容裁剪（性能优化）
**目标**：只返回修改相关片段，保留上下文 3 行，并用占位符隐藏未变更区域

**实现细节**：
1. 基于 `originalContent` 和 `modifiedContent` 计算差异块（可复用 diff 库）
2. 对每个差异块保留上下文 `3` 行
3. 将差异块之间的未变更区域折叠为一行占位符
4. 原始与更新内容分别裁剪，确保两边逻辑一致

**占位符格式（英文）**：
- `... [No changes: 42 lines] ...`

**伪代码**：
```typescript
function buildTruncatedView(
  original: string,
  updated: string,
  context: number
): { originalView: string; updatedView: string } {
  const hunks = computeDiffHunks(original, updated)
  const originalLines = original.split('\n')
  const updatedLines = updated.split('\n')

  const originalRanges = expandHunksWithContext(hunks, context, 'original')
  const updatedRanges = expandHunksWithContext(hunks, context, 'updated')

  const originalView = buildCollapsedText(originalLines, originalRanges)
  const updatedView = buildCollapsedText(updatedLines, updatedRanges)

  return { originalView, updatedView }
}

function buildCollapsedText(lines: string[], ranges: Array<{ start: number; end: number }>) {
  // Merge overlapping ranges, then emit text with placeholders for gaps.
  // Placeholder line: `... [No changes: X lines] ...`
}
```

**修改位置**：
- `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts`（在构造响应前进行裁剪）

#### 任务 1.5：确保错误处理兼容
**目标**：错误情况仍返回可读文本（向后兼容）

**实现细节**：
- 失败时返回简单的错误字符串（不使用 JSON）
- 保持现有错误消息格式


### 阶段二：前端渲染逻辑改造

#### 任务 2.1：检测是否为差异展示工具
**目标**：识别需要 diff 渲染的工具调用

**实现细节**：
- 添加 computed `isDiffTool`，检查 `tool_call.name` 是否为 `editText` 或 `textReplace`
- 检查 `status` 为 `success`
- 检查 `response` 是否为有效的 JSON 且包含必需字段

**修改位置**：`src/renderer/src/components/message/MessageBlockToolCall.vue`（script 部分）

```typescript
const isDiffTool = computed(() => {
  const name = props.block.tool_call?.name || ''
  return (
    props.block.status === 'success' &&
    (name === 'editText' || name === 'textReplace') &&
    hasResponse.value
  )
})
```

#### 任务 2.2：解析响应数据
**目标**：解析 JSON 响应，提取 diff 相关字段

**实现细节**：
- 添加 computed `diffData`，尝试解析 `responseText` 为 JSON
- 提取 `originalCode`、`updatedCode` 字段
- 解析失败时返回 null（降级到纯文本展示）

```typescript
const diffData = computed(() => {
  if (!isDiffTool.value || !hasResponse.value) return null
  try {
    const parsed = JSON.parse(responseText.value)
    if (
      parsed.success &&
      parsed.originalCode &&
      parsed.updatedCode
    ) {
      return {
        originalCode: parsed.originalCode,
        updatedCode: parsed.updatedCode,
        replacements: parsed.replacements
      }
    }
  } catch (e) {
    console.warn('[MessageBlockToolCall] Failed to parse diff response:', e)
  }
  return null
})
```

#### 任务 2.3：集成 markstream code node
**目标**：使用 markstream 的 diff 渲染能力

**实现细节**：
1. 使用 `CodeBlockNode`（`import { CodeBlockNode } from 'markstream-vue'`）
2. 添加条件渲染，当 `diffData` 存在时使用 `CodeBlockNode`
3. 传入 `diff`, `originalCode`, `updatedCode` 参数（确认这些参数已支持）
4. 降级处理：失败时回退到现有的 `<pre>` 展示

**修改位置**：`src/renderer/src/components/message/MessageBlockToolCall.vue:54-78`

**伪代码**：
```vue
<!-- 响应 -->
<div v-if="hasResponse" class="space-y-2 flex-1 min-w-0">
  <div class="flex items-center justify-between gap-2">
    <h5 class="text-xs font-medium text-accent-foreground flex flex-row gap-2 items-center">
      <Icon :icon="isTerminalTool ? 'lucide:terminal' : 'lucide:arrow-down-to-dot'" class="w-4 h-4 text-foreground" />
      {{ isTerminalTool ? t('toolCall.terminalOutput') : t('toolCall.responseData') }}
    </h5>
    <button
      class="text-xs text-muted-foreground hover:text-foreground transition-colors"
      @click.stop="copyResponse"
    >
      <Icon icon="lucide:copy" class="w-3 h-3 inline-block mr-1" />
      {{ responseCopyText }}
    </button>
  </div>

  <!-- Diff 渲染 -->
  <template v-if="diffData">
    <!-- 这里需要根据 markstream 实际 API 调整 -->
    <CodeBlockNode
      :diff="true"
      :original-code="diffData.originalCode"
      :updated-code="diffData.updatedCode"
      class="rounded-md border bg-background text-xs p-2 max-h-64 overflow-auto"
    />
    <div v-if="diffData.replacements !== undefined" class="text-xs text-muted-foreground mt-1">
      {{ t('toolCall.replacementsCount', { count: diffData.replacements }) }}
    </div>
  </template>

  <!-- 降级：纯文本展示 -->
  <pre v-else class="rounded-md border bg-background text-xs p-2 whitespace-pre-wrap break-words max-h-64 overflow-auto">{{ responseText }}</pre>
</div>
```

#### 任务 2.4：复制功能适配
**目标**：diff 模式下复制行为合理

**实现细节**：
- 保持现有 `copyResponse` 方法不变
- 直接复制 `responseText`（JSON 字符串包含完整信息）
- 不需要针对 diff 模式做特殊处理

```typescript
const copyResponse = async () => {
  if (!hasResponse.value) return
  try {
    const textToCopy = responseText.value
    if (window.api?.copyText) {
      window.api.copyText(textToCopy)
    } else {
      await navigator.clipboard.writeText(textToCopy)
    }
    responseCopyText.value = t('common.copySuccess')
    setTimeout(() => {
      responseCopyText.value = t('common.copy')
    }, 2000)
  } catch (error) {
    console.error('[MessageBlockToolCall] Failed to copy response:', error)
  }
}
```

#### 任务 2.5：i18n 支持（可选）
**目标**：添加国际化键值

**实现细节**：
- 添加 `toolCall.replacementsCount` 翻译键
- 在中文和英文语言文件中添加翻译

**修改位置**：
- `src/renderer/src/i18n/zh-CN.json`
- `src/renderer/src/i18n/en-US.json`

```json
{
  "toolCall": {
    "replacementsCount": "已完成 {count} 处替换"
  }
}
```

### 阶段三：测试与验证

#### 任务 3.1：单元测试
**目标**：确保后端方法返回正确格式

**测试场景**：
- `EditText` 成功场景：验证响应包含 `success: true`、`originalCode` 和 `updatedCode`
- `TextReplace` 成功场景：验证响应包含 `success: true`、`originalCode`、`updatedCode`、`replacements`
- 错误场景：验证响应包含 `success: false` 和 `error` 字段

**测试位置**：
- `test/main/presenter/agentPresenter/`（如不存在则创建）

#### 任务 3.2：集成测试
**目标**：确保前后端集成正常

**测试场景**：
- 工具调用成功时，前端正确渲染 diff 视图
- 工具调用失败时，前端降级到纯文本展示
- 其他工具调用不受影响

**测试位置**：
- `test/renderer/components/message/MessageBlockToolCall.test.ts`（如不存在则创建）

#### 任务 3.3：手动测试
**目标**：实际使用场景验证

**测试步骤**：
1. 启动开发环境（`pnpm run dev`）
2. 触发 `EditText` 工具调用，验证 diff 渲染
3. 触发 `TextReplace` 工具调用，验证 diff 渲染和替换次数显示
4. 触发其他工具（如 `readFile`），验证不受影响
5. 测试复制功能

#### 任务 3.4：Lint 和类型检查
**目标**：代码质量检查

**运行命令**：
```bash
pnpm run lint
pnpm run typecheck
pnpm run format
```

## 技术细节

### markstream 集成确认
**重要**：需要确认项目中 markstream code node 的正确导入和使用方式

**待确认**：
1. markstream 组件的导入路径
2. code node 的 props 接口名称
3. 样式类和默认值

**可能的位置**：
- `package.json` 中的 `markstream-vue` 依赖版本
- `src/renderer/src/` 中的 markstream 使用示例

### 向后兼容性
- 现有工具调用继续使用 `<pre>` 展示
- `EditText` 和 `TextReplace` 在失败或响应格式错误时降级到纯文本
- 不影响现有数据结构和 API

### 性能考虑
- 大文件 diff 渲染可能影响性能
- 考虑添加文件大小限制或分块渲染
- `max-h-64` 样式限制高度，避免长 diff 占用过多空间

## 风险与缓解

### 风险 1：markstream 版本兼容
**描述**：项目中 markstream-vue 版本可能不支持 diff 参数

**缓解**：
- 提前检查 `package.json` 中 markstream-vue 版本
- 查阅对应版本的文档
- 必要时升级依赖

### 风险 2：JSON 解析失败
**描述**：现有历史数据或错误响应可能不是 JSON 格式

**缓解**：
- 使用 try-catch 包裹 JSON.parse
- 解析失败时降级到纯文本展示
- 添加日志记录便于调试

### 风险 3：大文件性能问题
**描述**：超大文件的 diff 可能导致前端卡顿

**缓解**：
- 保持现有的 `max-h-64` 限制
- 考虑添加文件大小阈值（如 > 1MB 时提示）
- 未来可考虑虚拟滚动优化

## 后续优化方向

1. **增强 diff 展示**：支持行内 diff、高亮修改行等高级功能
2. **用户交互**：允许用户在原始/更新/diff 视图之间切换
3. **历史对比**：保存编辑历史，支持时间轴查看
4. **批量操作**：支持一次性查看多个文件的修改
5. **导出功能**：支持导出 diff 为 `.patch` 文件

## 附录

### 相关文件清单

**后端**：
- `src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts`

**前端**：
- `src/renderer/src/components/message/MessageBlockToolCall.vue`
- `src/renderer/src/i18n/zh-CN.json`
- `src/renderer/src/i18n/en-US.json`

**测试**（可选）：
- `test/main/presenter/agentPresenter/agentFileSystemHandler.test.ts`
- `test/renderer/components/message/MessageBlockToolCall.test.ts`

### 关键代码行引用

- `EditText` 方法返回：`src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts:748`
- `TextReplace` 方法返回：`src/main/presenter/agentPresenter/acp/agentFileSystemHandler.ts:813`
- 前端响应展示：`src/renderer/src/components/message/MessageBlockToolCall.vue:74-77`

### 检查清单

实施完成后需确认：

- [ ] `EditText` 返回包含 `success`、`originalCode`、`updatedCode` 的 JSON
- [ ] `TextReplace` 返回包含 `success`、`originalCode`、`updatedCode`、`replacements` 的 JSON
- [ ] 前端正确解析并使用 markstream 渲染 diff
- [ ] 错误情况降级到纯文本展示
- [ ] 复制功能正常工作
- [ ] 其他工具不受影响
- [ ] 单元测试通过
- [ ] Lint 和类型检查通过
- [ ] 手动测试验证成功
