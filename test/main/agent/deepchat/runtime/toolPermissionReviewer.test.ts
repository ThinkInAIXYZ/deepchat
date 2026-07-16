import type { ProviderSettingsPort } from '@/provider/settings'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRuntimePort } from '@shared/types/provider'
import { reviewAutoApproveToolPermission } from '@/agent/deepchat/runtime/toolPermissionReviewer'

describe('tool permission reviewer', () => {
  it('accepts a low-risk decision only when the model echoes the exact action hash', async () => {
    const executeWithRateLimit = vi.fn().mockResolvedValue(undefined)
    const generateCompletionStandalone = vi.fn().mockImplementation(async (_provider, messages) => {
      const prompt = String(messages[1]?.content ?? '')
      const actionHash = prompt.match(/"actionHash": "([a-f0-9]+)"/)?.[1]
      return JSON.stringify({
        actionHash,
        decision: 'auto_allow',
        riskLevel: 'low',
        userAuthorization: 'medium',
        rationale: 'Narrow action requested by the user.'
      })
    })
    const providerSettings = {
      resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({
        assistantModel: { providerId: 'review-provider', modelId: 'review-model' }
      })
    } as unknown as ProviderSettingsPort
    const providerRuntime = {
      executeWithRateLimit,
      generateCompletionStandalone
    } as unknown as ProviderRuntimePort

    const result = await reviewAutoApproveToolPermission(
      {
        providerSettings,
        agentSettings: providerSettings,
        providerRuntime,
        getSessionAgentId: () => 'deepchat'
      },
      {
        sessionId: 'session-1',
        messageId: 'message-1',
        toolCallId: 'call-1',
        toolName: 'read',
        toolArgs: '{"path":"README.md"}',
        reason: 'tool_call'
      },
      {
        providerId: 'session-provider',
        modelId: 'session-model',
        messages: [{ role: 'user', content: 'Read README.md' }],
        signal: new AbortController().signal
      }
    )

    expect(result).toMatchObject({
      decision: 'auto_allow',
      riskLevel: 'low',
      userAuthorization: 'medium'
    })
    expect(executeWithRateLimit).toHaveBeenCalledWith('review-provider', {
      signal: expect.any(AbortSignal)
    })
    expect(generateCompletionStandalone).toHaveBeenCalledWith(
      'review-provider',
      expect.any(Array),
      'review-model',
      0,
      700,
      expect.objectContaining({ swallowErrors: false })
    )
  })

  it('falls back to asking the user when the action hash does not match', async () => {
    const result = await reviewAutoApproveToolPermission(
      {
        providerSettings: {} as ProviderSettingsPort,
        agentSettings: {
          resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({})
        },
        providerRuntime: {
          executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
          generateCompletionStandalone: vi.fn().mockResolvedValue(
            JSON.stringify({
              actionHash: 'wrong',
              decision: 'auto_allow',
              riskLevel: 'low'
            })
          )
        } as unknown as ProviderRuntimePort,
        getSessionAgentId: () => undefined
      },
      {
        sessionId: 'session-1',
        messageId: 'message-1',
        toolCallId: 'call-1',
        toolName: 'write',
        toolArgs: '{}',
        reason: 'precheck'
      },
      {
        providerId: 'openai',
        modelId: 'gpt-4o',
        messages: [],
        signal: new AbortController().signal
      }
    )

    expect(result).toMatchObject({
      decision: 'ask_user',
      rationale: 'Auto-review action hash mismatch.'
    })
  })
})
