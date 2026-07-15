import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

import { ConfigService } from '@/config'
import { emitAgentCatalogChanged } from '@/config/eventPublishers'
import type { AcpRegistryAgent } from '@shared/presenter'

function attachCatalogSink(presenter: ConfigService): void {
  Object.assign(presenter, {
    agentCatalogEventSink: {
      publishChanged: (agentIds?: string[]) => emitAgentCatalogChanged(presenter, agentIds)
    }
  })
}

function attachRuntimeEffects(
  presenter: ConfigService,
  refreshAcpProviderAgents: (agentIds?: string[]) => Promise<void>
): void {
  Object.assign(presenter, {
    runtimeEffects: {
      refreshFloatingLanguage: vi.fn(),
      refreshTabLanguage: vi.fn(),
      refreshFloatingTheme: vi.fn(),
      restartApp: vi.fn(),
      applyContentProtection: vi.fn(),
      applyProxyMode: vi.fn(),
      applyCustomProxyUrl: vi.fn(),
      setFloatingButtonEnabled: vi.fn(),
      refreshAcpProviderAgents,
      testHookCommand: vi.fn()
    }
  })
}

describe('ConfigService font size settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes typed settings.changed without the retired raw font-size renderer event', () => {
    const store = {
      set: vi.fn()
    }
    const presenter = Object.assign(Object.create(ConfigService.prototype), {
      agentRepository: null,
      getSettingsStoreForKey: vi.fn(() => store)
    }) as ConfigService & {
      getSettingsStoreForKey: ReturnType<typeof vi.fn>
    }

    presenter.setSetting('fontSizeLevel', 4)

    expect(store.set).toHaveBeenCalledWith('fontSizeLevel', 4)
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('settings.changed', {
      changedKeys: ['fontSizeLevel'],
      version: expect.any(Number),
      values: {
        fontSizeLevel: 4
      }
    })
  })

  it('refreshes desktop language through explicit runtime effects', async () => {
    const refreshFloatingLanguage = vi.fn()
    const refreshTabLanguage = vi.fn().mockResolvedValue(undefined)
    const setSetting = vi.fn()
    const presenter = Object.assign(Object.create(ConfigService.prototype), {
      setSetting,
      getSetting: vi.fn(() => 'zh-CN'),
      getLanguage: vi.fn(() => 'zh-CN'),
      runtimeEffects: {
        refreshFloatingLanguage,
        refreshTabLanguage
      }
    }) as ConfigService

    presenter.setLanguage('zh-CN')
    await Promise.resolve()

    expect(setSetting).toHaveBeenCalledWith('language', 'zh-CN')
    expect(refreshFloatingLanguage).toHaveBeenCalledTimes(1)
    expect(refreshTabLanguage).toHaveBeenCalledTimes(1)
  })

  it('applies content protection directly after persisting it', () => {
    const setContentProtectionEnabled = vi.fn()
    const applyContentProtection = vi.fn()
    const presenter = Object.assign(Object.create(ConfigService.prototype), {
      uiSettingsHelper: { setContentProtectionEnabled },
      runtimeEffects: { applyContentProtection }
    }) as ConfigService

    presenter.setContentProtectionEnabled(true)

    expect(setContentProtectionEnabled).toHaveBeenCalledWith(true)
    expect(applyContentProtection).toHaveBeenCalledWith(true)
  })

  it('applies proxy changes directly after persisting them', () => {
    const setSetting = vi.fn()
    const applyProxyMode = vi.fn()
    const applyCustomProxyUrl = vi.fn()
    const presenter = Object.assign(Object.create(ConfigService.prototype), {
      setSetting,
      runtimeEffects: { applyProxyMode, applyCustomProxyUrl }
    }) as ConfigService

    presenter.setProxyMode('custom')
    presenter.setCustomProxyUrl('http://127.0.0.1:8080')

    expect(setSetting).toHaveBeenNthCalledWith(1, 'proxyMode', 'custom')
    expect(setSetting).toHaveBeenNthCalledWith(2, 'customProxyUrl', 'http://127.0.0.1:8080')
    expect(applyProxyMode).toHaveBeenCalledWith('custom')
    expect(applyCustomProxyUrl).toHaveBeenCalledWith('http://127.0.0.1:8080')
  })
})

