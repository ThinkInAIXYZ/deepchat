import { describe, expect, it, vi } from 'vitest'
import {
  DeepChatToolResolver,
  MAX_RUN_TOOL_REQUIREMENT_NAME_BYTES,
  MAX_RUN_TOOL_UNIVERSE_DEFINITIONS,
  MAX_RUN_TOOL_UNIVERSE_SKILLS,
  MAX_SKILL_TOOL_REQUIREMENTS
} from '@/agent/deepchat/runtime/toolResolver'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'
import { SKILL_NAME_MAX_LENGTH } from '@shared/types/skill'
import {
  TOOL_EXECUTION,
  type MCPToolDefinition,
  type MCPToolDefinitionBase
} from '@shared/types/core/mcp'

const createResourceInstance = (agentId = 'deepchat') => {
  let cached: { profile: 'general'; fingerprint: string; tools: [] } | undefined
  return {
    getAgentId: vi.fn(() => agentId),
    getRuntimeState: vi.fn(() => ({
      status: 'idle',
      providerId: 'openai',
      modelId: 'gpt-4.1',
      permissionMode: 'full_access'
    })),
    getRuntimeActivatedSkills: vi.fn(() => []),
    getToolProfileCache: vi.fn(() => cached),
    setToolProfileCache: vi.fn((entry) => {
      cached = entry
    })
  }
}

const createScopeRegistry = (instance: unknown, assertCurrent = vi.fn()) =>
  ({
    getToolRegistryRevision: vi.fn(() => 1),
    getOrHydrateScope: vi.fn((sessionId: string) => ({ sessionId, instance })),
    getHydratedScope: vi.fn((sessionId: string) => ({
      sessionId,
      instance,
      state: () => undefined
    })),
    scopeFor: vi.fn(() => ({ assertCurrent }))
  }) as any

const agentTool = (
  name: string,
  overrides: Partial<MCPToolDefinitionBase> = {}
): MCPToolDefinition => ({
  source: 'agent',
  execution: TOOL_EXECUTION.read.parallel,
  type: 'function',
  function: {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} }
  },
  server: { name: 'agent-tools', icons: '', description: 'Agent tools' },
  ...overrides
})

const mcpTool = (visibleName: string, originalName: string): MCPToolDefinition => ({
  source: 'mcp',
  execution: TOOL_EXECUTION.read.parallel,
  type: 'function',
  function: {
    name: visibleName,
    description: `${visibleName} tool`,
    parameters: { type: 'object', properties: {} }
  },
  server: {
    name: 'remote',
    icons: '',
    description: 'Remote',
    id: '22222222-2222-4222-8222-222222222222',
    configGeneration: 1,
    bindingHash: 'a'.repeat(64)
  },
  raw: {
    name: originalName,
    inputSchema: { type: 'object', properties: {} }
  }
})

