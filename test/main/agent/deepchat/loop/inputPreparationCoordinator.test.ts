import { describe, expect, it, vi } from 'vitest'
import { InputPreparationCoordinator } from '@/agent/deepchat/loop/inputPreparationCoordinator'

function createIntent(succeeded: boolean) {
  return { id: succeeded ? 'success' : 'rejected', succeeded }
}

describe('InputPreparationCoordinator', () => {
  it.each([true, false])(
    'keeps projection and user facts before an initial apply returning succeeded=%s',
    async (succeeded) => {
      const order: string[] = []
      const intent = createIntent(succeeded)
      const afterCompactionApplyReturned = vi.fn(() => order.push('memory'))

      const result = await new InputPreparationCoordinator().prepareInitial({
        ensureHistory: () => {
          order.push('history')
          return ['old turn']
        },
        prepareIntent: async (history) => {
          order.push(`intent:${history[0]}`)
          return intent
        },
        createCompactionProjection: () => {
          order.push('projection')
          return 'compaction-message'
        },
        appendUserFact: () => {
          order.push('user')
          return 'user-message'
        },
        beginCompaction: () => order.push('begin'),
        applyCompaction: async (_intent, projection) => {
          order.push(`apply:${projection}:${succeeded}`)
          return { value: succeeded ? 'new summary' : 'old summary' }
        },
        readSummary: () => ({ value: 'unreachable' }),
        afterCompactionApplyReturned,
        checkpoints: {
          assertCurrent: () => order.push('check')
        }
      })

      expect(order).toEqual([
        'check',
        'history',
        'intent:old turn',
        'check',
        'projection',
        'user',
        'begin',
        `apply:compaction-message:${succeeded}`,
        'check',
        'memory'
      ])
      expect(result).toEqual({
        history: ['old turn'],
        intent,
        summary: { value: succeeded ? 'new summary' : 'old summary' },
        userMessageId: 'user-message'
      })
      expect(afterCompactionApplyReturned).toHaveBeenCalledOnce()
    }
  )

  it('appends the user without projection, apply, or Memory trigger when there is no intent', async () => {
    const order: string[] = []
    const applyCompaction = vi.fn()
    const afterCompactionApplyReturned = vi.fn()

    const result = await new InputPreparationCoordinator().prepareInitial({
      ensureHistory: () => ['history'],
      prepareIntent: async () => null,
      createCompactionProjection: () => 'projection',
      appendUserFact: () => {
        order.push('user')
        return 'user-message'
      },
      beginCompaction: vi.fn(),
      applyCompaction,
      readSummary: () => {
        order.push('summary')
        return { value: 'current' }
      },
      afterCompactionApplyReturned,
      checkpoints: { assertCurrent: vi.fn() }
    })

    expect(order).toEqual(['summary', 'user'])
    expect(result.intent).toBeNull()
    expect(result.summary).toEqual({ value: 'current' })
    expect(applyCompaction).not.toHaveBeenCalled()
    expect(afterCompactionApplyReturned).not.toHaveBeenCalled()
  })

  it.each([new Error('apply failed'), Object.assign(new Error('aborted'), { name: 'AbortError' })])(
    'does not trigger Memory when initial compaction throws %s',
    async (error) => {
      const afterCompactionApplyReturned = vi.fn()

      await expect(
        new InputPreparationCoordinator().prepareInitial({
          ensureHistory: () => [],
          prepareIntent: async () => createIntent(true),
          createCompactionProjection: () => 'projection',
          appendUserFact: () => 'user-message',
          beginCompaction: vi.fn(),
          applyCompaction: async () => {
            throw error
          },
          readSummary: () => ({ value: 'current' }),
          afterCompactionApplyReturned,
          checkpoints: { assertCurrent: vi.fn() }
        })
      ).rejects.toBe(error)

      expect(afterCompactionApplyReturned).not.toHaveBeenCalled()
    }
  )

  it.each([true, false])(
    'refreshes resume history without a compaction observer after succeeded=%s returns',
    async (succeeded) => {
      const order: string[] = []
      const result = await new InputPreparationCoordinator().prepareExisting({
        ensureHistory: () => {
          order.push('history:before')
          return ['before']
        },
        refreshHistory: () => {
          order.push('history:after')
          return ['after']
        },
        prepareIntent: async () => {
          order.push('intent')
          return createIntent(succeeded)
        },
        applyCompaction: async () => {
          order.push(`apply:${succeeded}`)
          return { value: succeeded ? 'updated' : 'unchanged' }
        },
        readSummary: () => ({ value: 'unreachable' }),
        checkpoints: {
          assertCurrent: () => order.push('check'),
          beforeHistoryRefresh: () => order.push('abort-check')
        }
      })

      expect(order).toEqual([
        'check',
        'history:before',
        'intent',
        'check',
        `apply:${succeeded}`,
        'check',
        'abort-check',
        'history:after'
      ])
      expect(result.history).toEqual(['after'])
      expect(result.summary).toEqual({ value: succeeded ? 'updated' : 'unchanged' })
    }
  )

  it('reads the current resume summary before the abort checkpoint and history refresh', async () => {
    const order: string[] = []

    const result = await new InputPreparationCoordinator().prepareExisting({
      ensureHistory: () => {
        order.push('history:before')
        return ['before']
      },
      refreshHistory: () => {
        order.push('history:after')
        return ['after']
      },
      prepareIntent: async () => {
        order.push('intent:none')
        return null
      },
      applyCompaction: vi.fn(),
      readSummary: () => {
        order.push('summary')
        return { value: 'current' }
      },
      checkpoints: {
        assertCurrent: () => order.push('check'),
        beforeHistoryRefresh: () => order.push('abort-check')
      }
    })

    expect(order).toEqual([
      'check',
      'history:before',
      'intent:none',
      'check',
      'summary',
      'abort-check',
      'history:after'
    ])
    expect(result).toEqual({
      history: ['after'],
      intent: null,
      summary: { value: 'current' }
    })
  })

  it.each([
    new Error('resume failed'),
    Object.assign(new Error('resume aborted'), { name: 'AbortError' })
  ])('does not refresh history when resume compaction throws %s', async (error) => {
    const refreshHistory = vi.fn()

    await expect(
      new InputPreparationCoordinator().prepareExisting({
        ensureHistory: () => ['before'],
        refreshHistory,
        prepareIntent: async () => createIntent(true),
        applyCompaction: async () => {
          throw error
        },
        readSummary: () => ({ value: 'current' }),
        checkpoints: { assertCurrent: vi.fn(), beforeHistoryRefresh: vi.fn() }
      })
    ).rejects.toBe(error)

    expect(refreshHistory).not.toHaveBeenCalled()
  })

  it('does not refresh or backfill resume history when abort lands before refresh', async () => {
    const refreshHistory = vi.fn()
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })

    await expect(
      new InputPreparationCoordinator().prepareExisting({
        ensureHistory: () => ['before'],
        refreshHistory,
        prepareIntent: async () => null,
        applyCompaction: vi.fn(),
        readSummary: () => ({ value: 'current' }),
        checkpoints: {
          assertCurrent: vi.fn(),
          beforeHistoryRefresh: () => {
            throw abortError
          }
        }
      })
    ).rejects.toBe(abortError)

    expect(refreshHistory).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'triggers the context-pressure observer after succeeded=%s normally returns',
    async (succeeded) => {
      const afterCompactionApplyReturned = vi.fn()

      await new InputPreparationCoordinator().prepareExisting({
        ensureHistory: () => ['history'],
        prepareIntent: async () => createIntent(succeeded),
        applyCompaction: async () => ({ succeeded }),
        readSummary: () => ({ succeeded: false }),
        afterCompactionApplyReturned,
        checkpoints: { assertCurrent: vi.fn() }
      })

      expect(afterCompactionApplyReturned).toHaveBeenCalledOnce()
    }
  )

  it('does not trigger the context-pressure observer when there is no intent', async () => {
    const afterCompactionApplyReturned = vi.fn()

    await new InputPreparationCoordinator().prepareExisting({
      ensureHistory: () => ['history'],
      prepareIntent: async () => null,
      applyCompaction: vi.fn(),
      readSummary: () => ({ succeeded: false }),
      afterCompactionApplyReturned,
      checkpoints: { assertCurrent: vi.fn() }
    })

    expect(afterCompactionApplyReturned).not.toHaveBeenCalled()
  })

  it.each([
    new Error('pressure failed'),
    Object.assign(new Error('pressure aborted'), { name: 'AbortError' })
  ])('does not trigger the context-pressure observer when apply throws %s', async (error) => {
    const afterCompactionApplyReturned = vi.fn()

    await expect(
      new InputPreparationCoordinator().prepareExisting({
        ensureHistory: () => ['history'],
        prepareIntent: async () => createIntent(true),
        applyCompaction: async () => {
          throw error
        },
        readSummary: () => ({ succeeded: false }),
        afterCompactionApplyReturned,
        checkpoints: { assertCurrent: vi.fn() }
      })
    ).rejects.toBe(error)

    expect(afterCompactionApplyReturned).not.toHaveBeenCalled()
  })
})
