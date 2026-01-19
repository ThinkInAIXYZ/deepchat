import { ref } from 'vue'
import { describe, it, expect, vi } from 'vitest'
import { useExecutionAdapter } from '@/composables/chat/useExecutionAdapter'

const sendMessage = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 'm-1', role: 'assistant', content: [] })
)
const messageStreaming = vi.hoisted(() => ({
  handleStreamResponse: vi.fn(),
  handleStreamEnd: vi.fn(),
  handleStreamError: vi.fn()
}))

vi.mock('@/composables/usePresenter', () => ({
  usePresenter: (name: string) => {
    if (name === 'agentPresenter') {
      return { sendMessage }
    }
    return {}
  }
}))
vi.mock('@/composables/chat/useMessageStreaming', () => ({
  useMessageStreaming: () => messageStreaming
}))
vi.mock('@/composables/chat/useConversationCore', () => ({
  useConversationCore: () => ({ getMessage: vi.fn() })
}))
vi.mock('@/stores/workspace', () => ({
  useWorkspaceStore: () => ({ terminateAllRunningCommands: vi.fn() })
}))

describe('useExecutionAdapter', () => {
  it('sends message and updates caches', async () => {
    const activeThreadId = ref('t-1')
    const selectedVariantsMap = ref<Record<string, string>>({})
    const generatingThreadIds = ref(new Set<string>())
    const generatingMessagesCache = ref(new Map<string, { message: any; threadId: string }>())
    const threadsWorkingStatus = ref(new Map())
    const updateThreadWorkingStatus = vi.fn()
    const loadMessages = vi.fn().mockResolvedValue(undefined)
    const enrichMessageWithExtra = vi.fn(async (message: any) => message)
    const messageCacheComposable = {
      cacheMessageForView: vi.fn(),
      ensureMessageId: vi.fn()
    }
    const getTabId = () => 7

    const adapter = useExecutionAdapter({
      activeThreadId,
      selectedVariantsMap,
      generatingThreadIds,
      generatingMessagesCache,
      threadsWorkingStatus,
      updateThreadWorkingStatus,
      loadMessages,
      enrichMessageWithExtra,
      audioComposable: { playToolcallSound: vi.fn(), playTypewriterSound: vi.fn() },
      messageCacheComposable,
      getTabId
    })

    const payload = { text: 'hi', files: [], links: [], think: false, search: false }
    await adapter.sendMessage(payload)

    expect(sendMessage).toHaveBeenCalledWith('t-1', JSON.stringify(payload), 7, {})
    expect(updateThreadWorkingStatus).toHaveBeenCalledWith('t-1', 'working')
    expect(generatingThreadIds.value.has('t-1')).toBe(true)
    expect(generatingMessagesCache.value.has('m-1')).toBe(true)
    expect(messageCacheComposable.cacheMessageForView).toHaveBeenCalled()
    expect(messageCacheComposable.ensureMessageId).toHaveBeenCalledWith('m-1')
    expect(loadMessages).toHaveBeenCalled()
  })
})
