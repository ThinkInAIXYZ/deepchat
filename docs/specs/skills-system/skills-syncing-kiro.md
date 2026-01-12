# Kiro Steering Files 格式规格

> 本文档是 [skills-syncing.md](./skills-syncing.md) 的子文档，描述 Kiro Steering Files 的格式规格和转换规则。

## 1. 基本信息

| 属性 | 值 |
|------|-----|
| 工具名称 | Kiro |
| Steering 目录 | `.kiro/steering/` |
| 文件模式 | `*.md` |
| 格式类型 | YAML frontmatter + Markdown |
| Frontmatter | **可选** |

## 2. 目录结构

```
.kiro/steering/
├── product.md                # 产品概述（always included）
├── tech.md                   # 技术栈（always included）
├── structure.md              # 项目结构（always included）
├── react-components.md       # 条件包含
├── api-patterns.md           # 按需引用
└── testing-guidelines.md     # 按需引用
```

**特点**：
- 每个 Steering File 是**单个 Markdown 文件**
- 文件名即 Steering File 名称
- 不支持子文件夹结构
- 支持三种**包含模式**（inclusion modes）
- 支持 `#filename` 引用语法

## 3. Steering File 格式

### 3.1 完整示例

**Always Inclusion（始终包含）**：
```markdown
---
title: Product Overview
inclusion: always
---

# Product Overview

This is a React-based e-commerce platform with the following features:
- User authentication
- Product catalog
- Shopping cart
- Order management
```

**Conditional Inclusion（条件包含）**：
```markdown
---
title: React Component Guidelines
inclusion: conditional
file_patterns: ["*.jsx", "*.tsx", "src/components/**/*"]
---

# React Component Guidelines

## Naming Conventions
- Use PascalCase for component names
- Use camelCase for props

## Structure
- One component per file
- Co-locate styles and tests
```

**On-Demand（按需引用）**：
```markdown
---
title: API Patterns
---

# API Patterns

## REST Endpoints
- Use plural nouns for resources
- Use HTTP verbs correctly

## Error Handling
- Return consistent error format
- Include error codes
```

### 3.2 Frontmatter 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `title` | string | ❌ 否 | 显示名称，用于 `#filename` 引用 |
| `inclusion` | string | ❌ 否 | 包含模式：`always` 或 `conditional` |
| `file_patterns` | string[] | ❌ 否 | 仅在 `conditional` 模式下使用 |

### 3.3 包含模式（Inclusion Modes）

| 模式 | 触发条件 | 说明 |
|------|----------|------|
| `always` | 每次对话 | 始终包含在 AI 上下文中 |
| `conditional` | 文件匹配 | 当操作的文件匹配 `file_patterns` 时包含 |
| 无 `inclusion` | 手动引用 | 通过 `#filename` 显式引用 |

### 3.4 file_patterns 语法

支持 glob 模式：

```yaml
file_patterns:
  - "*.jsx"                    # 所有 JSX 文件
  - "*.tsx"                    # 所有 TSX 文件
  - "src/components/**/*"      # components 目录下所有文件
  - "**/*.test.ts"             # 所有测试文件
```

### 3.5 调用方式

**自动包含**：
- `always` 模式的文件自动包含
- `conditional` 模式根据当前文件自动触发

**手动引用**：
在对话中使用 `#` 加文件名（不含 .md）：
```
Check #api-patterns for the REST conventions
Follow #react-components guidelines
```

## 4. 发现机制

Kiro 从以下位置发现 Steering Files：

1. **项目目录**：`.kiro/steering/`
2. 递归扫描工作区内的 `.kiro/steering/` 目录

**注意**：
- 同名文件可能产生冲突
- `always` 模式文件会增加每次对话的 token 消耗

## 5. 与 DeepChat 的转换

### 5.1 兼容性

