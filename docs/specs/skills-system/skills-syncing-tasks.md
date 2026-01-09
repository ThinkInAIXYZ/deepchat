# Skills 跨工具同步开发任务清单

## 概述

本文档基于 [skills-syncing.md](./skills-syncing.md) 及其子文档制定，用于开发跟踪。

**预计工作量**：中等复杂度功能，涉及 Main/Renderer 双端开发

**支持的工具**：
- Claude Code - YAML frontmatter + Markdown（子文件夹结构）
- Cursor - 纯 Markdown（单文件）
- Windsurf - 步骤式 Markdown（单文件）
- GitHub Copilot - YAML frontmatter + Markdown（单文件）
- Kiro - YAML frontmatter + Markdown（单文件，支持 inclusion 模式）
- Antigravity - YAML frontmatter + Markdown（单文件，步骤式）

---

## Phase 1: 类型定义与核心数据模型

### 1.1 共享类型定义

- [x] **1.1.1** 创建 `src/shared/types/skillSync.ts` 文件骨架
  ```typescript
  // 包含：CanonicalSkill, SkillReference, SkillScript
  // ExternalToolConfig, FormatCapabilities
  // ScanResult, ExternalSkillInfo
  // ImportPreview, ExportPreview
  // ConflictStrategy, SyncResult
  ```

- [x] **1.1.2** 定义 `CanonicalSkill` 中间格式接口
  - name, description, instructions
  - allowedTools, model, tags
  - references, scripts
  - source 来源信息

- [x] **1.1.3** 定义 `ExternalToolConfig` 工具配置接口
  - id, name, skillsDir, filePattern, format
  - capabilities (FormatCapabilities)

- [x] **1.1.4** 定义 `FormatCapabilities` 格式能力接口
  - hasFrontmatter, supportsName, supportsDescription
  - supportsTools, supportsModel
  - supportsSubfolders, supportsReferences, supportsScripts

- [x] **1.1.5** 定义同步操作相关类型
  - ScanResult, ExternalSkillInfo
  - ImportPreview, ExportPreview
  - ConflictStrategy (enum)
  - SyncResult

- [x] **1.1.6** 定义 `ISkillSyncPresenter` 接口
  - scanExternalTools(), scanTool()
  - previewImport(), executeImport()
  - previewExport(), executeExport()
  - getRegisteredTools(), isToolAvailable()

- [x] **1.1.7** 在 `src/shared/types/index.d.ts` 中导出 skillSync 类型

---

## Phase 2: Format Adapters 实现（插件化）

### 2.1 适配器基础架构

- [x] **2.1.1** 创建 `src/main/presenter/skillSyncPresenter/adapters/` 目录结构
- [x] **2.1.2** 定义 `IFormatAdapter` 接口
  ```typescript
  interface IFormatAdapter {
    id: string
    name: string
    parse(content: string, context: ParseContext): CanonicalSkill
    serialize(skill: CanonicalSkill): string
    detect(content: string): boolean
    getCapabilities(): FormatCapabilities
  }
  ```
- [x] **2.1.3** 创建 `adapters/index.ts` 适配器注册表

### 2.2 Claude Code 适配器

- [x] **2.2.1** 创建 `adapters/claudeCodeAdapter.ts`
- [x] **2.2.2** 实现 parse() - YAML frontmatter 解析
  - 处理 `allowed-tools` ↔ `allowedTools` 字段名转换
  - 支持字符串和数组两种 allowed-tools 格式
- [x] **2.2.3** 实现 serialize() - 生成 SKILL.md 格式
- [x] **2.2.4** 实现 references/ 和 scripts/ 子文件夹处理
- [x] **2.2.5** 单元测试

### 2.3 Cursor 适配器

- [x] **2.3.1** 创建 `adapters/cursorAdapter.ts`
- [x] **2.3.2** 实现 parse() - 纯 Markdown 解析
  - 从 `# Title` 提取 name
  - 从首段提取 description
- [x] **2.3.3** 实现 serialize() - 生成 Cursor 格式
  - 可选将 references 内联到 `## References`
