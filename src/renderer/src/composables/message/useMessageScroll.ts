import { ref, reactive, readonly, onBeforeUnmount, nextTick, type Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { ScrollInfo } from './types'

// === Constants ===
const MESSAGE_HIGHLIGHT_CLASS = 'message-highlight'
const MAX_SCROLL_RETRIES = 12
const SCROLL_RETRY_DELAY = 80
const HIGHLIGHT_DURATION = 2000
const PLACEHOLDER_POSITION_THRESHOLD = 5000

export interface UseMessageScrollOptions {
  containerRef?: Ref<HTMLDivElement | undefined>
  shouldAutoFollow?: Ref<boolean>
  scrollAnchor?: Ref<HTMLDivElement | undefined>
}

export function useMessageScroll(options?: UseMessageScrollOptions) {
  const messagesContainer = options?.containerRef ?? ref<HTMLDivElement>()
  const scrollAnchor = options?.scrollAnchor ?? ref<HTMLDivElement>()
  const aboveThreshold = ref(false)

  const scrollInfo = reactive<ScrollInfo>({
    viewportHeight: 0,
    contentHeight: 0,
    scrollTop: 0
  })

  let intersectionObserver: IntersectionObserver | null = null
  let scrollRetryTimer: number | null = null
  let scrollRetryToken = 0
  let bottomScrollRetryTimer: number | null = null
  let bottomScrollCancelToken = 0
  let pendingScrollTargetId: string | null = null

  const updateScrollInfoImmediate = () => {
    const container = messagesContainer.value
    if (!container) return
    scrollInfo.viewportHeight = container.clientHeight
    scrollInfo.contentHeight = container.scrollHeight
    scrollInfo.scrollTop = container.scrollTop
  }

  // Debounced version for scroll events (~60fps)
  const updateScrollInfo = useDebounceFn(updateScrollInfoImmediate, 16)

  const handleScroll = () => {
    updateScrollInfo()
  }

  /**
   * Fallback scroll to bottom (non-virtual scroll)
   */
  const scrollToBottomBase = (_smooth = false) => {
    const container = messagesContainer.value
    if (!container) return

    const targetTop = Math.max(container.scrollHeight - container.clientHeight, 0)
    container.scrollTop = targetTop
    updateScrollInfoImmediate()
  }

  /**
   * Schedule scroll to bottom (updated for non-virtual scroll)
   */
  const scheduleScrollToBottom = (force = false) => {
    if (bottomScrollRetryTimer) {
      clearTimeout(bottomScrollRetryTimer)
      bottomScrollRetryTimer = null
    }
    const currentBottomToken = ++bottomScrollCancelToken

    nextTick(() => {
      const shouldAutoFollow = options?.shouldAutoFollow
      if (force && shouldAutoFollow) {
        shouldAutoFollow.value = true
      }

      if (!force && shouldAutoFollow && !shouldAutoFollow.value) {
        updateScrollInfo()
        return
      }

      // Use scrollToBottomBase directly (no virtual scroller)
      scrollToBottomBase()
    })
  }

  /**
   * Public scroll to bottom API
   */
  const scrollToBottom = (force = false) => scheduleScrollToBottom(force)

  /**
   * Highlight a message element
   */
  const highlightMessage = (target: HTMLElement) => {
    target.classList.add(MESSAGE_HIGHLIGHT_CLASS)
    setTimeout(() => target.classList.remove(MESSAGE_HIGHLIGHT_CLASS), HIGHLIGHT_DURATION)
  }

  /**
   * Fallback scroll to message (non-virtual scroll)
   */
  const scrollToMessageBase = (messageId: string) => {
    nextTick(() => {
      const messageElement = document.querySelector(
        `[data-message-id="${messageId}"]`
      ) as HTMLElement | null
      if (messageElement) {
        messageElement.scrollIntoView({ block: 'start' })
        highlightMessage(messageElement)
      }
      updateScrollInfoImmediate()
    })
  }

  /**
   * Scroll to specific message (updated for non-virtual scroll)
   */
  const scrollToMessage = (messageId: string, itemsGetter?: () => Array<{ id: string }>) => {
    // Use scrollToMessageBase directly (no virtual scroller)
    scrollToMessageBase(messageId)
  }

  const setupScrollObserver = () => {
    if (intersectionObserver) {
      intersectionObserver.disconnect()
    }

    intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        aboveThreshold.value = !entry.isIntersecting
        updateScrollInfoImmediate()
      },
      {
        root: messagesContainer.value,
        rootMargin: '0px 0px 20px 0px',
        threshold: 0
      }
    )

    if (scrollAnchor.value) {
      intersectionObserver.observe(scrollAnchor.value)
    }

    updateScrollInfoImmediate()
  }

  onBeforeUnmount(() => {
    if (intersectionObserver) {
      intersectionObserver.disconnect()
      intersectionObserver = null
    }

    if (scrollRetryTimer) {
      clearTimeout(scrollRetryTimer)
      scrollRetryTimer = null
    }

    if (bottomScrollRetryTimer) {
      clearTimeout(bottomScrollRetryTimer)
      bottomScrollRetryTimer = null
    }
    bottomScrollCancelToken++

    pendingScrollTargetId = null
  })

  return {
    // Refs
    messagesContainer,
    scrollAnchor,
    aboveThreshold: readonly(aboveThreshold),

    // Scroll info (readonly to prevent external mutation)
    scrollInfo: readonly(scrollInfo),

    // Methods
    scrollToBottom,
    scrollToBottomBase,
    scrollToMessage,
    scrollToMessageBase,
    handleScroll,
    updateScrollInfo: updateScrollInfoImmediate,
    setupScrollObserver,
    highlightMessage
  }
}
