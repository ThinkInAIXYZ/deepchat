# Phase 1 Tasks: Agent Data Model & Storage

## Status Legend
- [ ] Not Started
- [~] In Progress
- [x] Completed

## Pre-requisites: 复用现有能力

在开始实现前，确保理解以下现有代码：

- [x] 阅读 `src/main/presenter/sqlitePresenter/index.ts` - 理解表注册模式
- [x] 阅读 `src/main/presenter/sqlitePresenter/tables/conversations.ts` - 理解表结构模式
- [x] 阅读 `src/main/presenter/configPresenter/acpConfHelper.ts` - 理解 ACP 配置读取
- [x] 阅读 `src/main/presenter/sessionPresenter/index.ts` - 理解 Presenter 设计模式
- [x] 阅读 `src/preload/index.ts` - 理解 Presenter 暴露模式

---

## 1. Type Definitions

- [x] Create `src/shared/types/presenters/agentConfig.presenter.d.ts`
  - [x] Define `AgentType` type
  - [x] Define `AgentBase` interface
  - [x] Define `TemplateAgent` interface
  - [x] Define `AcpAgent` interface
  - [x] Define `Agent` union type
  - [x] Define `CreateAgentParams` type
  - [x] Define `UpdateAgentParams` type

## 2. Database Schema

- [x] Create `src/main/presenter/sqlitePresenter/tables/agents.ts`
  - [x] Define table schema
  - [x] Implement `createTable()` method
  - [x] Implement CRUD operations
  - [x] Add JSON serialization for `args` and `env` fields
  - [x] Add `is_builtin` column with code-based migration
  - [x] Add `getByBuiltinId()` method

- [x] Update `src/main/presenter/sqlitePresenter/tables/conversations.ts`
  - [x] Add `agent_id` column to conversations table
  - [x] Create migration logic for existing data

- [x] Update `src/main/presenter/sqlitePresenter/index.ts`
  - [x] Register agents table

## 3. AgentConfigPresenter

- [x] Create `src/main/presenter/agentConfigPresenter/index.ts`
  - [x] Implement `IAgentConfigPresenter` interface
  - [x] Implement `getAgents()` - get all agents
  - [x] Implement `getAgent(id)` - get single agent
  - [x] Implement `createAgent(params)` - create template agent
  - [x] Implement `updateAgent(id, updates)` - update agent
  - [x] Implement `deleteAgent(id)` - delete agent
  - [x] Implement `getAgentsByType(type)` - filter by type
  - [x] Implement `getAcpGlobalEnabled()` / `setAcpGlobalEnabled()`
  - [x] Implement `getAcpUseBuiltinRuntime()` / `setAcpUseBuiltinRuntime()`

## 4. ACP Agents Sync

- [x] Implement `migrateAcpAgentsFromStore()` method
  - [x] Get ACP configs from configPresenter
  - [x] Migrate builtin ACP agents to DB
  - [x] Migrate custom ACP agents to DB
  - [x] Migrate global settings to `acp_global_settings.json`

- [x] Implement `ensureDefaultBuiltinAgents()` method
  - [x] Create default builtin agents if missing

## 5. Default Agent

- [x] Implement `ensureDefaultAgent()` method
  - [x] Check if default agent exists
  - [x] Create default workdir if not exists
  - [x] Create default "Local Agent" with default config

- [x] Implement `getDefaultAgent()` method

## 6. Session Model Update

- [x] Update `src/shared/types/presenters/session.presenter.d.ts`
  - [x] Add `agentId` to `SessionConfig`

- [x] Update `src/main/presenter/sessionPresenter/index.ts`
  - [x] Support `agentId` in session creation
  - [x] Support filtering sessions by agent

## 7. Registration & Initialization

- [x] Update `src/main/presenter/index.ts`
  - [x] Register `agentConfigPresenter`
  - [x] Add to presenter export
  - [x] Initialize before `llmproviderPresenter` (AcpProvider dependency)

- [x] Update app initialization
  - [x] Call `ensureDefaultAgent()` on first launch
  - [x] Call `migrateAcpAgentsFromStore()` on app start

## 8. Preload Bridge

- [x] Update `src/preload/index.ts`
  - [x] Expose `agentConfigPresenter` methods

## 9. Testing

- [x] Unit tests for AgentConfigPresenter CRUD
- [x] Unit tests for agents table operations
- [x] Test default agent creation
- [x] Test ACP builtin agents initialization

---

## Dependencies
- None (this is the first phase)

## Estimated Effort
- 3-5 days

## Completion Date
- 2025-02-16
