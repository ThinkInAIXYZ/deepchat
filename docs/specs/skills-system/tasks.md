# DeepChat Skills 系统开发任务清单

## 概述

本文档基于 [design.md](./design.md) 和 [ui-design.md](./ui-design.md) 制定，用于开发跟踪。

**预计工作量**：中等复杂度功能，涉及 Main/Renderer 双端开发

---

## Phase 1: 核心基础设施

### 1.1 数据模型与类型定义

- [x] **1.1.1** 在 `src/shared/` 中定义 Skills 相关类型
  ```typescript
  interface SkillMetadata {
    name: string
    description: string
    path: string
    skillRoot: string
    allowedTools?: string[]
  }

  interface SkillContent {
    name: string
    content: string
  }
  ```

- [x] **1.1.2** 扩展 Conversation 类型，添加 `activeSkills?: string[]` 字段

### 1.2 数据库 Schema 扩展

- [x] **1.2.1** 修改 `chat.db` 的 conversations 表，添加 `active_skills` 列（JSON 序列化）
- [x] **1.2.2** 添加数据库迁移脚本

### 1.3 配置系统扩展

- [x] **1.3.1** 在 ConfigPresenter 中添加 Skills 配置项
  - `skillsPath`: Skills 目录路径 (`~/.deepchat/skills/`)
  - `enableSkills`: 全局开关（默认 true）

### 1.4 SkillPresenter 实现

- [x] **1.4.1** 创建 `src/main/presenter/skillPresenter/index.ts`
- [x] **1.4.2** 实现 `getSkillsDir()` - 获取 Skills 根目录路径
- [x] **1.4.3** 实现 `discoverSkills()` - 扫描目录，解析 SKILL.md frontmatter
- [x] **1.4.4** 实现 `getMetadataList()` - 返回所有 Skill 的 Metadata
- [x] **1.4.5** 实现 `loadSkillContent(name)` - 读取完整 SKILL.md，替换路径变量
- [x] **1.4.6** 实现 `getMetadataPrompt()` - 生成注入 Context 的 Metadata 文本

### 1.5 安装与卸载功能

- [x] **1.5.1** 实现 `installBuiltinSkills()` - 首次启动时安装内置 Skills
- [x] **1.5.2** 实现 `installFromFolder(folderPath)` - 从本地文件夹安装
- [x] **1.5.3** 实现 `installFromZip(zipPath)` - 从 ZIP 文件安装
- [x] **1.5.4** 实现 `installFromUrl(url)` - 从 URL 下载安装
- [x] **1.5.5** 实现 `uninstallSkill(name)` - 卸载（删除文件夹）
- [x] **1.5.6** 实现 name 与目录名一致性验证（自动重命名）
- [x] **1.5.7** 实现同名冲突检测与覆盖逻辑

### 1.6 热加载机制

- [x] **1.6.1** 实现 `watchSkillFiles()` - 使用 chokidar 监控 skills 目录
- [x] **1.6.2** 文件变化时重新解析 Metadata
- [x] **1.6.3** 发送 `SKILL_EVENTS.METADATA_UPDATED` 事件

### 1.7 会话状态管理

- [x] **1.7.1** 实现 `getActiveSkills(conversationId)` - 从数据库加载激活状态
- [x] **1.7.2** 实现 `setActiveSkills(conversationId, skills)` - 持久化激活状态
- [x] **1.7.3** 实现 `validateSkillNames(names)` - 过滤已不存在的 Skill

---

## Phase 2: Agent Loop 集成

### 2.1 工具定义与注册

- [x] **2.1.1** 创建 `src/main/presenter/skillPresenter/skillTools.ts`
- [x] **2.1.2** 实现 `skill_list` 工具 - 列出可用 Skills 及激活状态
- [x] **2.1.3** 实现 `skill_control` 工具 - 激活/停用 Skill
- [x] **2.1.4** 在 ToolPresenter 中注册 Skills 工具（仅当 enableSkills = true）

### 2.2 Context 构建集成

- [x] **2.2.1** 修改 AgentLoopHandler，添加 enableSkills 检查
- [x] **2.2.2** 在系统提示中注入 Metadata 列表（含 Skills 根目录路径）
- [x] **2.2.3** 检测激活 Skills，加载完整内容注入系统提示
- [x] **2.2.4** 实现路径变量替换（`${SKILL_ROOT}`, `${SKILLS_DIR}`）

### 2.3 工具列表合并

- [x] **2.3.1** 实现 `getActiveSkillsAllowedTools(conversationId)`
- [x] **2.3.2** 在构建 LLM 工具列表时合并 allowedTools（并集）

### 2.4 事件系统

- [x] **2.4.1** 在 `src/main/events.ts` 中定义 SKILL_EVENTS 常量
  ```typescript
  const SKILL_EVENTS = {
    DISCOVERED: 'skill:discovered',
    METADATA_UPDATED: 'skill:metadata-updated',
    INSTALLED: 'skill:installed',
    UNINSTALLED: 'skill:uninstalled',
    ACTIVATED: 'skill:activated',
    DEACTIVATED: 'skill:deactivated'
  }
  ```
- [x] **2.4.2** 在相应操作时发送事件

---

## Phase 3: UI 实现

### 3.1 路由与导航

- [x] **3.1.1** 在 Settings 路由配置中添加 `/skills` 路由
- [~] **3.1.2** 添加导航菜单项（图标/位置与 spec 不一致）

### 3.2 Pinia Store

