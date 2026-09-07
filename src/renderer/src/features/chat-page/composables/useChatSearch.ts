import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import { refDebounced } from '@vueuse/core'
import {
  applyChatSearchHighlights,
  collectChatSearchResults,
  clearChatSearchHighlights,
  setActiveChatSearchResult,
  type ChatSearchResult
} from '@/lib/chatSearch'
import type { DisplayMessage } from '@/features/chat-page/model/displayMessage'
import type { ChatScrollTarget, ChatScrollReason } from '@/composables/chat/chatScrollState'

type ChatSearchBarHandle = {
  focusInput: () => void
  selectInput: () => void
}

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
  // Keep the input untouched, but debounce and compare one canonical query everywhere else.
  // This avoids a whitespace-only edit briefly mixing the old and new search state.
  const canonicalChatSearchQuery = computed(() => chatSearchQuery.value.trim())
  const debouncedChatSearchQuery = refDebounced(canonicalChatSearchQuery, 150)
  const chatSearchBarRef = ref<ChatSearchBarHandle | null>(null)

  let chatSearchRefreshFrame: number | null = null
  let pendingChatSearchReveal = false
  let chatSearchOperationId = 0

  const isSearchQuerySettled = computed(
    () => canonicalChatSearchQuery.value === debouncedChatSearchQuery.value
  )
  const chatSearchResults = computed(() => {
    if (!isChatSearchOpen.value || !isSearchQuerySettled.value) {
      return []
    }

    return collectChatSearchResults(displayMessages.value, debouncedChatSearchQuery.value)
  })

  const resolvedChatSearchQuery = () => debouncedChatSearchQuery.value
  const isCurrentSearchOperation = (operationId: number, query: string) =>
    operationId === chatSearchOperationId &&
    isChatSearchOpen.value &&
    isSearchQuerySettled.value &&
    resolvedChatSearchQuery() === query

  async function refreshChatSearchHighlights(
    revealActive: boolean,
    operationId = chatSearchOperationId
  ) {
    if (!isChatSearchOpen.value || !isSearchQuerySettled.value) {
      return
    }

    const query = resolvedChatSearchQuery()
    await nextTick()
    if (!isCurrentSearchOperation(operationId, query)) {
      return
    }

    const root = messageSearchRoot.value
    applyChatSearchHighlights(root, query)

    if (chatSearchResults.value.length === 0) {
      activeChatSearchIndex.value = 0
      return
    }

    const nextIndex = Math.min(activeChatSearchIndex.value, chatSearchResults.value.length - 1)
    activeChatSearchIndex.value = nextIndex
    const activeResult = chatSearchResults.value[nextIndex]
    if (revealActive) {
      await revealChatSearchResult(activeResult, 'auto', operationId, query)
    } else if (isCurrentSearchOperation(operationId, query)) {
      setActiveChatSearchResult(root, activeResult, { scroll: false })
    }
  }

  async function revealChatSearchResult(
    result: ChatSearchResult | undefined,
    behavior: ScrollBehavior = 'auto',
    operationId = chatSearchOperationId,
    query = resolvedChatSearchQuery()
  ) {
    if (!result || !isCurrentSearchOperation(operationId, query)) return

    await nextTick()
    if (!isCurrentSearchOperation(operationId, query)) return
    const root = messageSearchRoot.value
    applyChatSearchHighlights(root, query)

    if (!hasWindowEntry(result.messageId)) return
    const requestId = requestChatScroll('search-navigation', {
      kind: 'message',
      messageId: result.messageId,
      align: 'one-third'
    })
    if (requestId === null) return
    await waitForNextAnimationFrame()
    if (!isCurrentSearchOperation(operationId, query)) return
    await nextTick()
    if (!isCurrentSearchOperation(operationId, query)) return
    applyChatSearchHighlights(root, query)
    if (!isCurrentSearchOperation(operationId, query)) return
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

  function disposeChatSearch() {
    chatSearchOperationId += 1
    cancelScheduledChatSearchRefresh()
    clearChatSearchHighlights(messageSearchRoot.value)
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
      void refreshChatSearchHighlights(shouldReveal, chatSearchOperationId)
    })
  }

  function focusChatSearchInput() {
    nextTick(() => {
      chatSearchBarRef.value?.selectInput()
    })
  }

  function setChatSearchBarRef(instance: unknown) {
    chatSearchBarRef.value = instance as ChatSearchBarHandle | null
  }

  function clearChatSearchState() {
    chatSearchOperationId += 1
    cancelScheduledChatSearchRefresh()
    clearChatSearchHighlights(messageSearchRoot.value)
    chatSearchQuery.value = ''
    activeChatSearchIndex.value = 0
    isChatSearchOpen.value = false
  }

  function openChatSearch() {
    isChatSearchOpen.value = true
    focusChatSearchInput()
    if (isSearchQuerySettled.value) {
      void refreshChatSearchHighlights(true)
    }
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
    chatSearchOperationId += 1
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

  watch(
    canonicalChatSearchQuery,
    (query) => {
      chatSearchOperationId += 1
      activeChatSearchIndex.value = 0
      if (query !== debouncedChatSearchQuery.value) {
        clearChatSearchHighlights(messageSearchRoot.value)
      }
    },
    { flush: 'sync' }
  )

  watch(debouncedChatSearchQuery, () => {
    if (!isChatSearchOpen.value || !isSearchQuerySettled.value) {
      return
    }

    scheduleChatSearchHighlights(true)
  })

  watch(
    [visibleDisplayMessages, chatSearchResults],
    () => {
      if (!isChatSearchOpen.value || !isSearchQuerySettled.value) {
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
    setChatSearchBarRef,
    chatSearchResults,
    openChatSearch,
    closeChatSearch,
    clearChatSearchState,
    goToNextChatSearchMatch,
    goToPreviousChatSearchMatch,
    handleSearchKeydown,
    cancelScheduledChatSearchRefresh,
    disposeChatSearch
  }
}
