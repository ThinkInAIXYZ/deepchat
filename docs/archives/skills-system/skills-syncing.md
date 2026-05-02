# Skills 跨工具同步设计文档

> Archive note: This document is a historical record. File paths and implementation names can reference code that has since moved or been removed.


## 1. 概述

### 1.1 背景

不同的 AI Agent 工具都有自己的 Skills/Commands/Workflows 系统，但格式和存储位置各不相同。用户在多个工具之间切换时，希望能够复用已有的 Skills。

### 1.2 设计目标

| 目标 | 描述 | 优先级 |
|------|------|--------|
| **双向同步** | 支持从其他工具导入和导出到其他工具 | P0 |
| **格式转换** | 自动处理不同工具间的格式差异 | P0 |
| **冲突处理** | 提供清晰的冲突解决机制 | P0 |
| **批量操作** | 支持一次性同步多个 Skills | P1 |
| **增量同步** | 仅同步有变化的 Skills | P2 |

### 1.3 非目标

- 实时双向自动同步（需用户主动触发）
- 跨工具的 Skill 依赖解析
- 云端同步服务
- 工具间的功能完全对等（部分工具功能可能无法完全转换）

### 1.4 支持的工具

| 工具 | 规格文档 |
|------|----------|
| Claude Code | [skills-syncing-claude-code.md](./skills-syncing-claude-code.md) |
| Cursor | [skills-syncing-cursor.md](./skills-syncing-cursor.md) |
| Windsurf | [skills-syncing-windsurf.md](./skills-syncing-windsurf.md) |
| Antigravity | [skills-syncing-antigravity.md](./skills-syncing-antigravity.md) |
| GitHub Copilot | [skills-syncing-copilot.md](./skills-syncing-copilot.md) |
| Kiro | [skills-syncing-kiro.md](./skills-syncing-kiro.md) |

---

## 2. 数据模型

### 2.1 统一中间格式 (Canonical Skill Format)

所有工具的 Skill 在转换时，先转为统一的中间格式：

```typescript
/**
 * 统一的 Skill 中间格式
 * 用于在不同工具格式之间转换
 */
interface CanonicalSkill {
  // 基础元数据
  name: string                    // 唯一标识符
  description: string             // 描述文本

  // 内容
  instructions: string            // 主要指令内容（Markdown）

  // 可选元数据
  allowedTools?: string[]         // 工具限制
  model?: string                  // 指定模型
  tags?: string[]                 // 标签分类

  // 附属资源
  references?: SkillReference[]   // 参考文档
  scripts?: SkillScript[]         // 脚本文件

  // 来源信息
  source?: {
    tool: string                  // 来源工具标识
    originalPath: string          // 原始路径
    originalFormat: string        // 原始格式
  }
}

interface SkillReference {
  name: string                    // 文件名
  content: string                 // 文件内容
  relativePath: string            // 相对路径
}

interface SkillScript {
  name: string                    // 脚本名
  content: string                 // 脚本内容
  relativePath: string            // 相对路径
}
```

### 2.2 外部工具配置

```typescript
/**
 * 外部工具配置接口
 * 每个工具的具体配置在对应的子文档中定义
 */
interface ExternalToolConfig {
  id: string                      // 工具唯一标识
  name: string                    // 显示名称
  skillsDir: string               // 相对于 HOME 的路径
  filePattern: string             // 文件匹配模式 (glob)
  format: string                  // 文件格式类型
  capabilities: FormatCapabilities // 格式能力
}

/**
 * 格式能力定义
 */
interface FormatCapabilities {
  hasFrontmatter: boolean         // 是否有 YAML frontmatter
  supportsName: boolean           // 支持 name 字段
  supportsDescription: boolean    // 支持 description 字段
  supportsTools: boolean          // 支持工具限制
  supportsModel: boolean          // 支持模型指定
  supportsSubfolders: boolean     // 支持子文件夹结构
  supportsReferences: boolean     // 支持 references/
  supportsScripts: boolean        // 支持 scripts/
}
```

### 2.3 同步操作类型

