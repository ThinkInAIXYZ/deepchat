import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStores = vi.hoisted(() => new Map<string, Record<string, any>>())

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

vi.mock('electron-store', () => ({
  default: class MockElectronStore {
    private readonly data: Record<string, any>

    constructor(options: { name: string; defaults?: Record<string, any> }) {
      if (!mockStores.has(options.name)) {
        mockStores.set(options.name, clone(options.defaults ?? {}))
      }
      this.data = mockStores.get(options.name)!
    }

    get(key: string) {
      return this.data[key]
    }

    set(key: string, value: any) {
      this.data[key] = value
    }

    delete(key: string) {
      delete this.data[key]
    }
  }
}))

vi.mock('../../../../src/main/presenter/configPresenter/mcpConfHelper', () => ({
  McpConfHelper: class MockMcpConfHelper {
    async getMcpServers() {
      return {
        github: { type: 'stdio' },
        memory: { type: 'inmemory' }
      }
    }
  }
}))

describe('AcpConfHelper registry-first migration', () => {
  beforeEach(() => {
    mockStores.clear()
    vi.resetModules()
  })

  it('migrates legacy builtins into registry agent state and active profile env', async () => {
    mockStores.set('acp_agents', {
      enabled: true,
      version: '2',
      builtins: [
        {
          id: 'kimi-cli',
          name: 'Kimi CLI',
          enabled: true,
          activeProfileId: 'work',
          profiles: [
            {
              id: 'default',
              name: 'Default',
              command: 'kimi',
              args: ['acp'],
              env: { KIMI_PROFILE: 'default' }
            },
            {
              id: 'work',
              name: 'Work',
              command: 'kimi',
              args: ['acp'],
              env: { KIMI_PROFILE: 'work' }
            }
          ],
          mcpSelections: ['github']
        }
      ],
      customs: [
        {
          id: 'local-agent',
          name: 'Local Agent',
          command: 'acp-local',
          args: ['serve'],
          env: { LOCAL_ENV: '1' },
          enabled: true,
          mcpSelections: ['github']
        }
      ]
    })

    const { AcpConfHelper } =
      await import('../../../../src/main/presenter/configPresenter/acpConfHelper')
    const helper = new AcpConfHelper()

    expect(helper.getAgentState('kimi')).toEqual(
      expect.objectContaining({
        agentId: 'kimi',
        enabled: true,
        envOverride: { KIMI_PROFILE: 'work' }
      })
    )

    expect(helper.getManualAgents()).toEqual([
      expect.objectContaining({
        id: 'local-agent',
        name: 'Local Agent',
        source: 'manual',
        enabled: true,
        env: { LOCAL_ENV: '1' }
      })
    ])

    expect(helper.getSharedMcpSelections()).toEqual(['github'])
  })

  it('persists registry env overrides and validates shared MCP selections', async () => {
    const { AcpConfHelper } =
      await import('../../../../src/main/presenter/configPresenter/acpConfHelper')
    const helper = new AcpConfHelper()

    helper.setAgentEnvOverride('claude-code-acp', {
      ANTHROPIC_AUTH_TOKEN: 'token',
      EMPTY_LINE: ''
    })
    await helper.setAgentMcpSelections('claude-code-acp', true, ['github', 'memory'])

    expect(helper.getAgentState('claude-acp')).toEqual(
      expect.objectContaining({
        agentId: 'claude-acp',
        envOverride: {
          ANTHROPIC_AUTH_TOKEN: 'token',
          EMPTY_LINE: ''
        }
      })
    )

    await expect(helper.getAgentMcpSelections('claude-acp')).resolves.toEqual(['github'])
    expect(helper.getSharedMcpSelections()).toEqual(['github'])
  })

  it('migrates v3 per-agent MCP selections into one shared selection set', async () => {
    mockStores.set('acp_agents', {
      enabled: true,
      version: '3',
      registryStates: {
        'claude-code-acp': {
          agentId: 'claude-code-acp',
          enabled: true,
          envOverride: { TOKEN: '1' },
          mcpSelections: ['github']
        }
      },
      manualAgents: [
        {
          id: 'local-agent',
          name: 'Local Agent',
          command: 'local-agent',
          enabled: true,
          mcpSelections: ['github', 'legacy-extra']
        }
      ],
      installStates: {
        'claude-code-acp': {
          status: 'installed',
          version: '1.0.0'
        }
      }
    })

    const { AcpConfHelper } =
      await import('../../../../src/main/presenter/configPresenter/acpConfHelper')
    const helper = new AcpConfHelper()

    expect(helper.getSharedMcpSelections()).toEqual(['github', 'legacy-extra'])
    expect(helper.getAgentState('claude-acp')).toEqual(
      expect.objectContaining({
        agentId: 'claude-acp',
        enabled: true,
        envOverride: { TOKEN: '1' }
      })
    )
    expect(helper.getManualAgents()).toEqual([
      expect.objectContaining({
        id: 'local-agent',
        name: 'Local Agent',
        source: 'manual',
        enabled: true
      })
    ])
    expect(helper.getInstallState('claude-acp')).toEqual(
      expect.objectContaining({
        status: 'installed',
        version: '1.0.0'
      })
    )
  })
})