describe('DeepChatToolResolver Subagent capability', () => {
  it('keeps the executor catalog cached when only orchestration policy changes', async () => {
    let orchestrationPolicy: 'explicit' | 'proactive' = 'explicit'
    const getAllToolDefinitions = vi.fn().mockResolvedValue([])
    const resourceInstance = createResourceInstance()
    const resolver = new DeepChatToolResolver({
      agentSettings: {
        getAgentType: vi.fn(async () => 'deepchat'),
        resolveDeepChatAgentConfig: vi.fn(async () => ({ subagentEnabled: false }))
      },
      skillSettings: { isEnabled: vi.fn(() => false) },
      skillService: { getActiveSkills: vi.fn(), validateSkillNames: vi.fn() },
      sqlitePresenter: {
        newSessionsTable: {
          get: vi.fn(() => ({
            session_kind: 'regular',
            orchestration_policy: orchestrationPolicy
          })),
          getDisabledAgentTools: vi.fn(() => [])
        }
      },
      toolService: { getAllToolDefinitions, syncAgentToolContext: vi.fn() },
      registry: createScopeRegistry(resourceInstance),
      identity: {
        getAgentId: vi.fn(() => 'deepchat'),
        isAcpBackedSubagentSession: vi.fn(() => false)
      }
    } as any)

    await resolver.loadToolDefinitionsForSession(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )
    await resolver.loadToolDefinitionsForSession(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )
    orchestrationPolicy = 'proactive'
    await resolver.loadToolDefinitionsForSession(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(resolver.resolveOrchestrationPolicy('session-1')).toBe('proactive')
    expect(getAllToolDefinitions).toHaveBeenCalledOnce()
    expect(getAllToolDefinitions.mock.calls[0][0]).toMatchObject({ sessionKind: 'regular' })
    expect(getAllToolDefinitions.mock.calls[0][0]).not.toHaveProperty('orchestrationPolicy')
  })

  it('refreshes the catalog from capability cache keys without event invalidation', async () => {
    let config: DeepChatAgentConfig = {
      subagentEnabled: true,
      subagents: [
        {
          id: 'reviewer',
          targetType: 'self',
          displayName: 'Reviewer',
          description: 'Review the result.'
        }
      ]
    }
    const row = {
      session_kind: 'regular' as const,
      subagent_enabled: 0
    }
    const getAllToolDefinitions = vi.fn().mockResolvedValue([])
    const resourceInstance = createResourceInstance()
    const resolver = new DeepChatToolResolver({
      agentSettings: {
        getSkillsEnabled: vi.fn(() => false),
        getAgentType: vi.fn(async () => 'deepchat'),
        resolveDeepChatAgentConfig: vi.fn(async () => config)
      },
      skillSettings: { isEnabled: vi.fn(() => false) },
      skillService: { getActiveSkills: vi.fn(), setActiveSkills: vi.fn() },
      sqlitePresenter: {
        newSessionsTable: {
          get: vi.fn(() => row),
          getDisabledAgentTools: vi.fn(() => [])
        }
      },
      toolService: {
        getAllToolDefinitions,
        syncAgentToolContext: vi.fn()
      },
      registry: createScopeRegistry(resourceInstance),
      identity: {
        getAgentId: vi.fn(() => 'deepchat'),
        isAcpBackedSubagentSession: vi.fn(() => false)
      }
    } as any)

    await resolver.loadToolDefinitionsForSession(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )
    await resolver.loadToolDefinitionsForSession(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )
    expect(getAllToolDefinitions).toHaveBeenCalledTimes(1)
    expect(getAllToolDefinitions.mock.calls[0][0].subagentCapability).toMatchObject({
      available: true,
      slots: [expect.objectContaining({ id: 'reviewer' })]
    })

    row.subagent_enabled = 1
    await resolver.loadToolDefinitionsForSession(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )
    expect(getAllToolDefinitions).toHaveBeenCalledTimes(1)

    config = {
      ...config,
      subagents: [{ ...config.subagents![0], description: 'Review security boundaries.' }]
    }
    await resolver.loadToolDefinitionsForSession(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )
    expect(getAllToolDefinitions).toHaveBeenCalledTimes(2)
    expect(getAllToolDefinitions.mock.calls[1][0].subagentCapability.cacheKey).not.toBe(
      getAllToolDefinitions.mock.calls[0][0].subagentCapability.cacheKey
    )

    config = { ...config, subagentEnabled: false }
    await resolver.loadToolDefinitionsForSession(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )
    expect(getAllToolDefinitions).toHaveBeenCalledTimes(3)
    expect(getAllToolDefinitions.mock.calls[2][0].subagentCapability).toMatchObject({
      available: false,
      reason: 'policy_disabled'
    })
  })

  it('marks child sessions unsupported before building their catalog', async () => {
    const getAllToolDefinitions = vi.fn().mockResolvedValue([])
    const resourceInstance = createResourceInstance()
    const resolver = new DeepChatToolResolver({
      agentSettings: {
        getSkillsEnabled: vi.fn(() => false),
        getAgentType: vi.fn(async () => 'deepchat'),
        resolveDeepChatAgentConfig: vi.fn(async () => ({
          subagentEnabled: true,
          subagents: [
            {
              id: 'reviewer',
              targetType: 'self',
              displayName: 'Reviewer',
              description: ''
            }
          ]
        }))
      },
      skillSettings: { isEnabled: vi.fn(() => false) },
      skillService: { getActiveSkills: vi.fn(), setActiveSkills: vi.fn() },
      sqlitePresenter: {
        newSessionsTable: {
          get: vi.fn((sessionId: string) =>
            sessionId === 'child-1'
              ? {
                  agent_id: 'deepchat',
                  session_kind: 'subagent',
                  parent_session_id: 'parent-1',
                  subagent_enabled: 1
                }
              : { agent_id: 'deepchat', session_kind: 'regular' }
          ),
          getDisabledAgentTools: vi.fn(() => [])
        }
      },
      toolService: { getAllToolDefinitions },
      registry: createScopeRegistry(resourceInstance),
      identity: {
        getAgentId: vi.fn(() => 'deepchat'),
        isAcpBackedSubagentSession: vi.fn(() => false)
      }
    } as any)

    await resolver.loadToolDefinitionsForSession(
      'child-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(getAllToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentCapability: expect.objectContaining({
          available: false,
          reason: 'unsupported_session'
        })
      })
    )
  })

  it('intersects parent and target tool authority for Subagent catalog and dispatch', async () => {
    const getAllToolDefinitions = vi.fn().mockResolvedValue([])
    const resourceInstance = createResourceInstance('reviewer')
    const resolveDeepChatAgentConfig = vi.fn(async (agentId: string) =>
      agentId === 'parent-agent'
        ? {
            disabledAgentTools: ['read'],
            enabledMcpServerIds: ['mcp-a', 'mcp-b']
          }
        : {
            disabledAgentTools: ['edit'],
            enabledMcpServerIds: ['mcp-b', 'mcp-c']
          }
    )
    const resolver = new DeepChatToolResolver({
      agentSettings: {
        getAgentType: vi.fn(async () => 'deepchat'),
        resolveDeepChatAgentConfig
      },
      skillSettings: { isEnabled: vi.fn(() => false) },
      skillService: { getActiveSkills: vi.fn(), validateSkillNames: vi.fn() },
      sqlitePresenter: {
        newSessionsTable: {
          get: vi.fn((sessionId: string) =>
            sessionId === 'child-1'
              ? {
                  agent_id: 'reviewer',
                  session_kind: 'subagent',
                  parent_session_id: 'parent-1'
                }
              : { agent_id: 'parent-agent', session_kind: 'regular' }
          ),
          getDisabledAgentTools: vi.fn((sessionId: string) =>
            sessionId === 'child-1' ? ['write'] : ['exec']
          )
        }
      },
      toolService: {
        getAllToolDefinitions,
        syncAgentToolContext: vi.fn()
      },
      registry: createScopeRegistry(resourceInstance),
      identity: {
        getAgentId: vi.fn((sessionId: string) =>
          sessionId === 'child-1' ? 'reviewer' : 'parent-agent'
        ),
        isAcpBackedSubagentSession: vi.fn(() => false)
      }
    } as any)

    await resolver.loadToolDefinitionsForSession(
      'child-1',
      '/repo',
      undefined,
      resourceInstance as any
    )

    expect(getAllToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKind: 'subagent',
        disabledAgentTools: ['edit', 'exec', 'read', 'write'],
        enabledMcpServerIds: ['mcp-b']
      })
    )
    await expect(
      resolver.resolveAgentExtensionPolicy('child-1', resourceInstance as any)
    ).resolves.toEqual({ enabledMcpServerIds: ['mcp-b'] })
  })

  it('does not expose Subagents to regular non-DeepChat compatibility sessions', async () => {
    const getAllToolDefinitions = vi.fn().mockResolvedValue([])
    const resourceInstance = createResourceInstance('acp-reviewer')
    const resolver = new DeepChatToolResolver({
      agentSettings: {
        getSkillsEnabled: vi.fn(() => false),
        getAgentType: vi.fn(async () => 'acp'),
        resolveDeepChatAgentConfig: vi.fn(async () => ({
          subagentEnabled: true,
          subagents: [
            {
              id: 'reviewer',
              targetType: 'self',
              displayName: 'Reviewer',
              description: ''
            }
          ]
        }))
      },
      skillSettings: { isEnabled: vi.fn(() => false) },
      skillService: { getActiveSkills: vi.fn(), setActiveSkills: vi.fn() },
      sqlitePresenter: {
        newSessionsTable: {
          get: vi.fn(() => ({ session_kind: 'regular', subagent_enabled: 1 })),
          getDisabledAgentTools: vi.fn(() => [])
        }
      },
      toolService: { getAllToolDefinitions },
      registry: createScopeRegistry(resourceInstance),
      identity: {
        getAgentId: vi.fn(() => 'acp-reviewer'),
        isAcpBackedSubagentSession: vi.fn(() => false)
      }
    } as any)

    await resolver.loadToolDefinitionsForSession(
      'acp-session',
      null,
      undefined,
      resourceInstance as any
    )

    expect(getAllToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentCapability: expect.objectContaining({
          available: false,
          reason: 'unsupported_session'
        })
      })
    )
  })

  it('keeps extension policy when Agent type resolution fails closed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const getAllToolDefinitions = vi.fn().mockResolvedValue([])
    const resourceInstance = createResourceInstance('custom-agent')
    const resolver = new DeepChatToolResolver({
      agentSettings: {
        getSkillsEnabled: vi.fn(() => false),
        getAgentType: vi.fn().mockRejectedValue(new Error('catalog unavailable')),
        resolveDeepChatAgentConfig: vi.fn(async () => ({
          enabledMcpServerIds: ['server-a'],
          subagentEnabled: true,
          subagents: [
            {
              id: 'reviewer',
              targetType: 'self',
              displayName: 'Reviewer',
              description: ''
            }
          ]
        }))
      },
      skillSettings: { isEnabled: vi.fn(() => false) },
      skillService: { getActiveSkills: vi.fn(), setActiveSkills: vi.fn() },
      sqlitePresenter: {
        newSessionsTable: {
          get: vi.fn(() => ({ session_kind: 'regular' })),
          getDisabledAgentTools: vi.fn(() => [])
        }
      },
      toolService: { getAllToolDefinitions },
      registry: createScopeRegistry(resourceInstance),
      identity: {
        getAgentId: vi.fn(() => 'custom-agent'),
        isAcpBackedSubagentSession: vi.fn(() => false)
      }
    } as any)

    await resolver.loadToolDefinitionsForSession(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(getAllToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        enabledMcpServerIds: ['server-a'],
        subagentCapability: expect.objectContaining({
          available: false,
          reason: 'unsupported_session'
        })
      })
    )
    expect(warnSpy).toHaveBeenCalledWith(
      '[DeepChatAgent] Failed to resolve Agent type for tool policy custom-agent:',
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })

  it('fails closed without misreporting config resolution failures as an explicit disable', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const getAllToolDefinitions = vi.fn().mockResolvedValue([])
    const resourceInstance = createResourceInstance()
    const resolver = new DeepChatToolResolver({
      agentSettings: {
        getSkillsEnabled: vi.fn(() => false),
        getAgentType: vi.fn(async () => 'deepchat'),
        resolveDeepChatAgentConfig: vi.fn().mockRejectedValue(new Error('config unavailable'))
      },
      skillSettings: { isEnabled: vi.fn(() => false) },
      skillService: { getActiveSkills: vi.fn(), setActiveSkills: vi.fn() },
      sqlitePresenter: {
        newSessionsTable: {
          get: vi.fn(() => ({ session_kind: 'regular', subagent_enabled: 1 })),
          getDisabledAgentTools: vi.fn(() => [])
        }
      },
      toolService: { getAllToolDefinitions },
      registry: createScopeRegistry(resourceInstance),
      identity: {
        getAgentId: vi.fn(() => 'deepchat'),
        isAcpBackedSubagentSession: vi.fn(() => false)
      }
    } as any)

    await resolver.loadToolDefinitionsForSession(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(getAllToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentCapability: expect.objectContaining({
          available: false,
          reason: 'no_valid_slots'
        })
      })
    )
    expect(warnSpy).toHaveBeenCalledWith(
      '[DeepChatAgent] Failed to resolve tool policy for agent deepchat:',
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })
})

