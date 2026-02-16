# Phase 2: Settings - Agent Management

## Overview

在设置界面实现 Agent 管理功能，包括：
1. Template Agent 创建/编辑/删除
2. Workdir 管理（独立的设置列）
3. 默认 Local Agent 的显示和配置

## Core Principle: 复用现有能力

本 phase 复用以下现有组件：

- **设置框架**: 复用 `src/renderer/settings/` 的布局和导航模式
- **shadcn/ui 组件**: 使用现有 Popover, Dialog, Button, Input, Select 等组件
- **Provider 数据**: 从 `llmProviderPresenter` 获取 provider 和 model 列表
- **文件选择器**: 复用 `filePresenter.showDirectoryPicker()` 打开目录
- **i18n**: 遵循 `src/renderer/src/i18n/` 的国际化模式

## UI Design

### Settings Navigation

```
┌─────────────────────────────────────────────────────────────┐
│  Settings                                                   │
├──────────────┬──────────────────────────────────────────────┤
│  General     │                                              │
│  Providers   │                                              │
│  Agents  ←── │       Agent Management Content               │
│  MCP         │                                              │
│  ACP         │                                              │
│  Shortcuts   │                                              │
│  About       │                                              │
└──────────────┴──────────────────────────────────────────────┘
```

### Agent Management Page

```
┌─────────────────────────────────────────────────────────────┐
│  Agents                                                     │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  [+ New Agent]                    [Search...]       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Template Agents                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  📁 Local Agent                           [Edit]    │   │
│  │     Provider: Ollama  |  Model: llama3              │   │
│  │     Workdir: ~/DeepChat/workspace                   │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  🤖 Claude Helper                         [Edit]    │   │
│  │     Provider: Anthropic  |  Model: claude-3-sonnet  │   │
│  │     Workdir: ~/Projects/my-app                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ACP Agents (Synced from ACP Settings)                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🟢 Claude Code                           [View]    │   │
│  │     Command: claude                                  │   │
│  │     Managed in ACP Settings                         │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │  🟢 Codex                                 [View]    │   │
│  │     Command: codex                                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Create/Edit Agent Dialog

```
┌─────────────────────────────────────────────────────────────┐
│  Create Agent                                    [X]        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Name                                                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  My Agent                                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Icon (optional)                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  lucide:bot                                   [Pick]│   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Provider                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Ollama                                     [▼]     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Model                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  llama3                                     [▼]     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Workdir                                                   │
│  ┌─────────────────────────────────────────────────────┬─┐ │
│  │  ~/Projects/my-app                               [📁]│ │
│  └─────────────────────────────────────────────────────┴─┘ │
│                                                             │
│  Advanced Settings                                    [▶]  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  System Prompt (optional)                          │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │                                             │   │   │
│  │  │                                             │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  │                                                     │   │
│  │  Temperature: 0.7  [=================|===]          │   │
│  │  Max Tokens:   4096 [================|====]         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│                                    [Cancel]    [Create]    │
└─────────────────────────────────────────────────────────────┘
```

### Workdir Picker Dialog

```
┌─────────────────────────────────────────────────────────────┐
│  Select Working Directory                       [X]        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Recent Directories                                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  📁 ~/Projects/deepchat                             │   │
│  │  📁 ~/Projects/my-app                               │   │
│  │  📁 ~/Documents/notes                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Browse Other Directory...]                               │
│                                                             │
│  Selected: ~/Projects/deepchat                             │
│                                                             │
│                                    [Cancel]    [Select]    │
└─────────────────────────────────────────────────────────────┘
```

## Components

### New Components

| Component | Location | Description |
|-----------|----------|-------------|
| AgentSettings | `settings/components/AgentSettings.vue` | Agent 管理主页面 |
| AgentList | `settings/components/AgentList.vue` | Agent 列表展示 |
| AgentEditorDialog | `settings/components/AgentEditorDialog.vue` | 创建/编辑 Agent 对话框 |
| WorkdirPicker | `settings/components/WorkdirPicker.vue` | 工作目录选择器 |
| AgentIconPicker | `settings/components/AgentIconPicker.vue` | 图标选择器 |

### Component Structure

```
AgentSettings.vue
├── AgentList.vue
│   ├── TemplateAgentSection.vue
│   │   └── AgentListItem.vue (template type)
│   └── AcpAgentSection.vue
│       └── AgentListItem.vue (acp type)
├── AgentEditorDialog.vue
│   ├── WorkdirPicker.vue
│   └── AgentIconPicker.vue
└── WorkdirPicker.vue (standalone dialog)
```

## Data Flow

### Creating Agent

```
User Input
    │
    ▼