| 能力 | Kiro | DeepChat | 转换 |
|------|:----:|:--------:|------|
| name | ✅ (title/filename) | ✅ | 提取 title 或文件名 |
| description | ❌ | ✅ | 导出时丢失 |
| instructions | ✅ | ✅ | Markdown body |
| allowedTools | ❌ | ✅ | 导出时丢失 |
| model | ❌ | ✅ | 导出时丢失 |
| references/ | ❌ | ✅ | 导出时丢失 |
| scripts/ | ❌ | ✅ | 导出时丢失 |
| inclusion | ✅ | ❌ | 导入时记录，导出时设置 |
| file_patterns | ✅ | ❌ | 导入时记录，导出时设置 |

### 5.2 导入转换 (Kiro → DeepChat)

```typescript
function convertFromKiro(content: string, filename: string): DeepChatSkill {
  const { data, body } = grayMatter(content)

  // 从 title 或文件名提取 name
  const name = data.title
    ? data.title.toLowerCase().replace(/\s+/g, '-')
    : filename.replace('.md', '')

  // 将 inclusion 信息嵌入到 instructions 开头
  let instructions = body
  if (data.inclusion) {
    const inclusionNote = `<!-- Kiro inclusion: ${data.inclusion} -->\n`
    if (data.file_patterns?.length) {
      instructions = `${inclusionNote}<!-- file_patterns: ${data.file_patterns.join(', ')} -->\n\n${body}`
    } else {
      instructions = `${inclusionNote}\n${body}`
    }
  }

  return {
    name,
    description: '', // Kiro 没有专门的 description 字段
    instructions,
    allowedTools: undefined,
    model: undefined,
    references: undefined,
    scripts: undefined,
    // 保存 Kiro 特有信息用于后续导出
    _kiro: {
      inclusion: data.inclusion,
      filePatterns: data.file_patterns
    }
  }
}
```

### 5.3 导出转换 (DeepChat → Kiro)

```typescript
interface KiroExportOptions {
  inclusion?: 'always' | 'conditional'
  filePatterns?: string[]
}

function convertToKiro(skill: DeepChatSkill, options?: KiroExportOptions): string {
  const frontmatter: Record<string, unknown> = {}

  // 转换 name 为 title
  const title = skill.name
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  frontmatter.title = title

  // 设置 inclusion 模式
  if (options?.inclusion) {
    frontmatter.inclusion = options.inclusion
    if (options.inclusion === 'conditional' && options.filePatterns?.length) {
      frontmatter.file_patterns = options.filePatterns
    }
  }

  // 如果有 description，嵌入到 instructions 开头
  let instructions = skill.instructions
  if (skill.description) {
    instructions = `> ${skill.description}\n\n${instructions}`
  }

  const yaml = Object.keys(frontmatter).length > 0
    ? `---\n${yamlDump(frontmatter)}---\n\n`
    : ''

  return yaml + instructions
}
```

### 5.4 转换警告

导出到 Kiro 时：

| 丢失内容 | 处理方式 |
|----------|----------|
| `description` | 嵌入到 instructions 开头（作为引用块） |
| `allowedTools` | 静默丢失 |
| `model` | 静默丢失 |
| `references/` | 静默丢失 |
| `scripts/` | 静默丢失 |

导入到 DeepChat 时：

| 转换内容 | 处理方式 |
|----------|----------|
| `inclusion` 模式 | 作为注释嵌入 instructions |
| `file_patterns` | 作为注释嵌入 instructions |
| 无 `description` | 设为空字符串 |

### 5.5 导出选项 UI

由于 Kiro 支持 inclusion 模式，导出时应提供选项：

```
┌────────────────────────────────────────────────────────────┐
│ Kiro 导出选项                                               │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ 包含模式:                                                   │
│ ○ 按需引用 (默认，通过 #name 手动引用)                      │
│ ○ 始终包含 (每次对话自动包含)                               │
│ ○ 条件包含 (根据文件模式自动包含)                           │
│                                                            │
│ 文件模式 (仅条件包含):                                      │
│ ┌──────────────────────────────────────────────────────┐  │
│ │ *.tsx, *.jsx, src/components/**/*                    │  │
│ └──────────────────────────────────────────────────────┘  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## 6. 参考资源

- [Kiro Steering Documentation](https://kiro.dev/docs/steering/)
- [Kiro Getting Started](https://kiro.dev/docs/getting-started/)
