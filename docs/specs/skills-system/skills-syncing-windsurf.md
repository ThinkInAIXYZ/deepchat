# Windsurf Workflows 格式规格

> 本文档是 [skills-syncing.md](./skills-syncing.md) 的子文档，描述 Windsurf Workflows 的格式规格和转换规则。

## 1. 基本信息

| 属性 | 值 |
|------|-----|
| 工具名称 | Windsurf |
| Workflows 目录 | `.windsurf/workflows/` |
| 文件模式 | `*.md` |
| 格式类型 | 步骤式 Markdown |
| Frontmatter | **无** |

## 2. 目录结构

```
.windsurf/workflows/
├── code-review.md
├── deploy.md
├── pr-review.md
└── run-tests.md
```

**特点**：
- 每个 Workflow 是**单个 Markdown 文件**
- 文件名即 Workflow 名称（用于 `/` 调用）
- 不支持子文件夹或附属资源
- 支持多级目录发现

## 3. Workflow 格式

### 3.1 完整示例

```markdown
# Code Review Workflow

A workflow to systematically review code changes and provide structured feedback.

## Steps

### 1. Get the Changes

Run the following command to see all changes:
```bash
git diff HEAD~1
```

### 2. Analyze Each File

For each changed file:
- Check code style and formatting
- Look for potential bugs
- Verify error handling
- Check for security issues

### 3. Check Test Coverage

Ensure new code has appropriate tests:
```bash
npm run test:coverage
```

### 4. Generate Review Report

Output a structured report with:
- Summary of changes
- Issues found (by severity)
- Recommendations
- Overall assessment
```

### 3.2 结构说明

| 部分 | 必需 | 说明 |
|------|------|------|
| `# Title` | ✅ 是 | 一级标题，Workflow 显示名称 |
| 描述段落 | ✅ 是 | 标题后的描述文本 |
| `## Steps` | ✅ 是 | 步骤容器 |
| `### N. Step Name` | ✅ 是 | 编号步骤，按顺序执行 |

### 3.3 调用方式

在 Cascade 中输入 `/` 加 workflow 名称：

```
> /code-review
> /deploy
> /pr-review
```

## 4. 发现机制

Windsurf 自动从多个位置发现 Workflows：

1. **当前工作区**：`.windsurf/workflows/`
2. **子目录**：递归搜索所有 `.windsurf/workflows/`
3. **Git 仓库根目录**：向上搜索到 git root
4. **多工作区**：去重并显示最短相对路径

**企业功能**：
- 系统级 Workflows（全局可用，不可修改）
- 管理员权限控制

## 5. 高级特性

### 5.1 Workflow 链式调用

Workflows 可以调用其他 Workflows：

```markdown
# Full CI Pipeline

## Steps

### 1. Run Linting
Call /lint-check

### 2. Run Tests
Call /run-tests

### 3. Deploy
Call /deploy-staging
```

### 5.2 常见用例

- 代码格式化（Prettier, Black）
- Linting（ESLint, Flake8）
- 单元测试和 E2E 测试
- 部署流程
- 安全漏洞扫描

## 6. 与 DeepChat 的转换

### 6.1 兼容性

| 能力 | Windsurf | DeepChat | 转换 |
|------|:--------:|:--------:|------|
| name | ✅ (从标题/文件名) | ✅ | 提取标题或文件名 |
| description | ✅ (从首段) | ✅ | 提取首段 |
| instructions | ✅ (Steps) | ✅ | Steps 作为 instructions |
| allowedTools | ❌ | ✅ | 导出时丢失 |
| model | ❌ | ✅ | 导出时丢失 |
| references/ | ❌ | ✅ | 可选择内联 |
| scripts/ | ❌ | ✅ | 导出时丢失 |

### 6.2 导入转换 (Windsurf → DeepChat)

```typescript
function convertFromWindsurf(content: string, filename: string): DeepChatSkill {
  const lines = content.split('\n')

  // 提取标题
  const titleMatch = lines.find(l => l.startsWith('# '))
  const name = titleMatch
    ? titleMatch.replace('# ', '').replace(' Workflow', '').toLowerCase().replace(/\s+/g, '-')
    : filename.replace('.md', '')

  // 提取描述（标题和 ## Steps 之间的内容）
  const titleIndex = lines.findIndex(l => l.startsWith('# '))
  const stepsIndex = lines.findIndex(l => l.startsWith('## Steps'))

  let description = ''
  for (let i = titleIndex + 1; i < stepsIndex; i++) {
    const line = lines[i].trim()
    if (line && !line.startsWith('#')) {
      description = line
      break
    }
  }

  // Steps 内容作为 instructions
  const instructions = stepsIndex >= 0
    ? lines.slice(stepsIndex).join('\n')
    : content

  return {
    name,
    description,
    instructions,
    allowedTools: undefined,
    references: undefined,
    scripts: undefined
  }
}
```

### 6.3 导出转换 (DeepChat → Windsurf)

```typescript
function convertToWindsurf(skill: DeepChatSkill): string {
  const title = skill.name
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  let output = `# ${title} Workflow\n\n`
  output += `${skill.description}\n\n`
  output += `## Steps\n\n`

  // 检查 instructions 是否已有步骤结构
  if (skill.instructions.includes('### 1.') || skill.instructions.includes('### Step 1')) {
    output += skill.instructions
  } else {
    // 整体作为单个步骤
    output += `### 1. Execute\n\n${skill.instructions}`
  }

  return output
}
```

### 6.4 转换警告

导出到 Windsurf 时，以下内容会丢失：

| 丢失内容 | 处理方式 |
|----------|----------|
| `allowedTools` | 静默丢失 |
| `model` | 静默丢失 |
| `scripts/` | 静默丢失 |
| `references/` | 可内联到步骤中或丢失 |

## 7. 参考资源

- [Workflows - Windsurf Docs](https://docs.windsurf.com/windsurf/cascade/workflows)
- [Windsurf Workflows Guide](https://www.kzsoftworks.com/blog/windsurf-workflows-from-prompt-chaos-to-productive-focus)
