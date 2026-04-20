import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('messageStore reactivity', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('forwards stream state reactively from the stream store', async () => {
    vi.doUnmock('pinia')
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())

    const sessionClient = {
      restore: vi.fn().mockResolvedValue({
        session: { id: 's1' },
        messages: []
      })
    }
    const streamListeners = {
      updated: [] as Array<(payload: any) => void>,
      completed: [] as Array<(payload: any) => void>,
      failed: [] as Array<(payload: any) => void>
    }
    const chatClient = {
      onStreamUpdated: vi.fn((listener: (payload: any) => void) => {
        streamListeners.updated.push(listener)
        return () => undefined
      }),
      onStreamCompleted: vi.fn((listener: (payload: any) => void) => {
        streamListeners.completed.push(listener)
        return () => undefined
      }),
      onStreamFailed: vi.fn((listener: (payload: any) => void) => {
        streamListeners.failed.push(listener)
        return () => undefined
      })
    }

    vi.doMock('../../../src/renderer/api/SessionClient', () => ({
      SessionClient: vi.fn(() => sessionClient)
    }))
    vi.doMock('../../../src/renderer/api/ChatClient', () => ({
      ChatClient: vi.fn(() => chatClient)
    }))

    ;(window as any).electron = {
      ipcRenderer: {
        on: vi.fn(),
        removeListener: vi.fn()
      }
    }

    const { useMessageStore } = await import('@/stores/ui/message')
    const store = useMessageStore()

    await store.loadMessages('s1')

    const responseHandler = streamListeners.updated[0]
    expect(typeof responseHandler).toBe('function')

    responseHandler({
      sessionId: 's1',
      requestId: '__rate_limit__:s1:1',
      messageId: '__rate_limit__:s1:1',
      updatedAt: 1,
      blocks: [
        {
          type: 'action',
          action_type: 'rate_limit',
          status: 'pending',
          timestamp: 1
        }
      ]
    })

    expect(store.isStreaming).toBe(true)
    expect(store.currentStreamMessageId).toBe('__rate_limit__:s1:1')
    expect(store.streamingBlocks).toHaveLength(1)
    expect(store.streamRevision).toBeGreaterThan(0)
  })
})
