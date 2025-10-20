import { ref, reactive, readonly, onUnmounted, nextTick } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { ScrollInfo } from './types'

export function useMessageScroll() {
  const messagesContainer = ref<HTMLDivElement>()
  const scrollAnchor = ref<HTMLDivElement>()
  const aboveThreshold = ref(false)

  const scrollInfo = reactive<ScrollInfo>({
    viewportHeight: 0,
    contentHeight: 0,
    scrollTop: 0
  })

  let intersectionObserver: IntersectionObserver | null = null

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

  const scrollToBottom = (_smooth = false) => {
    const container = messagesContainer.value
    if (!container) {
      return
    }

    const targetTop = Math.max(container.scrollHeight - container.clientHeight, 0)
    container.scrollTop = targetTop
    updateScrollInfoImmediate()
  }

  /**
   * 滚动到指定消息
   */
  const scrollToMessage = (messageId: string) => {
    nextTick(() => {
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
      if (messageElement) {
        messageElement.scrollIntoView({
          block: 'start'
        })

        // 添加高亮效果
        messageElement.classList.add('message-highlight')
        setTimeout(() => {
          messageElement.classList.remove('message-highlight')
        }, 2000)
      }
      updateScrollInfoImmediate()
    })
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

  onUnmounted(() => {
    if (intersectionObserver) {
      intersectionObserver.disconnect()
      intersectionObserver = null
    }
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
    scrollToMessage,
    handleScroll,
    updateScrollInfo: updateScrollInfoImmediate, // Export immediate version
    setupScrollObserver
  }
}