```typescript
/**
 * 扫描结果
 */
interface ScanResult {
  toolId: string
  toolName: string
  available: boolean              // 目录是否存在
  skillsDir: string               // 完整路径
  skills: ExternalSkillInfo[]     // 发现的 Skills
  error?: string                  // 扫描错误
}

interface ExternalSkillInfo {
  name: string
  description?: string
  path: string                    // 文件/文件夹路径
  format: string                  // 检测到的格式
  lastModified: Date              // 最后修改时间
}

/**
 * 导入预览
 */
interface ImportPreview {
  skill: CanonicalSkill           // 转换后的 Skill
  source: ExternalSkillInfo       // 来源信息
  conflict?: {
    existingSkill: SkillMetadata  // 已存在的同名 Skill
    strategy: ConflictStrategy    // 建议的处理策略
  }
  warnings: string[]              // 转换警告（如丢失功能）
}

/**
 * 导出预览
 */
interface ExportPreview {
  skill: SkillMetadata            // 要导出的 Skill
  targetTool: string              // 目标工具 ID
  targetPath: string              // 目标路径
  convertedContent: string        // 转换后的内容预览
  warnings: string[]              // 转换警告
  conflict?: {
    existingPath: string          // 已存在的文件
    strategy: ConflictStrategy
  }
}

/**
 * 冲突处理策略
 */
enum ConflictStrategy {
  SKIP = 'skip',                  // 跳过
  OVERWRITE = 'overwrite',        // 覆盖
  RENAME = 'rename',              // 重命名（添加后缀）
  MERGE = 'merge'                 // 合并（仅适用于部分场景）
}

/**
 * 同步操作结果
 */
interface SyncResult {
  success: boolean
  imported: number                // 成功导入数量
  exported: number                // 成功导出数量
  skipped: number                 // 跳过数量
  failed: Array<{
    skill: string
    reason: string
  }>
}
```

---

## 3. 架构设计

### 3.1 模块架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SkillSyncPresenter                          │
│  统一的同步协调器，管理导入/导出流程                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌───────────────────┐     ┌───────────────────┐                   │
│  │   ToolScanner     │     │  FormatConverter  │                   │
│  │  扫描外部工具目录  │     │  格式转换引擎     │                   │
│  └─────────┬─────────┘     └─────────┬─────────┘                   │
│            │                         │                              │
│            ▼                         ▼                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Format Adapters (插件化)                  │   │
│  │  每个外部工具一个 Adapter，负责解析和序列化该工具的格式       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ 调用
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SkillPresenter                              │
│  现有的 Skill 管理器（安装/卸载/读写）                              │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件接口

#### SkillSyncPresenter

同步功能的主入口，协调扫描、转换和写入：

```typescript
interface ISkillSyncPresenter {
  // 扫描
  scanExternalTools(): Promise<ScanResult[]>
  scanTool(toolId: string): Promise<ScanResult>

  // 导入（从外部工具 → DeepChat）
  previewImport(toolId: string, skillNames: string[]): Promise<ImportPreview[]>
  executeImport(previews: ImportPreview[], strategies: Record<string, ConflictStrategy>): Promise<SyncResult>

  // 导出（从 DeepChat → 外部工具）
  previewExport(skillNames: string[], targetToolId: string): Promise<ExportPreview[]>
  executeExport(previews: ExportPreview[], strategies: Record<string, ConflictStrategy>): Promise<SyncResult>

  // 工具配置
  getRegisteredTools(): ExternalToolConfig[]
  isToolAvailable(toolId: string): Promise<boolean>
}
```

#### FormatConverter

格式转换引擎，处理不同格式间的转换：

```typescript
interface IFormatConverter {
  // 解析外部格式 → CanonicalSkill
  parseExternal(content: string, format: string, context: ParseContext): CanonicalSkill

  // CanonicalSkill → 外部格式
  serializeToExternal(skill: CanonicalSkill, targetToolId: string): string

  // CanonicalSkill → DeepChat SKILL.md
  serializeToSkillMd(skill: CanonicalSkill): string

  // 获取转换警告
  getConversionWarnings(skill: CanonicalSkill, targetToolId: string): string[]
}

interface ParseContext {
  toolId: string
  filePath: string
  folderPath?: string            // 对于支持子文件夹的工具
}
```

#### Format Adapter

每种格式的具体转换实现（插件化）：

