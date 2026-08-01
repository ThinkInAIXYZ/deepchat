import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCurrentWorkflowRunScope, WorkflowLaunchScopeResolver } from '@/workflow/launchScope'
import type { WorkflowRun } from '@shared/workflow/domain'

describe('WorkflowLaunchScopeResolver', () => {
  const resolveConversationSessionInfo = vi.fn()
  const getAgentType = vi.fn()
  const resolveDeepChatAgentConfig = vi.fn()
  const getMessage = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    resolveConversationSessionInfo.mockResolvedValue({
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
    })
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

  it('reports session capability without constructing an execution scope', async () => {
    const resolver = createResolver()

    await expect(resolver.resolveCapability('parent-1')).resolves.toEqual({ available: true })
    expect(getAgentType).not.toHaveBeenCalled()
    expect(getMessage).not.toHaveBeenCalled()

    resolveDeepChatAgentConfig.mockResolvedValueOnce({ subagentEnabled: false })
    await expect(resolver.resolveCapability('parent-1')).resolves.toEqual({
      available: false,
      reason: 'subagents_disabled'
    })

    resolveDeepChatAgentConfig.mockRejectedValueOnce(new Error('config unavailable'))
    await expect(resolver.resolveCapability('parent-1')).resolves.toEqual({
      available: false,
      reason: 'agent_policy_unavailable'
    })
  })

  it('reports exact unavailable reasons for unsupported session and draft targets', async () => {
    const resolver = createResolver()

    resolveConversationSessionInfo.mockResolvedValueOnce(null)
    await expect(resolver.resolveCapability('missing')).resolves.toEqual({
      available: false,
      reason: 'session_unavailable'
    })

    resolveConversationSessionInfo.mockResolvedValueOnce({
      agentType: 'acp',
      sessionKind: 'regular'
    })
    await expect(resolver.resolveCapability('acp-parent')).resolves.toEqual({
      available: false,
      reason: 'deepchat_agent_required'
    })

    resolveConversationSessionInfo.mockResolvedValueOnce({
      agentType: 'deepchat',
      sessionKind: 'subagent'
    })
    await expect(resolver.resolveCapability('child')).resolves.toEqual({
      available: false,
      reason: 'regular_parent_required'
    })

    getAgentType.mockResolvedValueOnce(null)
    await expect(resolver.resolveDraftCapability('missing-agent')).resolves.toEqual({
      available: false,
      reason: 'agent_unavailable'
    })

    getAgentType.mockResolvedValueOnce('acp')
    await expect(resolver.resolveDraftCapability('acp-agent')).resolves.toEqual({
      available: false,
      reason: 'deepchat_agent_required'
    })

    await expect(resolver.resolveDraftCapability('deepchat')).resolves.toEqual({ available: true })
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
    const resolve = vi.fn().mockResolvedValue({
      workspacePath: '/repo',
      allowedAgentIds: ['deepchat'],
      capabilityScopeHash: 'a'.repeat(64),
      capabilities: []
    })

    await assertCurrentWorkflowRunScope({ resolve }, {
      id: 'run-1',
      parentSessionId: 'parent-1',
      parentMessageId: 'message-that-may-be-pruned',
      workspacePath: '/repo',
      capabilityScopeHash: 'a'.repeat(64),
      allowedAgentIds: ['deepchat']
    } as WorkflowRun)

    expect(resolve).toHaveBeenCalledWith({
      parentSessionId: 'parent-1',
      parentMessageId: null,
      allowedAgentIds: ['deepchat']
    })
  })
})
