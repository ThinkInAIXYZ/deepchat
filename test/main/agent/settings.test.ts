import { describe, expect, it, vi } from 'vitest'
import { AgentSettings } from '@/agent/settings'
import { AgentLifecycleGate } from '@/agent/lifecycleGate'
import { BUILTIN_DEEPCHAT_AGENT_ID } from '@/agent/repository'
import { CRON_JOB_AGENT_TOOL_NAME } from '@shared/agentTools'
import type { CreateDeepChatAgentInput } from '@shared/types/agent-interface'

const createModelSelection = (providerId: string, modelId: string) => ({ providerId, modelId })

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

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
  it('repairs legacy selections before materializing version 3 configs', () => {
    const sequence: string[] = []
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      initializeUnifiedAgents: vi.fn(() => sequence.push('initialize-v1-v2')),
      reconcileLegacyBuiltinAgentSelections: vi.fn(() => sequence.push('reconcile-legacy')),
      cleanupDeprecatedBuiltinAgentSelections: vi.fn(() => sequence.push('cleanup-deprecated')),
      materializeIndependentDeepChatAgentConfigs: vi.fn(() => sequence.push('materialize-v3')),
      settings: { get: vi.fn(() => 2) },
      provider: { setAcpProviderEnabled: vi.fn() },
      acpCatalog: { getGlobalEnabled: vi.fn(() => false) },
      registry: {
        listAgents: vi.fn(() => []),
        initialize: vi.fn(() => new Promise(() => undefined))
      }
    }) as AgentSettings

    settings.start()

    expect(sequence).toEqual([
      'initialize-v1-v2',
      'reconcile-legacy',
      'cleanup-deprecated',
      'materialize-v3'
    ])
  })

  it('does not rerun legacy config materialization at version 3', () => {
    const reconcileLegacyBuiltinAgentSelections = vi.fn()
    const materializeIndependentDeepChatAgentConfigs = vi.fn()
    const cleanupDeprecatedBuiltinAgentSelections = vi.fn()
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      initializeUnifiedAgents: vi.fn(),
      reconcileLegacyBuiltinAgentSelections,
      cleanupDeprecatedBuiltinAgentSelections,
      materializeIndependentDeepChatAgentConfigs,
      settings: { get: vi.fn(() => 3) },
      provider: { setAcpProviderEnabled: vi.fn() },
      acpCatalog: { getGlobalEnabled: vi.fn(() => false) },
      registry: {
        listAgents: vi.fn(() => []),
        initialize: vi.fn(() => new Promise(() => undefined))
      }
    }) as AgentSettings

    settings.start()

    expect(cleanupDeprecatedBuiltinAgentSelections).toHaveBeenCalledOnce()
    expect(reconcileLegacyBuiltinAgentSelections).not.toHaveBeenCalled()
    expect(materializeIndependentDeepChatAgentConfigs).not.toHaveBeenCalled()
  })

  it('freezes legacy Skill targets before marking version 3', () => {
    const sequence: string[] = []
    const store = {
      set: vi.fn((key: string | Record<string, unknown>) =>
        sequence.push(typeof key === 'string' ? 'mark-v3' : 'migrate-app-defaults')
      )
    }
    const repository = {
      materializeLegacyInheritedDeepChatConfigs: vi.fn(() => {
        sequence.push('materialize')
        return {
          materializedAgentIds: ['broken', 'writer'],
          recoveredAgentIds: ['broken'],
          legacySkillAllowLists: { broken: ['skill-a'] }
        }
      }),
      resolveDeepChatAgentConfig: vi.fn(() => ({
        defaultModelPreset: createModelSelection('anthropic', 'claude-sonnet'),
        autoCompactionEnabled: false,
        autoCompactionTriggerThreshold: 65,
        autoCompactionRetainRecentPairs: 4
      }))
    }
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      settings: store,
      repository,
      skillMigrationSettings: {
        freezeLegacyMigrationTargets: vi.fn(
          (agentIds: string[], legacySkillAllowLists: Record<string, string[]>) => {
            sequence.push('freeze-skill-targets')
            expect(agentIds).toEqual(['broken', 'writer'])
            expect(legacySkillAllowLists).toEqual({ broken: ['skill-a'] })
          }
        )
      }
    }) as AgentSettings

    ;(settings as any).materializeIndependentDeepChatAgentConfigs()

    expect(sequence).toEqual([
      'materialize',
      'freeze-skill-targets',
      'migrate-app-defaults',
      'mark-v3'
    ])
    expect(store.set).toHaveBeenNthCalledWith(1, {
      defaultModel: createModelSelection('anthropic', 'claude-sonnet'),
      autoCompactionEnabled: false,
      autoCompactionTriggerThreshold: 65,
      autoCompactionRetainRecentPairs: 4
    })
    expect(store.set).toHaveBeenCalledWith('unifiedAgentsMigrationVersion', 3)
  })

  it('leaves the version marker unset when config materialization fails', () => {
    const store = { set: vi.fn() }
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      settings: store,
      skillMigrationSettings: { freezeLegacyMigrationTargets: vi.fn() },
      repository: {
        materializeLegacyInheritedDeepChatConfigs: vi.fn(() => {
          throw new Error('materialization failed')
        })
      }
    }) as AgentSettings

    expect(() => (settings as any).materializeIndependentDeepChatAgentConfigs()).toThrow(
      'materialization failed'
    )
    expect(store.set).not.toHaveBeenCalled()
  })

  it('leaves version 3 unset when app default migration fails', () => {
    const store = {
      set: vi.fn((key: string | Record<string, unknown>) => {
        if (typeof key !== 'string') throw new Error('settings write failed')
      })
    }
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      settings: store,
      skillMigrationSettings: { freezeLegacyMigrationTargets: vi.fn() },
      repository: {
        materializeLegacyInheritedDeepChatConfigs: vi.fn(() => ({
          materializedAgentIds: ['writer'],
          recoveredAgentIds: []
        })),
        resolveDeepChatAgentConfig: vi.fn(() => ({
          autoCompactionEnabled: false,
          autoCompactionTriggerThreshold: 70,
          autoCompactionRetainRecentPairs: 3
        }))
      }
    }) as AgentSettings

    expect(() => (settings as any).materializeIndependentDeepChatAgentConfigs()).toThrow(
      'settings write failed'
    )
    expect(store.set).not.toHaveBeenCalledWith('unifiedAgentsMigrationVersion', 3)
  })

  it('clears a stale app default model when the legacy builtin Agent has none', () => {
    const sequence: string[] = []
    const store = {
      set: vi.fn((key: string | Record<string, unknown>) =>
        sequence.push(typeof key === 'string' ? 'mark-v3' : 'migrate-app-defaults')
      ),
      delete: vi.fn(() => sequence.push('clear-default-model'))
    }
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      settings: store,
      skillMigrationSettings: {
        freezeLegacyMigrationTargets: vi.fn(() => sequence.push('freeze-skill-targets'))
      },
      repository: {
        materializeLegacyInheritedDeepChatConfigs: vi.fn(() => {
          sequence.push('materialize')
          return { materializedAgentIds: [], recoveredAgentIds: [] }
        }),
        resolveDeepChatAgentConfig: vi.fn(() => ({ defaultModelPreset: null }))
      }
    }) as AgentSettings

    ;(settings as any).materializeIndependentDeepChatAgentConfigs()

    expect(sequence).toEqual([
      'materialize',
      'freeze-skill-targets',
      'migrate-app-defaults',
      'clear-default-model',
      'mark-v3'
    ])
    expect(store.delete).toHaveBeenCalledWith('defaultModel')
  })

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

