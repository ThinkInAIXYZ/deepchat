import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCurrentWorkflowRunScope, WorkflowLaunchScopeResolver } from '@/workflow/launchScope'
import type { WorkflowRun } from '@shared/workflow/domain'
import type { ConversationSessionInfo } from '@/tool/runtimePorts'
import { TEST_WORKFLOW_EXECUTION_SNAPSHOT } from './workflowTestFixtures'

describe('WorkflowLaunchScopeResolver', () => {
  const resolveConversationSessionInfo = vi.fn()
  const getAgentType = vi.fn()
  const resolveDeepChatAgentConfig = vi.fn()
  const getMessage = vi.fn()
  let parent: ConversationSessionInfo

  beforeEach(() => {
    vi.clearAllMocks()
    parent = {
      sessionId: 'parent-1',
      agentId: 'deepchat',
      agentName: 'DeepChat',
      agentType: 'deepchat',
      providerId: 'openai',
      modelId: 'model-1',
      projectDir: '/repo/../repo',
      permissionMode: 'default',
      generationSettings: {
        systemPrompt: 'parent',
        temperature: 0.2,
        contextLength: 32_000,
        maxTokens: 4_096,
        timeout: 60_000
      },
      disabledAgentTools: ['cronjob'],
      activeSkills: ['review'],
      sessionKind: 'regular',
      parentSessionId: null,
      subagentMeta: null,
      subagentCapability: {
        available: false,
        reason: 'no_valid_slots',
        cacheKey: 'none'
      }
    }
    resolveConversationSessionInfo.mockImplementation(async () => parent)
    getAgentType.mockResolvedValue('deepchat')
    resolveDeepChatAgentConfig.mockImplementation(async (agentId: string) => ({
      subagentEnabled: true,
      permissionMode: agentId === 'reviewer' ? 'default' : 'full_access',
      systemPrompt: `${agentId} prompt`,
      disabledAgentTools: ['cronjob']
    }))
    getMessage.mockReturnValue({
      id: 'message-1',
      sessionId: 'parent-1'
    })
  })

  const createResolver = () =>
    new WorkflowLaunchScopeResolver({
      sessions: { resolveConversationSessionInfo },
      agents: { getAgentType, resolveDeepChatAgentConfig },
      messages: { getMessage }
    })

  it('derives workspace and target policy from main-owned session state', async () => {
    const resolved = await createResolver().resolve({
      parentSessionId: 'parent-1',
      parentMessageId: 'message-1',
      allowedAgentIds: ['reviewer', 'deepchat', 'reviewer']
    })

    expect(resolved.workspacePath).toBe('/repo')
    expect(resolved.allowedAgentIds).toEqual(['deepchat', 'reviewer'])
    expect(resolved.capabilityScopeHash).toMatch(/^[0-9a-f]{64}$/)
    expect(resolved.capabilities).toContain('cross-agent-security-policy')
    expect(resolved.executionSnapshot).toMatchObject({
      schemaVersion: 1,
      providerId: 'openai',
      modelId: 'model-1',
      generationSettings: {
        systemPrompt: 'parent',
        temperature: 0.2
      }
    })
  })

  it('omits absent optional settings from the immutable execution snapshot', async () => {
    parent = {
      ...parent,
      generationSettings: {
        ...parent.generationSettings!,
        topP: undefined,
        imageGeneration: { size: undefined }
      }
    }

    const resolved = await createResolver().resolve({
      parentSessionId: 'parent-1',
      parentMessageId: null,
      allowedAgentIds: ['deepchat']
    })

    expect(resolved.executionSnapshot.generationSettings).not.toHaveProperty('topP')
    expect(resolved.executionSnapshot.generationSettings.imageGeneration).toEqual({})
  })

  it('separates mutable model settings from the continuously validated security scope', async () => {
    const resolver = createResolver()
    const first = await resolver.resolve({
      parentSessionId: 'parent-1',
      parentMessageId: null,
      allowedAgentIds: ['deepchat']
    })
    parent = {
      ...parent,
      modelId: 'model-2',
      generationSettings: {
        ...parent.generationSettings,
        reasoningEffort: 'high'
      }
    }
    const second = await resolver.resolve({
      parentSessionId: 'parent-1',
      parentMessageId: null,
      allowedAgentIds: ['deepchat']
    })

    expect(second.capabilityScopeHash).toBe(first.capabilityScopeHash)
    expect(second.executionSnapshot).not.toEqual(first.executionSnapshot)
    expect(second.executionSnapshot.modelId).toBe('model-2')
    expect(second.executionSnapshot.generationSettings.reasoningEffort).toBe('high')
  })

  it('keeps security revalidation available without current generation settings', async () => {
    const resolver = createResolver()
    parent = { ...parent, generationSettings: null }
    const request = {
      parentSessionId: 'parent-1',
      parentMessageId: null,
      allowedAgentIds: ['deepchat']
    }

    await expect(resolver.resolve(request)).rejects.toThrow(
      'parent generation settings are unavailable'
    )
    await expect(resolver.resolveCapabilityScope(request)).resolves.toMatchObject({
      workspacePath: '/repo',
      allowedAgentIds: ['deepchat'],
      capabilityScopeHash: expect.stringMatching(/^[0-9a-f]{64}$/)
    })
  })

  it('changes the capability hash when effective target security changes', async () => {
    const resolver = createResolver()
    const first = await resolver.resolve({
      parentSessionId: 'parent-1',
      parentMessageId: null,
      allowedAgentIds: ['reviewer']
    })
    resolveDeepChatAgentConfig.mockImplementation(async (agentId: string) => ({
      subagentEnabled: true,
      permissionMode: agentId === 'reviewer' ? 'full_access' : 'default',
      systemPrompt: `${agentId} prompt`,
      disabledAgentTools: []
    }))
    const second = await resolver.resolve({
      parentSessionId: 'parent-1',
      parentMessageId: null,
      allowedAgentIds: ['reviewer']
    })

    expect(second.capabilityScopeHash).not.toBe(first.capabilityScopeHash)
  })

  it('includes target MCP and skill policy in the capability hash', async () => {
    const resolver = createResolver()
    resolveDeepChatAgentConfig.mockResolvedValue({
      subagentEnabled: true,
      enabledMcpServerIds: ['filesystem'],
      enabledSkillNames: ['review']
    })
    const first = await resolver.resolve({
      parentSessionId: 'parent-1',
      parentMessageId: null,
      allowedAgentIds: ['reviewer']
    })
    resolveDeepChatAgentConfig.mockResolvedValue({
      subagentEnabled: true,
      enabledMcpServerIds: ['filesystem', 'github'],
      enabledSkillNames: ['review']
    })
    const second = await resolver.resolve({
      parentSessionId: 'parent-1',
      parentMessageId: null,
      allowedAgentIds: ['reviewer']
    })

    expect(second.capabilityScopeHash).not.toBe(first.capabilityScopeHash)
  })

  it('rejects direct ACP targets and a parent message from another session', async () => {
    getAgentType.mockResolvedValueOnce('deepchat').mockResolvedValueOnce('acp')
    await expect(
      createResolver().resolve({
        parentSessionId: 'parent-1',
        parentMessageId: null,
        allowedAgentIds: ['deepchat', 'acp-reviewer']
      })
    ).rejects.toThrow('not a DeepChat agent')

    getMessage.mockReturnValue({ id: 'message-1', sessionId: 'other-parent' })
    await expect(
      createResolver().resolve({
        parentSessionId: 'parent-1',
        parentMessageId: 'message-1',
        allowedAgentIds: ['deepchat']
      })
    ).rejects.toThrow('does not belong to session')
  })

  it('fails closed when the parent agent disables subagent execution', async () => {
    resolveDeepChatAgentConfig.mockResolvedValue({ subagentEnabled: false })

    await expect(
      createResolver().resolve({
        parentSessionId: 'parent-1',
        parentMessageId: null,
        allowedAgentIds: ['deepchat']
      })
    ).rejects.toThrow('disabled by the parent agent policy')
    expect(getAgentType).not.toHaveBeenCalled()
  })

  it('does not make durable execution depend on retaining its provenance message', async () => {
    const resolveCapabilityScope = vi.fn().mockResolvedValue({
      workspacePath: '/repo',
      allowedAgentIds: ['deepchat'],
      capabilityScopeHash: 'a'.repeat(64),
      capabilities: []
    })

    await assertCurrentWorkflowRunScope(
      {
        resolve: vi.fn().mockResolvedValue({
          workspacePath: '/repo',
          allowedAgentIds: ['deepchat'],
          capabilityScopeHash: 'a'.repeat(64),
          capabilities: [],
          executionSnapshot: TEST_WORKFLOW_EXECUTION_SNAPSHOT
        }),
        resolveCapabilityScope
      },
      {
        id: 'run-1',
        parentSessionId: 'parent-1',
        parentMessageId: 'message-that-may-be-pruned',
        workspacePath: '/repo',
        capabilityScopeHash: 'a'.repeat(64),
        allowedAgentIds: ['deepchat']
      } as WorkflowRun
    )

    expect(resolveCapabilityScope).toHaveBeenCalledWith({
      parentSessionId: 'parent-1',
      parentMessageId: null,
      allowedAgentIds: ['deepchat']
    })
  })
})
