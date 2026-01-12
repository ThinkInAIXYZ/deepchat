# Cursor Commands 格式规格

> 本文档是 [skills-syncing.md](./skills-syncing.md) 的子文档，描述 Cursor Commands 的格式规格和转换规则。

## 1. 基本信息

| 属性 | 值 |
|------|-----|
| 工具名称 | Cursor |
| Commands 目录 | `.cursor/commands/` (项目级) |
| 文件模式 | `*.md` |
| 格式类型 | 纯结构化 Markdown |
| Frontmatter | **无** |

## 2. 目录结构

```
.cursor/commands/
├── code-review.md
├── refactor.md
├── lint-suite.md
├── create-pr.md
└── optimize-performance.md
```

**特点**：
- 每个 Command 是**单个 Markdown 文件**
- 文件名即 Command 名称
- 不支持子文件夹或附属资源

## 3. Command 格式

### 3.1 完整示例

```markdown
# Code Review

Brief description of what this command does - reviews code changes according to team standards.

## Objective

Perform a thorough code review of the current changes, checking for:
- Code quality and readability
- Potential bugs and edge cases
- Performance implications
- Security vulnerabilities

## Requirements

- Follow the project's coding standards
- Check for proper error handling
- Verify test coverage for new code
- Ensure documentation is updated

## Output

Provide a structured review report with:
1. Summary of changes reviewed
2. List of issues found (categorized by severity)
3. Suggested improvements
4. Overall assessment
```

### 3.2 结构说明

| 部分 | 必需 | 说明 |
|------|------|------|
| `# Title` | ✅ 是 | 一级标题，Command 显示名称 |
| 首段描述 | ✅ 是 | 标题后的首段，简短描述用途 |
| `## Objective` | ❌ 否 | 详细说明任务目标和预期结果 |
| `## Requirements` | ❌ 否 | 具体要求、约束、编码标准 |
| `## Output` | ❌ 否 | 描述 AI 应该产出什么 |

### 3.3 调用方式

在 Cursor 的 Agent 输入框中输入 `/` 触发命令选择：

```
> /code-review
> /refactor
> /lint-suite
```

## 4. 发现机制

Cursor 从以下位置发现 Commands：

1. `.cursor/commands/` - 项目目录
2. 全局 Commands 库（用户级）
3. Team Commands（通过 Cursor Dashboard 配置）

## 5. 与 DeepChat 的转换

### 5.1 兼容性

| 能力 | Cursor | DeepChat | 转换 |
|------|:------:|:--------:|------|
| name | ✅ (从标题/文件名) | ✅ | 提取标题或文件名 |
| description | ✅ (从首段) | ✅ | 提取首段 |
| instructions | ✅ | ✅ | 合并所有 sections |
| allowedTools | ❌ | ✅ | 导出时丢失 |
| references/ | ❌ | ✅ | 可选择内联 |
| scripts/ | ❌ | ✅ | 导出时丢失 |

### 5.2 导入转换 (Cursor → DeepChat)

```typescript
function convertFromCursor(content: string, filename: string): DeepChatSkill {
  const lines = content.split('\n')

  // 提取标题
  const titleMatch = lines.find(l => l.startsWith('# '))
  const name = titleMatch
    ? titleMatch.replace('# ', '').toLowerCase().replace(/\s+/g, '-')
    : filename.replace('.md', '')

  // 提取首段作为 description
  const titleIndex = lines.findIndex(l => l.startsWith('# '))
  let description = ''
  for (let i = titleIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue
    if (line.startsWith('#')) break
    description = line
    break
  }

  // 剩余内容作为 instructions
  const instructions = content

  return {
    name,
    description,
    instructions,
    allowedTools: undefined,  // Cursor 不支持
    references: undefined,
    scripts: undefined
  }
}
```

### 5.3 导出转换 (DeepChat → Cursor)

```typescript
function convertToCursor(skill: DeepChatSkill): string {
  const title = skill.name
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  let output = `# ${title}\n\n`
  output += `${skill.description}\n\n`
  output += `## Objective\n\n`
  output += skill.instructions

  // 如果有 references，可选择内联
  if (skill.references?.length) {
    output += `\n\n## References\n\n`
    for (const ref of skill.references) {
      output += `### ${ref.name}\n\n${ref.content}\n\n`
    }
  }

  return output
}
```

### 5.4 转换警告

导出到 Cursor 时，以下内容会丢失：

| 丢失内容 | 处理方式 |
|----------|----------|
| `allowedTools` | 静默丢失，无法映射 |
| `scripts/` | 静默丢失，无法映射 |
| `references/` | 可选择内联到 `## References` 或丢失 |

## 6. 参考资源

- [Commands - Cursor Docs](https://cursor.com/docs/agent/chat/commands)
- [Cursor Custom Slash Commands](https://github.com/hamzafer/cursor-commands)
