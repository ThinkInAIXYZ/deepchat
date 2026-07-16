import { describe, expect, it, vi } from 'vitest'
import { DeepChatToolResolver } from '@/agent/deepchat/runtime/toolResolver'
import type { DeepChatAgentConfig } from '@shared/types/agent-interface'

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
    getToolProfileCache: vi.fn(() => cached),
    setToolProfileCache: vi.fn((entry) => {
      cached = entry
    })
  }
}

describe('DeepChatToolResolver Subagent capability', () => {
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
      deepChatRuntime: { getToolRegistryRevision: vi.fn(() => 1) },
      getDeepChatInstance: vi.fn(() => resourceInstance),
      getSessionAgentId: vi.fn(() => 'deepchat'),
      getRuntimeState: vi.fn(),
      assertCurrent: vi.fn(),
      isAcpBackedSubagentSession: vi.fn(() => false),
      isStaleInstanceError: vi.fn(() => false)
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
          get: vi.fn(() => ({ session_kind: 'subagent', subagent_enabled: 1 })),
          getDisabledAgentTools: vi.fn(() => [])
        }
      },
      toolService: { getAllToolDefinitions },
      deepChatRuntime: { getToolRegistryRevision: vi.fn(() => 1) },
      getDeepChatInstance: vi.fn(() => resourceInstance),
      getSessionAgentId: vi.fn(() => 'deepchat'),
      getRuntimeState: vi.fn(),
      assertCurrent: vi.fn(),
      isAcpBackedSubagentSession: vi.fn(() => false),
      isStaleInstanceError: vi.fn(() => false)
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
      deepChatRuntime: { getToolRegistryRevision: vi.fn(() => 1) },
      getDeepChatInstance: vi.fn(() => resourceInstance),
      getSessionAgentId: vi.fn(() => 'acp-reviewer'),
      getRuntimeState: vi.fn(),
      assertCurrent: vi.fn(),
      isAcpBackedSubagentSession: vi.fn(() => false),
      isStaleInstanceError: vi.fn(() => false)
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
      deepChatRuntime: { getToolRegistryRevision: vi.fn(() => 1) },
      getDeepChatInstance: vi.fn(() => resourceInstance),
      getSessionAgentId: vi.fn(() => 'custom-agent'),
      getRuntimeState: vi.fn(),
      assertCurrent: vi.fn(),
      isAcpBackedSubagentSession: vi.fn(() => false),
      isStaleInstanceError: vi.fn(() => false)
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
      deepChatRuntime: { getToolRegistryRevision: vi.fn(() => 1) },
      getDeepChatInstance: vi.fn(() => resourceInstance),
      getSessionAgentId: vi.fn(() => 'deepchat'),
      getRuntimeState: vi.fn(),
      assertCurrent: vi.fn(),
      isAcpBackedSubagentSession: vi.fn(() => false),
      isStaleInstanceError: vi.fn(() => false)
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
