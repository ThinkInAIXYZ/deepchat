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

  describe('judgment model (System One)', () => {
    const createJudgmentDeps = (
      answers: Record<string, unknown> | (() => never),
      judgmentModel: { providerId: string; modelId: string } | null = {
        providerId: 'typesafe',
        modelId: 'jev-1.13.0'
      }
    ) => {
      const runJudgment =
        typeof answers === 'function'
          ? vi.fn().mockImplementation(answers)
          : vi.fn().mockResolvedValue({ model: 'jev-1.13.0', answers })
      const generateCompletionStandalone = vi.fn().mockResolvedValue('{}')
      return {
        deps: {
          providerSettings: {} as ProviderSettingsPort,
          agentSettings: {
            resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({
              assistantModel: { providerId: 'review-provider', modelId: 'review-model' },
              judgmentModel
            })
          },
          providerRuntime: {
            executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
            generateCompletionStandalone,
            runJudgment
          } as unknown as ProviderRuntimePort,
          getSessionAgentId: () => 'deepchat'
        },
        runJudgment,
        generateCompletionStandalone
      }
    }

    const request = {
      sessionId: 'session-1',
      messageId: 'message-1',
      toolCallId: 'call-1',
      toolName: 'read',
      toolArgs: '{"path":"README.md"}',
      reason: 'tool_call' as const
    }
    const context = {
      providerId: 'session-provider',
      modelId: 'session-model',
      messages: [{ role: 'user' as const, content: 'Read README.md' }],
      signal: new AbortController().signal
    }

    const answersFor = (params: {
      risk: string
      confidence?: number
      authorization?: number
      injection?: number
    }) => ({
      risk_level: {
        type: 'choice',
        choice: params.risk,
        confidence: params.confidence ?? 0.9,
        probabilities: { [params.risk]: params.confidence ?? 0.9 }
      },
      user_authorization: { type: 'noul', noul: params.authorization ?? 0.95 },
      injection_pressure: { type: 'noul', noul: params.injection ?? 0.05 }
    })

    it('uses the judgment model instead of the generative path when configured', async () => {
      const { deps, runJudgment, generateCompletionStandalone } = createJudgmentDeps(
        answersFor({ risk: 'low' })
      )

      const result = await reviewAutoApproveToolPermission(deps, request, context)

      expect(result).toMatchObject({ decision: 'auto_allow', riskLevel: 'low' })
      expect(runJudgment).toHaveBeenCalledWith(
        'typesafe',
        'jev-1.13.0',
        expect.objectContaining({
          questions: expect.objectContaining({ risk_level: expect.any(Object) })
        }),
        { signal: expect.any(AbortSignal) }
      )
      expect(generateCompletionStandalone).not.toHaveBeenCalled()
    })

    it('still blocks critical risk and asks the user for high risk', async () => {
      const critical = await reviewAutoApproveToolPermission(
        createJudgmentDeps(answersFor({ risk: 'critical' })).deps,
        request,
        context
      )
      expect(critical).toMatchObject({ decision: 'block', riskLevel: 'critical' })

      const high = await reviewAutoApproveToolPermission(
        createJudgmentDeps(answersFor({ risk: 'high' })).deps,
        request,
        context
      )
      expect(high).toMatchObject({ decision: 'ask_user', riskLevel: 'high' })
    })

    it('asks the user when the review signals do not clear the auto-allow floor', async () => {
      const unauthorized = await reviewAutoApproveToolPermission(
        createJudgmentDeps(answersFor({ risk: 'low', authorization: 0.2 })).deps,
        request,
        context
      )
      expect(unauthorized).toMatchObject({ decision: 'ask_user' })

      const injected = await reviewAutoApproveToolPermission(
        createJudgmentDeps(answersFor({ risk: 'low', injection: 0.9 })).deps,
        request,
        context
      )
      expect(injected).toMatchObject({ decision: 'ask_user' })

      const unconfident = await reviewAutoApproveToolPermission(
        createJudgmentDeps(answersFor({ risk: 'low', confidence: 0.2 })).deps,
        request,
        context
      )
      expect(unconfident).toMatchObject({ decision: 'ask_user' })
    })

    it('asks the user when the judgment call fails or returns unusable answers', async () => {
      const failed = await reviewAutoApproveToolPermission(
        createJudgmentDeps(() => {
          throw new Error('judgment unavailable')
        }).deps,
        request,
        context
      )
      expect(failed).toMatchObject({ decision: 'ask_user' })

      const malformed = await reviewAutoApproveToolPermission(
        createJudgmentDeps({ risk_level: { type: 'noul', noul: 1 } }).deps,
        request,
        context
      )
      expect(malformed).toMatchObject({ decision: 'ask_user' })
    })

    it('keeps the generative path when no judgment model is configured', async () => {
      const { deps, runJudgment, generateCompletionStandalone } = createJudgmentDeps(
        answersFor({ risk: 'low' }),
        null
      )

      await reviewAutoApproveToolPermission(deps, request, context)

      expect(runJudgment).not.toHaveBeenCalled()
      expect(generateCompletionStandalone).toHaveBeenCalled()
    })

    it('bounds the judgment request with the review signal', async () => {
      const controller = new AbortController()
      let observedSignal: AbortSignal | undefined
      const runJudgment = vi.fn().mockImplementation(
        async (_provider, _model, _request, options: { signal: AbortSignal }) => {
          observedSignal = options.signal
          await new Promise((resolve) => {
            if (options.signal.aborted) {
              resolve(undefined)
              return
            }
            options.signal.addEventListener('abort', () => resolve(undefined), { once: true })
          })
          throw new Error('Aborted')
        }
      )

      const deps = {
        providerSettings: {} as ProviderSettingsPort,
        agentSettings: {
          resolveDeepChatAgentConfig: vi.fn().mockResolvedValue({
            judgmentModel: { providerId: 'typesafe', modelId: 'jev-1.13.0' }
          })
        },
        providerRuntime: {
          executeWithRateLimit: vi.fn().mockResolvedValue(undefined),
          generateCompletionStandalone: vi.fn(),
          runJudgment
        } as unknown as ProviderRuntimePort,
        getSessionAgentId: () => 'deepchat'
      }

      const pending = reviewAutoApproveToolPermission(deps, request, {
        ...context,
        signal: controller.signal
      })

      await vi.waitFor(() => expect(observedSignal).toBeDefined())
      expect(observedSignal?.aborted).toBe(false)

      controller.abort()

      expect(observedSignal?.aborted).toBe(true)
      await expect(pending).rejects.toThrow()
    })
  })
})