describe('ConfigService NowledgeMem settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists config without the retired raw config renderer event', async () => {
    const store = {
      set: vi.fn()
    }
    const presenter = Object.assign(Object.create(ConfigService.prototype), {
      getSettingsStoreForKey: vi.fn(() => store)
    }) as ConfigService & {
      getSettingsStoreForKey: ReturnType<typeof vi.fn>
    }
    const config = {
      baseUrl: 'http://127.0.0.1:14242',
      apiKey: 'test-key',
      timeout: 30000
    }

    await presenter.setNowledgeMemConfig(config)

    expect(store.set).toHaveBeenCalledWith('nowledgeMemConfig', config)
  })
})

describe('ConfigService ACP agent notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('publishes DeepChat catalog changes without ACP model refresh', async () => {
    const presenter = Object.assign(Object.create(ConfigService.prototype), {
      agentRepository: {
        createDeepChatAgent: vi.fn(() => ({
          id: 'writer',
          name: 'Writer',
          type: 'deepchat',
          enabled: true
        }))
      },
      isAttachingAgentRepository: false,
      getAcpEnabled: vi.fn(async () => true),
      getAcpAgents: vi.fn(async () => [])
    }) as ConfigService
    attachCatalogSink(presenter)

    await presenter.createDeepChatAgent({ name: 'Writer' })
    await Promise.resolve()
    await Promise.resolve()

    expect(publishDeepchatEventMock).not.toHaveBeenCalledWith(
      'models.changed',
      expect.objectContaining({ providerId: 'acp' })
    )
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.updated', {
      sessionIds: [],
      reason: 'list-refreshed'
    })
  })

  it('publishes typed session refresh instead of the retired raw session list event', async () => {
    const presenter = Object.assign(Object.create(ConfigService.prototype), {
      agentRepository: {},
      isAttachingAgentRepository: false,
      getAcpEnabled: vi.fn(async () => true),
      getAcpAgents: vi.fn(async () => [])
    }) as ConfigService
    attachCatalogSink(presenter)

    ;(presenter as any).notifyAcpAgentsChanged(['agent-1'])
    await Promise.resolve()
    await Promise.resolve()

    expect(publishDeepchatEventMock).toHaveBeenCalledWith('models.changed', {
      reason: 'agents',
      providerId: 'acp',
      version: expect.any(Number)
    })
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.updated', {
      sessionIds: [],
      reason: 'list-refreshed'
    })
  })

  it('preserves ACP model, catalog, and process refresh order', async () => {
    const sequence: string[] = []
    const refreshAgents = vi.fn(async () => {
      sequence.push('process-refresh')
    })
    publishDeepchatEventMock.mockImplementation((event, payload) => {
      if (event === 'models.changed' && payload.reason === 'runtime-refresh') {
        sequence.push('model-runtime')
      }
      if (event === 'models.changed' && payload.reason === 'agents') {
        sequence.push('model-agents')
      }
      if (event === 'sessions.updated') {
        sequence.push('sessions')
      }
    })

    const presenter = Object.assign(Object.create(ConfigService.prototype), {
      agentRepository: {},
      isAttachingAgentRepository: false,
      clearProviderModelStatusCache: vi.fn(() => sequence.push('cache-clear')),
      getAcpEnabled: vi.fn(async () => true),
      getAcpAgents: vi.fn(async () => [])
    }) as ConfigService
    attachCatalogSink(presenter)
    attachRuntimeEffects(presenter, refreshAgents)

    ;(presenter as any).handleAcpAgentsMutated(['agent-1'])
    await vi.waitFor(() => expect(refreshAgents).toHaveBeenCalledWith(['agent-1']))

    expect(sequence).toEqual([
      'cache-clear',
      'model-runtime',
      'model-agents',
      'sessions',
      'process-refresh'
    ])
  })

  it('closes enabled direct ACP agents before disabling the compatibility provider', async () => {
    const sequence: string[] = []
    const refreshAgents = vi.fn(async () => {
      sequence.push('runtime-refresh')
    })
    const presenter = Object.assign(Object.create(ConfigService.prototype), {
      acpCatalogConfigAdapter: {
        setGlobalEnabled: vi.fn(() => {
          sequence.push('catalog-disable')
          return true
        })
      },
      getAcpAgents: vi.fn(async () => {
        sequence.push('list-enabled-agents')
        return [{ id: 'agent-1' }, { id: 'agent-2' }]
      }),
      syncAcpProviderEnabled: vi.fn(() => sequence.push('provider-disable')),
      providerModelHelper: { setProviderModels: vi.fn() },
      clearProviderModelStatusCache: vi.fn(),
      notifyAcpAgentsChanged: vi.fn()
    }) as ConfigService
    attachRuntimeEffects(presenter, refreshAgents)

    await presenter.setAcpEnabled(false)

    expect(refreshAgents).toHaveBeenCalledWith(['agent-1', 'agent-2'])
    expect(sequence).toEqual([
      'list-enabled-agents',
      'catalog-disable',
      'runtime-refresh',
      'provider-disable'
    ])
  })

  it('refreshes direct ACP agents whose registry descriptors changed', async () => {
    const previousAgents: AcpRegistryAgent[] = [
      {
        id: 'agent-1',
        name: 'Agent 1',
        version: '1.0.0',
        description: 'Before',
        distribution: { npx: { package: '@example/agent-1' } },
        source: 'registry',
        enabled: true
      },
      {
        id: 'agent-2',
        name: 'Agent 2',
        version: '1.0.0',
        distribution: { npx: { package: '@example/agent-2' } },
        source: 'registry',
        enabled: true
      }
    ]
    const refreshedAgents = [{ ...previousAgents[0], description: 'After' }, previousAgents[1]]
    const refreshAgents = vi.fn(async () => undefined)
    const presenter = Object.assign(Object.create(ConfigService.prototype), {
      acpRegistryService: {
        listAgents: vi.fn(() => previousAgents),
        refresh: vi.fn(async () => refreshedAgents)
      },
      syncRegistryAgentsToRepository: vi.fn(),
      listAcpRegistryAgents: vi.fn(async () => refreshedAgents),
      notifyAcpAgentsChanged: vi.fn()
    }) as ConfigService
    attachRuntimeEffects(presenter, refreshAgents)

    await presenter.refreshAcpRegistry(true)

    expect(refreshAgents).toHaveBeenCalledWith(['agent-1'])
  })

  it('defers ACP startup notification until the agent repository is attached', async () => {
    const presenter = Object.assign(Object.create(ConfigService.prototype), {
      agentRepository: null,
      pendingAgentCatalogChanged: false,
      pendingAcpAgentModelsChanged: false,
      isAttachingAgentRepository: false,
      initializeUnifiedAgents: vi.fn(),
      reconcileLegacyBuiltinAgentSelections: vi.fn(),
      cleanupDeprecatedBuiltinAgentSelections: vi.fn(),
      getAcpEnabled: vi.fn(async () => true),
      getAcpAgents: vi.fn(async () => [])
    }) as ConfigService
    attachCatalogSink(presenter)

    ;(presenter as any).notifyAcpAgentsChanged()

    expect(publishDeepchatEventMock).not.toHaveBeenCalled()

    presenter.setAgentRepository({} as never)
    await Promise.resolve()
    await Promise.resolve()

    expect(publishDeepchatEventMock).toHaveBeenCalledWith('models.changed', {
      reason: 'runtime-refresh',
      providerId: 'acp',
      version: expect.any(Number)
    })
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('sessions.updated', {
      sessionIds: [],
      reason: 'list-refreshed'
    })
  })
})