- [x] **2.3.4** 单元测试

### 2.4 Windsurf 适配器

- [x] **2.4.1** 创建 `adapters/windsurfAdapter.ts`
- [x] **2.4.2** 实现 parse() - 步骤式 Markdown 解析
  - 从标题提取 name（去除 " Workflow" 后缀）
  - 提取 `## Steps` 之前的描述
- [x] **2.4.3** 实现 serialize() - 生成步骤式格式
  - 智能检测是否已有步骤结构
- [x] **2.4.4** 单元测试

### 2.5 GitHub Copilot 适配器

- [x] **2.5.1** 创建 `adapters/copilotAdapter.ts`
- [x] **2.5.2** 实现 parse() - YAML frontmatter 解析
  - 工具名称映射（read → Read, runCommands → Bash 等）
  - 处理 `#file:` 引用语法
- [x] **2.5.3** 实现 serialize() - 生成 `.prompt.md` 格式
  - 反向工具名称映射
  - 将 references 转换为 `#file:` 引用
- [x] **2.5.4** 单元测试

### 2.6 Kiro 适配器

- [x] **2.6.1** 创建 `adapters/kiroAdapter.ts`
- [x] **2.6.2** 实现 parse() - 处理 inclusion 模式
  - 保存 inclusion 和 file_patterns 信息
- [x] **2.6.3** 实现 serialize() - 生成 Kiro 格式
  - 支持设置 inclusion 模式
  - 将 description 嵌入为引用块
- [x] **2.6.4** 定义 Kiro 导出选项接口
- [x] **2.6.5** 单元测试

### 2.7 Antigravity 适配器

- [x] **2.7.1** 创建 `adapters/antigravityAdapter.ts`
- [x] **2.7.2** 实现 parse() - 与 Windsurf 类似，但有 frontmatter
- [x] **2.7.3** 实现 serialize() - 生成步骤式格式
- [x] **2.7.4** 单元测试

---

## Phase 3: 核心服务实现

### 3.1 ToolScanner 工具扫描器

- [x] **3.1.1** 创建 `src/main/presenter/skillSyncPresenter/toolScanner.ts`
- [x] **3.1.2** 实现工具配置注册表
  ```typescript
  const EXTERNAL_TOOLS: ExternalToolConfig[] = [
    { id: 'claude-code', name: 'Claude Code', skillsDir: '~/.claude/skills/', ... },
    { id: 'cursor', name: 'Cursor', skillsDir: '.cursor/commands/', ... },
    // ...
  ]
  ```
- [x] **3.1.3** 实现 `scanTool(toolId)` - 扫描单个工具目录
  - 检查目录是否存在
  - 根据 filePattern 匹配文件
  - 提取基本元信息
- [x] **3.1.4** 实现 `scanExternalTools()` - 扫描所有已注册工具
- [x] **3.1.5** 实现路径安全验证（防止路径遍历）
- [x] **3.1.6** 单元测试

### 3.2 FormatConverter 格式转换引擎

- [x] **3.2.1** 创建 `src/main/presenter/skillSyncPresenter/formatConverter.ts`
- [x] **3.2.2** 实现 `parseExternal()` - 根据格式选择适配器解析
- [x] **3.2.3** 实现 `serializeToExternal()` - 序列化为外部格式
- [x] **3.2.4** 实现 `serializeToSkillMd()` - 序列化为 DeepChat SKILL.md
- [x] **3.2.5** 实现 `getConversionWarnings()` - 获取转换警告
  - 检测功能丢失（如 allowedTools 导出到 Cursor）
- [x] **3.2.6** 单元测试

### 3.3 SkillSyncPresenter 主类

- [x] **3.3.1** 创建 `src/main/presenter/skillSyncPresenter/index.ts` 骨架
- [x] **3.3.2** 创建 `src/main/presenter/skillSyncPresenter/types.ts` 内部类型

- [x] **3.3.3** 实现扫描功能
  - `scanExternalTools()` - 扫描所有外部工具
  - `scanTool(toolId)` - 扫描指定工具