```typescript
interface IFormatAdapter {
  // 适配器标识
  readonly id: string
  readonly name: string

  // 解析
  parse(content: string, context: ParseContext): CanonicalSkill

  // 序列化
  serialize(skill: CanonicalSkill): string

  // 检测格式
  detect(content: string): boolean

  // 获取功能限制
  getCapabilities(): FormatCapabilities
}
```

### 3.3 数据流

#### 导入流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 用户选择    │     │ 扫描外部    │     │ 格式转换    │     │ 冲突检测    │
│ 外部工具    │────▶│ 工具目录    │────▶│ → Canonical │────▶│ & 预览      │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                                   │
                                                                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 刷新 UI     │◀────│ 写入到      │◀────│ Canonical   │◀────│ 用户确认    │
│ 显示结果    │     │ DeepChat    │     │ → SKILL.md  │     │ 冲突策略    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

#### 导出流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 用户选择    │     │ 读取        │     │ 格式转换    │     │ 冲突检测    │
│ Skills &    │────▶│ DeepChat    │────▶│ → 目标格式  │────▶│ & 预览      │
│ 目标工具    │     │ Skills      │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
                                                                   │
                                                                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 显示结果    │◀────│ 写入到      │◀────│ 用户确认    │◀────│ 显示转换    │
│             │     │ 目标目录    │     │ 冲突策略    │     │ 警告        │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

---

## 4. 交互设计

### 4.1 UI 入口

在 Skills 设置页面添加同步功能：

