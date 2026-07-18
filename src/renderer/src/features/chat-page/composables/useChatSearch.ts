import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  applyChatSearchHighlights,
  collectChatSearchResults,
  clearChatSearchHighlights,
  setActiveChatSearchResult,
  type ChatSearchResult
} from '@/lib/chatSearch'
import type { DisplayMessage } from '@/features/chat-page/model/displayMessage'
import type { ChatScrollTarget, ChatScrollReason } from '@/composables/chat/chatScrollState'

type UseChatSearchOptions = {
  messageSearchRoot: Ref<HTMLElement | null>
  displayMessages: ComputedRef<DisplayMessage[]>
  visibleDisplayMessages: ComputedRef<DisplayMessage[]>
  hasWindowEntry: (messageId: string) => boolean
  requestChatScroll: (
    reason: ChatScrollReason,
    target: ChatScrollTarget,
    immediate?: boolean
  ) => number | null
  waitForNextAnimationFrame: () => Promise<void>
}

/**
 * Owns in-session find (Cmd/Ctrl+F): open state, query, active match index,
 * highlight application, and rAF-coalesced refresh. Navigation reuses the shared
 * scroll controller via `requestChatScroll('search-navigation', …)` so it never
 * fights auto-follow for the scrollbar.
 */
export function useChatSearch(options: UseChatSearchOptions) {
  const {
    messageSearchRoot,
    displayMessages,
    visibleDisplayMessages,
    hasWindowEntry,
    requestChatScroll,
    waitForNextAnimationFrame
  } = options

  const isChatSearchOpen = ref(false)
  const chatSearchQuery = ref('')
  const activeChatSearchIndex = ref(0)
  const chatSearchBarRef = ref<{
    focusInput: () => void
    selectInput: () => void
  } | null>(null)

  let chatSearchRefreshFrame: number | null = null
  let pendingChatSearchReveal = false

  const chatSearchResults = computed(() =>
    collectChatSearchResults(displayMessages.value, chatSearchQuery.value)
  )

  async function refreshChatSearchHighlights(revealActive: boolean) {
    if (!isChatSearchOpen.value) {
      return
    }

    await nextTick()
    if (!isChatSearchOpen.value) {
      return
    }

    const root = messageSearchRoot.value
    applyChatSearchHighlights(root, chatSearchQuery.value)

    if (chatSearchResults.value.length === 0) {
      activeChatSearchIndex.value = 0
      return
    }

    const nextIndex = Math.min(activeChatSearchIndex.value, chatSearchResults.value.length - 1)
    activeChatSearchIndex.value = nextIndex
    const activeResult = chatSearchResults.value[nextIndex]
    if (revealActive) {
      await revealChatSearchResult(activeResult, 'auto')
    } else {
      setActiveChatSearchResult(root, activeResult, { scroll: false })
    }
  }

  async function revealChatSearchResult(
    result: ChatSearchResult | undefined,
    behavior: ScrollBehavior = 'auto'
  ) {
    if (!result) return

    await nextTick()
    const root = messageSearchRoot.value
    applyChatSearchHighlights(root, chatSearchQuery.value)

    if (!hasWindowEntry(result.messageId)) return
    const requestId = requestChatScroll('search-navigation', {
      kind: 'message',
      messageId: result.messageId,
      align: 'one-third'
    })
    if (requestId === null) return
    await waitForNextAnimationFrame()
    await nextTick()
    applyChatSearchHighlights(root, chatSearchQuery.value)
    setActiveChatSearchResult(root, result, { behavior, scroll: false })
  }

  function cancelScheduledChatSearchRefresh() {
    pendingChatSearchReveal = false
    if (chatSearchRefreshFrame === null) {
      return
    }

    window.cancelAnimationFrame(chatSearchRefreshFrame)
    chatSearchRefreshFrame = null
  }

  function scheduleChatSearchHighlights(revealActive = false) {
    if (!isChatSearchOpen.value) {
      return
    }
    pendingChatSearchReveal ||= revealActive
    if (chatSearchRefreshFrame !== null) return

    chatSearchRefreshFrame = window.requestAnimationFrame(() => {
      chatSearchRefreshFrame = null
      const shouldReveal = pendingChatSearchReveal
      pendingChatSearchReveal = false
      void refreshChatSearchHighlights(shouldReveal)
    })
  }

  function focusChatSearchInput() {
    nextTick(() => {
      chatSearchBarRef.value?.selectInput()
    })
  }

  function clearChatSearchState() {
    cancelScheduledChatSearchRefresh()
    clearChatSearchHighlights(messageSearchRoot.value)
    chatSearchQuery.value = ''
    activeChatSearchIndex.value = 0
    isChatSearchOpen.value = false
  }

  function openChatSearch() {
    isChatSearchOpen.value = true
    focusChatSearchInput()
    void refreshChatSearchHighlights(true)
  }

  function closeChatSearch() {
    clearChatSearchState()
  }

  function activateChatSearchMatch(index: number, behavior: ScrollBehavior = 'auto') {
    if (chatSearchResults.value.length === 0) {
      activeChatSearchIndex.value = 0
      return
    }

    const normalizedIndex =
      ((index % chatSearchResults.value.length) + chatSearchResults.value.length) %
      chatSearchResults.value.length

    activeChatSearchIndex.value = normalizedIndex
    void revealChatSearchResult(chatSearchResults.value[normalizedIndex], behavior)
  }

  function goToNextChatSearchMatch() {
    activateChatSearchMatch(activeChatSearchIndex.value + 1)
  }

  function goToPreviousChatSearchMatch() {
    activateChatSearchMatch(activeChatSearchIndex.value - 1)
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    const element = target instanceof HTMLElement ? target : null
    if (!element) {
      return false
    }

    return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
  }

  /**
   * Handles the search-specific keyboard shortcuts. Returns true when the event
   * was consumed so the caller can skip its own handling.
   */
  function handleSearchKeydown(event: KeyboardEvent): boolean {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      openChatSearch()
      return true
    }

    if (!isChatSearchOpen.value) {
      return false
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeChatSearch()
      return true
    }

    if (event.key === 'Enter' && !isEditableTarget(event.target)) {
      event.preventDefault()
      if (event.shiftKey) {
        goToPreviousChatSearchMatch()
      } else {
        goToNextChatSearchMatch()
      }
      return true
    }

    return false
  }

  watch(chatSearchQuery, () => {
    activeChatSearchIndex.value = 0
    scheduleChatSearchHighlights(true)
  })

  watch(
    [visibleDisplayMessages, chatSearchResults],
    () => {
      if (!isChatSearchOpen.value) {
        return
      }

      scheduleChatSearchHighlights(false)
    },
    { flush: 'post' }
  )

  return {
    isChatSearchOpen,
    chatSearchQuery,
    activeChatSearchIndex,
    chatSearchBarRef,
    chatSearchResults,
    openChatSearch,
    closeChatSearch,
    clearChatSearchState,
    goToNextChatSearchMatch,
    goToPreviousChatSearchMatch,
    handleSearchKeydown,
    cancelScheduledChatSearchRefresh
  }
}
