# DeepChat Skills 系统设计文档

> Archive note: This document is a historical record. File paths and implementation names can reference code that has since moved or been removed.


## 1. 概述

### 1.1 核心理念

Skills 是一个**文件体系**，为 AI Agent 提供可激活的专业知识和行为指导。

**关键特征**：
- **文件驱动**：Skills 以文件形式存在于文件系统中，用户在设置中管理
- **模型自主**：由 LLM 通过工具决定何时激活/停用 Skill
- **渐进加载**：Metadata 始终在 Context，完整内容仅激活后加载
- **工具复用**：Skill 内的 scripts/references 通过现有工具（Read/Bash）访问
- **热加载**：监控 Skill 文件变化，自动更新 Metadata

### 1.2 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 启动时：扫描文件系统，提取所有 Skill 的 Metadata         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. 每轮对话：Metadata 列表始终存在于 Context                │
│    "Available skills: code-review, refactor, ..."          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. 模型决策：根据用户意图，调用 skill_control 工具          │
│    skill_control({ action: "activate", skill_name: "..." })│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. 下一轮 Loop：加载已激活 Skill 的完整 SKILL.md 内容       │
│    注入到系统提示中                                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. 模型执行：根据 SKILL.md 指令，用现有工具访问资源         │
│    - Read 工具读取 references/                              │
│    - Bash 工具执行 scripts/                                 │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 设计目标

| 目标 | 描述 | 优先级 |
|------|------|--------|
| **文件体系** | Skills 以文件夹形式存在，用户在设置中管理 | P0 |
| **模型自主激活** | LLM 通过工具控制 Skill 激活状态 | P0 |
| **渐进加载** | Metadata 常驻，完整内容按需加载 | P0 |
| **热加载** | 监控文件变化，自动更新 Metadata | P0 |
| **工具扩展** | Skill 可声明额外需要的工具 | P1 |

### 1.4 非目标

- Skill 市场和在线分发
- Skill 版本管理和依赖解析
- 多 Skill 编排和工作流
- 与 Custom Prompts 合并
- 项目级/用户级分层（当前仅用户级）

---

## 2. 文件体系

### 2.1 目录结构

```
~/.deepchat/skills/                  # Skills 目录
├── code-review/                     # Skill 文件夹
│   ├── SKILL.md                     # 必需：元数据 + 完整指令
│   ├── references/                  # 可选：参考文档
│   │   ├── style-guide.md
│   │   └── checklist.md
│   └── scripts/                     # 可选：辅助脚本
│       └── lint.sh
├── refactor/
│   └── SKILL.md
└── my-skill/
    └── SKILL.md
```

**说明**：
- 内置 Skills 首次启动时自动安装到同一目录
- 用户在设置界面中管理 Skills（启用/禁用/编辑）
- 用户可删除或修改内置 Skills

### 2.2 Skill 安装

支持三种安装方式：

| 方式 | 说明 | 使用场景 |
|------|------|----------|
| 本地文件夹 | 选择包含 SKILL.md 的文件夹 | 从其他客户端拷贝（如 ~/.claude/skills/） |
| 本地 zip | 选择 zip 文件 | 下载的 Skill 包 |
| URL | 输入 zip 下载地址 | 在线安装 |

**文件夹/zip 结构要求**：

```
skill-name/                  # Skill 文件夹
├── SKILL.md                 # 必需
├── references/              # 可选
└── scripts/                 # 可选
```

**安装流程**：

```
用户选择文件夹 / zip 文件 / 输入 URL
    │
    ▼
读取文件夹 / 解压 zip / 下载并解压
    │
    ▼
验证结构（SKILL.md 必须存在）
    │
    ▼
解析 SKILL.md frontmatter，获取 name
    │
    ▼
验证 name 与目录名一致（不一致则自动重命名目录为 name）
    │
    ▼
检查同名 Skill 是否存在
    │
    ├── 存在 → 提示用户确认覆盖
    │
    ▼
拷贝到 ~/.deepchat/skills/{name}/
    │
    ▼
触发热加载，更新 Metadata
```

**冲突处理**：
- 同名 Skill 已存在时，提示用户选择：覆盖 / 取消
- 覆盖时先备份原 Skill 文件夹

### 2.3 SKILL.md 格式