```
┌─────────────────────────────────────────────────────────────────┐
│ Skills Settings                                                  │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ Header                                                      │ │
│ │ ┌─────────────────┐  ┌──────────┐  ┌──────────┐  ┌───────┐ │ │
│ │ │ 🔍 Search...    │  │ 同步 ▾   │  │ 导入 ▾  │  │+ 安装 │ │ │
│ │ └─────────────────┘  └──────────┘  └──────────┘  └───────┘ │ │
│ │                      ┌───────────────────────┐              │ │
│ │                      │ 从其他工具导入...     │              │ │
│ │                      │ 导出到其他工具...     │              │ │
│ │                      └───────────────────────┘              │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ [Skills 卡片网格...]                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 导入向导流程

**Step 1: 选择来源工具**

```
┌──────────────────────────────────────────────────────────────────┐
│ 从其他工具导入 Skills                                        ✕   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 选择要导入的工具:                                                │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ○ [工具名称]         [目录路径]                            │  │
│ │   ✓ 已检测到 N 个 Skills                                  │  │
│ ├────────────────────────────────────────────────────────────┤  │
│ │ ○ [工具名称]         [目录路径]                            │  │
│ │   ⚠ 目录不存在                                             │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ○ 自定义路径...                                            │  │
│ │   选择包含 Skills 的文件夹                                  │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                              [取消]    [下一步]  │
└──────────────────────────────────────────────────────────────────┘
```

**Step 2: 选择 Skills**

```
┌──────────────────────────────────────────────────────────────────┐
│ 从 [工具名称] 导入                                           ✕   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌────────────────────────┐                                      │
│ │ ☐ 全选 (N)            │                                      │
│ └────────────────────────┘                                      │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ☑ [skill-name]                                             │  │
│ │   [skill description]                                       │  │
│ │   ⚠ 已存在同名 Skill (如有冲突)                            │  │
│ ├────────────────────────────────────────────────────────────┤  │
│ │ ☑ [skill-name]                                             │  │
│ │   [skill description]                                       │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ 已选择 N 个，其中 M 个存在冲突                                   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                [上一步]    [取消]    [下一步]    │
└──────────────────────────────────────────────────────────────────┘
```

**Step 3: 预览与冲突处理**

```
┌──────────────────────────────────────────────────────────────────┐
│ 确认导入                                                     ✕   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 即将导入 N 个 Skills:                                           │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ✓ [skill-name]                                             │  │
│ │   ┌──────────────────────────────────────────────────────┐ │  │
│ │   │ ⚠ 冲突: 已存在同名 Skill                             │ │  │
│ │   │                                                      │ │  │
│ │   │ 处理方式: ○ 覆盖  ○ 跳过  ● 重命名为 xxx-1           │ │  │
│ │   └──────────────────────────────────────────────────────┘ │  │
│ ├────────────────────────────────────────────────────────────┤  │
│ │ ✓ [skill-name]                                             │  │
│ │   无冲突，将直接导入                                        │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ℹ️ 转换说明                                                 │  │
│ │ • [转换说明列表，根据源工具动态生成]                        │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                [上一步]    [取消]    [导入]      │
└──────────────────────────────────────────────────────────────────┘
```

### 4.3 导出向导流程

**Step 1: 选择要导出的 Skills**

```
┌──────────────────────────────────────────────────────────────────┐
│ 导出 Skills 到其他工具                                       ✕   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 选择要导出的 Skills:                                             │
│                                                                  │
│ ┌────────────────────────┐                                      │
│ │ ☐ 全选 (N)            │                                      │
│ └────────────────────────┘                                      │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ☑ [skill-name]                                             │  │
│ │   [skill description]                                       │  │
│ │   📁 包含 references/, scripts/ (如有)                      │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ 已选择 N 个 Skills                                               │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                              [取消]    [下一步]  │
└──────────────────────────────────────────────────────────────────┘
```

**Step 2: 选择目标工具**

```
┌──────────────────────────────────────────────────────────────────┐
│ 选择目标工具                                                 ✕   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 导出到:                                                          │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ○ [工具名称]         [目录路径]                            │  │
│ │   ✓ 完全兼容 / ⚠ [丢失功能列表]                           │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ○ 自定义路径...                                            │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                [上一步]    [取消]    [下一步]    │
└──────────────────────────────────────────────────────────────────┘
```

**Step 3: 预览与确认**

```
┌──────────────────────────────────────────────────────────────────┐
│ 确认导出到 [工具名称]                                        ✕   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 即将导出 N 个 Skills 到 [目标路径]                               │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ [skill-name] → [目标文件名]                                │  │
│ │   ┌──────────────────────────────────────────────────────┐ │  │
│ │   │ ℹ️ 转换说明:                                          │ │  │
│ │   │ • [转换说明列表]                                      │ │  │
│ │   └──────────────────────────────────────────────────────┘ │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ 预览: [目标文件名]                                         │  │
│ │ ┌──────────────────────────────────────────────────────┐   │  │
│ │ │ [转换后的内容预览]                                   │   │  │
│ │ └──────────────────────────────────────────────────────┘   │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                [上一步]    [取消]    [导出]      │
└──────────────────────────────────────────────────────────────────┘
```

### 4.4 结果反馈

```
┌──────────────────────────────────────────────────────────────────┐
│ [导入/导出]完成                                              ✕   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│         ✓ [操作]成功                                            │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ 成功: N                                                    │  │
│ │ • [skill-name]                                             │  │
│ │ • [skill-name]                                             │  │
│ │                                                            │  │
│ │ 跳过: M                                                    │  │
│ │ • [skill-name] (原因)                                      │  │
│ │                                                            │  │
│ │ 失败: K                                                    │  │
│ │ • [skill-name] (错误原因)                                  │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                         [完成]   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. 与现有系统集成

### 5.1 与 SkillPresenter 集成

```
SkillSyncPresenter                    SkillPresenter
       │                                    │
       │  scanExternalTools()               │
       │ ──────────────────────────────────▶│ (不调用)
       │                                    │
       │  executeImport()                   │
       │ ──────────────────────────────────▶│ installFromFolder()
       │                                    │
       │  executeExport()                   │
       │ ──────────────────────────────────▶│ loadSkillContent()
       │                                    │ getSkillFolderTree()
       │                                    │
```

### 5.2 事件定义

```typescript
const SKILL_SYNC_EVENTS = {
  SCAN_STARTED: 'skill-sync:scan-started',
  SCAN_COMPLETED: 'skill-sync:scan-completed',
  IMPORT_STARTED: 'skill-sync:import-started',
  IMPORT_PROGRESS: 'skill-sync:import-progress',
  IMPORT_COMPLETED: 'skill-sync:import-completed',
  EXPORT_STARTED: 'skill-sync:export-started',
  EXPORT_PROGRESS: 'skill-sync:export-progress',
  EXPORT_COMPLETED: 'skill-sync:export-completed'
}
```

### 5.3 文件结构

