import { describe, expect, it, vi } from 'vitest'
import { AgentSettings } from '@/agent/settings'
import { BUILTIN_DEEPCHAT_AGENT_ID } from '@/agent/repository'
import { CRON_JOB_AGENT_TOOL_NAME } from '@shared/agentTools'

const createModelSelection = (providerId: string, modelId: string) => ({ providerId, modelId })

describe('AgentSettings ACP registry uninstall', () => {
  it('blocks registry uninstall before removing files when sessions remain', async () => {
    const uninstallRegistryAgent = vi.fn().mockResolvedValue(undefined)
    const clearRegistryAcpAgentInstallation = vi.fn()
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      getRegistryAgentOrThrow: vi.fn(() => ({
        id: 'codex-acp',
        name: 'Codex CLI',
        version: '0.10.0',
        distribution: {}
      })),
      repository: {
        hasAgentSessions: vi.fn(() => true),
        getAgentInstallState: vi.fn(),
        clearRegistryAcpAgentInstallation
      },
      launchSpecs: {
        uninstallRegistryAgent,
        selectRegistryDistribution: vi.fn()
      },
      handleAcpAgentsMutated: vi.fn()
    }) as AgentSettings

    await expect(settings.uninstallAcpRegistryAgent('codex-acp')).rejects.toThrow(
      'related conversations'
    )
    expect(uninstallRegistryAgent).not.toHaveBeenCalled()
    expect(clearRegistryAcpAgentInstallation).not.toHaveBeenCalled()
  })
})

describe('AgentSettings migrations', () => {
  it('clears deprecated model selections from the built-in agent', () => {
    const updateBuiltinDeepChatConfig = vi.fn()
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      getBuiltinDeepChatConfig: vi.fn(() => ({
        defaultModelPreset: createModelSelection('laoshi', 'default'),
        assistantModel: createModelSelection('qwenlm', 'assistant'),
        visionModel: createModelSelection('laoshi', 'vision')
      })),
      updateBuiltinDeepChatConfig
    }) as AgentSettings

    ;(settings as any).cleanupDeprecatedBuiltinAgentSelections()

    expect(updateBuiltinDeepChatConfig).toHaveBeenCalledWith({
      defaultModelPreset: null,
      assistantModel: null,
      visionModel: null
    })
  })

  it('seeds required disabled tools into explicit agent configs once', () => {
    const repository = {
      ensureBuiltinDeepChatAgent: vi.fn(),
      listAgents: vi.fn(() => [
        { id: BUILTIN_DEEPCHAT_AGENT_ID },
        { id: 'deepchat-custom' },
        { id: 'deepchat-inherit' }
      ]),
      getDeepChatAgentConfig: vi.fn((agentId: string) =>
        agentId === BUILTIN_DEEPCHAT_AGENT_ID
          ? { disabledAgentTools: ['tool-a'] }
          : agentId === 'deepchat-custom'
            ? { disabledAgentTools: [] }
            : {}
      ),
      updateDeepChatAgent: vi.fn()
    }
    const store = { get: vi.fn(() => 1), set: vi.fn() }
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      repository,
      settings: store,
      buildLegacyBuiltinDeepChatConfig: vi.fn(() => ({})),
      syncRegistryAgentsToRepository: vi.fn()
    }) as AgentSettings

    ;(settings as any).initializeUnifiedAgents()

    expect(repository.updateDeepChatAgent).toHaveBeenNthCalledWith(1, BUILTIN_DEEPCHAT_AGENT_ID, {
      config: { disabledAgentTools: ['tool-a', CRON_JOB_AGENT_TOOL_NAME] }
    })
    expect(repository.updateDeepChatAgent).toHaveBeenNthCalledWith(2, 'deepchat-custom', {
      config: { disabledAgentTools: [CRON_JOB_AGENT_TOOL_NAME] }
    })
    expect(store.set).toHaveBeenCalledWith('unifiedAgentsMigrationVersion', 2)
  })

  it('moves live legacy model selections into the built-in agent', () => {
    const values = new Map<string, unknown>([
      ['defaultModel', createModelSelection(' openai ', 'gpt-4o')],
      ['assistantModel', createModelSelection('openai', 'gpt-4o-mini')],
      ['defaultVisionModel', createModelSelection('google', 'gemini-2.5-flash')]
    ])
    const updateBuiltinDeepChatConfig = vi.fn()
    const store = {
      get: vi.fn((key: string) => values.get(key)),
      delete: vi.fn()
    }
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      settings: store,
      getBuiltinDeepChatConfig: vi.fn(() => ({
        defaultModelPreset: createModelSelection('laoshi', 'default'),
        assistantModel: createModelSelection('qwenlm', 'assistant'),
        visionModel: createModelSelection('qwenlm', 'vision')
      })),
      updateBuiltinDeepChatConfig
    }) as AgentSettings

    ;(settings as any).reconcileLegacyBuiltinAgentSelections()

    expect(updateBuiltinDeepChatConfig).toHaveBeenCalledWith({
      defaultModelPreset: createModelSelection('openai', 'gpt-4o'),
      assistantModel: createModelSelection('openai', 'gpt-4o-mini'),
      visionModel: createModelSelection('google', 'gemini-2.5-flash')
    })
    expect(store.delete).toHaveBeenCalledWith('defaultVisionModel')
  })
})

