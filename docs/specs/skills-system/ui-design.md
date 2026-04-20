# DeepChat Skills 系统 UI 设计文档

## 1. 概述

本文档描述 Skills 系统的用户界面设计，基于 DeepChat 现有 UI 模式和组件库。

### 1.1 设计原则

- **一致性**：遵循现有 MCP、Custom Prompts 等功能的 UI 模式
- **简洁性**：卡片网格展示，侧边栏编辑
- **复用性**：使用 shadcn/ui 组件库

### 1.2 UI 入口

Skills 管理页面作为设置窗口的新页面，位于 MCP 和 Prompt 之间：

| 路由 | 组件 | 图标 | 位置 |
|------|------|------|------|
| `/skills` | SkillsSettings | `lucide:sparkles` | 5 (MCP Market 之后) |

---

## 2. 页面结构

### 2.1 整体布局

```
┌─────────────────────────────────────────────────────────────────┐
│ Skills Settings                                                 │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Header                                                      │ │
│ │ ┌─────────────────┐  ┌──────────┐  ┌──────────┐            │ │
│ │ │ 🔍 Search...    │  │ 导入 ▾  │  │ + 安装   │            │ │
│ │ └─────────────────┘  └──────────┘  └──────────┘            │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ScrollArea                                                  │ │
│ │                                                             │ │
│ │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │ │
│ │  │ Skill    │  │ Skill    │  │ Skill    │  │ Skill    │   │ │
│ │  │ Card     │  │ Card     │  │ Card     │  │ Card     │   │ │
│ │  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │ │
│ │                                                             │ │
│ │  ┌──────────┐  ┌──────────┐                                │ │
│ │  │ Skill    │  │ Skill    │                                │ │
│ │  │ Card     │  │ Card     │                                │ │
│ │  └──────────┘  └──────────┘                                │ │
│ │                                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Footer: 共 6 个 Skills | 打开 Skills 文件夹                 │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 组件层次

```
SkillsSettings.vue
├── SkillsHeader.vue
│   ├── Input (搜索)
│   ├── DropdownMenu (导入)
│   │   ├── 从文件夹安装
│   │   ├── 从 ZIP 安装
│   │   └── 从 URL 安装
│   └── Button (安装)
├── ScrollArea
│   ├── Empty State (无 Skills 时)
│   └── Grid
│       └── SkillCard.vue (循环)
├── Footer
│   ├── 统计信息
│   └── 打开文件夹按钮
└── Dialogs
    ├── SkillInstallDialog.vue (安装对话框)
    ├── SkillEditorSheet.vue (编辑侧边栏)
    └── AlertDialog (删除确认)
```

---

## 3. 组件设计

### 3.1 SkillCard

Skill 卡片组件，展示单个 Skill 信息。

```
┌─────────────────────────────────────┐
│ ┌───┐  code-review           ⋮    │
│ │ ✨ │  按照团队规范进行代码审查    │
│ └───┘                              │
│                                    │
│ ┌────────────────────────────────┐ │
│ │ allowedTools: Read, Grep, ... │ │
│ └────────────────────────────────┘ │
│                                    │
│ ┌────────┐              ┌────────┐ │
│ │  编辑  │              │  删除  │ │
│ └────────┘              └────────┘ │
└─────────────────────────────────────┘
```

**状态变体**：
- 正常状态
- Hover 状态（显示操作按钮）
- 加载状态（安装/删除中）

**Props**：
```typescript
interface SkillCardProps {
  skill: SkillMetadata
  onEdit: () => void
  onDelete: () => void
}
```

### 3.2 SkillEditorSheet

右侧滑出的编辑面板，用于查看和编辑 Skill 详情。

```
┌──────────────────────────────────────┐
│ ← 编辑 Skill                         │
├──────────────────────────────────────┤
│                                      │
│ 名称                                 │
│ ┌──────────────────────────────────┐ │
│ │ code-review                      │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 描述                                 │
│ ┌──────────────────────────────────┐ │
│ │ 按照团队规范进行代码审查...       │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 额外工具 (allowedTools)              │
│ ┌──────────────────────────────────┐ │
│ │ Read, Grep, Glob, Bash(git:*)   │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ─────────────────────────────────── │
│                                      │
│ Skill 内容                           │
│ ┌──────────────────────────────────┐ │
│ │ # Code Review Skill              │ │
│ │                                  │ │
│ │ ## 你的角色                       │ │
│ │ 你是一个代码审查专家...           │ │
│ │                                  │ │
│ │                                  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ─────────────────────────────────── │
│                                      │
│ 文件夹内容                           │
│ ┌──────────────────────────────────┐ │
│ │ 📁 references/                   │ │
│ │    📄 style-guide.md             │ │
│ │    📄 checklist.md               │ │
│ │ 📁 scripts/                      │ │
│ │    📄 lint.sh                    │ │
│ └──────────────────────────────────┘ │
│                                      │
├──────────────────────────────────────┤
│         [取消]          [保存]       │
└──────────────────────────────────────┘
```

**功能**：
- 编辑 frontmatter 字段（name, description, allowedTools）
- 编辑 SKILL.md 正文内容（Markdown 编辑器）
- 查看 Skill 文件夹结构（只读树形展示）
- 保存修改（写回 SKILL.md 文件）

### 3.3 SkillInstallDialog

安装 Skill 的对话框，支持三种安装方式。

```
┌──────────────────────────────────────┐
│ 安装 Skill                      ✕   │
├──────────────────────────────────────┤
│                                      │
│ ┌────────┐ ┌────────┐ ┌────────┐    │
│ │ 文件夹 │ │  ZIP   │ │  URL   │    │
│ └────────┘ └────────┘ └────────┘    │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │                                  │ │
│ │     拖拽文件夹到此处             │ │
│ │         或点击选择               │ │
│ │                                  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ 提示：支持从 ~/.claude/skills/      │
│ 等其他客户端直接导入 Skill 文件夹    │
│                                      │
├──────────────────────────────────────┤
│                        [取消] [安装] │
└──────────────────────────────────────┘
```

**Tab 切换内容**：

1. **文件夹 Tab**：文件夹选择区域
2. **ZIP Tab**：ZIP 文件选择区域
3. **URL Tab**：URL 输入框

**冲突处理对话框**：
```
┌──────────────────────────────────────┐
│ Skill 已存在                    ✕   │
├──────────────────────────────────────┤
│                                      │
│ 名为 "code-review" 的 Skill 已存在。│
│ 是否要覆盖现有 Skill？               │
│                                      │
├──────────────────────────────────────┤
│                      [取消] [覆盖]   │
└──────────────────────────────────────┘
```

---

## 4. 交互流程

### 4.1 查看 Skills 列表

```
用户打开 Settings → Skills
    │
    ▼