describe('DeepChatToolResolver Agent Skill scope', () => {
  const createResolver = () => {
    const getAllToolDefinitions = vi.fn().mockResolvedValue([])
    const resourceInstance = createResourceInstance('writer')
    const resolveDeepChatAgentConfig = vi.fn(async () => ({
      enabledSkillNames: ['legacy-only'],
      enabledMcpServerIds: ['mcp-a']
    }))
    const skillService = {
      getActiveSkills: vi.fn().mockResolvedValue(['owned-a', 'owned-b']),
      validateSkillNames: vi.fn(async (_agentId: string, names: string[]) =>
        names.filter((name) => name === 'owned-a' || name === 'owned-b')
      ),
      revalidateActiveSkillsForAgent: vi.fn().mockResolvedValue(['owned-b'])
    }
    const resolver = new DeepChatToolResolver({
      agentSettings: {
        getAgentType: vi.fn(async () => 'deepchat'),
        resolveDeepChatAgentConfig
      },
      skillSettings: { isEnabled: vi.fn(() => true) },
      skillService,
      sqlitePresenter: {
        newSessionsTable: {
          get: vi.fn(() => ({ session_kind: 'regular' })),
          getDisabledAgentTools: vi.fn(() => [])
        }
      },
      toolService: { getAllToolDefinitions },
      registry: createScopeRegistry(resourceInstance),
      identity: {
        getAgentId: vi.fn(() => 'writer'),
        isAcpBackedSubagentSession: vi.fn(() => false)
      }
    } as any)

    return {
      resolver,
      resourceInstance,
      skillService,
      getAllToolDefinitions,
      resolveDeepChatAgentConfig
    }
  }

  it('keeps the resolved Run Skill snapshot when assignments change during the Run', async () => {
    const { resolver, resourceInstance, skillService, getAllToolDefinitions } = createResolver()

    await resolver.loadToolDefinitionsForSession(
      'session-1',
      null,
      ['foreign', 'owned-b'],
      resourceInstance as any
    )

    expect(skillService.validateSkillNames).not.toHaveBeenCalled()
    expect(getAllToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'writer',
        activeSkillNames: ['foreign', 'owned-b'],
        enabledMcpServerIds: ['mcp-a']
      })
    )
  })

  it('propagates catalog failures only for fail-closed runtime refreshes', async () => {
    const { resolver, resourceInstance, getAllToolDefinitions } = createResolver()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    getAllToolDefinitions.mockRejectedValue(new Error('catalog unavailable'))
    const catalog = resolver.createSessionToolCatalogPort(
      'session-1',
      null,
      resourceInstance as any
    )

    await expect(catalog.resolve({ activeSkillNames: ['owned-a'] })).resolves.toEqual([])
    await expect(
      catalog.resolve({ activeSkillNames: ['owned-a'], failClosed: true })
    ).rejects.toThrow('catalog unavailable')
    expect(errorSpy).toHaveBeenCalledOnce()
    errorSpy.mockRestore()
  })

  it('does not reuse a compatible catalog cache for fail-closed refreshes', async () => {
    const { resolver, resourceInstance, skillService, getAllToolDefinitions } = createResolver()
    skillService.getActiveSkills.mockResolvedValue(['owned-a'])
    getAllToolDefinitions
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('strict catalog unavailable'))
    const catalog = resolver.createSessionToolCatalogPort(
      'session-1',
      null,
      resourceInstance as any
    )

    await expect(catalog.resolve({ activeSkillNames: ['owned-a'] })).resolves.toEqual([])
    await expect(
      catalog.resolve({ activeSkillNames: ['owned-a'], failClosed: true })
    ).rejects.toThrow('strict catalog unavailable')
    expect(getAllToolDefinitions).toHaveBeenCalledTimes(2)
    expect(getAllToolDefinitions.mock.calls[1][0]).toMatchObject({ requireCompleteCatalog: true })
  })

  it('propagates Skill validation failures only for fail-closed runtime refreshes', async () => {
    const { resolver, resourceInstance, skillService, getAllToolDefinitions } = createResolver()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    skillService.validateSkillNames.mockRejectedValue(new Error('Skill registry unavailable'))
    const catalog = resolver.createSessionToolCatalogPort(
      'session-1',
      null,
      resourceInstance as any
    )

    await expect(catalog.resolve({ activeSkillNames: ['owned-a'] })).resolves.toEqual([])
    expect(getAllToolDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({ activeSkillNames: [] })
    )
    await expect(
      catalog.resolve({ activeSkillNames: ['owned-a'], failClosed: true })
    ).rejects.toThrow('Skill registry unavailable')
    expect(warnSpy).toHaveBeenCalledTimes(2)
    warnSpy.mockRestore()
  })

  it('rejects strict refreshes when validation omits a requested runtime Skill', async () => {
    const { resolver, resourceInstance, skillService, getAllToolDefinitions } = createResolver()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    skillService.validateSkillNames.mockResolvedValue([])
    const catalog = resolver.createSessionToolCatalogPort(
      'session-1',
      null,
      resourceInstance as any
    )

    await expect(catalog.resolve({ activeSkillNames: ['owned-a'] })).resolves.toEqual([])
    await expect(
      catalog.resolve({ activeSkillNames: ['owned-a'], failClosed: true })
    ).rejects.toThrow('did not preserve the requested Skill set')
    expect(getAllToolDefinitions).toHaveBeenCalledOnce()
    warnSpy.mockRestore()
  })

  it('freshly loads session Skills during strict refresh even with an explicit active set', async () => {
    const { resolver, resourceInstance, skillService, getAllToolDefinitions } = createResolver()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    skillService.getActiveSkills.mockRejectedValue(new Error('Session Skills unavailable'))
    const catalog = resolver.createSessionToolCatalogPort(
      'session-1',
      null,
      resourceInstance as any
    )

    await expect(catalog.resolve({ activeSkillNames: ['owned-a'] })).resolves.toEqual([])
    await expect(
      catalog.resolve({ activeSkillNames: ['owned-a'], failClosed: true })
    ).rejects.toThrow('Session Skills unavailable')
    expect(getAllToolDefinitions).toHaveBeenCalledOnce()
    expect(skillService.getActiveSkills).toHaveBeenCalledOnce()
    warnSpy.mockRestore()
  })

  it('propagates Agent policy failures only for fail-closed runtime refreshes', async () => {
    const { resolver, resourceInstance, resolveDeepChatAgentConfig, getAllToolDefinitions } =
      createResolver()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    resolveDeepChatAgentConfig.mockRejectedValue(new Error('Agent policy unavailable'))
    const catalog = resolver.createSessionToolCatalogPort(
      'session-1',
      null,
      resourceInstance as any
    )

    await expect(catalog.resolve({ activeSkillNames: ['owned-a'] })).resolves.toEqual([])
    expect(getAllToolDefinitions).toHaveBeenCalledOnce()
    await expect(
      catalog.resolve({ activeSkillNames: ['owned-a'], failClosed: true })
    ).rejects.toThrow('Agent policy unavailable')
    expect(getAllToolDefinitions).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledTimes(2)
    warnSpy.mockRestore()
  })

  it('revalidates transfer selections with the explicit target Agent', async () => {
    const { resolver, skillService, resolveDeepChatAgentConfig } = createResolver()

    await resolver.revalidateActiveSkillsForAgent('session-1', 'reviewer')

    expect(skillService.revalidateActiveSkillsForAgent).toHaveBeenCalledWith(
      'session-1',
      'reviewer'
    )
    expect(resolveDeepChatAgentConfig).not.toHaveBeenCalled()
  })

  it('keeps all already-validated persisted skills without consulting Agent config', async () => {
    const { resolver, resolveDeepChatAgentConfig } = createResolver()

    await expect(resolver.resolveActiveSkillNamesForToolProfile('session-1')).resolves.toEqual([
      'owned-a',
      'owned-b'
    ])
    expect(resolveDeepChatAgentConfig).not.toHaveBeenCalled()
  })
})