describe('AgentSettings DeepChat mutations', () => {
  it('runs cleanup before deleting a removable agent', async () => {
    const calls: string[] = []
    const repository = {
      canDeleteDeepChatAgent: vi.fn(() => true),
      deleteDeepChatAgent: vi.fn(() => {
        calls.push('delete')
        return true
      })
    }
    const cleanupDeletedAgent = vi.fn(async () => {
      calls.push('cleanup')
      return { cleanupPendingRestart: true }
    })
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      repository,
      cleanupDeletedAgent,
      notifyAgentCatalogChanged: vi.fn()
    }) as AgentSettings

    await expect(settings.deleteDeepChatAgentWithCleanup('writer')).resolves.toEqual({
      removed: true,
      cleanupPendingRestart: true
    })
    expect(calls).toEqual(['cleanup', 'delete'])
  })

  it('does not run cleanup when deletion is blocked', async () => {
    const cleanupDeletedAgent = vi.fn()
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      repository: {
        canDeleteDeepChatAgent: vi.fn(() => false),
        deleteDeepChatAgent: vi.fn()
      },
      cleanupDeletedAgent,
      notifyAgentCatalogChanged: vi.fn()
    }) as AgentSettings

    await expect(settings.deleteDeepChatAgentWithCleanup('deepchat')).resolves.toEqual({
      removed: false,
      cleanupPendingRestart: false
    })
    expect(cleanupDeletedAgent).not.toHaveBeenCalled()
  })

  it('notifies memory maintenance only for successful relevant updates', async () => {
    const notifyMemoryConfigChanged = vi.fn()
    const notifyAgentCatalogChanged = vi.fn()
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      repository: { updateDeepChatAgent: vi.fn(() => ({ id: 'writer' })) },
      notifyMemoryConfigChanged,
      notifyAgentCatalogChanged
    }) as AgentSettings

    await settings.updateDeepChatAgent('writer', { config: { memoryEnabled: true } })
    await settings.updateDeepChatAgent('writer', { config: { systemPrompt: 'Concise.' } })

    expect(notifyMemoryConfigChanged).toHaveBeenCalledOnce()
    expect(notifyMemoryConfigChanged).toHaveBeenCalledWith('writer')
    expect(notifyAgentCatalogChanged).toHaveBeenCalledTimes(2)
  })

  it('isolates memory maintenance callback failures from config updates', async () => {
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      repository: { updateDeepChatAgent: vi.fn(() => ({ id: 'writer' })) },
      notifyMemoryConfigChanged: vi.fn(() => {
        throw new Error('arm failed')
      }),
      notifyAgentCatalogChanged: vi.fn()
    }) as AgentSettings

    await expect(
      settings.updateDeepChatAgent('writer', { config: { memoryEnabled: true } })
    ).resolves.toEqual({ id: 'writer' })
  })
})

describe('AgentSettings ACP notifications', () => {
  it('publishes catalog, model, and session changes before refreshing processes', async () => {
    const sequence: string[] = []
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      provider: {
        clearAcpProviderModelStatus: vi.fn(() => sequence.push('cache-clear')),
        refreshAcpProviderAgents: vi.fn(async () => sequence.push('process-refresh'))
      },
      events: {
        publishCatalogChanged: vi.fn(() => sequence.push('catalog')),
        publishAcpModelsChanged: vi.fn(() => sequence.push('models')),
        publishSessionsUpdated: vi.fn(() => sequence.push('sessions'))
      }
    }) as AgentSettings

    ;(settings as any).handleAcpAgentsMutated(['agent-1'])
    await vi.waitFor(() => expect(sequence).toContain('process-refresh'))

    expect(sequence).toEqual(['cache-clear', 'catalog', 'models', 'sessions', 'process-refresh'])
  })

  it('closes enabled ACP agents before disabling the provider', async () => {
    const sequence: string[] = []
    const refreshAcpProviderAgents = vi.fn(async () => sequence.push('runtime-refresh'))
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      acpCatalog: {
        setGlobalEnabled: vi.fn(() => {
          sequence.push('catalog-disable')
          return true
        })
      },
      getAcpAgents: vi.fn(async () => {
        sequence.push('list-enabled-agents')
        return [{ id: 'agent-1' }, { id: 'agent-2' }]
      }),
      provider: {
        refreshAcpProviderAgents,
        setAcpProviderEnabled: vi.fn(() => sequence.push('provider-disable')),
        clearAcpProviderModels: vi.fn(),
        clearAcpProviderModelStatus: vi.fn()
      },
      notifyAcpAgentsChanged: vi.fn()
    }) as AgentSettings

    await settings.setAcpEnabled(false)

    expect(refreshAcpProviderAgents).toHaveBeenCalledWith(['agent-1', 'agent-2'])
    expect(sequence).toEqual([
      'list-enabled-agents',
      'catalog-disable',
      'runtime-refresh',
      'provider-disable'
    ])
  })

  it('refreshes only registry agents whose descriptors changed', async () => {
    const previous = [
      { id: 'agent-1', name: 'Agent 1', version: '1', description: 'Before' },
      { id: 'agent-2', name: 'Agent 2', version: '1' }
    ]
    const refreshed = [{ ...previous[0], description: 'After' }, previous[1]]
    const refreshAcpProviderAgents = vi.fn(async () => undefined)
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      registry: {
        listAgents: vi.fn(() => previous),
        refresh: vi.fn(async () => refreshed)
      },
      provider: { refreshAcpProviderAgents },
      syncRegistryAgentsToRepository: vi.fn(),
      listAcpRegistryAgents: vi.fn(async () => refreshed),
      notifyAcpAgentsChanged: vi.fn()
    }) as AgentSettings

    await settings.refreshAcpRegistry(true)

    expect(refreshAcpProviderAgents).toHaveBeenCalledWith(['agent-1'])
  })
})
