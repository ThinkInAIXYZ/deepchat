import { describe, expect, it, vi } from 'vitest'
import { SessionTranscriptMutations } from '@/session/transcriptMutations'

describe('SessionTranscriptMutations', () => {
  it('allows a failed Steer retry to coexist with restart-held Queue drafts', async () => {
    const message = {
      id: 'steer-1',
      sessionId: 's1',
      orderSeq: 3,
      role: 'user',
      content: JSON.stringify({ text: 'Retry steer', files: [] }),
      status: 'error',
      metadata: JSON.stringify({ inputReceipt: { mode: 'steer', readAt: null } })
    }
    const runtime = {
      prepareRetry: vi.fn().mockResolvedValue({ projectDir: '/repo' })
    }
    const transcript = {
      getMessage: vi.fn(() => message),
      restoreUserMessage: vi.fn()
    }
    const mutations = new SessionTranscriptMutations({
      transcript,
      runtime
    } as any)

    await expect(mutations.prepareRetryMessage('s1', 'steer-1')).resolves.toEqual({
      content: { text: 'Retry steer', files: [], search: false },
      projectDir: '/repo',
      sourceOrderSeq: 3,
      retryFromOrderSeq: 4,
      sourceMessageId: 'steer-1'
    })
    expect(runtime.prepareRetry).toHaveBeenCalledWith('s1', {
      allowRestartHeldQueue: true
    })
    // The failed Steer prompt is kept as the pre-stream anchor, so it must be
    // restored to 'sent' to remain visible to context history filtering.
    expect(transcript.restoreUserMessage).toHaveBeenCalledWith('steer-1')
  })

  it('keeps the user prompt in place when retrying a user message directly', async () => {
    const message = {
      id: 'user-1',
      sessionId: 's1',
      orderSeq: 3,
      role: 'user',
      content: JSON.stringify({ text: 'Retry prompt', files: [] }),
      status: 'sent',
      metadata: '{}'
    }
    const runtime = {
      prepareRetry: vi.fn().mockResolvedValue({ projectDir: '/repo' })
    }
    const mutations = new SessionTranscriptMutations({
      transcript: { getMessage: vi.fn(() => message) },
      runtime
    } as any)

    await expect(mutations.prepareRetryMessage('s1', 'user-1')).resolves.toEqual({
      content: { text: 'Retry prompt', files: [], search: false },
      projectDir: '/repo',
      sourceOrderSeq: 3,
      // Truncate from the message after the prompt so the prompt survives, and
      // anchor it so the same record is re-sent instead of a fresh duplicate.
      retryFromOrderSeq: 4,
      sourceMessageId: 'user-1'
    })
    expect(runtime.prepareRetry).toHaveBeenCalledWith('s1', {
      allowRestartHeldQueue: false
    })
  })

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

  it('invalidates retry projections only after transcript deletion commits', () => {
    const calls: string[] = []
    const runtime = {
      invalidateTranscriptFrom: vi.fn(() => calls.push('invalidate'))
    }
    const mutations = new SessionTranscriptMutations({
      transcript: {
        deleteFromOrderSeq: vi.fn(() => {
          calls.push('delete')
        })
      },
      runtime,
      runInTransaction: (operation) => {
        calls.push('transaction:start')
        const result = operation()
        calls.push('transaction:commit')
        return result
      }
    } as any)

    mutations.commitRetryMessage('s1', 7)

    expect(calls).toEqual(['transaction:start', 'delete', 'transaction:commit', 'invalidate'])
  })

  it('does not invalidate retry projections when transcript deletion rolls back', () => {
    const runtime = { invalidateTranscriptFrom: vi.fn() }
    const mutations = new SessionTranscriptMutations({
      transcript: {
        deleteFromOrderSeq: vi.fn(() => {
          throw new Error('delete failed')
        })
      },
      runtime,
      runInTransaction: (operation) => operation()
    } as any)

    expect(() => mutations.commitRetryMessage('s1', 7)).toThrow('delete failed')
    expect(runtime.invalidateTranscriptFrom).not.toHaveBeenCalled()
  })

  it('cancels the active Run before editing transcript history', async () => {
    const calls: string[] = []
    const message = {
      id: 'message-1',
      sessionId: 's1',
      orderSeq: 7,
      role: 'user',
      content: JSON.stringify({ text: 'old text' })
    }
    const runtime = {
      assertNoActivePendingInputs: vi.fn(),
      cancelForTranscriptMutation: vi.fn(async () => calls.push('cancel')),
      invalidateTranscriptFrom: vi.fn(() => calls.push('invalidate'))
    }
    const mutations = new SessionTranscriptMutations({
      transcript: {
        getMessage: vi.fn(() => message),
        updateMessageContent: vi.fn(() => calls.push('update'))
      },
      runtime
    } as any)

    await mutations.editUserMessage('s1', 'message-1', 'new text')

    expect(calls).toEqual(['cancel', 'invalidate', 'update'])
  })

  it('replaces all legacy text blocks while preserving non-text blocks and attachments', async () => {
    const mention = { type: 'mention', category: 'prompts', id: 'review', content: 'Prompt' }
    const code = { type: 'code', content: 'const n = 7', language: 'ts' }
    const files = [{ name: 'notes.txt', path: '/repo/notes.txt' }]
    const message = {
      id: 'message-1',
      sessionId: 's1',
      orderSeq: 7,
      role: 'user',
      content: JSON.stringify({
        text: 'FirstSecondThird',
        files,
        content: [
          mention,
          { type: 'text', content: 'First' },
          code,
          { type: 'text', content: 'Second' },
          { type: 'text', content: 'Third' }
        ]
      })
    }
    const mutations = new SessionTranscriptMutations({
      transcript: {
        getMessage: () => message,
        updateMessageContent: (_id: string, content: string) => {
          message.content = content
        }
      },
      runtime: {
        assertNoActivePendingInputs: vi.fn(),
        cancelForTranscriptMutation: vi.fn(),
        invalidateTranscriptFrom: vi.fn()
      }
    } as any)

    const saved = await mutations.editUserMessage('s1', 'message-1', 'Replacement')
    expect(JSON.parse(saved.content)).toMatchObject({
      text: 'Replacement',
      files,
      content: [mention, { type: 'text', content: 'Replacement' }, code]
    })
  })

  it('does not edit transcript history when active Run cancellation fails', async () => {
    const cancellationError = new Error('cancellation failed')
    const runtime = {
      assertNoActivePendingInputs: vi.fn(),
      cancelForTranscriptMutation: vi.fn().mockRejectedValue(cancellationError),
      invalidateTranscriptFrom: vi.fn()
    }
    const transcript = {
      getMessage: vi.fn(() => ({
        id: 'message-1',
        sessionId: 's1',
        orderSeq: 7,
        role: 'user',
        content: JSON.stringify({ text: 'old text' })
      })),
      updateMessageContent: vi.fn()
    }
    const mutations = new SessionTranscriptMutations({ transcript, runtime } as any)

    await expect(mutations.editUserMessage('s1', 'message-1', 'new text')).rejects.toBe(
      cancellationError
    )
    expect(runtime.invalidateTranscriptFrom).not.toHaveBeenCalled()
    expect(transcript.updateMessageContent).not.toHaveBeenCalled()
  })

  it('rejects a new structured session grant before cancelling the active Run', async () => {
    const runtime = {
      assertNoActivePendingInputs: vi.fn(),
      cancelForTranscriptMutation: vi.fn(),
      invalidateTranscriptFrom: vi.fn()
    }
    const transcript = {
      getMessage: vi.fn(() => ({
        id: 'message-1',
        sessionId: 's1',
        orderSeq: 7,
        role: 'user',
        content: JSON.stringify({
          text: 'old text',
          inlineItems: [
            {
              type: 'session',
              offset: 8,
              sessionId: 'source',
              title: 'Source',
              projectDir: null,
              tapeIncarnationId: 'original-incarnation'
            }
          ]
        })
      })),
      updateMessageContent: vi.fn()
    }
    const mutations = new SessionTranscriptMutations({ transcript, runtime } as any)

    await expect(
      mutations.editUserMessage('s1', 'message-1', 'edited', [
        {
          type: 'session',
          offset: 0,
          sessionId: 'source',
          title: 'Source',
          projectDir: null,
          tapeIncarnationId: 'different-incarnation'
        }
      ])
    ).rejects.toThrow('not originally granted')
    expect(runtime.cancelForTranscriptMutation).not.toHaveBeenCalled()
    expect(transcript.updateMessageContent).not.toHaveBeenCalled()
  })

  it('rejects a stale edit rather than restoring a concurrently removed session grant', async () => {
    const reference = {
      type: 'session' as const,
      offset: 0,
      sessionId: 'source',
      title: 'Source',
      projectDir: null,
      tapeIncarnationId: 'original-incarnation'
    }
    let message = {
      id: 'message-1',
      sessionId: 's1',
      orderSeq: 7,
      role: 'user',
      content: JSON.stringify({ text: 'old', inlineItems: [reference] })
    }
    const cancellations: Array<() => void> = []
    const runtime = {
      assertNoActivePendingInputs: vi.fn(),
      cancelForTranscriptMutation: vi.fn(
        () => new Promise<void>((resolve) => cancellations.push(resolve))
      ),
      invalidateTranscriptFrom: vi.fn()
    }
    const transcript = {
      getMessage: vi.fn(() => ({ ...message })),
      updateMessageContent: vi.fn((_id: string, content: string) => {
        message = { ...message, content }
      })
    }
    const mutations = new SessionTranscriptMutations({ transcript, runtime } as any)
    const removing = mutations.editUserMessage('s1', 'message-1', 'removed', [])
    const retaining = mutations.editUserMessage('s1', 'message-1', 'stale', [reference])
    cancellations[0]()
    await removing
    cancellations[1]()
    await expect(retaining).rejects.toThrow('Message changed while editing')
    expect(JSON.parse(message.content)).toMatchObject({ text: 'removed' })
    expect(JSON.parse(message.content).inlineItems).toBeUndefined()
    expect(transcript.updateMessageContent).toHaveBeenCalledTimes(1)
    expect(runtime.invalidateTranscriptFrom).toHaveBeenCalledTimes(1)
  })

  it('does not invalidate or write a message deleted during cancellation', async () => {
    const transcript = {
      getMessage: vi
        .fn()
        .mockReturnValueOnce({
          id: 'message-1',
          sessionId: 's1',
          orderSeq: 7,
          role: 'user',
          content: JSON.stringify({ text: 'old' })
        })
        .mockReturnValue(null),
      updateMessageContent: vi.fn()
    }
    const runtime = {
      assertNoActivePendingInputs: vi.fn(),
      cancelForTranscriptMutation: vi.fn().mockResolvedValue(undefined),
      invalidateTranscriptFrom: vi.fn()
    }
    const mutations = new SessionTranscriptMutations({ transcript, runtime } as any)
    await expect(mutations.editUserMessage('s1', 'message-1', 'new')).rejects.toThrow('not found')
    expect(runtime.invalidateTranscriptFrom).not.toHaveBeenCalled()
    expect(transcript.updateMessageContent).not.toHaveBeenCalled()
  })

  it('hands the extracted cloned prefix cursor to the fork target reset', async () => {
    const runtime = { resetForkTarget: vi.fn() }
    const transcript = {
      getMessage: vi.fn(() => ({
        id: 'message-9',
        sessionId: 'source',
        orderSeq: 9,
        role: 'assistant',
        content: '[]'
      })),
      cloneSentMessagesToSession: vi.fn(() => 7)
    }
    const mutations = new SessionTranscriptMutations({ transcript, runtime } as any)

    await mutations.forkSessionFromMessage('source', 'target', 'message-9')

    expect(transcript.cloneSentMessagesToSession).toHaveBeenCalledWith('source', 'target', 9)
    expect(runtime.resetForkTarget).toHaveBeenCalledWith('target', 7)
  })
})
