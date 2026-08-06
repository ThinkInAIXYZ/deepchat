import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationCapabilityResolver } from '@/orchestration/capability'

describe('OrchestrationCapabilityResolver', () => {
  const resolveConversationSessionInfo = vi.fn()
  const getAgentType = vi.fn()
  const resolveDeepChatAgentConfig = vi.fn()

  const createResolver = () =>
    new OrchestrationCapabilityResolver({
      sessions: { resolveConversationSessionInfo },
      agents: { getAgentType, resolveDeepChatAgentConfig }
    })

  beforeEach(() => {
    vi.clearAllMocks()
    resolveConversationSessionInfo.mockResolvedValue({
      agentId: 'deepchat',
      agentType: 'deepchat',
      sessionKind: 'regular'
    })
    getAgentType.mockResolvedValue('deepchat')
    resolveDeepChatAgentConfig.mockResolvedValue({ subagentEnabled: true })
  })

  it('resolves regular DeepChat session capability from the Agent policy', async () => {
    const resolver = createResolver()

    await expect(resolver.resolveSession('parent-1')).resolves.toEqual({ available: true })
    expect(getAgentType).not.toHaveBeenCalled()

    resolveDeepChatAgentConfig.mockResolvedValueOnce({ subagentEnabled: false })
    await expect(resolver.resolveSession('parent-1')).resolves.toEqual({
      available: false,
      reason: 'subagents_disabled'
    })

    resolveDeepChatAgentConfig.mockRejectedValueOnce(new Error('config unavailable'))
    await expect(resolver.resolveSession('parent-1')).resolves.toEqual({
      available: false,
      reason: 'agent_policy_unavailable'
    })
  })

  it('reports exact unavailable reasons for unsupported session and draft targets', async () => {
    const resolver = createResolver()

    resolveConversationSessionInfo.mockResolvedValueOnce(null)
    await expect(resolver.resolveSession('missing')).resolves.toEqual({
      available: false,
      reason: 'session_unavailable'
    })

    resolveConversationSessionInfo.mockResolvedValueOnce({
      agentType: 'acp',
      sessionKind: 'regular'
    })
    await expect(resolver.resolveSession('acp-parent')).resolves.toEqual({
      available: false,
      reason: 'deepchat_agent_required'
    })

    resolveConversationSessionInfo.mockResolvedValueOnce({
      agentType: 'deepchat',
      sessionKind: 'subagent'
    })
    await expect(resolver.resolveSession('child')).resolves.toEqual({
      available: false,
      reason: 'regular_parent_required'
    })

    getAgentType.mockRejectedValueOnce(new Error('policy unavailable'))
    await expect(resolver.resolveDraft('unknown-policy')).resolves.toEqual({
      available: false,
      reason: 'agent_policy_unavailable'
    })

    getAgentType.mockResolvedValueOnce(null)
    await expect(resolver.resolveDraft('missing-agent')).resolves.toEqual({
      available: false,
      reason: 'agent_unavailable'
    })

    getAgentType.mockResolvedValueOnce('acp')
    await expect(resolver.resolveDraft('acp-agent')).resolves.toEqual({
      available: false,
      reason: 'deepchat_agent_required'
    })

    await expect(resolver.resolveDraft('deepchat')).resolves.toEqual({ available: true })
  })
})
