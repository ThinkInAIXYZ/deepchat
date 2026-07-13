import { describe, expect, it, vi } from 'vitest'
import { DeepChatLoopEngine } from '@/agent/deepchat/loop/deepChatLoopEngine'
import { createLoopRun } from '@/agent/deepchat/loop/loopRun'
import { toAppSessionId } from '@/agent/shared/agentSessionIds'

function createRun() {
  return createLoopRun({
    runId: 'run-1',
    sessionId: toAppSessionId('session-1'),
    messageId: 'message-1',
    abortController: new AbortController(),
    messages: [{ role: 'user', content: 'Hello' }],
    streamState: {},
    resources: { toolDefinitions: [], activeSkillNames: [] }
  })
}

function createCommitCallbacks(order?: string[]) {
  return {
    updateOutput: ({ providerRound, outcome }: { providerRound: number; outcome: string }) => {
      order?.push(`output:${providerRound}:${outcome}`)
    },
    afterRoundPersisted: ({
      providerRound,
      outcome
    }: {
      providerRound: number
      outcome: string
    }) => {
      order?.push(`persisted:${providerRound}:${outcome}`)
    },
    settleTurn: ({ outcome }: { outcome: unknown }) => {
      order?.push('settled')
      return outcome
    }
  }
}

describe('DeepChatLoopEngine', () => {
  it('settles a simple provider round without executing tools', async () => {
    const run = createRun()
    const consumeProviderRound = vi.fn(async () => ({ type: 'terminal' as const }))
    const executeToolBatch = vi.fn(async () => ({
      type: 'continue' as const,
      executedToolCount: 0
    }))

    const outcome = await new DeepChatLoopEngine().run(
      run,
      {
        consumeProviderRound,
        executeToolBatch
      },
      createCommitCallbacks()
    )

    expect(outcome).toEqual({ type: 'terminal' })
    expect(run.providerRoundCount).toBe(1)
    expect(consumeProviderRound).toHaveBeenCalledTimes(1)
    expect(executeToolBatch).not.toHaveBeenCalled()
  })

  it('owns provider and tool-batch alternation across multiple rounds', async () => {
    const run = createRun()
    const order: string[] = []

    const outcome = await new DeepChatLoopEngine().run<object, { id: number }, never, unknown>(
      run,
      {
        consumeProviderRound: async ({ providerRound }) => {
          order.push(`provider:${providerRound}`)
          return providerRound < 3
            ? {
                type: 'tool_batch',
                batch: { id: providerRound },
                toolCallCount: 1
              }
            : { type: 'terminal' }
        },
        executeToolBatch: async ({ batch }) => {
          order.push(`tools:${batch.id}`)
          return { type: 'continue', executedToolCount: 1 }
        }
      },
      createCommitCallbacks(order)
    )

    expect(outcome).toEqual({ type: 'terminal' })
    expect(order).toEqual([
      'provider:1',
      'output:1:tool_batch',
      'tools:1',
      'persisted:1:continue',
      'provider:2',
      'output:2:tool_batch',
      'tools:2',
      'persisted:2:continue',
      'provider:3',
      'output:3:terminal',
      'settled'
    ])
    expect(run.providerRoundCount).toBe(3)
  })

  it('stops before consuming a provider round beyond the configured limit', async () => {
    const run = createRun()
    const consumeProviderRound = vi.fn(async ({ providerRound }: { providerRound: number }) => ({
      type: 'tool_batch' as const,
      batch: providerRound,
      toolCallCount: 1
    }))
    const executeToolBatch = vi.fn(async () => ({
      type: 'continue' as const,
      executedToolCount: 1
    }))

    const outcome = await new DeepChatLoopEngine().run(
      run,
      {
        maxProviderRounds: 2,
        consumeProviderRound,
        executeToolBatch
      },
      createCommitCallbacks()
    )

    expect(outcome).toEqual({ type: 'max_provider_rounds', limit: 2 })
    expect(run.providerRoundCount).toBe(3)
    expect(consumeProviderRound).toHaveBeenCalledTimes(2)
    expect(executeToolBatch).toHaveBeenCalledTimes(2)
  })

  it('stops before a tool batch would exceed the global tool-call limit', async () => {
    const run = createRun()
    const executeToolBatch = vi.fn(async () => ({
      type: 'continue' as const,
      executedToolCount: 129
    }))

    const outcome = await new DeepChatLoopEngine().run(
      run,
      {
        consumeProviderRound: async () => ({
          type: 'tool_batch' as const,
          batch: 'oversized',
          toolCallCount: 129
        }),
        executeToolBatch
      },
      createCommitCallbacks()
    )

    expect(outcome).toEqual({
      type: 'max_tool_calls',
      attemptedToolCount: 129,
      limit: 128
    })
    expect(executeToolBatch).not.toHaveBeenCalled()
  })

  it('includes previously executed tools when enforcing the global tool-call limit', async () => {
    const run = createRun()
    const executeToolBatch = vi.fn(async () => ({
      type: 'continue' as const,
      executedToolCount: 1
    }))

    const outcome = await new DeepChatLoopEngine().run(
      run,
      {
        initialExecutedToolCount: 128,
        consumeProviderRound: async () => ({
          type: 'tool_batch' as const,
          batch: 'resumed-overflow',
          toolCallCount: 1
        }),
        executeToolBatch
      },
      createCommitCallbacks()
    )

    expect(outcome).toEqual({
      type: 'max_tool_calls',
      attemptedToolCount: 129,
      limit: 128
    })
    expect(executeToolBatch).not.toHaveBeenCalled()
  })

  it('propagates a paused tool batch without entering another provider round', async () => {
    const run = createRun()
    const order: string[] = []
    const consumeProviderRound = vi.fn(async () => ({
      type: 'tool_batch' as const,
      batch: 'permission',
      toolCallCount: 1
    }))

    const outcome = await new DeepChatLoopEngine().run(
      run,
      {
        consumeProviderRound,
        executeToolBatch: async () => ({
          type: 'halted' as const,
          result: { status: 'paused' as const }
        })
      },
      createCommitCallbacks(order)
    )

    expect(outcome).toEqual({ type: 'halted', result: { status: 'paused' } })
    expect(order).toEqual(['output:1:tool_batch', 'persisted:1:halted', 'settled'])
    expect(run.providerRoundCount).toBe(1)
    expect(consumeProviderRound).toHaveBeenCalledTimes(1)
  })

  it('settles a thrown round error through the same terminal callback', async () => {
    const run = createRun()
    const error = new Error('provider failed')
    const order: string[] = []

    const outcome = await new DeepChatLoopEngine().run(
      run,
      {
        consumeProviderRound: async () => {
          throw error
        },
        executeToolBatch: async () => ({
          type: 'continue' as const,
          executedToolCount: 0
        })
      },
      createCommitCallbacks(order)
    )

    expect(outcome).toEqual({ type: 'thrown', error })
    expect(order).toEqual(['settled'])
  })

  it('invokes the settlement stage exactly once when a normal writer fails', async () => {
    const run = createRun()
    const settlementError = new Error('commit failed')
    const settleTurn = vi.fn(() => {
      throw settlementError
    })

    await expect(
      new DeepChatLoopEngine().run(
        run,
        {
          consumeProviderRound: async () => ({ type: 'terminal' as const }),
          executeToolBatch: async () => ({
            type: 'continue' as const,
            executedToolCount: 0
          })
        },
        {
          updateOutput: vi.fn(),
          afterRoundPersisted: vi.fn(),
          settleTurn
        }
      )
    ).rejects.toBe(settlementError)
    expect(settleTurn).toHaveBeenCalledTimes(1)
  })

  it('does not retry settlement while already handling a thrown round error', async () => {
    const run = createRun()
    const providerError = new Error('provider failed')
    const settlementError = new Error('commit failed')
    const settleTurn = vi.fn(() => {
      throw settlementError
    })

    await expect(
      new DeepChatLoopEngine().run(
        run,
        {
          consumeProviderRound: async () => {
            throw providerError
          },
          executeToolBatch: async () => ({
            type: 'continue' as const,
            executedToolCount: 0
          })
        },
        {
          updateOutput: vi.fn(),
          afterRoundPersisted: vi.fn(),
          settleTurn
        }
      )
    ).rejects.toBe(settlementError)
    expect(settleTurn).toHaveBeenCalledTimes(1)
  })

  it.each(['aborted', 'error'] as const)(
    'propagates a %s provider outcome without executing tools',
    async (status) => {
      const run = createRun()
      const executeToolBatch = vi.fn(async () => ({
        type: 'continue' as const,
        executedToolCount: 0
      }))

      const outcome = await new DeepChatLoopEngine().run(
        run,
        {
          consumeProviderRound: async () => ({
            type: 'halted' as const,
            result: { status }
          }),
          executeToolBatch
        },
        createCommitCallbacks()
      )

      expect(outcome).toEqual({ type: 'halted', result: { status } })
      expect(executeToolBatch).not.toHaveBeenCalled()
    }
  )

  it('observes resource refresh completed by the tool adapter before the next round', async () => {
    const run = createRun()
    const observedSkills: string[][] = []

    const outcome = await new DeepChatLoopEngine().run<object, string, never, unknown>(
      run,
      {
        consumeProviderRound: async ({ providerRound, run: currentRun }) => {
          observedSkills.push([...currentRun.resources.activeSkillNames])
          return providerRound === 1
            ? { type: 'tool_batch', batch: 'skill_view', toolCallCount: 1 }
            : { type: 'terminal' }
        },
        executeToolBatch: async ({ run: currentRun }) => {
          currentRun.resources.activeSkillNames = ['deepchat-settings']
          return { type: 'continue', executedToolCount: 1 }
        }
      },
      createCommitCallbacks()
    )

    expect(outcome).toEqual({ type: 'terminal' })
    expect(observedSkills).toEqual([[], ['deepchat-settings']])
  })
})
