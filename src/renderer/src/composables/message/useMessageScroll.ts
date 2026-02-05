import { ref, reactive, readonly, onBeforeUnmount, nextTick, type Ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { ScrollInfo } from './types'
import type { DynamicScroller } from 'vue-virtual-scroller'

// === Constants ===
const MESSAGE_HIGHLIGHT_CLASS = 'message-highlight'
const MAX_SCROLL_RETRIES = 12
const SCROLL_RETRY_DELAY = 80
const HIGHLIGHT_DURATION = 2000
const PLACEHOLDER_POSITION_THRESHOLD = 5000

export interface UseMessageScrollOptions {
  dynamicScrollerRef?: Ref<InstanceType<typeof DynamicScroller> | null>
  shouldAutoFollow?: Ref<boolean>
  autoScrollEnabled?: Ref<boolean>
  scrollAnchor?: Ref<HTMLDivElement | undefined>
}

export function useMessageScroll(options?: UseMessageScrollOptions) {
  const messagesContainer = ref<HTMLDivElement>()
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
   * Schedule scroll to bottom with retry mechanism for virtual scroller
   */
  const scheduleScrollToBottom = (force = false) => {
    if (bottomScrollRetryTimer) {
      clearTimeout(bottomScrollRetryTimer)
      bottomScrollRetryTimer = null
    }
    const currentBottomToken = ++bottomScrollCancelToken

    nextTick(() => {
      const shouldAutoFollow = options?.shouldAutoFollow
      const autoScrollEnabled = options?.autoScrollEnabled
      const canAutoFollow = autoScrollEnabled ? autoScrollEnabled.value : true
      if (force && shouldAutoFollow) {
        if (canAutoFollow) {
          shouldAutoFollow.value = true
        }
      }

      if (!force && !canAutoFollow) {
        updateScrollInfo()
        return
      }

      if (!force && shouldAutoFollow && !shouldAutoFollow.value) {
        updateScrollInfo()
        return
      }

      const dynamicScrollerRef = options?.dynamicScrollerRef
      const scroller = dynamicScrollerRef?.value

      if (scroller?.scrollToBottom) {
        // Virtual scroll with retry mechanism
        let retryCount = 0
        let lastScrollHeight = 0

        const attemptScrollToBottom = () => {
          if (currentBottomToken !== bottomScrollCancelToken) return
          scroller.scrollToBottom()

          nextTick(() => {
            bottomScrollRetryTimer = window.setTimeout(() => {
              bottomScrollRetryTimer = null
              if (currentBottomToken !== bottomScrollCancelToken) return

              const container = messagesContainer.value
              if (!container) {
                updateScrollInfo()
                return
              }

              const currentScrollHeight = container.scrollHeight
              const currentScrollTop = container.scrollTop
              const viewportHeight = container.clientHeight
              const distanceToBottom = currentScrollHeight - currentScrollTop - viewportHeight

              const isAtBottom = distanceToBottom <= 1
              const heightStillChanging = currentScrollHeight !== lastScrollHeight
              lastScrollHeight = currentScrollHeight

              if (!isAtBottom && heightStillChanging && retryCount < MAX_SCROLL_RETRIES) {
                retryCount++
                attemptScrollToBottom()
              } else {
                updateScrollInfo()
              }
            }, SCROLL_RETRY_DELAY)
          })
        }

        attemptScrollToBottom()
      } else {
        // Fallback to base scroll
        scrollToBottomBase()
      }
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
   * Scroll to specific message with retry mechanism for virtual scroller
   */
  const scrollToMessage = (messageId: string, itemsGetter?: () => Array<{ id: string }>) => {
    const dynamicScrollerRef = options?.dynamicScrollerRef
    const scroller = dynamicScrollerRef?.value

    if (!scroller?.scrollToItem || !itemsGetter) {
      scrollToMessageBase(messageId)
      return
    }

    const items = itemsGetter()
    const index = items.findIndex((item) => item.id === messageId)

    if (index === -1) return

    pendingScrollTargetId = messageId

    const tryApplyCenterAndHighlight = () => {
      const container = messagesContainer.value
      if (!container) return false

      const target = container.querySelector(
        `[data-message-id="${messageId}"]`
      ) as HTMLElement | null
      if (!target) return false

      const targetRect = target.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const targetTop = targetRect.top - containerRect.top + container.scrollTop

      // Check if element is actually rendered (not in placeholder state)
      if (
        Math.abs(targetTop) > PLACEHOLDER_POSITION_THRESHOLD &&
        (targetTop < 0 || targetTop > container.scrollHeight)
      ) {
        return false
      }

      target.scrollIntoView({ block: 'start', behavior: 'instant' })
      updateScrollInfo()
      highlightMessage(target)
      pendingScrollTargetId = null
      return true
    }

    if (scrollRetryTimer) clearTimeout(scrollRetryTimer)
    scrollRetryTimer = null

    const currentToken = ++scrollRetryToken
    let retryCount = 0

    const attemptScroll = () => {
      if (currentToken !== scrollRetryToken) return

      scroller.scrollToItem(index)
      nextTick(() => {
        setTimeout(() => {
          if (tryApplyCenterAndHighlight()) return

          if (++retryCount < MAX_SCROLL_RETRIES) {
            scrollRetryTimer = window.setTimeout(() => {
              scrollRetryTimer = null
              attemptScroll()
            }, SCROLL_RETRY_DELAY)
          } else {
            pendingScrollTargetId = null
          }
        }, SCROLL_RETRY_DELAY)
      })
    }

    attemptScroll()
  }

  /**
   * Handle virtual scroll update
   */
  const handleVirtualScrollUpdate = () => {
    if (!pendingScrollTargetId) return
    const container = messagesContainer.value
    if (!container) return

    const target = container.querySelector(
      `[data-message-id="${pendingScrollTargetId}"]`
    ) as HTMLElement | null
    if (!target) return

    const messageId = pendingScrollTargetId
    pendingScrollTargetId = null
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
    handleVirtualScrollUpdate,
    highlightMessage
  }
}
