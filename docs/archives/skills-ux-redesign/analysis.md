# Skills 用户体验重设计 - 产品分析文档

> Archive note: This document is a historical record. File paths and implementation names can reference code that has since moved or been removed.


> 文档版本: v1.0
> 创建日期: 2025-01-11
> 状态: 分析阶段

---

## 一、核心问题

**Skills 功能强大，但用户感知不到、不会用。**

| 问题 | 表现 | 影响程度 |
|------|------|---------|
| 对话界面零曝光 | 主界面无任何 Skills 入口，用户无法感知其存在 | ⚠️ 严重 |
| 激活状态不可见 | 当前对话启用了哪些 Skills，用户无从得知 | ⚠️ 严重 |
| 设置入口太深 | 设置窗口第 7 项，同步藏在下拉菜单里 | 中等 |
| 与 MCP 关系模糊 | MCP 默认关闭，但 Skills 同步依赖 MCP 生态 | 中等 |

---

## 二、设计决策

### 决策 1: 触发符号分离

**`@` 用于引用，`/` 用于调用能力**

| 触发符 | 语义 | 包含内容 |
|--------|------|---------|
| `@` | 引用上下文 | context、files、resources、workspace files |
| `/` | 调用能力 | **skills**、prompts、tools |

**理由**: `@` 在社交产品中用于"提及"，`/` 在 CLI/Slack 中用于"命令"，语义更清晰。

### 决策 2: 取消二级菜单

**无论 `@` 还是 `/`，直接匹配全量内容，不再需要先选类别**

- 减少点击次数，提高效率
- 用户通常已知要找什么，直接输入更快
- 通过图标区分类别，不影响识别

### 决策 3: 输入框增加 Skills 状态入口

**在工具栏增加 Skills 指示器，展示当前激活状态**

```
┌──────────────────────────────────────────────────────────────────┐
│ [Mode ▾] [📁] [📎] [🌐] [MCP ▾]  [✨ 2]        [Model ▾] [⚙️] [↑]│
│                                   ↑                              │
│                          Skills 指示器，点击展开面板              │
└──────────────────────────────────────────────────────────────────┘
```

### 决策 4: 优化同步流程与状态展示

- 检测到外部 AI 工具时，主动提示是否导入 skills
- 设置页增加"同步状态"区域，展示各工具同步时间和 skill 数量
- 同步入口从下拉菜单提升为独立区域

---

## 三、具体需求

### 3.1 输入框内

| 需求 | 描述 | 优先级 |
|------|------|--------|
| `/` 触发 Skills 选择 | 输入 `/` 显示 skills + prompts + tools 列表 | P0 |
| 扁平化列表 | `@` 和 `/` 都直接显示匹配结果，无二级菜单 | P0 |
| 模糊搜索 | 根据输入实时过滤匹配项 | P0 |
| 类别图标 | 用图标区分（✨ skill / 💬 prompt / 🔧 tool） | P1 |

### 3.2 输入框外

| 需求 | 描述 | 优先级 |
|------|------|--------|
| Skills 指示器 | 工具栏显示当前激活 skills 数量 | P0 |
| Skills 面板 | 点击指示器展开，显示激活/可用 skills | P0 |
| 快速切换 | 面板内可直接激活/停用 skill | P1 |
| 跳转管理 | 面板提供入口跳转到设置页 | P2 |

### 3.3 同步与引导

| 需求 | 描述 | 优先级 |
|------|------|--------|
| 首次导入引导 | 检测到外部工具时提示导入 | P1 |
| 同步状态展示 | 设置页显示各工具同步时间和数量 | P1 |
| MCP 依赖提示 | 激活依赖 MCP 的 skill 时提示启用 | P2 |

---

## 四、交互示意

### 4.1 `/` 触发交互

```
用户输入: /
┌─────────────────────────────────────────────┐
│ ✨ commit      生成规范的 Git 提交信息       │
│ ✨ review      代码审查助手                  │
│ 💬 summarize   总结内容 (prompt)            │
│ 🔧 web_search  搜索网页 (tool)              │
└─────────────────────────────────────────────┘

用户输入: /rev
┌─────────────────────────────────────────────┐
│ ✨ review      代码审查助手                  │
└─────────────────────────────────────────────┘
```

