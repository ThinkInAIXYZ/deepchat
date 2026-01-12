# Create Skill 内置技能方案

> 本文档描述 DeepChat 内置的 `create-skill` 技能设计方案，用于指导 AI Agent 创建新的 Skills。

## 1. 概述

### 1.1 背景

参考 [Forge 的 create-skill 实现](https://github.com/antinomyhq/forge/blob/main/crates/forge_repo/src/skills/create-skill/SKILL.md)，我们需要为 DeepChat 设计一个内置的 `create-skill` 技能，帮助用户通过对话方式创建新的 Skills。

### 1.2 核心理念

**无需专门工具**：创建 Skill 本质上是文件操作（创建目录、写入 SKILL.md），现有的 Bash/Edit/Read/Write 工具已足够完成。`create-skill` 只需提供**专业知识**和**最佳实践**。

**渐进式引导**：通过对话收集需求，逐步完成 Skill 创建，而非一次性生成。

### 1.3 目标

| 目标 | 描述 |
|------|------|
| 引导创建 | 通过对话引导用户明确 Skill 用途和触发条件 |
| 格式规范 | 确保生成的 SKILL.md 符合 DeepChat 格式规范 |
| 最佳实践 | 应用 Skills 设计的最佳实践（渐进加载、Token 优化等）|
| 测试验证 | 创建后提示用户新会话中测试 |

---

## 2. 技能设计

### 2.1 基本信息

| 属性 | 值 |
|------|-----|
| name | `create-skill` |
| 描述 | 创建和编辑 DeepChat Skills |
| 触发场景 | 用户想要创建新 Skill 或更新现有 Skill |
| 依赖工具 | Bash, Write, Read, Edit |

### 2.2 目录结构

```
resources/skills/create-skill/
├── SKILL.md                    # 主指令文件
└── references/
    ├── skill-format.md         # SKILL.md 格式规范
    └── design-patterns.md      # 设计模式和最佳实践
```

### 2.3 工作流程

```
用户请求创建 Skill
    │
    ▼
Step 1: 理解需求
    - 收集具体用例和示例
    - 明确触发条件
    │
    ▼
Step 2: 规划内容
    - 确定需要的 scripts/references/assets
    - 设计目录结构
    │
    ▼
Step 3: 初始化目录
    - 创建 skill 文件夹
    - 生成 SKILL.md 骨架
    │
    ▼
Step 4: 编写内容
    - 完善 frontmatter
    - 编写指令正文
    - 创建辅助文件
    │
    ▼
Step 5: 测试提示
    - 提示用户在新会话中测试
    - 根据反馈迭代
```

---

## 3. SKILL.md 提示词

完整的提示词见 [create-skill-prompt.md](./create-skill-prompt.md)。

### 3.1 提示词要点

1. **Skill 是什么**：为 AI Agent 提供专业知识的文件体系
2. **核心原则**：
   - 简洁优先（Token 是公共资源）
   - 控制自由度（根据任务脆弱性调整）
   - 渐进加载（元数据 → 正文 → 引用文件）
3. **创建流程**：
   - 理解需求 → 规划结构 → 初始化 → 编写 → 测试
4. **格式规范**：
   - 必需字段：name, description
   - 可选字段：allowedTools
   - 路径变量：${SKILL_ROOT}, ${SKILLS_DIR}

---

## 4. 与 Forge 方案的差异

| 方面 | Forge | DeepChat |
|------|-------|----------|
| 全局/项目级 | 支持两种，默认项目级 | 仅用户级 (~/.deepchat/skills/) |
| 字段命名 | `allowed-tools` (kebab-case) | `allowedTools` (camelCase) |
| 路径变量 | `{{local_skills_path}}` | `${SKILLS_DIR}` |
| assets 目录 | 支持 | 当前不支持（可放 references） |
| 企业级 Skills | 支持 | 暂不支持 |

---

## 5. 内置安装

### 5.1 安装位置

```
resources/skills/create-skill/    # 打包到应用资源
    ↓ 首次启动
~/.deepchat/skills/create-skill/  # 安装到用户目录
```

### 5.2 安装时机

在 `SkillPresenter.installBuiltinSkills()` 中处理：

```typescript
// 内置 Skills 列表
const BUILTIN_SKILLS = ['create-skill']

async installBuiltinSkills() {
  const builtinDir = this.resolveBuiltinSkillsDir()
  for (const skillName of BUILTIN_SKILLS) {
    const sourcePath = path.join(builtinDir, skillName)
    await this.installFromDirectory(sourcePath, { overwrite: false })
  }
}
```

### 5.3 更新策略

- `overwrite: false`：不覆盖用户修改
- 用户可删除后重装获取最新版本

---

## 6. 实现任务

### 6.1 文件创建

- [ ] 创建 `resources/skills/create-skill/SKILL.md`
- [ ] 创建 `resources/skills/create-skill/references/skill-format.md`
- [ ] 创建 `resources/skills/create-skill/references/design-patterns.md`

### 6.2 打包配置

- [ ] 更新 `electron-builder` 配置，将 `resources/skills/` 打包到 app.asar.unpacked

### 6.3 测试

- [ ] 测试 Skill 安装流程
- [ ] 测试 Skill 创建流程
- [ ] 测试生成的 Skill 格式正确性

---

## 7. 参考资源

- [Forge create-skill](https://github.com/antinomyhq/forge/blob/main/crates/forge_repo/src/skills/create-skill/SKILL.md)
- [Claude Code Skills 文档](https://code.claude.com/docs/en/skills)
- [DeepChat Skills 设计文档](./design.md)