```
src/main/presenter/
├── skillPresenter/
│   └── index.ts                    # 现有 Skill 管理
└── skillSyncPresenter/
    ├── index.ts                    # SkillSyncPresenter 主类
    ├── types.ts                    # 类型定义
    ├── toolScanner.ts              # 工具扫描器
    ├── formatConverter.ts          # 格式转换引擎
    └── adapters/                   # 格式适配器（插件化）
        └── index.ts                # 适配器注册表

src/renderer/settings/components/skills/
├── SkillsSettings.vue              # 添加同步按钮
├── SkillSyncDialog/
│   ├── SkillSyncDialog.vue         # 同步向导主组件
│   ├── ImportWizard.vue            # 导入向导
│   ├── ExportWizard.vue            # 导出向导
│   ├── ToolSelector.vue            # 工具选择器
│   ├── SkillSelector.vue           # Skill 选择器
│   ├── ConflictResolver.vue        # 冲突处理
│   └── SyncResult.vue              # 结果展示

src/shared/types/
└── skillSync.ts                    # 共享类型定义
```

---

## 6. 国际化

```json
{
  "settings.skills.sync": "同步",
  "settings.skills.sync.import": "从其他工具导入...",
  "settings.skills.sync.export": "导出到其他工具...",

  "settings.skills.sync.import.title": "从其他工具导入 Skills",
  "settings.skills.sync.import.selectTool": "选择要导入的工具:",
  "settings.skills.sync.import.detected": "已检测到 {count} 个 Skills",
  "settings.skills.sync.import.notFound": "目录不存在",
  "settings.skills.sync.import.customPath": "自定义路径...",
  "settings.skills.sync.import.selectSkills": "选择要导入的 Skills",
  "settings.skills.sync.import.selectAll": "全选 ({count})",
  "settings.skills.sync.import.conflict": "已存在同名 Skill",
  "settings.skills.sync.import.selected": "已选择 {count} 个，其中 {conflicts} 个存在冲突",

  "settings.skills.sync.export.title": "导出 Skills 到其他工具",
  "settings.skills.sync.export.selectSkills": "选择要导出的 Skills",
  "settings.skills.sync.export.selectTarget": "选择目标工具",
  "settings.skills.sync.export.compatible": "完全兼容",
  "settings.skills.sync.export.warning": "{feature} 将丢失",

  "settings.skills.sync.conflict.title": "冲突处理",
  "settings.skills.sync.conflict.overwrite": "覆盖",
  "settings.skills.sync.conflict.skip": "跳过",
  "settings.skills.sync.conflict.rename": "重命名为 {name}",

  "settings.skills.sync.preview.title": "确认{action}",
  "settings.skills.sync.preview.converting": "转换说明",
  "settings.skills.sync.preview.warnings": "警告",

  "settings.skills.sync.result.title": "{action}完成",
  "settings.skills.sync.result.success": "成功: {count}",
  "settings.skills.sync.result.skipped": "跳过: {count}",
  "settings.skills.sync.result.failed": "失败: {count}",

  "settings.skills.sync.action.import": "导入",
  "settings.skills.sync.action.export": "导出",
  "settings.skills.sync.button.next": "下一步",
  "settings.skills.sync.button.prev": "上一步",
  "settings.skills.sync.button.done": "完成"
}
```

---

## 7. 安全考虑

### 7.1 路径安全

- 所有路径操作需验证在预期目录范围内
- 防止路径遍历攻击（../）
- 验证外部工具目录确实存在且可读

### 7.2 内容安全

- 解析外部文件时限制文件大小
- YAML 解析使用安全选项（禁用不安全的类型）
- 不执行任何脚本内容，仅复制

### 7.3 权限

- 导出时检查目标目录写权限
- 导入时检查源目录读权限
- 失败时提供明确错误信息

---

## 8. 未来扩展

### 8.1 增量同步

- 基于文件修改时间检测变化
- 仅同步有更新的 Skills
- 提供"上次同步时间"记录

### 8.2 自动同步

- 可选的文件监控模式
- 检测到外部工具 Skills 变化时通知用户
- 提供一键更新

### 8.3 更多工具支持

- 插件化的适配器架构
- 用户可添加自定义工具配置
- 社区贡献的适配器

### 8.4 云同步

- 可选的云端备份
- 跨设备同步
- 团队共享