### 4.2 Skills 面板

```
点击 [✨ 2] 后:
┌─────────────────────────────────────┐
│ ✨ Active Skills             [管理] │
├─────────────────────────────────────┤
│ ● commit    生成提交信息      [✕]  │
│ ● review    代码审查          [✕]  │
├─────────────────────────────────────┤
│ ○ explain   解释代码          [+]  │
│ ○ refactor  重构建议          [+]  │
└─────────────────────────────────────┘
```

### 4.3 设置页同步状态

```
┌─────────────────────────────────────────────────────────────┐
│ 同步状态                                                    │
├─────────────────────────────────────────────────────────────┤
│ 🔵 Claude Code   12 skills   上次: 2小时前          [同步]  │
│ 🟢 Cursor        5 skills    上次: 1天前            [同步]  │
│ ⚪ Copilot       未连接                        [设置连接]   │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、待确认事项

| 问题 | 选项 | 建议 |
|------|------|------|
| `/` 列表排序 | A) Skills 优先 B) 按使用频率 C) 按字母 | A |
| 自动同步 | A) 支持后台自动 B) 仅手动 | 待讨论 |
| 同名冲突 | A) 覆盖 B) 重命名 C) 让用户选择 | C |

---

## 附录 A: 现状调研

### A.1 界面结构

主界面仅有侧边栏（Chat/设置）和对话区域。输入框支持 @ 提及 (context/files/resources/tools/prompts)，但没有 Skills 相关入口。

### A.2 设置窗口导航

Skills 位于第 7 位（共 12 项）：通用 → 显示 → 模型 → MCP → MCP市场 → ACP → **Skills** → 提示词 → 知识库 → 数据 → 快捷键 → 关于

### A.3 当前 @ 提及系统

位置: `src/renderer/src/components/editor/mention/suggestion.ts`

采用二级菜单：先选类别 → 再选具体项。类别包括 context/files/resources/tools/prompts，**不包含 skills**。

### A.4 Skills 同步入口

位置: `src/renderer/settings/components/skills/SkillsHeader.vue`

同步隐藏在右上角下拉菜单: `[同步 ▾] → 导入 / 导出`

### A.5 AI 工具调用

AI 可通过 `skill_list` 和 `skill_control` 工具管理 Skills，但用户不可见。

### A.6 支持同步的 12 个外部工具

**用户级**: Claude Code、Cursor、OpenCode、Goose、Kilo Code、GitHub Copilot

**项目级**: Cursor、Windsurf、GitHub Copilot、Kiro、Antigravity、Codex

---

## 附录 B: 代码改动范围

### B.1 输入框

| 文件 | 改动 |
|------|------|
| `src/renderer/src/components/editor/mention/suggestion.ts` | 拆分 @ 和 / 逻辑 |
| `src/renderer/src/components/editor/mention/MentionList.vue` | 扁平化 UI |
| `src/renderer/src/components/chat-input/ChatInput.vue` | 增加 Skills 指示器 |
| 新增 `SkillsIndicator.vue` / `SkillsPanel.vue` | Skills 组件 |

### B.2 状态管理

| 文件 | 改动 |
|------|------|
| 新增 `src/renderer/src/stores/skillsActiveStore.ts` | 对话级 skills 状态 |

### B.3 设置页

| 文件 | 改动 |
|------|------|
| `src/renderer/settings/components/skills/SkillsSettings.vue` | 同步状态区 |
| 新增 `SyncStatusCard.vue` | 同步状态卡片 |

---

## 附录 C: 关键文件索引

| 模块 | 路径 |
|------|------|
| Skills 核心 | `src/main/presenter/skillPresenter/index.ts` |
| Skills 同步 | `src/main/presenter/skillSyncPresenter/index.ts` |
| Skills 设置页 | `src/renderer/settings/components/skills/SkillsSettings.vue` |
| 输入框 | `src/renderer/src/components/chat-input/ChatInput.vue` |
| @ 提及 | `src/renderer/src/components/editor/mention/suggestion.ts` |
| 类型定义 | `src/shared/types/skill.ts` |
