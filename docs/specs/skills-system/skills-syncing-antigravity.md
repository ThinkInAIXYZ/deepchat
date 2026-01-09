# Google Antigravity Workflows 格式规格

> 本文档是 [skills-syncing.md](./skills-syncing.md) 的子文档，描述 Google Antigravity Workflows 的格式规格和转换规则。

## 1. 基本信息

| 属性 | 值 |
|------|-----|
| 工具名称 | Antigravity (Google Project IDX) |
| Workflows 目录 | `.agent/workflows/` |
| 文件模式 | `*.md` |
| 格式类型 | YAML frontmatter + Markdown |
| Frontmatter | **有** (仅 description) |

## 2. 目录结构

```
.agent/workflows/
├── code-review.md
├── generate-tests.md
├── deploy.md
└── refactor.md
```

**特点**：
- 每个 Workflow 是**单个 Markdown 文件**
- 文件名即 Workflow 名称
- 不支持子文件夹结构
- 使用 `## Steps` + 编号步骤结构

## 3. Workflow 格式

### 3.1 完整示例

```markdown
---
description: Generate unit tests for existing code
---

## Steps

### 1. Analyze Target File

- Read the specified code file
- Identify all exported functions and classes
- Note any existing test patterns in the codebase

### 2. Generate Test Cases

For each exported function:
- Create at least 3 test cases
- Cover edge cases and error conditions
- Use clear, descriptive test names

### 3. Write Test File

```javascript
import { describe, it, expect } from 'vitest'
import { functionName } from './target-file'

describe('functionName', () => {
  it('should handle normal case', () => {
    // test implementation
  })
})
```

### 4. Verify Tests

Run the generated tests:
```bash
npm test
```
```

### 3.2 结构说明

| 部分 | 必需 | 说明 |
|------|------|------|
| YAML frontmatter | ❌ 否 | 可选，仅支持 `description` |
| `description` | ❌ 否 | workflow 描述 |
| `## Steps` | ✅ 是 | 步骤容器 |
| `### N. Step Name` | ✅ 是 | 编号步骤 |

### 3.3 Frontmatter 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `description` | string | ❌ 否 | Workflow 描述 |

**注意**：Antigravity 的 frontmatter 仅支持 `description` 字段，不支持 `name`、`tools`、`model` 等。

### 3.4 调用方式

在 Project IDX / Antigravity 中：
1. 打开命令面板
2. 选择 "Run Workflow"
3. 选择要运行的 workflow

或在 AI 对话中提及 workflow 名称。

## 4. 发现机制

Antigravity 从以下位置发现 Workflows：

1. **项目目录**：`.agent/workflows/`
2. **全局配置**：用户级 workflows（如有）

## 5. 与 DeepChat 的转换

### 5.1 兼容性

| 能力 | Antigravity | DeepChat | 转换 |
|------|:-----------:|:--------:|------|
| name | ✅ (从文件名) | ✅ | 提取文件名 |
| description | ✅ | ✅ | 直接映射 |
| instructions | ✅ (Steps) | ✅ | Steps 作为 instructions |
| allowedTools | ❌ | ✅ | 导出时丢失 |
| model | ❌ | ✅ | 导出时丢失 |
| references/ | ❌ | ✅ | 导出时丢失 |
| scripts/ | ❌ | ✅ | 导出时丢失 |

### 5.2 导入转换 (Antigravity → DeepChat)

```typescript
function convertFromAntigravity(content: string, filename: string): DeepChatSkill {
  const { data, body } = grayMatter(content)

  // 从文件名提取 name
  const name = filename.replace('.md', '')

  return {
    name,
    description: data.description || '',
    instructions: body,
    allowedTools: undefined,
    model: undefined,
    references: undefined,
    scripts: undefined
  }
}
```

### 5.3 导出转换 (DeepChat → Antigravity)

```typescript
function convertToAntigravity(skill: DeepChatSkill): string {
  let output = ''

  // 添加 frontmatter（如果有 description）
  if (skill.description) {
    output += `---\ndescription: ${skill.description}\n---\n\n`
  }

  // 检查 instructions 是否已有步骤结构
  if (skill.instructions.includes('## Steps') ||
      skill.instructions.includes('### 1.') ||
      skill.instructions.includes('### Step 1')) {
    output += skill.instructions
  } else {
    // 将整个 instructions 包装为步骤结构
    output += `## Steps\n\n### 1. Execute\n\n${skill.instructions}`
  }

  return output
}
```

### 5.4 转换警告

导出到 Antigravity 时：

| 丢失内容 | 处理方式 |
|----------|----------|
| `allowedTools` | 静默丢失 |
| `model` | 静默丢失 |
| `references/` | 静默丢失 |
| `scripts/` | 静默丢失 |

导入到 DeepChat 时：

| 转换内容 | 处理方式 |
|----------|----------|
| 步骤结构 | 保持原样作为 instructions |
| 无额外信息丢失 | - |

### 5.5 步骤结构智能检测

在导出时，检测现有步骤结构：

```typescript
function hasStepsStructure(content: string): boolean {
  const patterns = [
    /^## Steps/m,
    /^### \d+\./m,
    /^### Step \d+/m
  ]
  return patterns.some(p => p.test(content))
}
```

如果原 instructions 已有步骤结构，保持原样；否则包装为单一步骤。

## 6. 与 Windsurf 的比较

Antigravity 和 Windsurf 的格式非常相似：

| 特性 | Antigravity | Windsurf |
|------|-------------|----------|
| 目录 | `.agent/workflows/` | `.windsurf/workflows/` |
| Frontmatter | 有 (仅 description) | 无 |
| 步骤结构 | `## Steps` + `### N.` | `## Steps` + `### N.` |
| 描述位置 | frontmatter | 标题后首段 |

### 6.1 通用转换

由于格式相似，可以创建通用的步骤式 Markdown 适配器：

```typescript
class StepsMarkdownAdapter {
  parse(content: string, hasDescription: boolean): ParsedWorkflow {
    // 通用解析逻辑
  }

  serialize(workflow: ParsedWorkflow, includeDescription: boolean): string {
    // 通用序列化逻辑
  }
}
```

## 7. 参考资源

- [Customize Antigravity Rules and Workflows](https://atamel.dev/posts/2025/11-25_customize_antigravity_rules_workflows/)
- [Project IDX Documentation](https://idx.dev/docs)