describe('AgentSettings app defaults', () => {
  it('reads and writes the app default model without mutating an Agent', () => {
    const values = new Map<string, unknown>([
      ['defaultModel', { providerId: ' openai ', modelId: ' gpt-4o ' }]
    ])
    const store = {
      get: vi.fn((key: string) => values.get(key)),
      set: vi.fn((key: string, value: unknown) => values.set(key, value)),
      delete: vi.fn((key: string) => values.delete(key))
    }
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      settings: store
    }) as AgentSettings

    expect(settings.getDefaultModel()).toEqual({ providerId: 'openai', modelId: 'gpt-4o' })

    settings.setDefaultModel({ providerId: 'anthropic', modelId: 'claude-sonnet' })
    expect(store.set).toHaveBeenCalledWith('defaultModel', {
      providerId: 'anthropic',
      modelId: 'claude-sonnet'
    })

    settings.setDefaultModel(undefined)
    expect(store.delete).toHaveBeenCalledWith('defaultModel')
  })
})

describe('AgentSettings DeepChat mutations', () => {
  it('snapshots app auto-compaction defaults when creating an Agent', async () => {
    const createDeepChatAgent = vi.fn((input: CreateDeepChatAgentInput) => ({
      id: 'writer',
      type: 'deepchat',
      name: input.name,
      enabled: true,
      source: 'manual'
    }))
    const notifyAgentCatalogChanged = vi.fn()
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      settings: {
        get: vi.fn((key: string) => {
          const values: Record<string, unknown> = {
            autoCompactionEnabled: false,
            autoCompactionTriggerThreshold: 63,
            autoCompactionRetainRecentPairs: 3.6
          }
          return values[key]
        })
      },
      repository: { createDeepChatAgent },
      notifyAgentCatalogChanged
    }) as AgentSettings

    await settings.createDeepChatAgent({ name: 'Defaulted' })
    await settings.createDeepChatAgent({
      name: 'Explicit',
      config: {
        systemPrompt: 'Concise.',
        autoCompactionEnabled: true,
        autoCompactionTriggerThreshold: 73,
        autoCompactionRetainRecentPairs: 7.4
      }
    })

    expect(createDeepChatAgent).toHaveBeenNthCalledWith(1, {
      name: 'Defaulted',
      config: {
        autoCompactionEnabled: false,
        autoCompactionTriggerThreshold: 65,
        autoCompactionRetainRecentPairs: 4
      }
    })
    expect(createDeepChatAgent).toHaveBeenNthCalledWith(2, {
      name: 'Explicit',
      config: {
        systemPrompt: 'Concise.',
        autoCompactionEnabled: true,
        autoCompactionTriggerThreshold: 75,
        autoCompactionRetainRecentPairs: 7
      }
    })
    expect(notifyAgentCatalogChanged).toHaveBeenCalledTimes(2)
  })

  const createCleanupDebtStore = (initial: string[] = []) => {
    const values = new Map<string, unknown>()
    if (initial.length > 0) values.set('pendingAgentSkillCleanupIds', initial)
    return {
      values,
      store: {
        get: vi.fn((key: string) => values.get(key)),
        set: vi.fn((key: string, value: unknown) => values.set(key, value)),
        delete: vi.fn((key: string) => values.delete(key))
      }
    }
  }

  it('records cleanup debt before deleting the Agent row and clears it after Skill cleanup', async () => {
    const calls: string[] = []
    const cleanupDebt = createCleanupDebtStore()
    const repository = {
      canDeleteDeepChatAgent: vi.fn(() => true),
      deleteDeepChatAgent: vi.fn(() => {
        calls.push('delete')
        return true
      })
    }
    const cleanupDeletedAgent = vi.fn(async () => {
      calls.push('memory-cleanup')
      return { cleanupPendingRestart: true }
    })
    const cleanupDeletedAgentSkills = vi.fn(async () => {
      calls.push('skill-cleanup')
    })
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      repository,
      settings: cleanupDebt.store,
      agentLifecycle: new AgentLifecycleGate(),
      cleanupDeletedAgent,
      cleanupDeletedAgentSkills,
      notifyAgentCatalogChanged: vi.fn()
    }) as AgentSettings

    await expect(settings.deleteDeepChatAgentWithCleanup('writer')).resolves.toEqual({
      removed: true,
      cleanupPendingRestart: true
    })
    expect(calls).toEqual(['memory-cleanup', 'delete', 'skill-cleanup'])
    expect(cleanupDebt.values.has('pendingAgentSkillCleanupIds')).toBe(false)
  })

  it('does not run cleanup when deletion is blocked', async () => {
    const cleanupDeletedAgent = vi.fn()
    const cleanupDeletedAgentSkills = vi.fn()
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      repository: {
        canDeleteDeepChatAgent: vi.fn(() => false),
        deleteDeepChatAgent: vi.fn()
      },
      agentLifecycle: new AgentLifecycleGate(),
      cleanupDeletedAgent,
      cleanupDeletedAgentSkills,
      notifyAgentCatalogChanged: vi.fn()
    }) as AgentSettings

    await expect(settings.deleteDeepChatAgentWithCleanup('deepchat')).resolves.toEqual({
      removed: false,
      cleanupPendingRestart: false
    })
    expect(cleanupDeletedAgent).not.toHaveBeenCalled()
    expect(cleanupDeletedAgentSkills).not.toHaveBeenCalled()
  })

  it('keeps Agent Skill files when deletion becomes blocked during async memory cleanup', async () => {
    const cleanupDeletedAgentSkills = vi.fn()
    const cleanupDebt = createCleanupDebtStore()
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      repository: {
        canDeleteDeepChatAgent: vi.fn(() => true),
        deleteDeepChatAgent: vi.fn(() => false)
      },
      settings: cleanupDebt.store,
      agentLifecycle: new AgentLifecycleGate(),
      cleanupDeletedAgent: vi.fn(async () => ({ cleanupPendingRestart: false })),
      cleanupDeletedAgentSkills,
      notifyAgentCatalogChanged: vi.fn()
    }) as AgentSettings

    await expect(settings.deleteDeepChatAgentWithCleanup('writer')).resolves.toEqual({
      removed: false,
      cleanupPendingRestart: false
    })
    expect(cleanupDeletedAgentSkills).not.toHaveBeenCalled()
    expect(cleanupDebt.values.has('pendingAgentSkillCleanupIds')).toBe(false)
  })

  it('keeps cleanup debt when private Skill cleanup fails after Agent deletion', async () => {
    const skillCleanupError = new Error('EBUSY: Skill root is in use')
    const cleanupDebt = createCleanupDebtStore()
    const repository = {
      canDeleteDeepChatAgent: vi.fn(() => true),
      deleteDeepChatAgent: vi.fn(() => true)
    }
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      repository,
      settings: cleanupDebt.store,
      agentLifecycle: new AgentLifecycleGate(),
      cleanupDeletedAgent: vi.fn(async () => ({ cleanupPendingRestart: false })),
      cleanupDeletedAgentSkills: vi.fn(async () => {
        throw skillCleanupError
      }),
      notifyAgentCatalogChanged: vi.fn()
    }) as AgentSettings

    await expect(settings.deleteDeepChatAgentWithCleanup('writer')).resolves.toEqual({
      removed: true,
      cleanupPendingRestart: true
    })
    expect(repository.deleteDeepChatAgent).toHaveBeenCalledWith('writer')
    expect(cleanupDebt.values.get('pendingAgentSkillCleanupIds')).toEqual(['writer'])
  })

  it('shares concurrent deletion work without clearing failed Skill cleanup debt', async () => {
    const skillCleanupStarted = createDeferred<void>()
    const skillCleanupRelease = createDeferred<void>()
    const cleanupDebt = createCleanupDebtStore()
    const repository = {
      canDeleteDeepChatAgent: vi.fn(() => true),
      deleteDeepChatAgent: vi.fn(() => true)
    }
    const cleanupDeletedAgent = vi.fn(async () => ({ cleanupPendingRestart: false }))
    const cleanupDeletedAgentSkills = vi.fn(async () => {
      skillCleanupStarted.resolve(undefined)
      await skillCleanupRelease.promise
    })
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      repository,
      settings: cleanupDebt.store,
      agentLifecycle: new AgentLifecycleGate(),
      cleanupDeletedAgent,
      cleanupDeletedAgentSkills,
      notifyAgentCatalogChanged: vi.fn()
    }) as AgentSettings

    const firstDeletion = settings.deleteDeepChatAgentWithCleanup('writer')
    await skillCleanupStarted.promise
    const secondDeletion = settings.deleteDeepChatAgentWithCleanup('writer')

    expect(cleanupDebt.values.get('pendingAgentSkillCleanupIds')).toEqual(['writer'])
    expect(repository.deleteDeepChatAgent).toHaveBeenCalledOnce()
    expect(cleanupDeletedAgent).toHaveBeenCalledOnce()
    expect(cleanupDeletedAgentSkills).toHaveBeenCalledOnce()

    skillCleanupRelease.reject(new Error('EBUSY: Skill root is in use'))
    await expect(Promise.all([firstDeletion, secondDeletion])).resolves.toEqual([
      { removed: true, cleanupPendingRestart: true },
      { removed: true, cleanupPendingRestart: true }
    ])
    expect(cleanupDebt.values.get('pendingAgentSkillCleanupIds')).toEqual(['writer'])
  })

  it('waits for admitted Session assignment work before checking deletion eligibility', async () => {
    const operationStarted = createDeferred<void>()
    const operationRelease = createDeferred<void>()
    const agentLifecycle = new AgentLifecycleGate()
    const repository = {
      canDeleteDeepChatAgent: vi.fn(() => false),
      deleteDeepChatAgent: vi.fn()
    }
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      repository,
      settings: createCleanupDebtStore().store,
      agentLifecycle,
      cleanupDeletedAgent: vi.fn(),
      cleanupDeletedAgentSkills: vi.fn(),
      notifyAgentCatalogChanged: vi.fn()
    }) as AgentSettings
    const assignment = agentLifecycle.runWithAgentOperation('writer', async () => {
      operationStarted.resolve(undefined)
      await operationRelease.promise
    })
    await operationStarted.promise

    const deletion = settings.deleteDeepChatAgentWithCleanup('writer')
    await Promise.resolve()
    expect(repository.canDeleteDeepChatAgent).not.toHaveBeenCalled()

    operationRelease.resolve(undefined)
    await assignment
    await expect(deletion).resolves.toEqual({ removed: false, cleanupPendingRestart: false })
    expect(repository.canDeleteDeepChatAgent).toHaveBeenCalledOnce()
  })

  it('retries persisted Skill cleanup only after the Agent row is gone', async () => {
    const cleanupDebt = createCleanupDebtStore(['active-agent', 'deleted-agent'])
    const cleanupDeletedAgentSkills = vi.fn(async () => undefined)
    const settings = Object.assign(Object.create(AgentSettings.prototype), {
      settings: cleanupDebt.store,
      repository: {
        getAgent: vi.fn((agentId: string) => (agentId === 'active-agent' ? { id: agentId } : null))
      },
      cleanupDeletedAgentSkills
    }) as AgentSettings

    await settings.retryPendingDeletedAgentSkillCleanup()

    expect(cleanupDeletedAgentSkills).toHaveBeenCalledOnce()
    expect(cleanupDeletedAgentSkills).toHaveBeenCalledWith('deleted-agent')
    expect(cleanupDebt.values.has('pendingAgentSkillCleanupIds')).toBe(false)
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