- [x] **3.3.4** 实现导入功能
  - `previewImport()` - 预览导入，检测冲突
  - `executeImport()` - 执行导入，处理冲突策略
  - 调用 SkillPresenter.installFromFolder()

- [x] **3.3.5** 实现导出功能
  - `previewExport()` - 预览导出，检测冲突
  - `executeExport()` - 执行导出，写入目标目录
  - 调用 SkillPresenter.loadSkillContent()

- [x] **3.3.6** 实现工具查询
  - `getRegisteredTools()` - 获取所有已注册工具配置
  - `isToolAvailable()` - 检查工具目录是否存在

- [x] **3.3.7** 实现冲突处理逻辑
  - SKIP - 跳过
  - OVERWRITE - 覆盖
  - RENAME - 重命名（添加后缀）

- [x] **3.3.8** 集成测试

### 3.4 Presenter 注册与 IPC

- [x] **3.4.1** 在 `src/main/presenter/index.ts` 中注册 SkillSyncPresenter
- [x] **3.4.2** ~~在 `src/preload/presenter.ts` 中暴露 API~~ (不需要，使用动态路由)
- [x] **3.4.3** 更新 `src/shared/presenter.d.ts` 类型定义

---

## Phase 4: 事件系统

### 4.1 事件定义

- [x] **4.1.1** 在 `src/main/events.ts` 中添加 SKILL_SYNC_EVENTS
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

- [x] **4.1.2** 在相应操作时发送事件

---

## Phase 5: UI 实现

### 5.1 组件目录结构

- [x] **5.1.1** 创建 `src/renderer/settings/components/skills/SkillSyncDialog/` 目录
- [x] **5.1.2** 规划组件文件
  ```
  SkillSyncDialog/
  ├── SkillSyncDialog.vue        # 同步向导主组件
  ├── ImportWizard.vue           # 导入向导
  ├── ExportWizard.vue           # 导出向导
  ├── ToolSelector.vue           # 工具选择器
  ├── SkillSelector.vue          # Skill 选择器
  ├── ConflictResolver.vue       # 冲突处理
  └── SyncResult.vue             # 结果展示
  ```

### 5.2 入口集成

- [x] **5.2.1** 修改 `SkillsHeader.vue`，添加"同步"下拉菜单
  - "从其他工具导入..."
  - "导出到其他工具..."

### 5.3 主对话框组件

- [x] **5.3.1** 创建 `SkillSyncDialog.vue`
  - 管理导入/导出模式切换
  - 控制向导步骤流程

### 5.4 导入向导

- [x] **5.4.1** 创建 `ImportWizard.vue`
  - Step 1: 选择来源工具
  - Step 2: 选择 Skills
  - Step 3: 预览与冲突处理

- [x] **5.4.2** 创建 `ToolSelector.vue`
  - 显示已检测到的工具列表
  - 显示每个工具的 Skills 数量
  - 支持自定义路径

- [x] **5.4.3** 创建 `SkillSelector.vue`
  - 复选框列表选择 Skills
  - 显示冲突警告标识
  - 支持全选/取消全选

- [x] **5.4.4** 创建 `ConflictResolver.vue`
  - 单个冲突的处理选项（覆盖/跳过/重命名）
  - 批量冲突处理

- [x] **5.4.5** 导入流程进度展示

### 5.5 导出向导

- [x] **5.5.1** 创建 `ExportWizard.vue`
  - Step 1: 选择要导出的 Skills
  - Step 2: 选择目标工具
  - Step 3: 预览与确认

- [x] **5.5.2** 实现转换警告展示
  - 显示功能丢失警告
  - 显示转换后内容预览

- [x] **5.5.3** 实现 Kiro 特殊导出选项
  - inclusion 模式选择
  - file_patterns 输入

### 5.6 结果展示

- [x] **5.6.1** 创建 `SyncResult.vue`
  - 成功/跳过/失败统计
  - 详细列表展示

---

## Phase 6: 国际化

