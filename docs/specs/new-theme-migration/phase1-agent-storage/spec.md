# Phase 1: Agent Data Model & Storage

## Overview

设计并实现 Agent 的数据模型和存储层，包括：
1. SQLite `agents` 表结构
2. `AgentConfigPresenter` 提供者
3. ACP agents 自动同步逻辑

## Core Principle: 复用现有能力

本 phase 复用以下现有组件：

- **SQLite 基础设施**: 复用 `src/main/presenter/sqlitePresenter/` 的表管理模式
- **配置读取**: 复用 `configPresenter.acpConfHelper` 获取 ACP agents 配置
- **Presenter 模式**: 遵循现有 presenter 的设计模式（参考 `sessionPresenter`）
- **IPC 通信**: 复用 `preload/index.ts` 的 contextBridge 模式

## Data Model

### Agent Types

```typescript
// src/shared/types/presenters/agent.presenter.d.ts

export type AgentType = 'template' | 'acp'

export interface AgentBase {
  id: string
  name: string
  type: AgentType
  icon?: string  // iconify icon name
  createdAt: number
  updatedAt: number
}

export interface TemplateAgent extends AgentBase {
  type: 'template'
  providerId: string
  modelId: string
  systemPrompt?: string
  temperature?: number
  contextLength?: number
  maxTokens?: number
  thinkingBudget?: number
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
}

export interface AcpAgent extends AgentBase {
  type: 'acp'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled: boolean
}

export type Agent = TemplateAgent | AcpAgent
```

### SQLite Schema

```sql
-- agents 表
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('template', 'acp')),
  icon TEXT,

  -- Template Agent 字段
  provider_id TEXT,
  model_id TEXT,
  system_prompt TEXT,
  temperature REAL,
  context_length INTEGER,
  max_tokens INTEGER,
  thinking_budget INTEGER,
  reasoning_effort TEXT,

  -- ACP Agent 字段
  command TEXT,
  args TEXT,    -- JSON string
  env TEXT,     -- JSON string
  cwd TEXT,
  enabled INTEGER DEFAULT 1,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- conversations 表改造（新增字段）
ALTER TABLE conversations ADD COLUMN agent_id TEXT REFERENCES agents(id);
```

### Session Model Update

```typescript
// SessionConfig 新增字段
export type SessionConfig = {
  // ... existing fields
  agentId?: string  // 新增：绑定的 Agent ID
}
```

## Presenter Interface

```typescript
// src/main/presenter/agentConfigPresenter/index.ts

export interface IAgentConfigPresenter {
  // Agent CRUD
  getAgents(): Promise<Agent[]>
  getAgent(id: string): Promise<Agent | null>
  createAgent(agent: CreateAgentParams): Promise<string>
  updateAgent(id: string, updates: UpdateAgentParams): Promise<void>
  deleteAgent(id: string): Promise<void>

  // ACP Agent 同步
  syncAcpAgents(): Promise<void>
  
  // Default Agent
  ensureDefaultAgent(): Promise<void>
  getDefaultAgent(): Promise<TemplateAgent | null>
}

export type CreateAgentParams = Omit<TemplateAgent, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateAgentParams = Partial<Omit<Agent, 'id' | 'type' | 'createdAt' | 'updatedAt'>>
```

## Implementation Details

### 1. AgentConfigPresenter

位置: `src/main/presenter/agentConfigPresenter/index.ts`

职责:
- 管理 agents 表的 CRUD 操作
- 提供默认 Agent (Local Agent) 的创建和获取
- 同步 ACP agents 到 agents 表

### 2. ACP Agents 同步逻辑

```typescript
async syncAcpAgents(): Promise<void> {
  // 1. 从 configPresenter 获取所有 ACP agents 配置
  const acpConfigs = await this.configPresenter.getAcpAgents()
  
  // 2. 获取现有 agents 表中的 ACP agents
  const existingAcpAgents = await this.getAgentsByType('acp')
  
  // 3. 对比并同步
  for (const config of acpConfigs) {
    const existing = existingAcpAgents.find(a => a.id === config.id)
    if (!existing) {
      // 新增
      await this.createAcpAgent(config)
    } else {
      // 更新（如果有变化）
      await this.updateAcpAgentIfNeeded(existing, config)
    }
  }
  
  // 4. 删除不再存在的 ACP agents
  for (const agent of existingAcpAgents) {
    if (!acpConfigs.find(c => c.id === agent.id)) {
      await this.deleteAgent(agent.id)
    }
  }
}
```

### 3. Default Agent (Local Agent)

```typescript
async ensureDefaultAgent(): Promise<void> {
  const existing = await this.getAgent(DEFAULT_AGENT_ID)
  if (existing) return
  
  // 创建默认工作目录
  const defaultWorkdir = path.join(app.getPath('userData'), 'workspace')
  await fs.ensureDir(defaultWorkdir)
  
  // 创建默认 Agent
  await this.createAgent({
    id: DEFAULT_AGENT_ID,
    name: 'Local Agent',
    type: 'template',
    providerId: 'ollama',  // 或默认 provider
    modelId: 'llama3',     // 或默认 model
    icon: 'lucide:bot'
  })
}
```

## Files to Create/Modify

### New Files
- `src/main/presenter/agentConfigPresenter/index.ts` - 主 Presenter
- `src/main/presenter/sqlitePresenter/tables/agents.ts` - 表操作
- `src/shared/types/presenters/agent.presenter.d.ts` - 类型定义

### Modified Files
- `src/main/presenter/sqlitePresenter/index.ts` - 注册 agents 表
- `src/main/presenter/sqlitePresenter/tables/conversations.ts` - 添加 agent_id 字段
- `src/shared/types/presenters/session.presenter.d.ts` - 添加 agentId 字段
- `src/main/presenter/index.ts` - 注册 AgentConfigPresenter

## Migration Strategy

1. **数据库迁移**
   - 在 SQLitePresenter 初始化时检查 agents 表是否存在
   - 不存在则创建
   - conversations 表添加 agent_id 列（如果不存在）

2. **ACP 同步**
   - 应用启动时调用 `syncAcpAgents()`
   - ACP 配置变更时触发同步

3. **默认 Agent**
   - 首次启动时调用 `ensureDefaultAgent()`

## Testing

- [ ] Unit tests for AgentConfigPresenter CRUD
- [ ] Unit tests for ACP sync logic
- [ ] Integration tests for database migration
- [ ] Test default agent creation
