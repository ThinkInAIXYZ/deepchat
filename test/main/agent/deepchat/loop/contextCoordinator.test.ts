import { describe, expect, it, vi } from 'vitest'
import { DeepChatContextCoordinator } from '@/agent/deepchat/loop/contextCoordinator'
import { createLoopRun } from '@/agent/deepchat/loop/loopRun'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { ModelConfig } from '@shared/presenter'

function createRun(messages: ChatMessage[] = [{ role: 'user', content: 'hello' }]) {
  return createLoopRun({
    runId: 'run-1',
    sessionId: toAppSessionId('session-1'),
    messageId: 'message-1',
    abortController: new AbortController(),
    messages,
    streamState: {},
    resources: { toolDefinitions: [], activeSkillNames: [] }
  })
}

function createPreflight(
  messages: ChatMessage[],
  overrides: Partial<{
    fitsWithinContext: boolean
    requiresContextPressureRecovery: boolean
    requestedMaxTokens: number
    effectiveMaxTokens: number
  }> = {}
) {
  return {
    messages,
    inputTokens: 10,
    toolReserveTokens: 0,
    requestedMaxTokens: overrides.requestedMaxTokens ?? 100,
    effectiveMaxTokens: overrides.effectiveMaxTokens ?? 100,
    usableContextLength: 1_000,
    remainingOutputTokens: 990,
    totalRequestTokens: 110,
    fitsWithinContext: overrides.fitsWithinContext ?? true,
    shrunkByContextPressure: overrides.requiresContextPressureRecovery ?? false,
    requiresContextPressureRecovery: overrides.requiresContextPressureRecovery ?? false
  }
}

async function collect(stream: AsyncGenerator<LLMCoreStreamEvent>) {
  const events: LLMCoreStreamEvent[] = []
  for await (const event of stream) {
    events.push(event)
  }
  return events
}

function createAttemptInput(options?: {
  providerEvents?: LLMCoreStreamEvent[][]
  appendManifest?: (manifest: any) => void
  viewContext?: false
}) {
  const run = createRun()
  const order: string[] = []
  const manifests: any[] = []
  const providerRequests: any[] = []
  const manifestErrors: unknown[] = []
  const providerEvents = options?.providerEvents ?? [[{ type: 'text', content: 'ok' }]]
  let providerAttempt = 0
  let waiting = false
  const actualRateClears: string[] = []

  return {
    run,
    order,
    manifests,
    providerRequests,
    manifestErrors,
    actualRateClears,
    input: {
      run,
      requestMessages: run.messages,
      modelId: 'model-1',
      modelConfig: { contextLength: 1_000 } as ModelConfig,
      temperature: 0.4,
      maxTokens: 100,
      tools: [],
      bypassContextBudget: false,
      fallbackContextLength: 1_000,
      supportsVision: true,
      supportsAudioInput: true,
      traceDebugEnabled: true,
      viewContext:
        options?.viewContext === false
          ? undefined
          : {
              taskType: 'chat' as const,
              policy: 'legacy_context_v1' as const,
              policyVersion: 1,
              selection: { id: 'initial-selection' },
              summaryCursorOrderSeq: 3,
              supportsVision: false,
              supportsAudioInput: false,
              traceDebugEnabled: false
            },
      budget: {
        estimateToolReserveTokens: () => 0,
        preflight: ({
          messages,
          requestedMaxTokens
        }: {
          messages: ChatMessage[]
          requestedMaxTokens: number
        }) =>
          createPreflight(messages, {
            requestedMaxTokens,
            effectiveMaxTokens: requestedMaxTokens
          }),
        fitStrictRetry: ({ messages }: { messages: ChatMessage[] }) => messages,
        getStrictRetryMaxTokens: (maxTokens: number) => Math.floor(maxTokens / 2),
        getStrictRetryExtraReserve: () => 25,
        buildOverflowError: () => new Error('cannot fit'),
        buildOverflowAfterRecoveryError: () => new Error('provider still overflowed')
      },
      recovery: {
        recover: vi.fn(async ({ requestMessages }: { requestMessages: ChatMessage[] }) => ({
          messages: requestMessages
        }))
      },
      manifest: {
        resolvePolicy: ({ recoveredFromContextPressure, viewPolicy, viewPolicyVersion }: any) => ({
          policy: recoveredFromContextPressure
            ? ('context_pressure_recovery_shadow' as const)
            : (viewPolicy ?? ('tool_loop_shadow' as const)),
          policyVersion: viewPolicyVersion ?? null
        }),
        append: (manifest: any) => {
          order.push(`manifest:${manifest.requestSeq}`)
          manifests.push(structuredClone(manifest))
          options?.appendManifest?.(manifest)
        },
        onAppendError: (error: unknown) => manifestErrors.push(error)
      },
      rateGate: {
        beforeWait: () => order.push('before-rate'),
        wait: async () => {
          waiting = true
          order.push('rate')
        },
        clearWaiting: () => {
          if (!waiting) return
          waiting = false
          actualRateClears.push('clear')
          order.push('rate-clear')
        }
      },
      provider: {
        stream: async function* (request: any) {
          order.push('provider')
          providerRequests.push(structuredClone(request))
          for (const event of providerEvents[providerAttempt++] ?? []) {
            yield event
          }
        },
        beforeStream: () => order.push('before-provider')
      },
      isContextOverflowEvent: (event: LLMCoreStreamEvent) =>
        event.type === 'error' && event.error_message === 'context overflow',
      isContextOverflowError: (error: unknown) =>
        error instanceof Error && error.message === 'context overflow',
      createAbortError: () => Object.assign(new Error('aborted'), { name: 'AbortError' })
    }
  }
}