### 6.1 i18n 键值

- [x] **6.1.1** 添加中文 i18n keys (`zh-CN`)
  ```json
  {
    "settings.skills.sync": "同步",
    "settings.skills.sync.import": "从其他工具导入...",
    "settings.skills.sync.export": "导出到其他工具...",
    // ... 完整键值见 skills-syncing.md 第 6 节
  }
  ```

- [x] **6.1.2** 添加英文 i18n keys (`en-US`)

- [x] **6.1.3** 运行 `pnpm run i18n` 检查完整性

---

## Phase 7: 安全与测试

### 7.1 安全验证

- [x] **7.1.1** 实现路径安全验证
  - 防止路径遍历攻击（../）
  - 验证目录在预期范围内

- [x] **7.1.2** 实现内容安全
  - 限制文件大小
  - YAML 解析使用安全选项

- [x] **7.1.3** 实现权限检查
  - 导出时检查目标目录写权限
  - 导入时检查源目录读权限

### 7.2 单元测试

- [x] **7.2.1** Format Adapters 测试（各适配器）
- [x] **7.2.2** ToolScanner 测试
- [x] **7.2.3** FormatConverter 测试
- [x] **7.2.4** SkillSyncPresenter 测试

### 7.3 集成测试

- [x] **7.3.1** 完整导入流程测试
- [x] **7.3.2** 完整导出流程测试
- [x] **7.3.3** 冲突处理测试

### 7.4 代码质量

- [x] **7.4.1** 运行 `pnpm run format && pnpm run lint && pnpm run typecheck`
- [ ] **7.4.2** 代码审查

---

## 依赖关系

```
Phase 1 (类型定义)
    │
    └── 1.1 共享类型 ───────────────────────────────────────────────┐
                                                                    │
Phase 2 (Format Adapters)                                          │
    │                                                               │
    ├── 2.1 适配器基础架构 ◄─────────────────────────────────────────┤
    │                                                               │
    ├── 2.2 Claude Code 适配器 ◄────────────────────────────────────┤
    ├── 2.3 Cursor 适配器 ◄─────────────────────────────────────────┤
    ├── 2.4 Windsurf 适配器 ◄───────────────────────────────────────┤
    ├── 2.5 Copilot 适配器 ◄────────────────────────────────────────┤
    ├── 2.6 Kiro 适配器 ◄───────────────────────────────────────────┤
    └── 2.7 Antigravity 适配器 ◄────────────────────────────────────┘
                    │
                    ▼
Phase 3 (核心服务)
    │
    ├── 3.1 ToolScanner ◄── Phase 2
    ├── 3.2 FormatConverter ◄── Phase 2
    ├── 3.3 SkillSyncPresenter ◄── 3.1, 3.2
    └── 3.4 IPC 注册 ◄── 3.3
                    │
                    ▼
Phase 4 (事件系统) ◄── Phase 3
                    │
                    ▼
Phase 5 (UI 实现)
    │
    ├── 5.1-5.2 目录结构与入口
    ├── 5.3 主对话框
    ├── 5.4 导入向导
    ├── 5.5 导出向导
    └── 5.6 结果展示
                    │
                    ▼
Phase 6 (国际化) ◄── Phase 5
                    │
                    ▼
Phase 7 (安全与测试) ◄── All Phases
```

---

## 里程碑

| 里程碑 | 完成标准 |
|--------|----------|
| **M1: 类型与适配器** | 所有 Format Adapters 实现并通过测试 |
| **M2: 核心服务** | SkillSyncPresenter 完成，能扫描、导入、导出 |
| **M3: UI 完成** | 导入/导出向导可用，冲突处理完善 |
| **M4: 发布就绪** | i18n 完成，安全验证通过，测试覆盖 |

---

## 备注

- 开发过程中如有设计变更，及时更新 skills-syncing.md 和相关子文档
- 每个任务完成后在本文档标记 `[x]`
- 建议按 Phase 顺序推进，Phase 内可并行
- 适配器开发可并行进行，由不同开发者负责
