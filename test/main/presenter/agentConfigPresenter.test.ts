import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { AcpBuiltinAgent, AcpCustomAgent } from '@shared/presenter'
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

vi.mock('electron-store', () => {
  const store: Record<string, unknown> = {}
  return {
    default: vi.fn().mockImplementation(() => ({
      get: vi.fn((key: string) => store[key]),
      set: vi.fn((key: string, value: unknown) => {
        store[key] = value
      })
    }))
  }
})

const mockBuiltinAgents: AcpBuiltinAgent[] = [
  {
    id: 'claude-code-acp',
    name: 'Claude Code ACP',
    enabled: true,
    profiles: [{ id: 'default', name: 'Default', command: 'claude', args: [], env: {} }],
    activeProfileId: 'default',
    mcpSelections: ['mcp-1']
  }
]

const mockCustomAgents: AcpCustomAgent[] = [
  {
    id: 'custom-1',
    name: 'Custom Agent',
    command: 'node',
    args: ['server.js'],
    env: { NODE_ENV: 'test' },
    enabled: true,
    mcpSelections: []
  }
]

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

  it('creates and retrieves an acp agent with profiles', async () => {
    const id = await table.create({
      type: 'acp',
      name: 'ACP Agent',
      command: 'node',
      args: ['server.js'],
      enabled: true,
      isBuiltin: true,
      profiles: [{ id: 'p1', name: 'Profile 1', command: 'cmd1' }],
      mcpSelections: ['mcp-1']
    })

    const agent = await table.get(id)
    expect(agent).toBeDefined()
    expect(agent?.name).toBe('ACP Agent')
    expect(agent?.type).toBe('acp')
    if (agent?.type === 'acp') {
      expect(agent.command).toBe('node')
      expect(agent.enabled).toBe(true)
      expect(agent.isBuiltin).toBe(true)
      expect(agent.profiles).toHaveLength(1)
      expect(agent.mcpSelections).toEqual(['mcp-1'])
    }
  })

  it('lists agents by type', async () => {
    await table.create({
      type: 'template',
      name: 'Template 1',
      providerId: 'p1',
      modelId: 'm1'
    })
    await table.create({
      type: 'template',
      name: 'Template 2',
      providerId: 'p2',
      modelId: 'm2'
    })
    await table.create({ type: 'acp', name: 'ACP 1', command: 'cmd', enabled: true })

    const templates = await table.listByType('template')
    const acps = await table.listByType('acp')

    expect(templates.length).toBe(2)
    expect(acps.length).toBe(1)
  })

  it('lists only enabled acp agents', async () => {
    await table.create({ type: 'acp', name: 'Enabled', command: 'cmd1', enabled: true })
    await table.create({ type: 'acp', name: 'Disabled', command: 'cmd2', enabled: false })

    const enabled = await table.listEnabledAcpAgents()

    expect(enabled.length).toBe(1)
    expect(enabled[0].name).toBe('Enabled')
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

  it('updates acp agent profiles', async () => {
    const id = await table.create({
      type: 'acp',
      name: 'ACP',
      command: 'cmd',
      enabled: true,
      profiles: [{ id: 'p1', name: 'P1', command: 'c1' }]
    })

    await table.update(
      id,
      {
        profiles: [
          { id: 'p1', name: 'P1 Updated', command: 'c1' },
          { id: 'p2', name: 'P2', command: 'c2' }
        ]
      },
      'acp'
    )

    const agent = await table.get(id)
    if (agent?.type === 'acp') {
      expect(agent.profiles).toHaveLength(2)
      expect(agent.profiles?.[0].name).toBe('P1 Updated')
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

  it('detects if acp agents exist', async () => {
    expect(await table.hasAcpAgents()).toBe(false)

    await table.create({ type: 'acp', name: 'ACP', command: 'cmd', enabled: true })

    expect(await table.hasAcpAgents()).toBe(true)
  })
})

describe('AgentConfigPresenter', () => {
  let db: Database.Database
  let presenter: AgentConfigPresenter

  beforeEach(() => {
    db = createInMemoryDb()
    presenter = new AgentConfigPresenter(db)
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

  it('migrates ACP agents from store', async () => {
    await presenter.migrateAcpAgentsFromStore()

    const acpAgents = await presenter.getAgentsByType('acp')
    expect(acpAgents.length).toBe(2)

    const builtin = acpAgents.find((a) => a.id === 'claude-code-acp')
    expect(builtin?.name).toBe('Claude Code ACP')
    if (builtin?.type === 'acp') {
      expect(builtin.isBuiltin).toBe(true)
      expect(builtin.profiles).toHaveLength(1)
      expect(builtin.mcpSelections).toEqual(['mcp-1'])
    }

    const custom = acpAgents.find((a) => a.id === 'custom-1')
    expect(custom?.name).toBe('Custom Agent')
    if (custom?.type === 'acp') {
      expect(custom.isBuiltin).toBeFalsy()
    }
  })

  it('does not migrate if acp agents already exist', async () => {
    await presenter.createAgent({
      type: 'acp',
      name: 'Existing',
      command: 'cmd',
      enabled: true
    })

    await presenter.migrateAcpAgentsFromStore()

    const acpAgents = await presenter.getAgentsByType('acp')
    expect(acpAgents.length).toBe(1)
    expect(acpAgents[0].name).toBe('Existing')
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

  it('manages ACP agent profiles', async () => {
    await presenter.createAgent({
      type: 'acp',
      id: 'test-acp',
      name: 'Test ACP',
      command: 'cmd1',
      enabled: true,
      profiles: [{ id: 'p1', name: 'Profile 1', command: 'cmd1' }]
    })

    const profile = await presenter.addAcpAgentProfile('test-acp', {
      name: 'Profile 2',
      command: 'cmd2',
      args: ['--test']
    })

    expect(profile.name).toBe('Profile 2')
    expect(profile.id).toBeDefined()

    const agent = await presenter.getAgent('test-acp')
    if (agent?.type === 'acp') {
      expect(agent.profiles).toHaveLength(2)
    }
  })

  it('sets active profile and updates command', async () => {
    await presenter.createAgent({
      type: 'acp',
      id: 'test-acp',
      name: 'Test ACP',
      command: 'cmd1',
      enabled: true,
      profiles: [
        { id: 'p1', name: 'Profile 1', command: 'cmd1' },
        { id: 'p2', name: 'Profile 2', command: 'cmd2', args: ['--flag'] }
      ],
      activeProfileId: 'p1'
    })

    await presenter.setAcpAgentActiveProfile('test-acp', 'p2')

    const agent = await presenter.getAgent('test-acp')
    if (agent?.type === 'acp') {
      expect(agent.activeProfileId).toBe('p2')
      expect(agent.command).toBe('cmd2')
      expect(agent.args).toEqual(['--flag'])
    }
  })

  it('manages MCP selections for ACP agents', async () => {
    await presenter.createAgent({
      type: 'acp',
      id: 'test-acp',
      name: 'Test ACP',
      command: 'cmd',
      enabled: true
    })

    await presenter.setAcpAgentMcpSelections('test-acp', ['mcp-1', 'mcp-2'])

    const selections = await presenter.getAcpAgentMcpSelections('test-acp')
    expect(selections).toEqual(['mcp-1', 'mcp-2'])
  })
})