```markdown
---
name: code-review
description: 按照团队规范进行代码审查，检查代码质量、安全性和可维护性
allowedTools:                        # 可选：额外需要的工具（与用户已启用工具取并集）
  - Read
  - Grep
  - Glob
  - Bash(git:*)
---

# Code Review Skill

当前 Skill 根目录: ${SKILL_ROOT}

## 你的角色

你是一个代码审查专家，负责按照团队规范审查代码变更。

## 审查流程

1. 首先使用 `git diff` 查看变更范围
2. 阅读 ${SKILL_ROOT}/references/checklist.md 了解检查项
3. 逐个检查代码变更
4. 输出结构化的审查报告

## 资源位置

- 检查清单: ${SKILL_ROOT}/references/checklist.md
- 代码规范: ${SKILL_ROOT}/references/style-guide.md
- Lint 脚本: ${SKILL_ROOT}/scripts/lint.sh

## 输出格式

对于每个发现，使用以下格式：
- **位置**: 文件:行号
- **级别**: 🔴 严重 | 🟡 建议 | 🟢 优化
- **描述**: 问题描述
- **建议**: 修复建议
```

### 2.4 Frontmatter 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | 是 | Skill 唯一标识符，**必须与目录名一致** |
| `description` | string | 是 | 简短描述，用于模型理解何时使用 |
| `allowedTools` | string[] | 否 | 额外需要的工具，与用户已启用工具取并集 |

### 2.5 Name 与目录名一致性

`name` 是 Skill 的唯一标识符，**必须与目录名保持一致**。

**安装时验证**：
```
解析 SKILL.md frontmatter 获取 name
    │
    ▼
比较 name 与源目录名
    │
    ├── 一致 → 直接拷贝到 ~/.deepchat/skills/{name}/
    │
    └── 不一致 → 自动重命名目录为 name，拷贝到 ~/.deepchat/skills/{name}/
```

**持久化**：
- `activeSkills` 持久化 `name`（而非目录路径）
- 恢复会话时通过 `name` 查找 Skill

### 2.6 路径变量

Skill 内容中支持以下变量替换：

| 变量 | 说明 |
|------|------|
| `${SKILL_ROOT}` | 当前 Skill 的根目录路径 |
| `${SKILLS_DIR}` | Skills 总目录路径 (~/.deepchat/skills/) |

**示例**：
```markdown
读取检查清单: ${SKILL_ROOT}/references/checklist.md
执行脚本: ${SKILL_ROOT}/scripts/lint.sh
```

---

## 3. 数据模型

### 3.1 SkillMetadata（元数据）

启动时从 SKILL.md frontmatter 提取，始终保留在内存中。

```typescript
interface SkillMetadata {
  name: string              // 唯一标识符（来自 frontmatter，与目录名一致）
  description: string       // 描述文本
  path: string              // SKILL.md 完整路径
  skillRoot: string         // Skill 根目录路径
  allowedTools?: string[]   // 额外需要的工具（可选）
}
```

### 3.2 SkillState（会话状态）

与 Conversation 关联的激活状态，需要持久化。

```typescript
interface SkillState {
  conversationId: string    // 关联的会话 ID
  activeSkills: Set<string> // 已激活的 Skill 名称集合
}
```

**持久化方案**：

存储在 Conversation 记录中（SQLite chat.db）：

```typescript
// conversations 表扩展字段
interface Conversation {
  // ... 现有字段
  activeSkills?: string[]   // JSON 序列化的激活 Skill 名称数组
}
```

**生命周期**：
- 新建会话：`activeSkills = []`
- 激活/停用 Skill：更新内存状态 + 持久化到数据库
- 恢复会话：从数据库加载 `activeSkills`，过滤掉已不存在的 Skill

### 3.3 SkillContent（完整内容）

激活后加载，注入到系统提示。

```typescript
interface SkillContent {
  name: string
  content: string           // SKILL.md 完整内容（含 frontmatter 后的正文）
}
```

---

## 4. 工具定义

### 4.1 skill_list

列出所有可用 Skills 及其激活状态。

```typescript
{
  name: "skill_list",
  description: "列出所有可用的 skills 及其当前激活状态",
  parameters: {
    type: "object",
    properties: {},
    required: []
  }
}

// 返回示例
{
  "skills": [
    { "name": "code-review", "description": "代码审查", "active": true },
    { "name": "refactor", "description": "代码重构", "active": false }
  ]
}
```

### 4.2 skill_control

激活或停用指定 Skill。

```typescript
{
  name: "skill_control",
  description: "激活或停用一个 skill。激活后，该 skill 的完整指令将在下一轮对话中生效",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["activate", "deactivate"],
        description: "操作类型"
      },
      skill_name: {
        type: "string",
        description: "skill 名称"
      }
    },
    required: ["action", "skill_name"]
  }
}

// 返回示例
{
  "success": true,
  "message": "Skill 'code-review' activated. Instructions will be loaded in next turn."
}
```

