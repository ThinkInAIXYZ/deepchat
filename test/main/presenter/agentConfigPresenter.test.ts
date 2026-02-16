import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { IConfigPresenter, AcpAgentConfig } from '@shared/presenter'
import { AgentsTable } from '../../../src/main/presenter/sqlitePresenter/tables/agents'
import {
  AgentConfigPresenter,
  DEFAULT_AGENT_ID
} from '../../../src/main/presenter/agentConfigPresenter'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData')
  }
}))

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined)
  }
}))

const mockAcpAgents: AcpAgentConfig[] = [
  {
    id: 'acp-1',
    name: 'Test ACP Agent',
    command: 'node',
    args: ['server.js'],
    env: { NODE_ENV: 'test' },
    enable: true
  }
]

function createMockConfigPresenter(): IConfigPresenter {
  return {
    getProviders: vi.fn(() => [{ id: 'openai', enable: true }]),
    getAcpAgents: vi.fn().mockResolvedValue(mockAcpAgents)
  } as unknown as IConfigPresenter
}

function createInMemoryDb(): Database.Database {
  const Database = require('better-sqlite3-multiple-ciphers')
  return new Database(':memory:')
}

describe('AgentsTable', () => {
  let db: Database.Database
  let table: AgentsTable

  beforeEach(() => {
    db = createInMemoryDb()
    table = new AgentsTable(db)
    table.createTable()
  })

  afterEach(() => {
    db.close()
  })

  it('creates and retrieves a template agent', async () => {
    const id = await table.create({
      type: 'template',
      name: 'Test Agent',
      providerId: 'openai',
      modelId: 'gpt-4'
    })

    const agent = await table.get(id)
    expect(agent).toBeDefined()
    expect(agent?.name).toBe('Test Agent')
    expect(agent?.type).toBe('template')
    if (agent?.type === 'template') {
      expect(agent.providerId).toBe('openai')
      expect(agent.modelId).toBe('gpt-4')
    }
  })

  it('creates and retrieves an acp agent', async () => {
    const id = await table.create({
      type: 'acp',
      name: 'ACP Agent',
      command: 'node',
      args: ['server.js'],
      enabled: true
    })

    const agent = await table.get(id)
    expect(agent).toBeDefined()
    expect(agent?.name).toBe('ACP Agent')
    expect(agent?.type).toBe('acp')
    if (agent?.type === 'acp') {
      expect(agent.command).toBe('node')
      expect(agent.enabled).toBe(true)
    }
  })

  it('lists agents by type', async () => {
    await table.create({ type: 'template', name: 'Template 1', providerId: 'p1', modelId: 'm1' })
    await table.create({ type: 'template', name: 'Template 2', providerId: 'p2', modelId: 'm2' })
    await table.create({ type: 'acp', name: 'ACP 1', command: 'cmd', enabled: true })

    const templates = await table.listByType('template')
    const acps = await table.listByType('acp')

    expect(templates.length).toBe(2)
    expect(acps.length).toBe(1)
  })

  it('updates an agent', async () => {
    const id = await table.create({
      type: 'template',
      name: 'Original',
      providerId: 'openai',
      modelId: 'gpt-3.5'
    })

    await table.update(id, { name: 'Updated', modelId: 'gpt-4' }, 'template')

    const agent = await table.get(id)
    expect(agent?.name).toBe('Updated')
    if (agent?.type === 'template') {
      expect(agent.modelId).toBe('gpt-4')
    }
  })

  it('deletes an agent', async () => {
    const id = await table.create({
      type: 'template',
      name: 'To Delete',
      providerId: 'openai',
      modelId: 'gpt-4'
    })

    await table.delete(id)
    const agent = await table.get(id)
    expect(agent).toBeNull()
  })
})

describe('AgentConfigPresenter', () => {
  let db: Database.Database
  let presenter: AgentConfigPresenter
  let mockConfig: IConfigPresenter

  beforeEach(() => {
    db = createInMemoryDb()
    mockConfig = createMockConfigPresenter()
    presenter = new AgentConfigPresenter(db, mockConfig)
  })

  afterEach(() => {
    db.close()
  })

  it('ensures default agent exists', async () => {
    await presenter.ensureDefaultAgent()
    const agent = await presenter.getDefaultAgent()
    expect(agent).toBeDefined()
    expect(agent?.id).toBe(DEFAULT_AGENT_ID)
    expect(agent?.name).toBe('Local Agent')
  })

  it('does not create duplicate default agent', async () => {
    await presenter.ensureDefaultAgent()
    await presenter.ensureDefaultAgent()

    const agents = await presenter.getAgents()
    const defaultAgents = agents.filter((a) => a.id === DEFAULT_AGENT_ID)
    expect(defaultAgents.length).toBe(1)
  })

  it('prevents deleting default agent', async () => {
    await presenter.ensureDefaultAgent()
    await expect(presenter.deleteAgent(DEFAULT_AGENT_ID)).rejects.toThrow(
      'Cannot delete default agent'
    )
  })

  it('syncs ACP agents from config', async () => {
    await presenter.syncAcpAgents()

    const acpAgents = await presenter.getAgentsByType('acp')
    expect(acpAgents.length).toBe(1)
    expect(acpAgents[0].name).toBe('Test ACP Agent')
  })

  it('creates and retrieves agents', async () => {
    const id = await presenter.createAgent({
      type: 'template',
      name: 'Custom Agent',
      providerId: 'anthropic',
      modelId: 'claude-3'
    })

    const agent = await presenter.getAgent(id)
    expect(agent?.name).toBe('Custom Agent')
  })
})
