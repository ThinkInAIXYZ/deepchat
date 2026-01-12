# GitHub Copilot Prompt Files 格式规格

> 本文档是 [skills-syncing.md](./skills-syncing.md) 的子文档，描述 GitHub Copilot Prompt Files 的格式规格和转换规则。

## 1. 基本信息

| 属性 | 值 |
|------|-----|
| 工具名称 | GitHub Copilot |
| Prompts 目录 | `.github/prompts/` |
| 文件模式 | `*.prompt.md` |
| 格式类型 | YAML frontmatter + Markdown |
| Frontmatter | **可选** |

## 2. 目录结构

```
.github/prompts/
├── code-review.prompt.md
├── refactor.prompt.md
├── generate-tests.prompt.md
└── explain-code.prompt.md
```

**特点**：
- 每个 Prompt 是**单个 Markdown 文件**
- 文件名必须以 `.prompt.md` 结尾
- 文件名（不含扩展名）即 Prompt 名称
- 不支持子文件夹结构
- 支持 `#file` 引用语法

## 3. Prompt File 格式

### 3.1 完整示例

```markdown
---
description: Generate a comprehensive code review for the selected code
agent: agent
model: GPT-4o
tools: ['githubRepo', 'search/codebase', 'read', 'edit']
---

# Code Review

Review the code changes and provide feedback on:
- Code quality and readability
- Potential bugs and edge cases
- Performance implications
- Security vulnerabilities

## Context

Use #file:'${file}' to reference the current file context.

## Output Format

Provide a structured review with:
1. Summary of changes
2. Issues found (by severity)
3. Suggested improvements
4. Overall assessment
```

### 3.2 Frontmatter 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `description` | string | ❌ 否 | 描述用途，用于提示列表显示 |
| `agent` | string | ❌ 否 | 通常设为 `agent` |
| `model` | string | ❌ 否 | 指定使用的模型（如 `GPT-4o`） |
| `tools` | string[] | ❌ 否 | 可用工具列表 |

### 3.3 tools 数组

支持的工具包括：

| 工具名 | 说明 |
|--------|------|
| `githubRepo` | GitHub 仓库访问 |
| `search/codebase` | 代码库搜索 |
| `read` | 读取文件 |
| `edit` | 编辑文件 |
| `terminalLastCommand` | 终端最后命令 |
| `runCommands` | 运行命令 |

### 3.4 文件引用语法

Copilot 支持特殊的 `#file` 引用语法：

```markdown
# Using file references
Use #file:'src/utils.ts' to include file context.

# Using variable
Check #file:'${file}' for the current file.
```

### 3.5 调用方式

在 VS Code 中：
1. 打开命令面板 (`Ctrl/Cmd + Shift + P`)
2. 输入 `@workspace /prompt-name`
3. 或在 Chat 中直接输入 `/prompt-name`

## 4. 发现机制

GitHub Copilot 从以下位置发现 Prompt Files：

1. **工作区目录**：`.github/prompts/`
2. **用户全局目录**：`~/.github/prompts/`

**注意**：Copilot 按字母顺序列出 prompts。

## 5. 与 DeepChat 的转换

### 5.1 兼容性

| 能力 | GitHub Copilot | DeepChat | 转换 |
|------|:--------------:|:--------:|------|
| name | ✅ (从文件名) | ✅ | 提取文件名 |
| description | ✅ | ✅ | 直接映射 |
| instructions | ✅ | ✅ | Markdown body |
| allowedTools | ✅ (tools) | ✅ | 工具名称映射 |
| model | ✅ | ✅ | 直接映射 |
| references/ | ⚠️ (#file 引用) | ✅ | 转换 #file 或内联 |
| scripts/ | ❌ | ✅ | 导出时丢失 |

### 5.2 工具名称映射

DeepChat 与 Copilot 的工具名称需要映射：

| DeepChat | GitHub Copilot |
|----------|----------------|
| Read | read |
| Edit | edit |
| Bash | runCommands |
| Grep | search/codebase |
| Glob | search/codebase |

### 5.3 导入转换 (Copilot → DeepChat)

```typescript
function convertFromCopilot(content: string, filename: string): DeepChatSkill {
  const { data, body } = grayMatter(content)

  // 从文件名提取 name
  const name = filename.replace('.prompt.md', '')

  // 映射工具名称
  const allowedTools = data.tools?.map((tool: string) => {
    const mapping: Record<string, string> = {
      'read': 'Read',
      'edit': 'Edit',
      'runCommands': 'Bash',
      'search/codebase': 'Grep'
    }
    return mapping[tool] || tool
  })

  // 处理 #file 引用 - 转换为 ${SKILL_ROOT}/references/
  const processedBody = body.replace(
    /#file:'([^']+)'/g,
    '${SKILL_ROOT}/references/$1'
  )

  return {
    name,
    description: data.description || '',
    instructions: processedBody,
    allowedTools,
    model: data.model,
    references: undefined,
    scripts: undefined
  }
}
```

### 5.4 导出转换 (DeepChat → Copilot)

```typescript
function convertToCopilot(skill: DeepChatSkill): string {
  const frontmatter: Record<string, unknown> = {}

  if (skill.description) {
    frontmatter.description = skill.description
  }

  frontmatter.agent = 'agent'

  if (skill.model) {
    frontmatter.model = skill.model
  }

  // 映射工具名称
  if (skill.allowedTools?.length) {
    const mapping: Record<string, string> = {
      'Read': 'read',
      'Edit': 'edit',
      'Bash': 'runCommands',
      'Grep': 'search/codebase',
      'Glob': 'search/codebase'
    }
    frontmatter.tools = skill.allowedTools.map(t => mapping[t] || t)
  }

  // 处理 references - 转换为 #file 引用
  let instructions = skill.instructions
  if (skill.references?.length) {
    instructions += '\n\n## References\n\n'
    for (const ref of skill.references) {
      instructions += `See #file:'${ref.relativePath}' for ${ref.name}\n`
    }
  }

  const yaml = Object.keys(frontmatter).length > 0
    ? `---\n${yamlDump(frontmatter)}---\n\n`
    : ''

  return yaml + instructions
}
```

### 5.5 转换警告

导出到 GitHub Copilot 时：

| 丢失内容 | 处理方式 |
|----------|----------|
| `scripts/` | 静默丢失，无法映射 |
| `references/` | 转换为 `#file` 引用（内容不会复制） |
| 部分工具 | 映射到最接近的 Copilot 工具 |

导入到 DeepChat 时：

| 转换内容 | 处理方式 |
|----------|----------|
| `#file` 引用 | 转换为 `${SKILL_ROOT}/references/` 路径 |
| 工具名称 | 映射到 DeepChat 工具名 |

## 6. 参考资源

- [Prompt Files - VS Code Docs](https://code.visualstudio.com/docs/copilot/customization/prompt-files)
- [GitHub Copilot Chat Documentation](https://docs.github.com/en/copilot/github-copilot-chat)