加载 Skills Metadata 列表
    │
    ▼
渲染 SkillCard 网格
    │
    ├── 有 Skills → 显示卡片网格
    │
    └── 无 Skills → 显示空状态
                    "还没有安装任何 Skill"
                    [安装第一个 Skill]
```

### 4.2 安装 Skill

```
用户点击 "安装" 按钮
    │
    ▼
打开 SkillInstallDialog
    │
    ▼
用户选择安装方式（文件夹/ZIP/URL）
    │
    ▼
选择/输入安装源
    │
    ▼
点击 "安装"
    │
    ▼
验证 Skill 结构
    │
    ├── 无效 → 显示错误提示
    │
    ▼
检查是否存在同名 Skill
    │
    ├── 存在 → 显示覆盖确认对话框
    │           │
    │           ├── 取消 → 返回
    │           │
    │           └── 覆盖 → 继续安装
    │
    ▼
执行安装
    │
    ▼
显示成功提示（Toast）
    │
    ▼
刷新 Skills 列表
```

### 4.3 编辑 Skill

```
用户点击 SkillCard 的 "编辑" 按钮
    │
    ▼
打开 SkillEditorSheet
    │
    ▼
加载 Skill 完整内容
    │
    ▼
用户编辑字段
    │
    ▼
点击 "保存"
    │
    ▼
验证表单
    │
    ├── 无效 → 显示错误提示
    │
    ▼
写回 SKILL.md 文件
    │
    ▼
显示成功提示（Toast）
    │
    ▼
刷新 Skills 列表
```

### 4.4 删除 Skill

```
用户点击 SkillCard 的 "删除" 按钮
    │
    ▼
显示 AlertDialog 确认
    │
    ├── 取消 → 关闭对话框
    │
    └── 确认 → 执行删除
                │
                ▼
            删除 Skill 文件夹
                │
                ▼
            显示成功提示（Toast）
                │
                ▼
            刷新 Skills 列表
```

---

## 5. 文件结构

```
src/renderer/settings/
├── main.ts                          # 添加 /skills 路由
└── components/
    └── skills/
        ├── SkillsSettings.vue       # 主页面
        ├── SkillsHeader.vue         # 头部（搜索、导入、安装）
        ├── SkillCard.vue            # Skill 卡片
        ├── SkillEditorSheet.vue     # 编辑侧边栏
        ├── SkillInstallDialog.vue   # 安装对话框
        └── SkillFolderTree.vue      # 文件夹树形展示

src/renderer/src/stores/
└── skills.ts                        # Skills Pinia Store
```

---

## 6. Store 设计

```typescript
// src/renderer/src/stores/skills.ts
import { defineStore } from 'pinia'

interface SkillMetadata {
  name: string
  description: string
  path: string
  skillRoot: string
  allowedTools?: string[]
}