AgentEditorDialog.emit('create', agentData)
    │
    ▼
AgentSettings.handleCreateAgent()
    │
    ▼
presenter.agentConfigPresenter.createAgent(params)
    │
    ▼
SQLite INSERT INTO agents
    │
    ▼
EventBus.send(AGENT_EVENTS.AGENT_CREATED)
    │
    ▼
WorkspaceStore.refreshAgents()
```

### Workdir Selection

```
User clicks workdir field
    │
    ▼
WorkdirPicker.open()
    │
    ▼
Load recent workdirs from configPresenter
    │
    ▼
User selects or browses
    │
    ▼
WorkdirPicker.emit('select', path)
    │
    ▼
AgentEditorDialog updates form
```

## Default Agent

### Local Agent 配置

```typescript
const DEFAULT_LOCAL_AGENT = {
  id: 'local-agent-default',
  name: 'Local Agent',
  type: 'template',
  icon: 'lucide:bot',
  providerId: 'ollama',  // 或用户配置的默认 provider
  modelId: 'llama3',     // 或用户配置的默认 model
  workdir: path.join(app.getPath('userData'), 'workspace')
}
```

### 首次启动逻辑

1. 检查是否已存在任何 Agent
2. 如果不存在，创建默认 Local Agent
3. 创建默认工作目录 `~/DeepChat/workspace` 或 `{userData}/workspace`

## Settings Store Integration

```typescript
// Agent 设置状态
interface AgentSettingsState {
  agents: Agent[]
  loading: boolean
  error: string | null
  editingAgent: Agent | null
  showEditorDialog: boolean
  showWorkdirPicker: boolean
}
```

## i18n Keys

```json
{
  "settings.agents.title": "Agents",
  "settings.agents.description": "Manage your agent templates and configurations",
  "settings.agents.newAgent": "New Agent",
  "settings.agents.templateSection": "Template Agents",
  "settings.agents.acpSection": "ACP Agents",
  "settings.agents.acpSectionHint": "Managed in ACP Settings",
  "settings.agents.createTitle": "Create Agent",
  "settings.agents.editTitle": "Edit Agent",
  "settings.agents.name": "Name",
  "settings.agents.icon": "Icon",
  "settings.agents.provider": "Provider",
  "settings.agents.model": "Model",
  "settings.agents.workdir": "Working Directory",
  "settings.agents.advancedSettings": "Advanced Settings",
  "settings.agents.systemPrompt": "System Prompt",
  "settings.agents.temperature": "Temperature",
  "settings.agents.maxTokens": "Max Tokens",
  "settings.agents.workdirPicker.title": "Select Working Directory",
  "settings.agents.workdirPicker.recent": "Recent Directories",
  "settings.agents.workdirPicker.browse": "Browse Other Directory",
  "settings.agents.defaultLocalAgent": "Local Agent"
}
```

## Files to Create/Modify

### New Files
- `src/renderer/settings/components/AgentSettings.vue`
- `src/renderer/settings/components/AgentList.vue`
- `src/renderer/settings/components/AgentEditorDialog.vue`
- `src/renderer/settings/components/WorkdirPicker.vue`
- `src/renderer/settings/components/AgentIconPicker.vue`

### Modified Files
- `src/renderer/settings/App.vue` - 添加 Agents 导航项
- `src/renderer/settings/components/SettingsNav.vue` - 添加 Agents 菜单项
- `src/renderer/src/i18n/locales/en/settings.json` - 添加 i18n keys
- `src/renderer/src/i18n/locales/zh-CN/settings.json` - 添加 i18n keys

## Dependencies

- Phase 1 (AgentConfigPresenter)
- configPresenter (for recent workdirs)
- EventBus (for agent change events)

## Testing

- [ ] Agent creation flow
- [ ] Agent editing flow
- [ ] Agent deletion flow
- [ ] Workdir picker functionality
- [ ] ACP agents read-only display
- [ ] Default agent creation on first launch
