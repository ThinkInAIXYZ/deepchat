import { describe, expect, it, vi } from 'vitest'
import { SessionTranscriptMutations } from '@/session/transcriptMutations'

describe('SessionTranscriptMutations', () => {
  it('rolls pending inputs and transcript deletion back when Tape reset fails', async () => {
    const state = { pendingInputs: 1, transcriptMessages: 2, tapeEntries: 3 }
    const runtime = {
      prepareClearMessages: vi.fn().mockResolvedValue(undefined),
      finishClearMessages: vi.fn()
    }
    const mutations = new SessionTranscriptMutations({
      pendingInputs: {
        deleteBySession: vi.fn(() => {
          state.pendingInputs = 0
        })
      },
      transcript: {
        deleteBySession: vi.fn(() => {
          state.transcriptMessages = 0
        })
      },
      settings: {
        resetTape: vi.fn(() => {
          state.tapeEntries = 0
          throw new Error('Tape reset failed')
        })
      },
      runtime,
      runInTransaction: (operation) => {
        const snapshot = { ...state }
        try {
          return operation()
        } catch (error) {
          Object.assign(state, snapshot)
          throw error
        }
      }
    } as any)

    await expect(mutations.clearMessages('s1')).rejects.toThrow('Tape reset failed')

    expect(state).toEqual({ pendingInputs: 1, transcriptMessages: 2, tapeEntries: 3 })
    expect(runtime.prepareClearMessages).toHaveBeenCalledWith('s1')
    expect(runtime.finishClearMessages).not.toHaveBeenCalled()
  })

  it('finishes runtime cleanup only after the shared transaction commits', async () => {
    const calls: string[] = []
    const mutations = new SessionTranscriptMutations({
      pendingInputs: { deleteBySession: vi.fn(() => calls.push('pending')) },
      transcript: { deleteBySession: vi.fn(() => calls.push('transcript')) },
      settings: { resetTape: vi.fn(() => calls.push('tape')) },
      runtime: {
        prepareClearMessages: vi.fn(async () => {
          calls.push('prepare')
        }),
        finishClearMessages: vi.fn(() => calls.push('finish'))
      },
      runInTransaction: (operation) => {
        calls.push('transaction:start')
        const result = operation()
        calls.push('transaction:commit')
        return result
      }
    } as any)

    await mutations.clearMessages('s1')

    expect(calls).toEqual([
      'prepare',
      'transaction:start',
      'pending',
      'transcript',
      'tape',
      'transaction:commit',
      'finish'
    ])
  })
})