export const useSkillsStore = defineStore('skills', {
  state: () => ({
    skills: [] as SkillMetadata[],
    loading: false,
    error: null as string | null
  }),

  actions: {
    // 加载 Skills 列表
    async loadSkills() {
      this.loading = true
      try {
        const presenter = useLegacyPresenter('skillPresenter')
        this.skills = await presenter.getMetadataList()
      } finally {
        this.loading = false
      }
    },

    // 安装 Skill
    async installFromFolder(folderPath: string) { /* ... */ },
    async installFromZip(zipPath: string) { /* ... */ },
    async installFromUrl(url: string) { /* ... */ },

    // 卸载 Skill
    async uninstall(name: string) { /* ... */ },

    // 更新 Skill
    async updateSkill(name: string, content: string) { /* ... */ }
  }
})
```

---

## 7. 国际化

添加以下 i18n key：

```json
{
  "settings.skills": "Skills",
  "settings.skills.title": "Skills 管理",
  "settings.skills.search": "搜索 Skills...",
  "settings.skills.install": "安装",
  "settings.skills.import": "导入",
  "settings.skills.import.folder": "从文件夹安装",
  "settings.skills.import.zip": "从 ZIP 安装",
  "settings.skills.import.url": "从 URL 安装",
  "settings.skills.empty": "还没有安装任何 Skill",
  "settings.skills.empty.action": "安装第一个 Skill",
  "settings.skills.count": "共 {count} 个 Skills",
  "settings.skills.openFolder": "打开 Skills 文件夹",
  "settings.skills.card.edit": "编辑",
  "settings.skills.card.delete": "删除",
  "settings.skills.card.allowedTools": "额外工具",
  "settings.skills.editor.title": "编辑 Skill",
  "settings.skills.editor.name": "名称",
  "settings.skills.editor.description": "描述",
  "settings.skills.editor.allowedTools": "额外工具 (allowedTools)",
  "settings.skills.editor.content": "Skill 内容",
  "settings.skills.editor.files": "文件夹内容",
  "settings.skills.editor.save": "保存",
  "settings.skills.editor.cancel": "取消",
  "settings.skills.install.title": "安装 Skill",
  "settings.skills.install.tab.folder": "文件夹",
  "settings.skills.install.tab.zip": "ZIP",
  "settings.skills.install.tab.url": "URL",
  "settings.skills.install.folder.hint": "拖拽文件夹到此处或点击选择",
  "settings.skills.install.folder.tip": "支持从 ~/.claude/skills/ 等其他客户端直接导入",
  "settings.skills.install.zip.hint": "拖拽 ZIP 文件到此处或点击选择",
  "settings.skills.install.url.placeholder": "输入 ZIP 下载地址",
  "settings.skills.install.confirm": "安装",
  "settings.skills.install.cancel": "取消",
  "settings.skills.conflict.title": "Skill 已存在",
  "settings.skills.conflict.message": "名为 \"{name}\" 的 Skill 已存在。是否要覆盖现有 Skill？",
  "settings.skills.conflict.overwrite": "覆盖",
  "settings.skills.conflict.cancel": "取消",
  "settings.skills.delete.title": "删除 Skill",
  "settings.skills.delete.message": "确定要删除 Skill \"{name}\" 吗？此操作不可撤销。",
  "settings.skills.delete.confirm": "删除",
  "settings.skills.delete.cancel": "取消",
  "settings.skills.toast.installed": "Skill \"{name}\" 安装成功",
  "settings.skills.toast.updated": "Skill \"{name}\" 更新成功",
  "settings.skills.toast.deleted": "Skill \"{name}\" 已删除",
  "settings.skills.toast.error": "操作失败: {error}"
}
```

---

## 8. 路由配置

```typescript
// src/renderer/settings/main.ts
{
  path: '/skills',
  name: 'skills',
  component: () => import('./components/skills/SkillsSettings.vue'),
  meta: {
    titleKey: 'settings.skills',
    icon: 'lucide:sparkles',
    position: 5
  }
}
```

---

## 9. Presenter 接口

UI 层通过 `useLegacyPresenter('skillPresenter')` 调用以下方法：

```typescript
interface SkillPresenter {
  // 列表
  getMetadataList(): Promise<SkillMetadata[]>

  // 安装
  installFromFolder(folderPath: string): Promise<{ success: boolean; error?: string }>
  installFromZip(zipPath: string): Promise<{ success: boolean; error?: string }>
  installFromUrl(url: string): Promise<{ success: boolean; error?: string }>

  // 卸载
  uninstallSkill(name: string): Promise<{ success: boolean; error?: string }>

  // 读取完整内容
  loadSkillContent(name: string): Promise<string>

  // 更新 SKILL.md
  updateSkillFile(name: string, content: string): Promise<{ success: boolean; error?: string }>

  // 获取 Skill 文件夹结构
  getSkillFolderTree(name: string): Promise<FolderNode[]>

  // 打开 Skills 目录
  openSkillsFolder(): Promise<void>

  // 获取 Skills 目录路径
  getSkillsDir(): Promise<string>
}
```

---

## 10. 事件监听

UI 需要监听以下事件以实时更新：

```typescript
// 在 SkillsSettings.vue 中
onMounted(() => {
  // 监听 Skill 变化事件（热加载触发）
  eventBus.on(SKILL_EVENTS.METADATA_UPDATED, () => {
    skillsStore.loadSkills()
  })

  eventBus.on(SKILL_EVENTS.INSTALLED, () => {
    skillsStore.loadSkills()
  })

  eventBus.on(SKILL_EVENTS.UNINSTALLED, () => {
    skillsStore.loadSkills()
  })
})
```

