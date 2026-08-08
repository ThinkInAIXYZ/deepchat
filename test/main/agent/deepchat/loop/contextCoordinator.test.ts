import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepChatContextCoordinator } from '@/agent/deepchat/loop/contextCoordinator'
import { createLoopRun } from '@/agent/deepchat/loop/loopRun'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { ModelConfig } from '@shared/types/provider'
import { POSIX_COMMAND_SHELL } from '../../../../helpers/commandShell'

function createRun(messages: ChatMessage[] = [{ role: 'user', content: 'hello' }]) {
  return createLoopRun({
    runId: 'run-1',
    sessionId: toAppSessionId('session-1'),
    messageId: 'message-1',
    abortController: new AbortController(),
    messages,
    streamState: {},
    resources: { toolDefinitions: [], activeSkillNames: [], commandShell: POSIX_COMMAND_SHELL },
    initialLogicalRound: 1
  })
}

function expectedAttemptOutcome(overrides: Record<string, unknown> = {}) {
  return {
    logicalRound: 1,
    requestSeq: 1,
    physicalAttempt: 1,
    requestOrigin: 'chat',
    attemptOrigin: 'initial',
    status: 'completed',
    stopReason: 'complete',
    failureClassification: null,
    retryDecision: 'none',
    httpStatus: null,
    errorCode: null,
    retryDelayMs: null,
    usage: null,
    ...overrides
  }
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
  providerAttempts?: Array<{ events?: LLMCoreStreamEvent[]; error?: unknown }>
  appendManifest?: (manifest: any) => void
  viewContext?: false
}) {
  const run = createRun()
  const order: string[] = []
  const manifests: any[] = []
  const providerRequests: any[] = []
  const manifestErrors: unknown[] = []
  const outcomes: any[] = []
  const outcomeErrors: unknown[] = []
  const providerAttempts =
    options?.providerAttempts ??
    (
      options?.providerEvents ?? [
        [
          { type: 'text', content: 'ok' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    ).map((events) => ({ events }))
  let providerAttempt = 0
  let waiting = false
  const actualRateClears: string[] = []

  return {
    run,
    order,
    manifests,
    providerRequests,
    manifestErrors,
    outcomes,
    outcomeErrors,
    actualRateClears,
    input: {
      run,
      requestMessages: run.messages,
      modelId: 'model-1',
      modelConfig: { contextLength: 1_000 } as ModelConfig,
      temperature: 0.4,
      maxTokens: 100,
      tools: [],
      allowTransientRetry: true,
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
          const { signal, ...serializableRequest } = request
          providerRequests.push({ ...structuredClone(serializableRequest), signal })
          const attempt = providerAttempts[providerAttempt++] ?? { events: [] }
          for (const event of attempt.events ?? []) {
            yield event
          }
          if ('error' in attempt) {
            throw attempt.error
          }
        },
        beforeStream: () => order.push('before-provider')
      },
      outcome: {
        append: (outcome: any) => {
          order.push(`outcome:${outcome.requestSeq}`)
          outcomes.push(structuredClone(outcome))
        },
        onAppendError: (error: unknown) => outcomeErrors.push(error)
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
  afterEach(() => {
    vi.useRealTimers()
  })

  it('assembles post-compaction prompt before building the effective view', async () => {
    const order: string[] = []
    const prepared = await new DeepChatContextCoordinator().assemble({
      assembleContributions: async () => {
        order.push('post')
        return { checkpoint: 'checkpoint' }
      },
      buildView: (contributions) => {
        order.push(`view:${contributions.checkpoint}`)
        return { messages: [{ role: 'user', content: contributions.checkpoint }] }
      },
      assertCurrent: () => order.push('check')
    })

    expect(order).toEqual(['post', 'check', 'view:checkpoint'])
    expect(prepared).toEqual({
      contributions: { checkpoint: 'checkpoint' },
      view: { messages: [{ role: 'user', content: 'checkpoint' }] }
    })
  })

  it('does not rebuild or fit pressure context when there is no compaction intent', async () => {
    const assembleCheckpoint = vi.fn()
    const fit = vi.fn()
    const messages: ChatMessage[] = [{ role: 'user', content: 'unchanged' }]

    const recovered = await new DeepChatContextCoordinator().recoverFromPressure({
      requestMessages: messages,
      requestedMaxTokens: 100,
      toolReserveTokens: 20,
      minimumProtectedTailCount: 0,
      contextContributions: {
        checkpoint: { message: null, contributions: [] },
        memory: { content: null, manifest: null, anchorEntryId: null },
        directives: { content: null, manifest: null, anchorEntryId: null },
        memoryIncluded: false,
        directivesIncluded: false
      },
      prepareCompaction: async () => ({ applied: false as const }),
      assembleCheckpoint,
      getSummaryCursorOrderSeq: () => 1,
      fit,
      assertCurrent: vi.fn()
    })

    expect(recovered).toEqual({ messages })
    expect(assembleCheckpoint).not.toHaveBeenCalled()
    expect(fit).not.toHaveBeenCalled()
  })

  it('rebuilds and fits pressure context only after compaction normally returns', async () => {
    const order: string[] = []
    const oldCheckpoint = { role: 'user' as const, content: 'old checkpoint' }
    const contextContributions = {
      checkpoint: { message: oldCheckpoint, contributions: [] },
      memory: { content: null, manifest: null, anchorEntryId: null },
      directives: { content: null, manifest: null, anchorEntryId: null },
      memoryIncluded: false,
      directivesIncluded: false
    }
    const recovered = await new DeepChatContextCoordinator().recoverFromPressure({
      requestMessages: [
        { role: 'system', content: 'old system' },
        oldCheckpoint,
        { role: 'user', content: 'latest' }
      ],
      requestedMaxTokens: 100,
      toolReserveTokens: 20,
      minimumProtectedTailCount: 1,
      contextContributions,
      prepareCompaction: async (systemPrompt) => {
        order.push(`compact:${systemPrompt}`)
        return { applied: true as const, summary: { cursor: 9 } }
      },
      assembleCheckpoint: async () => {
        order.push('checkpoint')
        return {
          message: { role: 'user', content: 'new checkpoint' },
          contributions: []
        }
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
      'checkpoint',
      'check',
      'fit:120:1'
    ])
    expect(recovered).toEqual({
      messages: [
        { role: 'system', content: 'old system' },
        { role: 'user', content: 'new checkpoint' },
        { role: 'user', content: 'latest' }
      ],
      summaryCursorOrderSeq: 9,
      syntheticContributions: []
    })
  })

  it('attempts the ViewManifest before rate admission and sends the exact manifested request', async () => {
    const fixture = createAttemptInput()
    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      { type: 'text', content: 'ok' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.order).toEqual([
      'manifest:1',
      'before-rate',
      'rate',
      'rate-clear',
      'before-provider',
      'provider',
      'outcome:1'
    ])
    expect(fixture.manifests[0].messages).toEqual(fixture.providerRequests[0].messages)
    expect(fixture.providerRequests[0]).toMatchObject({
      identity: { logicalRound: 1, requestSeq: 1, physicalAttempt: 1 },
      requestOrigin: 'chat',
      attemptOrigin: 'initial',
      signal: fixture.run.abortController.signal
    })
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
    const fixture = createAttemptInput({
      viewContext: false,
      providerEvents: [
        [
          { type: 'text', content: 'ok' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.manifests[0]).toMatchObject({
      requestSeq: 1,
      taskType: 'tool_loop',
      supportsVision: true,
      supportsAudioInput: true,
      traceDebugEnabled: true
    })
    expect(fixture.manifests[0].selection).toBeUndefined()
    expect(fixture.outcomes).toEqual([expectedAttemptOutcome({ requestOrigin: 'tool_loop' })])
  })

  it('records only the final cumulative usage snapshot for a completed attempt', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: 100,
              completion_tokens: 10,
              total_tokens: 110,
              cached_tokens: 40
            }
          },
          {
            type: 'usage',
            usage: {
              prompt_tokens: 140,
              completion_tokens: 20,
              total_tokens: 160,
              cached_tokens: 120,
              cache_write_tokens: 8
            }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        usage: {
          inputTokens: 140,
          outputTokens: 20,
          totalTokens: 160,
          cacheReadTokens: 120,
          cacheWriteTokens: 8
        }
      })
    ])
  })

  it('keeps an actual provider attempt fail-open when ViewManifest persistence throws', async () => {
    const fixture = createAttemptInput({
      appendManifest: () => {
        throw new Error('manifest unavailable')
      }
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'ok' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.manifestErrors).toEqual([
      expect.objectContaining({ message: 'manifest unavailable' })
    ])
  })

  it('keeps generation fail-open when provider outcome persistence throws', async () => {
    const fixture = createAttemptInput()
    const persistenceError = new Error('outcome unavailable')
    fixture.input.outcome.append = () => {
      throw persistenceError
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'ok' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.outcomeErrors).toEqual([persistenceError])
  })

  it('keeps strict overflow recovery in one round while advancing requestSeq per request', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [{ type: 'error', error_message: 'context overflow' }],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.input.recovery.recover).toHaveBeenCalledOnce()
    expect(fixture.providerRequests).toHaveLength(2)
    expect(fixture.manifests.map((manifest) => manifest.requestSeq)).toEqual([1, 2])
    expect(fixture.run.requestSeq).toBe(2)
    expect(fixture.run.logicalRound).toBe(1)
    expect(fixture.run.physicalAttempt).toBe(1)
    expect(fixture.run.providerRecovery).toEqual({
      contextOverflowHandoffAttempted: true,
      strictProviderOverflowRetryUsed: true
    })
    expect(fixture.manifests[1].tokenBudget).toMatchObject({
      requestedMaxTokens: 50,
      reserveTokens: 75
    })
    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'context_overflow',
        stopReason: 'error',
        failureClassification: 'context_overflow',
        retryDecision: 'context_recovery_scheduled'
      }),
      expectedAttemptOutcome({
        requestSeq: 2,
        requestOrigin: 'context_recovery'
      })
    ])
    expect(fixture.providerRequests.map((request) => request.identity)).toEqual([
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 1 },
      { logicalRound: 1, requestSeq: 2, physicalAttempt: 1 }
    ])
    expect(fixture.order.indexOf('outcome:1')).toBeLessThan(fixture.order.indexOf('manifest:2'))
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
    expect(fixture.outcomes).toHaveLength(0)
  })

  it('records abort and error attempts without inventing usage', async () => {
    const aborted = createAttemptInput()
    aborted.input.provider.stream = async function* () {
      aborted.run.abortController.abort()
      throw Object.assign(new Error('canceled'), { name: 'AbortError' })
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(aborted.input))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(aborted.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'aborted',
        stopReason: null,
        failureClassification: 'aborted',
        retryDecision: 'not_retryable'
      })
    ])

    const failed = createAttemptInput()
    failed.input.provider.stream = async function* () {
      throw new Error('provider unavailable')
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(failed.input))
    ).rejects.toThrow('provider unavailable')
    expect(failed.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'error',
        stopReason: null,
        failureClassification: 'unknown',
        retryDecision: 'not_retryable'
      })
    ])
  })

  it('keeps usage returned before a provider error terminal event', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: 80,
              completion_tokens: 5,
              total_tokens: 85,
              cached_tokens: 60
            }
          },
          { type: 'error', error_message: 'provider failed' },
          { type: 'stop', stop_reason: 'error' }
        ]
      ]
    })

    await collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))

    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'error',
        stopReason: 'error',
        failureClassification: 'unknown',
        retryDecision: 'not_retryable',
        usage: {
          inputTokens: 80,
          outputTokens: 5,
          totalTokens: 85,
          cacheReadTokens: 60
        }
      })
    ])
  })

  it('retries a transient throw against the same manifested request', async () => {
    const transientError = Object.assign(new Error('fetch failed'), {
      code: 'ECONNRESET',
      headers: { 'retry-after-ms': '0' }
    })
    const fixture = createAttemptInput({
      providerAttempts: [
        { error: transientError },
        {
          events: [
            { type: 'text', content: 'recovered' },
            { type: 'stop', stop_reason: 'complete' }
          ]
        }
      ]
    })

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.manifests).toHaveLength(1)
    expect(fixture.providerRequests.map((request) => request.identity)).toEqual([
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 1 },
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 2 }
    ])
    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'error',
        stopReason: null,
        failureClassification: 'transient',
        retryDecision: 'retry_scheduled',
        errorCode: 'ECONNRESET',
        retryDelayMs: 0
      }),
      expectedAttemptOutcome({ physicalAttempt: 2, attemptOrigin: 'transient_retry' })
    ])
  })

  it('buffers retryable error controls until the retry decision is final', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'error',
            error_message: 'temporarily unavailable',
            failure: {
              statusCode: 503,
              retryHeaders: { 'retry-after-ms': '0' }
            }
          },
          { type: 'stop', stop_reason: 'error' }
        ],
        [
          { type: 'text', content: 'ok after retry' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    fixture.input.retryObserver = (event) => fixture.order.push(`retry:${event.type}`)

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      { type: 'text', content: 'ok after retry' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.outcomes[0]).toEqual(
      expectedAttemptOutcome({
        status: 'error',
        stopReason: 'error',
        failureClassification: 'transient',
        retryDecision: 'retry_scheduled',
        httpStatus: 503,
        retryDelayMs: 0
      })
    )
    expect(fixture.order).toEqual([
      'manifest:1',
      'before-rate',
      'rate',
      'rate-clear',
      'before-provider',
      'provider',
      'outcome:1',
      'retry:retry_scheduled',
      'before-rate',
      'rate',
      'rate-clear',
      'before-provider',
      'retry:retry_started',
      'provider',
      'outcome:1',
      'retry:retry_finished'
    ])
  })

  it('retries a premature EOF before output and surfaces it after partial output', async () => {
    vi.useFakeTimers()
    const retryable = createAttemptInput({
      providerEvents: [
        [],
        [
          { type: 'text', content: 'recovered' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    const retryPromise = collect(
      new DeepChatContextCoordinator().streamProviderAttempts(retryable.input)
    )
    await vi.runAllTimersAsync()

    await expect(retryPromise).resolves.toEqual([
      { type: 'text', content: 'recovered' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(retryable.providerRequests).toHaveLength(2)
    expect(retryable.outcomes[0]).toMatchObject({
      status: 'error',
      failureClassification: 'transient',
      retryDecision: 'retry_scheduled',
      errorCode: 'premature_eof'
    })

    const partial = createAttemptInput({
      providerEvents: [[{ type: 'text', content: 'partial' }]]
    })
    const partialEvents = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(partial.input)
    )

    expect(partialEvents).toEqual([
      { type: 'text', content: 'partial' },
      {
        type: 'error',
        error_message: 'Provider stream ended without a terminal stop event.',
        failure: { code: 'premature_eof', retryable: true }
      }
    ])
    expect(partial.providerRequests).toHaveLength(1)
    expect(partial.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'error',
        stopReason: 'error',
        failureClassification: 'transient',
        retryDecision: 'output_committed',
        errorCode: 'premature_eof'
      })
    ])
  })

  it.each([
    ['text', { type: 'text', content: 'partial' }],
    ['reasoning', { type: 'reasoning', reasoning_content: 'thinking' }],
    [
      'tool start',
      { type: 'tool_call_start', tool_call_id: 'call-1', tool_call_name: 'read_file' }
    ],
    [
      'tool chunk',
      { type: 'tool_call_chunk', tool_call_id: 'call-1', tool_call_arguments_chunk: '{' }
    ],
    [
      'tool end',
      { type: 'tool_call_end', tool_call_id: 'call-1', tool_call_arguments_complete: '{}' }
    ],
    [
      'permission',
      {
        type: 'permission',
        permission: { providerId: 'acp', requestId: 'request-1', tool_call_id: 'call-1' }
      }
    ],
    ['image', { type: 'image_data', image_data: { data: 'image', mimeType: 'image/png' } }],
    [
      'rate limit',
      {
        type: 'rate_limit',
        rate_limit: { providerId: 'provider-1', qpsLimit: 1, currentQps: 1, queueLength: 1 }
      }
    ],
    ['plan', { type: 'plan', plan: [] }]
  ] satisfies Array<[string, LLMCoreStreamEvent]>)(
    'does not replay after committed %s output',
    async (_name, semanticEvent) => {
      const terminalError: LLMCoreStreamEvent = {
        type: 'error',
        error_message: 'temporarily unavailable',
        failure: {
          statusCode: 503,
          retryHeaders: { 'retry-after-ms': '0' }
        }
      }
      const fixture = createAttemptInput({
        providerEvents: [[semanticEvent, terminalError, { type: 'stop', stop_reason: 'error' }]]
      })

      const events = await collect(
        new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
      )

      expect(events).toEqual([semanticEvent, terminalError, { type: 'stop', stop_reason: 'error' }])
      expect(fixture.providerRequests).toHaveLength(1)
      expect(fixture.outcomes[0]).toMatchObject({
        failureClassification: 'transient',
        retryDecision: 'output_committed'
      })
    }
  )

  it('preserves partial output without replay when the provider throws', async () => {
    const transientError = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    const fixture = createAttemptInput({
      providerAttempts: [
        {
          events: [{ type: 'text', content: 'partial' }],
          error: transientError
        }
      ]
    })
    const projected: LLMCoreStreamEvent[] = []

    const consume = async () => {
      for await (const event of new DeepChatContextCoordinator().streamProviderAttempts(
        fixture.input
      )) {
        projected.push(event)
      }
    }

    await expect(consume()).rejects.toBe(transientError)
    expect(projected).toEqual([{ type: 'text', content: 'partial' }])
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.outcomes[0]).toMatchObject({
      status: 'error',
      failureClassification: 'transient',
      retryDecision: 'output_committed'
    })
  })

  it('caps transient replay at two retries per logical round', async () => {
    const retryableFailure: LLMCoreStreamEvent[] = [
      {
        type: 'error',
        error_message: 'overloaded',
        failure: {
          statusCode: 503,
          retryHeaders: { 'retry-after-ms': '0' }
        }
      },
      { type: 'stop', stop_reason: 'error' }
    ]
    const fixture = createAttemptInput({
      providerEvents: [retryableFailure, retryableFailure, retryableFailure]
    })

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(fixture.providerRequests.map((request) => request.identity.physicalAttempt)).toEqual([
      1, 2, 3
    ])
    expect(fixture.manifests).toHaveLength(1)
    expect(fixture.outcomes.map((outcome) => outcome.retryDecision)).toEqual([
      'retry_scheduled',
      'retry_scheduled',
      'retry_budget_exhausted'
    ])
    expect(events).toEqual(retryableFailure)
  })

  it('shares retry budget across context recovery while resetting physical identity', async () => {
    const lifecycle: any[] = []
    const transientFailure: LLMCoreStreamEvent[] = [
      {
        type: 'error',
        error_message: 'overloaded',
        failure: {
          statusCode: 503,
          retryHeaders: { 'retry-after-ms': '0' }
        }
      },
      { type: 'stop', stop_reason: 'error' }
    ]
    const fixture = createAttemptInput({
      providerEvents: [
        transientFailure,
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 }
          },
          { type: 'error', error_message: 'context overflow' }
        ],
        transientFailure,
        transientFailure
      ]
    })
    fixture.input.retryObserver = (event) => lifecycle.push(structuredClone(event))

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      {
        type: 'usage',
        usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 }
      },
      ...transientFailure
    ])
    expect(fixture.manifests.map((manifest) => manifest.requestSeq)).toEqual([1, 2])
    expect(fixture.providerRequests.map((request) => request.identity)).toEqual([
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 1 },
      { logicalRound: 1, requestSeq: 1, physicalAttempt: 2 },
      { logicalRound: 1, requestSeq: 2, physicalAttempt: 1 },
      { logicalRound: 1, requestSeq: 2, physicalAttempt: 2 }
    ])
    expect(fixture.order.filter((entry) => entry === 'rate')).toHaveLength(4)
    expect(fixture.outcomes.map((outcome) => outcome.retryDecision)).toEqual([
      'retry_scheduled',
      'context_recovery_scheduled',
      'retry_scheduled',
      'retry_budget_exhausted'
    ])
    expect(lifecycle.map((event) => [event.type, event.retryNumber])).toEqual([
      ['retry_scheduled', 1],
      ['retry_started', 1],
      ['retry_finished', 1],
      ['retry_scheduled', 2],
      ['retry_started', 2],
      ['retry_finished', 2]
    ])
  })

  it('refuses Retry-After above the cap without sending another request', async () => {
    const failure: LLMCoreStreamEvent[] = [
      {
        type: 'error',
        error_message: 'rate limited',
        failure: {
          statusCode: 429,
          retryHeaders: { 'retry-after': '61' }
        }
      },
      { type: 'stop', stop_reason: 'error' }
    ]
    const fixture = createAttemptInput({ providerEvents: [failure] })

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual(failure)
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'error',
        stopReason: 'error',
        failureClassification: 'transient',
        retryDecision: 'retry_after_exceeds_limit',
        httpStatus: 429
      })
    ])
  })

  it('does not replay provider modes without an idempotent chat contract', async () => {
    const failure: LLMCoreStreamEvent[] = [
      {
        type: 'error',
        error_message: 'temporarily unavailable',
        failure: {
          statusCode: 503,
          retryHeaders: { 'retry-after-ms': '0' }
        }
      },
      { type: 'stop', stop_reason: 'error' }
    ]
    const fixture = createAttemptInput({ providerEvents: [failure] })
    fixture.input.allowTransientRetry = false

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual(failure)
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.outcomes[0]).toMatchObject({
      failureClassification: 'transient',
      retryDecision: 'not_retryable',
      retryDelayMs: null
    })
  })

  it('cancels scheduled backoff and still projects consumed usage', async () => {
    const usageEvent: LLMCoreStreamEvent = {
      type: 'usage',
      usage: {
        prompt_tokens: 9,
        completion_tokens: 1,
        total_tokens: 10
      }
    }
    const fixture = createAttemptInput({
      providerEvents: [
        [
          usageEvent,
          {
            type: 'error',
            error_message: 'temporarily unavailable',
            failure: { statusCode: 503 }
          }
        ]
      ]
    })
    fixture.input.retryObserver = (event) => {
      if (event.type === 'retry_scheduled') {
        fixture.run.abortController.abort(new DOMException('stopped', 'AbortError'))
      }
    }
    const projected: LLMCoreStreamEvent[] = []

    const consume = async () => {
      for await (const event of new DeepChatContextCoordinator().streamProviderAttempts(
        fixture.input
      )) {
        projected.push(event)
      }
    }

    await expect(consume()).rejects.toMatchObject({ name: 'AbortError' })
    expect(projected).toEqual([usageEvent])
    expect(fixture.providerRequests).toHaveLength(1)
    expect(fixture.outcomes[0]).toMatchObject({
      failureClassification: 'transient',
      retryDecision: 'retry_scheduled'
    })
  })

  it('settles an attempt as aborted when a provider ignores cancellation and stops cleanly', async () => {
    const fixture = createAttemptInput({
      providerEvents: [[{ type: 'stop', stop_reason: 'complete' }]]
    })
    const stream = fixture.input.provider.stream
    fixture.input.provider.stream = async function* (request) {
      fixture.run.abortController.abort()
      yield* stream(request)
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'aborted',
        stopReason: null,
        failureClassification: 'aborted',
        retryDecision: 'not_retryable'
      })
    ])
  })

  it('settles an active attempt when cancellation closes the stream at semantic output', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 }
          },
          { type: 'text', content: 'partial' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    const stream = new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)

    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { type: 'text', content: 'partial' }
    })
    fixture.run.abortController.abort(new DOMException('stopped', 'AbortError'))
    await stream.return(undefined)

    expect(fixture.outcomes).toEqual([
      expectedAttemptOutcome({
        status: 'aborted',
        stopReason: null,
        failureClassification: 'aborted',
        retryDecision: 'output_committed',
        usage: {
          inputTokens: 8,
          outputTokens: 1,
          totalTokens: 9
        }
      })
    ])
  })

  it('aggregates final usage snapshots across physical attempts exactly once', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: 10,
              completion_tokens: 2,
              total_tokens: 12,
              cached_tokens: 4
            }
          },
          {
            type: 'error',
            error_message: 'temporarily unavailable',
            failure: {
              statusCode: 503,
              retryHeaders: { 'retry-after-ms': '0' }
            }
          }
        ],
        [
          { type: 'text', content: 'done' },
          {
            type: 'usage',
            usage: {
              prompt_tokens: 7,
              completion_tokens: 3,
              total_tokens: 10,
              cached_tokens: 1,
              cache_write_tokens: 2
            }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })

    const events = await collect(
      new DeepChatContextCoordinator().streamProviderAttempts(fixture.input)
    )

    expect(events).toEqual([
      { type: 'text', content: 'done' },
      {
        type: 'usage',
        usage: {
          prompt_tokens: 17,
          completion_tokens: 5,
          total_tokens: 22,
          cached_tokens: 5,
          cache_write_tokens: 2
        }
      },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.outcomes.map((outcome) => outcome.usage)).toEqual([
      {
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        cacheReadTokens: 4
      },
      {
        inputTokens: 7,
        outputTokens: 3,
        totalTokens: 10,
        cacheReadTokens: 1,
        cacheWriteTokens: 2
      }
    ])
  })

  it('rejects unsafe usage aggregation instead of corrupting message accounting', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'usage',
            usage: {
              prompt_tokens: Number.MAX_SAFE_INTEGER,
              completion_tokens: 0,
              total_tokens: Number.MAX_SAFE_INTEGER
            }
          },
          {
            type: 'error',
            error_message: 'temporarily unavailable',
            failure: {
              statusCode: 503,
              retryHeaders: { 'retry-after-ms': '0' }
            }
          }
        ],
        [
          {
            type: 'usage',
            usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 }
          },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).rejects.toThrow('Provider usage prompt_tokens exceeds the safe integer range.')
    expect(fixture.outcomes).toHaveLength(2)
  })

  it('isolates retry observer failures from provider execution', async () => {
    const fixture = createAttemptInput({
      providerEvents: [
        [
          {
            type: 'error',
            error_message: 'temporarily unavailable',
            failure: {
              statusCode: 503,
              retryHeaders: { 'retry-after-ms': '0' }
            }
          }
        ],
        [
          { type: 'text', content: 'done' },
          { type: 'stop', stop_reason: 'complete' }
        ]
      ]
    })
    fixture.input.retryObserver = (event) => {
      if (event.type === 'retry_started') {
        Reflect.set(event.attempt, 'physicalAttempt', 99)
      }
      throw new Error('observer unavailable')
    }

    await expect(
      collect(new DeepChatContextCoordinator().streamProviderAttempts(fixture.input))
    ).resolves.toEqual([
      { type: 'text', content: 'done' },
      { type: 'stop', stop_reason: 'complete' }
    ])
    expect(fixture.providerRequests.map((request) => request.identity.physicalAttempt)).toEqual([
      1, 2
    ])
    expect(fixture.outcomes.map((outcome) => outcome.physicalAttempt)).toEqual([1, 2])
  })
})
