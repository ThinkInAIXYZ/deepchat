import { computed, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const chatSearchMocks = vi.hoisted(() => ({
  apply: vi.fn(),
  clear: vi.fn(),
  setActive: vi.fn()
}))

vi.mock('@/lib/chatSearch', () => ({
  applyChatSearchHighlights: chatSearchMocks.apply,
  clearChatSearchHighlights: chatSearchMocks.clear,
  setActiveChatSearchResult: chatSearchMocks.setActive,
  collectChatSearchResults: (
    messages: Array<{ id: string; content: { text: string } }>,
    query: string
  ) =>
    query.trim() && messages[0]?.content.text.includes(query.trim())
      ? [{ messageId: messages[0].id, matchIndex: 0 }]
      : []
}))

import { useChatSearch } from '@/features/chat-page/composables/useChatSearch'
import type { DisplayMessage } from '@/features/chat-page/model/displayMessage'

const createDeferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const createSearch = (waitForNextAnimationFrame: () => Promise<void> = async () => {}) => {
  const root = document.createElement('div')
  root.innerHTML = '<div data-message-id="m1"><p>alpha beta</p></div>'
  const messages = computed(
    () => [{ id: 'm1', content: { text: 'alpha beta' } }] as unknown as DisplayMessage[]
  )

  return useChatSearch({
    messageSearchRoot: ref(root),
    displayMessages: messages,
    visibleDisplayMessages: messages,
    hasWindowEntry: () => true,
    requestChatScroll: () => 1,
    waitForNextAnimationFrame
  })
}

const settleQuery = async (search: ReturnType<typeof createSearch>, query: string) => {
  search.chatSearchQuery.value = query
  await nextTick()
  await vi.advanceTimersByTimeAsync(150)
  await nextTick()
  // The debounced watcher schedules the highlight refresh on the next animation
  // frame; advance the faked rAF timer so the refresh actually runs.
  await vi.advanceTimersByTimeAsync(32)
  await nextTick()
}

describe('useChatSearch', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('waits for the query to settle before collecting results', async () => {
    vi.useFakeTimers()
    const search = createSearch()

    search.openChatSearch()
    search.chatSearchQuery.value = 'alpha'
    await nextTick()

    expect(search.chatSearchResults.value).toEqual([])

    await vi.advanceTimersByTimeAsync(150)
    await nextTick()

    expect(search.chatSearchResults.value).toEqual([{ messageId: 'm1', matchIndex: 0 }])
  })

  it('uses a trimmed canonical query while preserving the input value', async () => {
    vi.useFakeTimers()
    const search = createSearch()

    search.openChatSearch()
    await settleQuery(search, ' alpha ')

    expect(search.chatSearchQuery.value).toBe(' alpha ')
    expect(search.chatSearchResults.value).toEqual([{ messageId: 'm1', matchIndex: 0 }])
    expect(chatSearchMocks.apply).toHaveBeenCalledWith(expect.anything(), 'alpha')
  })

  it('does not restore an active marker after closing while navigation waits for a frame', async () => {
    vi.useFakeTimers()
    const frame = createDeferred()
    const search = createSearch(() => frame.promise)

    search.openChatSearch()
    await settleQuery(search, 'alpha')
    search.goToNextChatSearchMatch()
    await nextTick()

    search.closeChatSearch()
    frame.resolve()
    await nextTick()
    await nextTick()

    expect(chatSearchMocks.setActive).not.toHaveBeenCalled()
    expect(chatSearchMocks.clear).toHaveBeenCalled()
  })

  it('does not apply the previous query after it changes while navigation waits for a frame', async () => {
    vi.useFakeTimers()
    const frame = createDeferred()
    const search = createSearch(() => frame.promise)

    search.openChatSearch()
    await settleQuery(search, 'alpha')
    search.goToNextChatSearchMatch()
    await nextTick()

    // The navigation chain is now suspended on the deferred frame with 'alpha'
    // already applied. Only calls made after the query changes matter here.
    chatSearchMocks.apply.mockClear()
    search.chatSearchQuery.value = 'beta'
    await nextTick()
    frame.resolve()
    await nextTick()
    await nextTick()

    expect(chatSearchMocks.setActive).not.toHaveBeenCalled()
    expect(chatSearchMocks.apply).not.toHaveBeenCalledWith(expect.anything(), 'alpha')
  })
})
