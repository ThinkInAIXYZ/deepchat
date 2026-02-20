# New Theme Migration Plan

## Overview

基于新的 mock UI 设计，重新规划主题迁移。核心变化：

1. **Agent 为第一级**：侧边栏左侧显示 Agent 列表（Template + ACP）
2. **Session 绑定 Agent**：创建时选择 Agent，不可变
3. **Workdir 在设置中配置**：设置界面单独一列管理 workdir

## Core Principles

### 1. 样式严格遵循 Mock 组件

所有新组件必须严格遵循现有 mock 组件的样式规范，参考以下文件：

- `src/renderer/src/components/WindowSideBar.vue` - 侧边栏布局和样式
- `src/renderer/src/components/NewThread.vue` - Welcome 页面布局
- `src/renderer/src/components/chat-input/InputBox.vue` - 输入框容器
- `src/renderer/src/components/chat-input/components/InputToolbar.vue` - 输入工具栏
- `src/renderer/src/components/StatusBar.vue` - 状态栏

### 2. 复用现有能力

目标是利用已有功能放入新的样式和划分中，而非重写：

- 复用现有的 presenter（sessionPresenter, agentPresenter 等）
- 复用现有的 stores（chat, workspace 等）
- 复用现有的 composables（usePresenter, useMockViewState 等）
- 复用 shadcn/ui 组件库

### 3. 样式规范摘要

#### WindowSideBar 布局
```
┌────────────────────────────────────────┐
│ 左列 (48px) │ 右列 (240px, 可折叠)      │
│ Agent Icons │ Session List             │
│ ┌────────┐  │ ┌──────────────────────┐ │
│ │ w-9    │  │ │ Header (h-10)        │ │
│ │ h-9    │  │ ├──────────────────────┤ │
│ │ rounded│  │ │ Group: Today         │ │
│ │ -xl    │  │ │  • Session Item      │ │
│ └────────┘  │ │  • Session Item      │ │
│             │ └──────────────────────┘ │
└────────────────────────────────────────┘
```

#### Agent Icon 按钮
- 尺寸: `w-9 h-9` (36px)
- 圆角: `rounded-xl`
- 选中: `bg-card/50 border-white/80 ring-1 ring-black/10`
- 未选中: `bg-transparent border-none shadow-none`
- 悬停: `hover:bg-white/30 dark:hover:bg-white/10`

#### Session Item
- Padding: `px-2 py-1.5`
- 圆角: `rounded-md`
- 选中: `bg-accent text-accent-foreground`
- 未选中: `text-foreground/80 hover:bg-accent/50`

#### NewThread Welcome 布局
- Logo: `w-14 h-14`
- 标题: `text-3xl font-semibold`
- Project Selector: `h-7 px-2.5 text-xs`

#### InputBox 容器
- 宽度: `w-full max-w-2xl`
- 圆角: `rounded-xl`
- 背景: `bg-card/30 backdrop-blur-lg`

#### InputToolbar 按钮
- 尺寸: `h-7 w-7`
- 圆角: `rounded-lg` (工具按钮), `rounded-full` (发送)
- 颜色: `text-muted-foreground hover:text-foreground`

### 4. 渐进式迁移

- 每个 phase 完成后必须可独立运行
- 保持现有功能不中断
- Mock 组件逐步替换为真实数据源

## Key Concepts

### Agent Types

```typescript
type Agent = TemplateAgent | AcpAgent

interface TemplateAgent {
  id: string
  name: string
  type: 'template'
  providerId: string
  modelId: string
  systemPrompt?: string
  temperature?: number
  contextLength?: number
  maxTokens?: number
  thinkingBudget?: number
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  icon?: string
  createdAt: number
  updatedAt: number
}

interface AcpAgent {
  id: string
  name: string
  type: 'acp'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  icon?: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}
```

### Data Sources

| Type | Source | Storage |
|------|--------|---------|
| Template Agents | User created in Settings | SQLite `agents` table |
| ACP Agents | Synced from `configPresenter.acp_agents` | SQLite `agents` table (sync) |
| Sessions | `sessionPresenter` | SQLite `conversations` table |
| Workdirs | User configured in Settings | SQLite `workdirs` table |

### Session-Agent Binding

- Session 创建时选择 Agent（必选）
- 绑定后不可更改
- Session 继承 Agent 的默认配置（model, systemPrompt, temperature 等）
- `agentWorkspacePath` 仍用于记录工作目录，但来源是 Workdir 配置

## Migration Phases

### Phase 1: Agent Data Model & Storage
- Design SQLite `agents` table
- Implement `AgentConfigPresenter`
- Create migration logic for ACP agents sync
- [Details](./phase1-agent-storage/spec.md)

### Phase 2: Settings - Agent Management
- Create Template Agent settings section
- Implement workdir management UI
- Create default "Local Agent"
- [Details](./phase2-settings-agent/spec.md)

