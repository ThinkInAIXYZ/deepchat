import { beforeEach, describe, expect, it, vi } from 'vitest'

type StreamListener = (payload: any) => void

const chatClient = vi.hoisted(() => {
  const listeners: Record<string, StreamListener> = {}
  return {
    listeners,
    onStreamUpdated: vi.fn((listener: StreamListener) => {
      listeners.onStreamUpdated = listener
      return () => {}
    }),
    onStreamCompleted: vi.fn(() => () => {}),
    onStreamFailed: vi.fn(() => () => {}),
    onPlanUpdated: vi.fn(() => () => {}),
    onStreamActivity: vi.fn((listener: StreamListener) => {
      listeners.onStreamActivity = listener
      return () => {}
    })
  }
})

vi.mock('@api/ChatClient', () => ({
  createChatClient: () => chatClient
}))

vi.mock('@api/SessionClient', () => ({
  createSessionClient: () => ({
    onMessagesChanged: vi.fn(() => () => {})
  })
}))

import { bindMessageStoreIpc } from '@/stores/ui/messageIpc'

function createOptions(activeSessionId: string | null) {
  return {
    getActiveSessionId: vi.fn(() => activeSessionId),
    getCurrentStreamIdentity: vi.fn(() => ({ sessionId: null, requestId: null })),
    setStreamingState: vi.fn(),
    clearStreamingState: vi.fn(),
    loadMessages: vi.fn(),
    invalidateRecentSessionView: vi.fn(),
    applyPersistedMessageRecords: vi.fn(),
    isEphemeralStreamMessageId: vi.fn(() => false)
  }
}

describe('bindMessageStoreIpc stream activity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates recent-session views for sessions streamed in other windows', () => {
    const options = createOptions('other-session')
    const binding = bindMessageStoreIpc(options as any)

    chatClient.listeners.onStreamActivity({ sessionId: 'session-streaming-elsewhere' })

    expect(options.invalidateRecentSessionView).toHaveBeenCalledWith('session-streaming-elsewhere')
    binding.cleanup()
  })

  it('does not double-invalidate the active session', () => {
    const options = createOptions('active-session')
    const binding = bindMessageStoreIpc(options as any)

    chatClient.listeners.onStreamActivity({ sessionId: 'active-session' })

    expect(options.invalidateRecentSessionView).not.toHaveBeenCalled()
    binding.cleanup()
  })
})