---

## 5. Agent Loop 集成

### 5.1 Context 构建流程

```
每轮 Loop 开始前:

1. 构建基础系统提示
   │
2. 附加 Skills Metadata 列表（含 Skills 根目录路径）
   │  "## Available Skills
   │   Skills directory: ~/.deepchat/skills/
   │   You can activate these skills using skill_control tool:
   │   - code-review: 代码审查
   │   - refactor: 代码重构"
   │
3. 检查 SkillState.activeSkills
   │
4. 对每个激活的 Skill，加载完整内容
   │  读取 SKILL.md 正文部分，替换 ${SKILL_ROOT} 等变量
   │
5. 附加到系统提示
   │  "## Active Skills
   │   [所有激活 Skill 的内容依次列出]"
   │
6. 继续正常的 Agent Loop
```

### 5.2 状态生命周期

```
新建会话
    │
    ▼
SkillState = { conversationId, activeSkills: new Set() }
    │
    ▼
持久化空状态到 Conversation.activeSkills
    │
    ▼
用户消息 → Agent Loop
    │
    ▼
模型调用 skill_control({ action: "activate", skill_name: "code-review" })
    │
    ▼
SkillState.activeSkills.add("code-review")
    │
    ▼
持久化更新到 Conversation.activeSkills
    │
    ▼
当前轮继续执行（Skill 内容尚未加载）
    │
    ▼
下一轮 Loop 开始
    │
    ▼
检测到 "code-review" 激活 → 加载 SKILL.md 内容 → 注入系统提示
    │
    ▼
模型看到完整 Skill 指令，按指令行动


恢复会话（用户重新打开历史会话）
    │
    ▼
从 Conversation.activeSkills 加载持久化状态
    │
    ▼
过滤掉已不存在的 Skill 名称
    │
    ▼
SkillState = { conversationId, activeSkills: 过滤后的集合 }
    │
    ▼
继续正常的 Agent Loop（已激活 Skill 内容会被加载）
```

### 5.3 工具列表构建

当 Skill 定义了 `allowedTools` 时，与用户已启用的工具取**并集**：

```
LLM 请求时工具列表构建:
    │
    ▼
获取用户已启用的工具列表 (userEnabledTools)
    │
    ▼
遍历所有激活的 Skills
    │
    ▼
对每个 Skill，获取 allowedTools
    │
    ▼
最终工具列表 = userEnabledTools ∪ skill1.allowedTools ∪ skill2.allowedTools ∪ ...
```

**说明**：
- `allowedTools` 是**扩展**工具列表，而非限制
- 提示词中提到的工具和 tools 属性中暴露的工具是两个概念
- 提示词可以引导模型使用某些工具，但实际可用工具由 tools 列表决定

---

## 6. 组件设计

### 6.1 SkillPresenter

核心协调器，负责 Skill 的发现、管理和内容加载。

| 方法 | 职责 |
|------|------|
| `installBuiltinSkills()` | 首次启动时安装内置 Skills 到用户目录 |
| `installFromFolder(folderPath)` | 从本地文件夹安装 Skill |
| `installFromZip(zipPath)` | 从本地 zip 文件安装 Skill |
| `installFromUrl(url)` | 从 URL 下载并安装 Skill |
| `uninstallSkill(name)` | 卸载指定 Skill（删除文件夹） |
| `discoverSkills()` | 扫描 skills 目录，提取 Metadata |
| `getMetadataList()` | 返回所有 Skill 的 Metadata 列表 |
| `getMetadataPrompt()` | 生成 Metadata 列表的文本（注入 Context） |
| `loadSkillContent(name)` | 读取指定 Skill 的完整 SKILL.md 内容，替换路径变量 |
| `getSkillsDir()` | 获取 Skills 根目录路径 |
| `watchSkillFiles()` | 监控 Skill 文件变化，触发热加载 |
| `getActiveSkillsAllowedTools(conversationId)` | 获取会话中激活 Skills 声明的额外工具列表 |
| `getActiveSkills(conversationId)` | 获取会话的激活 Skill 列表（从持久化加载） |
| `setActiveSkills(conversationId, skills)` | 更新会话的激活 Skill 列表（持久化） |
| `validateSkillNames(names)` | 过滤掉已不存在的 Skill 名称 |

### 6.2 SkillTools

暴露给模型的工具实现。

