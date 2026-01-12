# Claude Code Skills 格式规格

> 本文档是 [skills-syncing.md](./skills-syncing.md) 的子文档，描述 Claude Code Skills 的格式规格和转换规则。

## 1. 基本信息

| 属性 | 值 |
|------|-----|
| 工具名称 | Claude Code |
| Skills 目录 | `~/.claude/skills/` (用户级) 或 `.claude/skills/` (项目级) |
| 文件模式 | `*/SKILL.md` |
| 格式类型 | YAML frontmatter + Markdown |
| Frontmatter | **必需** |

## 2. 目录结构

```
~/.claude/skills/
├── code-review/
│   ├── SKILL.md              # 必需：元数据 + 指令
│   ├── references/           # 可选：参考文档（按需加载）
│   │   ├── style-guide.md
│   │   └── checklist.md
│   ├── scripts/              # 可选：可执行脚本
│   │   └── lint.sh
│   └── assets/               # 可选：输出模板/资源
│       └── report-template.md
├── refactor/
│   └── SKILL.md
└── my-skill/
    └── SKILL.md
```

**特点**：
- 每个 Skill 是一个**文件夹**，而非单个文件
- 文件夹名应与 `name` 字段一致
- 支持 `references/`、`scripts/`、`assets/` 子文件夹

## 3. SKILL.md 格式

### 3.1 完整示例

```markdown
---
name: code-review
description: Reviews code changes according to team standards. Use when the user asks for a code review, PR review, or wants feedback on their changes.
allowed-tools: Read, Grep, Glob, Bash(git:*)
license: MIT
---

# Code Review

## Your Role

You are a code review expert responsible for reviewing code changes according to team standards.

## Review Process

1. First use `git diff` to see the scope of changes
2. Read ${SKILL_ROOT}/references/checklist.md to understand check items
3. Review each code change
4. Output a structured review report

## Resources

- Checklist: ${SKILL_ROOT}/references/checklist.md
- Style Guide: ${SKILL_ROOT}/references/style-guide.md
- Lint Script: ${SKILL_ROOT}/scripts/lint.sh

## Output Format

For each finding, use the following format:
- **Location**: file:line
- **Level**: 🔴 Critical | 🟡 Suggestion | 🟢 Optimization
- **Description**: Issue description
- **Suggestion**: Fix suggestion
```

### 3.2 Frontmatter 字段

| 字段 | 类型 | 必需 | 约束 | 说明 |
|------|------|------|------|------|
| `name` | string | ✅ 是 | 最长 64 字符，仅小写字母/数字/连字符 | Skill 唯一标识符 |
| `description` | string | ✅ 是 | 最长 1024 字符，非空 | 描述用途和触发条件，用于语义匹配 |
| `allowed-tools` | string/array | ❌ 否 | - | 限制可用工具，省略则不限制 |
| `license` | string | ❌ 否 | - | 许可证类型 |

### 3.3 allowed-tools 格式

支持两种写法：

**字符串格式**：
```yaml
allowed-tools: Read, Grep, Glob, Bash(git:*)
```

**数组格式**：
```yaml
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(git:*)
```

**工具限制语法**：
- `Bash` - 允许所有 Bash 命令
- `Bash(git:*)` - 仅允许 git 开头的命令
- `Bash(npm test:*)` - 仅允许 npm test 开头的命令

### 3.4 路径变量

Skill 内容中支持以下变量替换：

| 变量 | 说明 |
|------|------|
| `${SKILL_ROOT}` | 当前 Skill 的根目录路径 |

## 4. 发现机制

Claude Code 按以下顺序扫描 Skills：

1. `~/.config/claude/skills/` - 用户配置目录
2. `~/.claude/skills/` - 用户 HOME 目录
3. `.claude/skills/` - 项目目录
4. 插件提供的 Skills
5. 内置 Skills

**优先级**：后发现的同名 Skill 覆盖先发现的。

## 5. 已知问题

根据 [Issue #9817](https://github.com/anthropics/claude-code/issues/9817)：

- Frontmatter 格式敏感，多行 description 可能导致发现失败
- 发现失败时无错误提示（静默失败）
- YAML 对缩进敏感，建议使用 2 空格缩进

**建议**：
```yaml
# ✅ 推荐：单行 description
description: Reviews code changes according to team standards.

# ❌ 避免：多行 description
description: |
  Reviews code changes according to team standards.
  Use when the user asks for a code review.
```

## 6. 与 DeepChat 的转换

### 6.1 兼容性

| 能力 | Claude Code | DeepChat | 转换 |
|------|:-----------:|:--------:|------|
| name | ✅ | ✅ | 直接映射 |
| description | ✅ | ✅ | 直接映射 |
| allowed-tools | ✅ | ✅ | 字段名转换 `allowed-tools` ↔ `allowedTools` |
| references/ | ✅ | ✅ | 直接复制 |
| scripts/ | ✅ | ✅ | 直接复制 |
| assets/ | ✅ | ⚠️ | 复制到 references/ 或忽略 |
| license | ✅ | ❌ | 忽略 |

### 6.2 导入转换 (Claude Code → DeepChat)

```typescript
function convertFromClaudeCode(skill: ClaudeCodeSkill): DeepChatSkill {
  return {
    name: skill.name,
    description: skill.description,
    // 字段名转换
    allowedTools: skill['allowed-tools'],
    instructions: skill.body,
    // 子文件夹直接复制
    references: skill.references,
    scripts: skill.scripts
  }
}
```

### 6.3 导出转换 (DeepChat → Claude Code)

```typescript
function convertToClaudeCode(skill: DeepChatSkill): string {
  const frontmatter = {
    name: skill.name,
    description: skill.description,
    // 字段名转换
    ...(skill.allowedTools && { 'allowed-tools': skill.allowedTools })
  }

  return `---\n${yaml.dump(frontmatter)}---\n\n${skill.instructions}`
}
```

## 7. 参考资源

- [Agent Skills - Claude Code Docs](https://code.claude.com/docs/en/skills)
- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Anthropic Skills Repository](https://github.com/anthropics/skills)
