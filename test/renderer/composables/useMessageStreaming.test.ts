import { ref } from 'vue'
import { describe, it, expect, vi } from 'vitest'
import { useMessageStreaming } from '@/composables/chat/useMessageStreaming'

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: () => ({
    isMainWindowFocused: vi.fn().mockResolvedValue(true),
    showNotification: vi.fn()
  })
}))
vi.mock('@/composables/chat/useConversationCore', () => ({
  useConversationCore: () => ({ getMessage: vi.fn() })
}))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key })
}))

describe('useMessageStreaming', () => {
  it('creates skeleton message on stream init', () => {
    const activeThreadId = ref('t-1')
    const generatingThreadIds = ref(new Set<string>())
    const generatingMessagesCache = ref(new Map())
    const threadsWorkingStatus = ref(new Map())
    const updateThreadWorkingStatus = vi.fn()
    const enrichMessageWithExtra = vi.fn(async (message: any) => message)
    const messageCacheComposable = {
      cacheMessageForView: vi.fn(),
      ensureMessageId: vi.fn(),
      findMainAssistantMessageByParentId: vi.fn()
    }

    const streaming = useMessageStreaming(
      activeThreadId,
      generatingThreadIds,
      generatingMessagesCache,
      threadsWorkingStatus,
      updateThreadWorkingStatus,
      enrichMessageWithExtra,
      { playToolcallSound: vi.fn(), playTypewriterSound: vi.fn() },
      messageCacheComposable
    )

    streaming.handleStreamResponse({
      eventId: 'm-1',
      conversationId: 't-1',
      stream_kind: 'init'
    })

    expect(messageCacheComposable.cacheMessageForView).toHaveBeenCalled()
    const skeleton = messageCacheComposable.cacheMessageForView.mock.calls[0][0]
    expect(skeleton.id).toBe('m-1')
    expect(skeleton.conversationId).toBe('t-1')
    expect(messageCacheComposable.ensureMessageId).toHaveBeenCalledWith('m-1')
  })
})