| 方法 | 职责 |
|------|------|
| `handleSkillList(state)` | 处理 skill_list 工具调用 |
| `handleSkillControl(state, action, name)` | 处理 skill_control 工具调用 |

### 6.3 职责边界

```
SkillPresenter          SkillTools              AgentLoop
     │                       │                       │
     │  提供数据             │  提供工具             │  管理状态
     │  - Metadata           │  - skill_list        │  - SkillState
     │  - Content            │  - skill_control     │  - Context 构建
     │                       │                       │
```

---

## 7. 与现有系统集成

### 7.1 与 ConfigPresenter

```
ConfigPresenter
     │
     └── getSkillSettings()
         ├── skillsPath: string           // Skills 目录路径 (~/.deepchat/skills/)
         └── enableSkills: boolean        // 全局开关
```

### 7.2 enableSkills 开关行为

`enableSkills` 是 Skills 系统的全局开关，控制整个功能的启用/禁用。

**enableSkills = true（启用）**：
- 注册 `skill_list` / `skill_control` 工具
- 注入 Skills Metadata 列表到 Context
- 注入激活 Skill 的完整内容到 Context
- 合并激活 Skills 的 `allowedTools` 到工具列表
- 正常处理 Skill 激活/停用

**enableSkills = false（禁用）**：
- **不注册** `skill_list` / `skill_control` 工具（模型无法看到和调用）
- **不注入** Metadata 列表到 Context
- **不注入** 激活 Skill 内容到 Context
- **不合并** `allowedTools` 到工具列表
- **保留**持久化的 `activeSkills` 状态（视为挂起，重新启用后恢复）

```
用户关闭 enableSkills
    │
    ▼
Skills 功能挂起（非清除）
    │
    ├── 工具不可见
    ├── 提示词无 Skills 相关内容
    ├── 工具列表不含 Skills 的 allowedTools
    │
    └── Conversation.activeSkills 保持不变
              │
              ▼
        用户重新开启 enableSkills
              │
              ▼
        恢复之前的激活状态
```

### 7.3 热加载机制

```
启动时:
     │
     ├── discoverSkills() → 扫描并加载所有 Metadata
     │
     └── watchSkillFiles() → 启动文件监控
              │
              ▼
         监控 ~/.deepchat/skills/ 目录
              │
              ▼
         文件变化事件 (add/change/unlink)
              │
              ▼
         重新解析受影响的 SKILL.md
              │
              ▼
         更新内存中的 Metadata
              │
              ▼
         发送 SKILL_EVENTS.METADATA_UPDATED 事件
```

### 7.4 与 McpPresenter

```
构建 LLM 请求时的工具列表:

SkillPresenter                    McpPresenter
     │                                  │
     │  getActiveSkillsAllowedTools()   │
     │ ─────────────────────────────►   │
     │                                  │
     │  返回 ["Read", "Bash(git:*)"]    │
     │ ◄─────────────────────────────   │
     │                                  │
     │                    mergeTools(userEnabled, skillAllowed)
     │                                  │
     │  返回合并后的工具列表             │
     │ ◄─────────────────────────────   │
```

### 7.5 与 AgentLoopHandler

```
AgentLoopHandler
     │
     ├── 检查 enableSkills 配置
     │   │
     │   └── 仅当 enableSkills = true 时:
     │       │
     │       ├── 初始化 SkillState
     │       │
     │       ├── 注册 skill_list / skill_control 工具
     │       │
     │       ├── preparePromptContent() 中:
     │       │   ├── 附加 Metadata 列表
     │       │   └── 附加激活 Skill 的完整内容
     │       │
     │       └── 处理工具调用时:
     │           └── 路由到 SkillTools
     │
     └── enableSkills = false 时:
         └── 跳过所有 Skills 相关逻辑
```

### 7.6 与 EventBus

```typescript
const SKILL_EVENTS = {
  DISCOVERED: 'skill:discovered',           // Skills 发现完成
  METADATA_UPDATED: 'skill:metadata-updated', // Metadata 热加载更新
  INSTALLED: 'skill:installed',             // Skill 安装完成
  UNINSTALLED: 'skill:uninstalled',         // Skill 卸载完成
  ACTIVATED: 'skill:activated',             // Skill 被激活
  DEACTIVATED: 'skill:deactivated'          // Skill 被停用
}
```

---

## 8. 多 Skill 激活

多个 Skill 同时激活时，内容在同一个板块中依次列出：

```
## Active Skills

[code-review 的 SKILL.md 内容]

[refactor 的 SKILL.md 内容]
```