describe('DeepChatToolResolver Run definition universe', () => {
  const createUniverseResolver = (options?: {
    metadata?: Array<{ name: string; allowedTools?: string[] }>
    activeSkills?: string[]
    definitions?: MCPToolDefinition[]
    acpBacked?: boolean
    assertCurrent?: () => void
    sessionKind?: 'regular' | 'subagent'
    rejectParentPolicy?: boolean
  }) => {
    const resourceInstance = createResourceInstance('writer')
    const skillService = {
      getActiveSkills: vi.fn().mockResolvedValue(options?.activeSkills ?? []),
      snapshotPersistedActiveSkillNames: vi.fn(() => options?.activeSkills ?? []),
      snapshotCachedMetadataList: vi.fn(
        (_agentId: string, snapshotOptions: { maxItems: number }) =>
          (options?.metadata?.length ?? 0) > snapshotOptions.maxItems
            ? {
                state: 'overflow' as const,
                minimumItemCount: snapshotOptions.maxItems + 1
              }
            : {
                state: 'ready' as const,
                skills: options?.metadata ?? []
              }
      ),
      validateSkillNames: vi.fn(async (_agentId: string, names: string[]) => names),
      revalidateActiveSkillsForAgent: vi.fn()
    }
    const getToolDefinitionUniverse = vi.fn().mockResolvedValue({
      definitions: options?.definitions ?? [],
      complete: true,
      unavailableSourceCount: 0
    })
    const getAllToolDefinitions = vi.fn()
    const resolveDeepChatAgentConfig = vi.fn(async (agentId: string) => {
      if (options?.rejectParentPolicy && agentId === 'parent-agent') {
        throw new Error('private-parent-policy-error')
      }
      return { enabledMcpServerIds: ['mcp-a'] }
    })
    const resolver = new DeepChatToolResolver({
      agentSettings: {
        getAgentType: vi.fn(async () => 'deepchat'),
        resolveDeepChatAgentConfig
      },
      skillSettings: { isEnabled: vi.fn(() => true) },
      skillService,
      sqlitePresenter: {
        newSessionsTable: {
          get: vi.fn((sessionId: string) =>
            sessionId === 'parent-session'
              ? { agent_id: 'parent-agent', session_kind: 'regular' }
              : {
                  session_kind: options?.sessionKind ?? 'regular',
                  ...(options?.sessionKind === 'subagent'
                    ? { parent_session_id: 'parent-session' }
                    : {})
                }
          ),
          getDisabledAgentTools: vi.fn(() => ['exec'])
        }
      },
      toolService: { getAllToolDefinitions, getToolDefinitionUniverse },
      registry: createScopeRegistry(resourceInstance, options?.assertCurrent),
      identity: {
        getAgentId: vi.fn(() => 'writer'),
        isAcpBackedSubagentSession: vi.fn(() => options?.acpBacked === true)
      }
    } as any)
    return {
      resolver,
      resourceInstance,
      skillService,
      getAllToolDefinitions,
      getToolDefinitionUniverse,
      resolveDeepChatAgentConfig
    }
  }

  it('builds conditional definitions from every visible Agent Skill without activating them', async () => {
    const read = agentTool('read')
    const remote = mcpTool('remote__search', 'remote_search')
    const { resolver, resourceInstance, getAllToolDefinitions, getToolDefinitionUniverse } =
      createUniverseResolver({
        activeSkills: ['active-skill'],
        metadata: [
          { name: 'inactive-skill', allowedTools: ['remote_search'] },
          { name: 'active-skill', allowedTools: ['Read'] },
          { name: 'no-requirements' }
        ],
        definitions: [remote, read]
      })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      '/workspace',
      undefined,
      resourceInstance as any
    )

    expect(result).toMatchObject({
      status: 'resolved',
      complete: true,
      mandatoryAdmissionBlocked: false,
      activeSkillNames: ['active-skill'],
      degradationCounts: []
    })
    expect(result.skillRequirements.map((requirement) => requirement.skillName)).toEqual([
      'active-skill',
      'inactive-skill',
      'no-requirements'
    ])
    expect(result.skillRequirements.every((requirement) => requirement.activatable)).toBe(true)
    expect(result.skillRequirements[0].requiredStableTargetKeys).toHaveLength(1)
    expect(result.skillRequirements[1].requiredStableTargetKeys).toHaveLength(1)
    expect(getToolDefinitionUniverse).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'writer',
        disabledAgentTools: ['exec'],
        enabledMcpServerIds: ['mcp-a'],
        activeSkillNames: ['active-skill', 'inactive-skill', 'no-requirements']
      })
    )
    expect(getAllToolDefinitions).not.toHaveBeenCalled()
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.skillRequirements)).toBe(true)
  })

  it('accepts active Skill names up to the shared repository limit', async () => {
    const skillName = `skill-${'a'.repeat(SKILL_NAME_MAX_LENGTH - 'skill-'.length)}`
    const { resolver, resourceInstance } = createUniverseResolver({
      activeSkills: [skillName],
      metadata: [{ name: skillName }]
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result).toMatchObject({
      status: 'resolved',
      complete: true,
      mandatoryAdmissionBlocked: false,
      activeSkillNames: [skillName],
      degradationCounts: []
    })
    expect(result.skillRequirements).toEqual([
      expect.objectContaining({ skillName, activeAtRunStart: true, activatable: true })
    ])
  })

  it('resolves bundled legacy Skill requirements to native Agent targets', async () => {
    const { resolver, resourceInstance } = createUniverseResolver({
      metadata: [
        { name: 'code-review', allowedTools: ['read_file', 'list_files', 'search_files'] },
        { name: 'git-commit', allowedTools: ['run_terminal_cmd'] }
      ],
      definitions: [agentTool('read'), agentTool('glob'), agentTool('grep'), agentTool('exec')]
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result.status).toBe('resolved')
    expect(result.skillRequirements).toEqual([
      expect.objectContaining({ skillName: 'code-review', activatable: true }),
      expect.objectContaining({ skillName: 'git-commit', activatable: true })
    ])
    expect(result.skillRequirements[0].requiredStableTargetKeys).toHaveLength(3)
    expect(result.skillRequirements[1].requiredStableTargetKeys).toHaveLength(1)
  })

  it('separates inactive degradation from an active mandatory admission failure', async () => {
    const { resolver, resourceInstance } = createUniverseResolver({
      activeSkills: ['active-skill'],
      metadata: [
        { name: 'active-skill', allowedTools: ['missing-active'] },
        { name: 'inactive-skill', allowedTools: ['missing-inactive'] }
      ],
      definitions: [agentTool('read')]
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result.status).toBe('degraded')
    expect(result.complete).toBe(true)
    expect(result.mandatoryAdmissionBlocked).toBe(true)
    expect(result.degradationCounts).toContainEqual({
      code: 'skill-requirement-unresolved',
      count: 2
    })
    expect(
      result.skillRequirements.find((requirement) => requirement.skillName === 'inactive-skill')
    ).toMatchObject({ activeAtRunStart: false, activatable: false })
  })

  it('resolves prototype-named MCP requirements without invoking object properties', async () => {
    const { resolver, resourceInstance } = createUniverseResolver({
      activeSkills: ['prototype-name'],
      metadata: [{ name: 'prototype-name', allowedTools: ['__proto__'] }],
      definitions: [mcpTool('remote_proto', '__proto__')]
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result.skillRequirements).toEqual([
      expect.objectContaining({
        skillName: 'prototype-name',
        activatable: true,
        issueCodes: [],
        requiredStableTargetKeys: [expect.any(String)]
      })
    ])
  })

  it('degrades without reading catalogs when the persisted active-skill snapshot is unavailable', async () => {
    const { resolver, resourceInstance, skillService, getToolDefinitionUniverse } =
      createUniverseResolver()
    skillService.snapshotPersistedActiveSkillNames.mockImplementationOnce(() => {
      throw new Error('contains-private-state')
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result).toMatchObject({
      status: 'degraded',
      complete: false,
      definitions: [],
      activeSkillNames: [],
      skillRequirements: [],
      degradationCounts: [{ code: 'active-skill-snapshot-unavailable', count: 1 }]
    })
    expect(skillService.snapshotCachedMetadataList).not.toHaveBeenCalled()
    expect(getToolDefinitionUniverse).not.toHaveBeenCalled()
  })

  it('keeps partial definitions detached but blocks required-tool admission', async () => {
    const read = agentTool('read')
    const { resolver, resourceInstance, getToolDefinitionUniverse } = createUniverseResolver({
      activeSkills: ['active-skill'],
      metadata: [{ name: 'active-skill', allowedTools: ['read'] }],
      definitions: [read]
    })
    getToolDefinitionUniverse.mockResolvedValueOnce({
      definitions: [read],
      complete: false,
      unavailableSourceCount: 2
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result).toMatchObject({
      status: 'degraded',
      complete: false,
      mandatoryAdmissionBlocked: true,
      degradationCounts: [{ code: 'definition-universe-unavailable', count: 2 }]
    })
    expect(result.skillRequirements[0]).toMatchObject({
      activatable: false,
      issueCodes: ['definition-universe-unavailable']
    })
    expect(result.definitions[0]).not.toBe(read)
    expect(Object.isFrozen(result.definitions[0].function.parameters.properties)).toBe(true)
  })

  it('degrades without content when the complete Agent policy cannot be resolved', async () => {
    const { resolver, resourceInstance, getToolDefinitionUniverse, resolveDeepChatAgentConfig } =
      createUniverseResolver()
    resolveDeepChatAgentConfig.mockRejectedValueOnce(new Error('private-policy-error'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result).toMatchObject({
      status: 'degraded',
      complete: false,
      definitions: [],
      activeSkillNames: [],
      skillRequirements: [],
      degradationCounts: [{ code: 'tool-policy-unavailable', count: 1 }]
    })
    expect(warnSpy).not.toHaveBeenCalled()
    expect(getToolDefinitionUniverse).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('marks an alias ambiguous when it resolves to distinct owned targets', async () => {
    const { resolver, resourceInstance } = createUniverseResolver({
      metadata: [{ name: 'ambiguous-skill', allowedTools: ['Read'] }],
      definitions: [agentTool('read'), mcpTool('remote__read', 'read_file')]
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result.skillRequirements[0]).toMatchObject({
      skillName: 'ambiguous-skill',
      activatable: false,
      issueCodes: ['skill-requirement-ambiguous']
    })
  })

  it('rejects an oversized Skill catalog without probing missing active Skills', async () => {
    const metadata = Array.from({ length: MAX_RUN_TOOL_UNIVERSE_SKILLS + 1 }, (_, index) => ({
      name: `inactive-${index}`
    }))
    const { resolver, resourceInstance, getToolDefinitionUniverse } = createUniverseResolver({
      activeSkills: ['active-missing'],
      metadata
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result).toMatchObject({
      status: 'degraded',
      complete: false,
      mandatoryAdmissionBlocked: true,
      activeSkillNames: ['active-missing']
    })
    expect(result.skillRequirements).toEqual([
      {
        skillName: 'active-missing',
        activeAtRunStart: true,
        activatable: false,
        requiredStableTargetKeys: [],
        issueCodes: ['active-skill-metadata-not-admitted']
      }
    ])
    expect(result.degradationCounts).toContainEqual({
      code: 'active-skill-metadata-not-admitted',
      count: 1
    })
    expect(getToolDefinitionUniverse).toHaveBeenCalledWith(
      expect.objectContaining({ activeSkillNames: [] })
    )
  })

  it('reports only definitions beyond the run universe limit as degraded', async () => {
    const definitions = Array.from(
      { length: MAX_RUN_TOOL_UNIVERSE_DEFINITIONS + 2 },
      (_, index) => agentTool(`tool-${index}`)
    )
    const { resolver, resourceInstance } = createUniverseResolver({ definitions })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result).toMatchObject({
      status: 'degraded',
      complete: false,
      definitions: [],
      degradationCounts: [{ code: 'definition-limit-exceeded', count: 2 }]
    })
  })

  it('rejects oversized and invalid Skill requirements before reading their contents', async () => {
    const oversizedAllowedTools = new Array<string>(MAX_SKILL_TOOL_REQUIREMENTS + 1)
    const oversizedEntryRead = vi.fn(() => {
      throw new Error('oversized-entry-read')
    })
    Object.defineProperty(oversizedAllowedTools, 0, {
      configurable: true,
      enumerable: true,
      get: oversizedEntryRead
    })
    const { resolver, resourceInstance } = createUniverseResolver({
      activeSkills: ['oversized', 'invalid', 'null-byte'],
      metadata: [
        { name: 'oversized', allowedTools: oversizedAllowedTools },
        {
          name: 'invalid',
          allowedTools: ['x'.repeat(MAX_RUN_TOOL_REQUIREMENT_NAME_BYTES + 1)]
        },
        { name: 'null-byte', allowedTools: ['read\0write'] }
      ]
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(oversizedEntryRead).not.toHaveBeenCalled()
    expect(result.mandatoryAdmissionBlocked).toBe(true)
    expect(result.skillRequirements).toEqual([
      expect.objectContaining({
        skillName: 'invalid',
        issueCodes: ['skill-requirement-invalid']
      }),
      expect.objectContaining({
        skillName: 'null-byte',
        issueCodes: ['skill-requirement-invalid']
      }),
      expect.objectContaining({
        skillName: 'oversized',
        issueCodes: ['requirement-limit-exceeded']
      })
    ])
  })

  it('degrades accessor-backed Skill inputs without invoking accessors', async () => {
    const activeSkills = ['safe']
    const activeSkillRead = vi.fn(() => 'safe')
    Object.defineProperty(activeSkills, 0, {
      configurable: true,
      enumerable: true,
      get: activeSkillRead
    })
    const metadataNameRead = vi.fn(() => 'unsafe')
    const unsafeMetadata = {} as { name: string; allowedTools?: string[] }
    Object.defineProperty(unsafeMetadata, 'name', {
      configurable: true,
      enumerable: true,
      get: metadataNameRead
    })
    const { resolver, resourceInstance, skillService, getToolDefinitionUniverse } =
      createUniverseResolver({ metadata: [unsafeMetadata] })
    skillService.snapshotPersistedActiveSkillNames.mockReturnValueOnce(activeSkills)

    const activeResult = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(activeResult.degradationCounts).toEqual([
      { code: 'active-skill-snapshot-invalid', count: 1 }
    ])
    expect(activeSkillRead).not.toHaveBeenCalled()
    expect(getToolDefinitionUniverse).not.toHaveBeenCalled()

    skillService.snapshotPersistedActiveSkillNames.mockReturnValueOnce([])
    const metadataResult = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )
    expect(metadataResult.degradationCounts).toContainEqual({
      code: 'skill-metadata-invalid',
      count: 1
    })
    expect(metadataNameRead).not.toHaveBeenCalled()
  })

  it('rejects short accessor-backed requirement arrays without invoking accessors', async () => {
    const allowedTools = ['read']
    const requirementRead = vi.fn(() => 'read')
    Object.defineProperty(allowedTools, 0, {
      configurable: true,
      enumerable: true,
      get: requirementRead
    })
    const { resolver, resourceInstance } = createUniverseResolver({
      activeSkills: ['unsafe'],
      metadata: [{ name: 'unsafe', allowedTools }],
      definitions: [agentTool('read')]
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result.mandatoryAdmissionBlocked).toBe(true)
    expect(result.skillRequirements[0]).toMatchObject({
      activatable: false,
      issueCodes: ['skill-requirement-invalid']
    })
    expect(requirementRead).not.toHaveBeenCalled()
  })

  it('degrades catalog-wide definition conflicts before resolving Skill requirements', async () => {
    const base = agentTool('read')
    const conflict = agentTool('read', {
      function: {
        name: 'read',
        description: 'conflicting definition',
        parameters: { type: 'object', properties: {} }
      }
    })
    const { resolver, resourceInstance } = createUniverseResolver({
      activeSkills: ['reader'],
      metadata: [{ name: 'reader', allowedTools: ['read'] }],
      definitions: [base, conflict]
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result).toMatchObject({
      status: 'degraded',
      complete: false,
      mandatoryAdmissionBlocked: true,
      definitions: []
    })
    expect(result.degradationCounts).toContainEqual({
      code: 'definition-universe-unavailable',
      count: 1
    })
  })

  it('defensively degrades contradictory definition completeness', async () => {
    const { resolver, resourceInstance, getToolDefinitionUniverse } = createUniverseResolver({
      definitions: [agentTool('read')]
    })
    getToolDefinitionUniverse.mockResolvedValueOnce({
      definitions: [agentTool('read')],
      complete: true,
      unavailableSourceCount: 2
    })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result).toMatchObject({
      status: 'degraded',
      complete: false,
      degradationCounts: [{ code: 'definition-universe-unavailable', count: 2 }]
    })
  })

  it('degrades a definition acquisition failure without exposing its message', async () => {
    const { resolver, resourceInstance, getToolDefinitionUniverse } = createUniverseResolver()
    getToolDefinitionUniverse.mockRejectedValueOnce(new Error('private-definition-source'))

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result).toMatchObject({
      status: 'degraded',
      complete: false,
      degradationCounts: [{ code: 'definition-universe-unavailable', count: 1 }]
    })
    expect(JSON.stringify(result)).not.toContain('private-definition-source')
  })

  it('fences a stale instance before cloning the resolved definition universe', async () => {
    let assertionCount = 0
    const staleError = Object.assign(new Error('instance replaced'), {
      name: 'StaleDeepChatAgentInstanceError'
    })
    const assertCurrent = vi.fn(() => {
      assertionCount += 1
      if (assertionCount >= 4) throw staleError
    })
    const functionRead = vi.fn(() => agentTool('read').function)
    const definition = agentTool('read')
    Object.defineProperty(definition, 'function', {
      configurable: true,
      enumerable: true,
      get: functionRead
    })
    const { resolver, resourceInstance, getToolDefinitionUniverse } = createUniverseResolver({
      assertCurrent
    })
    getToolDefinitionUniverse.mockResolvedValueOnce({
      definitions: [definition],
      complete: true,
      unavailableSourceCount: 0
    })

    await expect(
      resolver.resolveRunToolDefinitionUniverse(
        'session-1',
        null,
        undefined,
        resourceInstance as any
      )
    ).rejects.toMatchObject({ name: 'StaleDeepChatAgentInstanceError' })
    expect(functionRead).not.toHaveBeenCalled()
  })

  it('keeps parent policy failures content-free for subagent shadow resolution', async () => {
    const { resolver, resourceInstance, getToolDefinitionUniverse } = createUniverseResolver({
      sessionKind: 'subagent',
      rejectParentPolicy: true
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result).toMatchObject({
      status: 'degraded',
      complete: false,
      degradationCounts: [{ code: 'tool-policy-unavailable', count: 1 }]
    })
    expect(getToolDefinitionUniverse).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('stops shadow universe resolution when its diagnostic signal is aborted', async () => {
    const { resolver, resourceInstance, getToolDefinitionUniverse, resolveDeepChatAgentConfig } =
      createUniverseResolver()
    resolveDeepChatAgentConfig.mockReturnValueOnce(new Promise(() => undefined))
    const controller = new AbortController()

    const pending = resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any,
      controller.signal
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(getToolDefinitionUniverse).not.toHaveBeenCalled()
  })

  it('excludes ACP before reading Skill or Tool catalogs', async () => {
    const {
      resolver,
      resourceInstance,
      skillService,
      getAllToolDefinitions,
      getToolDefinitionUniverse
    } = createUniverseResolver({ acpBacked: true })

    const result = await resolver.resolveRunToolDefinitionUniverse(
      'session-1',
      null,
      undefined,
      resourceInstance as any
    )

    expect(result.status).toBe('acp-excluded')
    expect(skillService.snapshotPersistedActiveSkillNames).not.toHaveBeenCalled()
    expect(skillService.snapshotCachedMetadataList).not.toHaveBeenCalled()
    expect(getAllToolDefinitions).not.toHaveBeenCalled()
    expect(getToolDefinitionUniverse).not.toHaveBeenCalled()
  })
})
