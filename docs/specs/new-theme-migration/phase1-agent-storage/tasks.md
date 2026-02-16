# Phase 1 Tasks: Agent Data Model & Storage

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## Pre-requisites: 复用现有能力

在开始实现前，确保理解以下现有代码：

- [ ] 阅读 `src/main/presenter/sqlitePresenter/index.ts` - 理解表注册模式
- [ ] 阅读 `src/main/presenter/sqlitePresenter/tables/conversations.ts` - 理解表结构模式
- [ ] 阅读 `src/main/presenter/configPresenter/acpConfHelper.ts` - 理解 ACP 配置读取
- [ ] 阅读 `src/main/presenter/sessionPresenter/index.ts` - 理解 Presenter 设计模式
- [ ] 阅读 `src/preload/index.ts` - 理解 Presenter 暴露模式

---

## 1. Type Definitions

- [ ] Create `src/shared/types/presenters/agent.presenter.d.ts`
  - [ ] Define `AgentType` type
  - [ ] Define `AgentBase` interface
  - [ ] Define `TemplateAgent` interface
  - [ ] Define `AcpAgent` interface
  - [ ] Define `Agent` union type
  - [ ] Define `CreateAgentParams` type
  - [ ] Define `UpdateAgentParams` type

## 2. Database Schema

- [ ] Create `src/main/presenter/sqlitePresenter/tables/agents.ts`
  - [ ] Define table schema
  - [ ] Implement `createTable()` method
  - [ ] Implement CRUD operations
  - [ ] Add JSON serialization for `args` and `env` fields

- [ ] Update `src/main/presenter/sqlitePresenter/tables/conversations.ts`
  - [ ] Add `agent_id` column to conversations table
  - [ ] Create migration logic for existing data

- [ ] Update `src/main/presenter/sqlitePresenter/index.ts`
  - [ ] Register agents table

## 3. AgentConfigPresenter

- [ ] Create `src/main/presenter/agentConfigPresenter/index.ts`
  - [ ] Implement `IAgentConfigPresenter` interface
  - [ ] Implement `getAgents()` - get all agents
  - [ ] Implement `getAgent(id)` - get single agent
  - [ ] Implement `createAgent(params)` - create template agent
  - [ ] Implement `updateAgent(id, updates)` - update agent
  - [ ] Implement `deleteAgent(id)` - delete agent
  - [ ] Implement `getAgentsByType(type)` - filter by type

## 4. ACP Agents Sync

- [ ] Implement `syncAcpAgents()` method
  - [ ] Get ACP configs from configPresenter
  - [ ] Compare with existing ACP agents in DB
  - [ ] Create new ACP agents
  - [ ] Update changed ACP agents
  - [ ] Delete removed ACP agents

## 5. Default Agent

- [ ] Implement `ensureDefaultAgent()` method
  - [ ] Check if default agent exists
  - [ ] Create default workdir if not exists
  - [ ] Create default "Local Agent" with default config

- [ ] Implement `getDefaultAgent()` method

## 6. Session Model Update

- [ ] Update `src/shared/types/presenters/session.presenter.d.ts`
  - [ ] Add `agentId` to `SessionConfig`

- [ ] Update `src/main/presenter/sessionPresenter/index.ts`
  - [ ] Support `agentId` in session creation
  - [ ] Support filtering sessions by agent

## 7. Registration & Initialization

- [ ] Update `src/main/presenter/index.ts`
  - [ ] Register `agentConfigPresenter`
  - [ ] Add to presenter export

- [ ] Update app initialization
  - [ ] Call `ensureDefaultAgent()` on first launch
  - [ ] Call `syncAcpAgents()` on app start

## 8. Preload Bridge

- [ ] Update `src/preload/index.ts`
  - [ ] Expose `agentConfigPresenter` methods

## 9. Testing

- [ ] Unit tests for agents table
- [ ] Unit tests for AgentConfigPresenter CRUD
- [ ] Unit tests for ACP sync logic
- [ ] Integration tests for database migration
- [ ] Test default agent creation

---

## Dependencies
- None (this is the first phase)

## Estimated Effort
- 3-5 days