### Phase 3: WindowSideBar Refactor
- Agent list component (left panel)
- Session list component (right panel)
- Grouping logic (by project / by date)
- [Details](./phase3-sidebar/spec.md)

### Phase 4: NewThread Adaptation
- Agent selector in NewThread
- Workdir display (from selected Agent's default workdir)
- [Details](./phase4-newthread/spec.md)

### Phase 5: ChatInput Integration
- Workdir toolbar in input box
- Per-message workdir override
- [Details](./phase5-chat-input/spec.md)

### Phase 6: Shell Removal
- Remove shell layer
- Integrate tab management into workspace store
- [Details](./phase6-shell-removal/spec.md)

## UI Structure (Target)

```
┌──────────────────────────────────────────────────────────────┐
│                        Main Window                           │
├──────────┬─────────────────┬──────────────────────────────────┤
│  Agent   │  Session List   │          Main Content            │
│  List    │                 │                                  │
│  48px    │     240px       │          flexible                │
│          │                 │                                  │
│ ┌──────┐ │ ┌─────────────┐ │ ┌──────────────────────────────┐ │
│ │ A1   │ │ │ <Search>    │ │ │        TopBar                │ │
│ ├──────┤ │ ├─────────────┤ │ ├──────────────────────────────┤ │
│ │ A2   │ │ │ Group By    │ │ │                              │ │
│ ├──────┤ │ ├─────────────┤ │ │                              │ │
│ │ A3   │ │ │ Project A   │ │ │      Chat / Welcome          │ │
│ │      │ │ │  - Sess 1   │ │ │                              │ │
│ │      │ │ │  - Sess 2   │ │ │                              │ │
│ │      │ │ │ Project B   │ │ │                              │ │
│ │      │ │ │  - Sess 3   │ │ │                              │ │
│ └──────┘ │ └─────────────┘ │ ├──────────────────────────────┤ │
│ ┌──────┐ │                 │ │  InputBox + Workdir Toolbar   │ │
│ │ +New │ │                 │ └──────────────────────────────┘ │
│ └──────┘ │                 │                                  │
└──────────┴─────────────────┴──────────────────────────────────┘
```

## Dependencies

```
Phase 1 (Agent Storage)
    │
    ▼
Phase 2 (Settings) ──────┬──────► Phase 4 (NewThread)
    │                    │              │
    ▼                    │              ▼
Phase 3 (Sidebar) ◄──────┘       Phase 5 (ChatInput)
    │                                   │
    └───────────────┬───────────────────┘
                    ▼
              Phase 6 (Shell Removal)
```

## Progress

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1 | ✅ Completed | Agent Data Model & Storage |
| Phase 2 | 🔴 Not Started | Settings - Agent Management |
| Phase 3 | 🔴 Not Started | WindowSideBar Refactor |
| Phase 4 | ✅ Completed | NewThread Adaptation |
| Phase 5 | ✅ Completed | ChatInput Integration |
| Phase 6 | 🔴 Not Started | Shell Removal |

## Key Files Reference

### Mock 组件（样式参考）

| 文件 | 用途 |
|------|------|
| `src/renderer/src/components/WindowSideBar.vue` | 侧边栏双列布局、Agent Icon、Session List 样式 |
| `src/renderer/src/components/NewThread.vue` | Welcome 页面布局、Project Selector 样式 |
| `src/renderer/src/components/chat-input/InputBox.vue` | InputBox 容器样式 + 输入交互 |
| `src/renderer/src/components/chat-input/components/InputToolbar.vue` | 工具栏按钮样式 |
| `src/renderer/src/components/StatusBar.vue` | 状态栏按钮样式 |
| `src/renderer/src/components/ChatPreviewPage.vue` | 预览聊天页面整体布局 |
| `src/renderer/src/components/ChatPreviewTopBar.vue` | 顶部栏样式 |

### 现有 Presenter（复用）

| 文件 | 用途 |
|------|------|
| `src/main/presenter/sessionPresenter/index.ts` | Session CRUD、列表查询 |
| `src/main/presenter/configPresenter/acpConfHelper.ts` | ACP Agent 配置读取 |
| `src/main/presenter/llmProviderPresenter/index.ts` | Provider/Model 列表 |
| `src/main/presenter/filePresenter/index.ts` | 文件选择器 |

### 现有 Store（复用）

| 文件 | 用途 |
|------|------|
| `src/renderer/src/stores/workspace.ts` | Tab 状态、窗口状态 |
| `src/renderer/src/stores/chat.ts` | 聊天状态、消息管理 |

### 现有 Composables（复用）

| 文件 | 用途 |
|------|------|
| `src/renderer/src/composables/useMockViewState.ts` | Mock 视图状态管理 |
| `src/renderer/src/composables/usePresenter.ts` | Presenter 访问 |