- [~] **3.2.1** 创建 `src/renderer/src/stores/skills.ts`（已存在 `skillsStore.ts`）
- [x] **3.2.2** 实现 state: `skills`, `loading`, `error`
- [~] **3.2.3** 实现 actions: `loadSkills`, `installFromFolder`, `installFromZip`, `installFromUrl`, `uninstall`, `updateSkill`（缺少 zip/url）

### 3.3 主页面组件

- [~] **3.3.1** 创建 `src/renderer/settings/components/skills/SkillsSettings.vue`（已存在简版页面）
- [~] **3.3.2** 实现页面整体布局（Header + ScrollArea + Footer）（无 Footer）
- [x] **3.3.3** 实现空状态展示
- [~] **3.3.4** 实现卡片网格布局（目前为列表）
- [ ] **3.3.5** 监听 SKILL_EVENTS 实时更新

### 3.4 Header 组件

- [ ] **3.4.1** 创建 `SkillsHeader.vue`
- [ ] **3.4.2** 实现搜索输入框
- [ ] **3.4.3** 实现导入下拉菜单（文件夹/ZIP/URL）
- [ ] **3.4.4** 实现安装按钮

### 3.5 Skill 卡片组件

- [ ] **3.5.1** 创建 `SkillCard.vue`
- [ ] **3.5.2** 实现卡片展示（名称、描述、allowedTools）
- [ ] **3.5.3** 实现编辑/删除操作按钮
- [ ] **3.5.4** 实现 hover 效果

### 3.6 编辑侧边栏

- [~] **3.6.1** 创建 `SkillEditorSheet.vue`（已内嵌在 SkillsSettings）
- [ ] **3.6.2** 实现 frontmatter 字段编辑（name, description, allowedTools）
- [x] **3.6.3** 实现 Markdown 内容编辑
- [ ] **3.6.4** 实现文件夹结构展示（只读）
- [x] **3.6.5** 实现保存逻辑（写回 SKILL.md）

### 3.7 安装对话框

- [~] **3.7.1** 创建 `SkillInstallDialog.vue`（已内嵌 Dialog）
- [ ] **3.7.2** 实现 Tab 切换（文件夹/ZIP/URL）
- [~] **3.7.3** 实现文件夹选择（支持拖拽）（仅选择）
- [ ] **3.7.4** 实现 ZIP 文件选择（支持拖拽）
- [ ] **3.7.5** 实现 URL 输入
- [ ] **3.7.6** 实现安装流程与进度提示
- [ ] **3.7.7** 实现冲突确认对话框

### 3.8 文件夹树组件

- [ ] **3.8.1** 创建 `SkillFolderTree.vue`
- [x] **3.8.2** 实现 `getSkillFolderTree(name)` Presenter 方法
- [ ] **3.8.3** 实现树形结构展示

### 3.9 删除确认

- [x] **3.9.1** 实现删除确认 AlertDialog
- [x] **3.9.2** 实现删除后 Toast 提示

---

## Phase 4: 国际化与完善

### 4.1 i18n

- [~] **4.1.1** 添加中文 i18n keys (`zh-CN`)（已部分添加）
- [~] **4.1.2** 添加英文 i18n keys (`en-US`)（已部分添加）
- [ ] **4.1.3** 运行 `pnpm run i18n` 检查完整性

### 4.2 内置 Skills

- [ ] **4.2.1** 设计并编写 1-2 个内置 Skill 示例
- [ ] **4.2.2** 打包内置 Skills 到应用资源
- [ ] **4.2.3** 首次启动时自动安装

### 4.3 测试

- [ ] **4.3.1** SkillPresenter 单元测试
- [ ] **4.3.2** skill_list / skill_control 工具测试
- [ ] **4.3.3** 安装/卸载流程测试
- [ ] **4.3.4** UI 组件测试（可选）

### 4.4 文档与清理

- [ ] **4.4.1** 更新 README 或用户文档
- [ ] **4.4.2** 代码审查与清理
- [ ] **4.4.3** 运行 `pnpm run format && pnpm run lint && pnpm run typecheck`

---

## 依赖关系

```
Phase 1 (基础设施)
    │
    ├── 1.1-1.3 类型/数据库/配置 ─┐
    │                            │
    ├── 1.4 SkillPresenter ──────┼── Phase 2 (Agent Loop)
    │                            │       │
    ├── 1.5 安装/卸载 ───────────┤       ├── 2.1-2.2 工具/Context
    │                            │       │
    ├── 1.6 热加载 ──────────────┤       └── 2.3-2.4 工具合并/事件
    │                            │
    └── 1.7 会话状态 ────────────┘
                                         │
                                         ▼
                                 Phase 3 (UI)
                                     │
                                     ├── 3.1-3.2 路由/Store
                                     │
                                     └── 3.3-3.9 组件
                                         │
                                         ▼
                                 Phase 4 (完善)
```

---

## 里程碑

| 里程碑 | 完成标准 |
|--------|----------|
| **M1: 核心功能** | SkillPresenter 完成，能发现、安装、卸载 Skills |
| **M2: Agent 集成** | skill_list/skill_control 工具可用，激活后内容注入 Context |
| **M3: UI 完成** | Settings 页面可用，支持全部安装方式 |
| **M4: 发布就绪** | i18n 完成，测试通过，代码审查完成 |

---

## 备注

- 开发过程中如有设计变更，及时更新 design.md 和 ui-design.md
- 每个任务完成后在本文档标记 `[x]`
- 建议按 Phase 顺序推进，Phase 内可并行