describe('DeepChatContextCoordinator', () => {
  it('assembles post-compaction prompt before building the effective view', async () => {
    const order: string[] = []
    const prepared = await new DeepChatContextCoordinator().assemble({
      assemblePostCompactionPrompt: async () => {
        order.push('post')
        return 'system prompt'
      },
      buildView: (systemPrompt) => {
        order.push(`view:${systemPrompt}`)
        return { messages: [{ role: 'system', content: systemPrompt }] }
      },
      assertCurrent: () => order.push('check')
    })

    expect(order).toEqual(['post', 'check', 'view:system prompt'])
    expect(prepared).toEqual({
      systemPrompt: 'system prompt',
      view: { messages: [{ role: 'system', content: 'system prompt' }] }
    })
  })

  it('does not rebuild or fit pressure context when there is no compaction intent', async () => {
    const assemblePostCompactionPrompt = vi.fn()
    const fit = vi.fn()
    const messages: ChatMessage[] = [{ role: 'user', content: 'unchanged' }]

    const recovered = await new DeepChatContextCoordinator().recoverFromPressure({
      requestMessages: messages,
      requestedMaxTokens: 100,
      toolReserveTokens: 20,
      minimumProtectedTailCount: 0,
      prepareCompaction: async () => ({ applied: false as const }),
      assemblePostCompactionPrompt,
      getSummaryCursorOrderSeq: () => 1,
      fit,
      assertCurrent: vi.fn()
    })

    expect(recovered).toEqual({ messages })
    expect(assemblePostCompactionPrompt).not.toHaveBeenCalled()
    expect(fit).not.toHaveBeenCalled()
  })

  it('rebuilds and fits pressure context only after compaction normally returns', async () => {
    const order: string[] = []
    const recovered = await new DeepChatContextCoordinator().recoverFromPressure({
      requestMessages: [
        { role: 'system', content: 'old system' },
        { role: 'user', content: 'latest' }
      ],
      requestedMaxTokens: 100,
      toolReserveTokens: 20,
      minimumProtectedTailCount: 1,
      prepareCompaction: async (systemPrompt) => {
        order.push(`compact:${systemPrompt}`)
        return { applied: true as const, summary: { cursor: 9 } }
      },
      assemblePostCompactionPrompt: async (_summary, systemPrompt) => {
        order.push(`post:${systemPrompt}`)
        return 'new system'
      },
      getSummaryCursorOrderSeq: (summary) => summary.cursor,
      fit: ({ messages, reserveTokens, minimumProtectedTailCount }) => {
        order.push(`fit:${reserveTokens}:${minimumProtectedTailCount}`)
        return messages
      },
      assertCurrent: () => order.push('check')
    })

    expect(order).toEqual([
      'check',
      'compact:old system',
      'check',
      'post:old system',
      'check',
      'fit:120:1'
    ])
    expect(recovered).toEqual({
      messages: [
        { role: 'system', content: 'new system' },
        { role: 'user', content: 'latest' }
      ],
      systemPrompt: 'new system',
      summaryCursorOrderSeq: 9
    })
  })

  it('attempts the ViewManifest before rate admission and sends the exact manifested request', async () => {
    const fixture = createAttemptInput()
    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([{ type: 'text', content: 'ok' }])
    expect(fixture.order).toEqual([
      'manifest:1',
      'before-rate',
      'rate',
      'rate-clear',
      'before-provider',
      'provider'
    ])
    expect(fixture.manifests[0].messages).toEqual(fixture.providerRequests[0].messages)
    expect(fixture.manifests[0]).toMatchObject({
      requestSeq: 1,
      taskType: 'chat',
      policy: 'legacy_context_v1',
      selection: { id: 'initial-selection' },
      supportsVision: false,
      supportsAudioInput: false,
      traceDebugEnabled: false
    })
    expect(fixture.run.requestSeq).toBe(1)
    expect(fixture.actualRateClears).toEqual(['clear'])
  })

  it('uses fallback capabilities without a ViewManifest context', async () => {
    const fixture = createAttemptInput({ viewContext: false })
    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.manifests[0]).toMatchObject({
      requestSeq: 1,
      taskType: 'tool_loop',
      supportsVision: true,
      supportsAudioInput: true,
      traceDebugEnabled: true
    })
    expect(fixture.manifests[0].selection).toBeUndefined()
  })

  it('keeps an actual provider attempt fail-open when ViewManifest persistence throws', async () => {
    const fixture = createAttemptInput({
      appendManifest: () => {
        throw new Error('manifest unavailable')
      }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([{ type: 'text', content: 'ok' }])
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.manifestErrors).toEqual([
      expect.objectContaining({ message: 'manifest unavailable' })
    ])
  })

  it('keeps strict overflow retry in one run while advancing requestSeq per attempt', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [{ type: 'text', content: 'recovered' }]
      ]
    })

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([{ type: 'text', content: 'recovered' }])
    expect(fixture.input.recovery.recover).toHaveBeenCalledOnce()
    expect(fixture.providerRequests).toHaveLength(2)
    expect(fixture.manifests.map((manifest) => manifest.requestSeq)).toEqual([1, 2])
    expect(fixture.run.requestSeq).toBe(2)
    expect(fixture.run.providerRoundCount).toBe(0)
    expect(fixture.run.providerRecovery).toEqual({
      contextOverflowHandoffAttempted: true,
      strictProviderOverflowRetryUsed: true
    })
    expect(fixture.manifests[1].tokenBudget).toMatchObject({
      requestedMaxTokens: 50,
      reserveTokens: 75
    })
  })

  it('checks retry availability before context recovery or another manifest', async () => {
    const fixture = createAttemptInput({
      providerEvents: [[{ type: 'error', error_message: 'context overflow' }]]
    })
    const limitError = new Error('provider attempt limit reached')
    fixture.input.provider.assertAvailable = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw limitError
      })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toBe(limitError)

    expect(fixture.input.provider.assertAvailable).toHaveBeenCalledTimes(2)
    expect(fixture.input.recovery.recover).not.toHaveBeenCalled()
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.manifests).toHaveLength(1)
    expect(fixture.order.filter((entry) => entry === 'rate')).toHaveLength(1)
    expect(fixture.run.requestSeq).toBe(1)
  })

  it('runs pressure recovery before manifesting the provider request', async () => {
    const fixture = createAttemptInput()
    const preflight = vi
      .fn()
      .mockReturnValueOnce(
        createPreflight([{ role: 'user', content: 'pressure' }], {
          requiresContextPressureRecovery: true,
          effectiveMaxTokens: 20
        })
      )
      .mockReturnValueOnce(
        createPreflight([
          { role: 'system', content: 'recovered system' },
          { role: 'user', content: 'pressure' }
        ])
      )
    fixture.input.budget.preflight = preflight
    fixture.input.recovery.recover = vi.fn(async () => ({
      messages: [
        { role: 'system', content: 'recovered system' },
        { role: 'user', content: 'pressure' }
      ],
      systemPrompt: 'recovered system',
      summaryCursorOrderSeq: 9
    }))

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.input.recovery.recover).toHaveBeenCalledOnce()
    expect(fixture.manifests[0]).toMatchObject({
      policy: 'context_pressure_recovery_shadow',
      selection: undefined,
      summaryCursorOrderSeq: 9
    })
    expect(fixture.manifests[0].messages).toEqual(fixture.providerRequests[0].messages)
  })

  it('does not start the provider when cancellation lands after rate admission', async () => {
    const fixture = createAttemptInput()
    fixture.input.rateGate.wait = async () => {
      fixture.run.abortController.abort()
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.manifests).toHaveLength(1)
    expect(fixture.providerRequests).toHaveLength(0)
  })
})
