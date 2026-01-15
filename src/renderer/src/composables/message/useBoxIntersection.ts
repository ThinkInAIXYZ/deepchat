import { ref, onBeforeUnmount, type Ref } from 'vue'

export interface BoxVisibility {
  id: string
  inView: boolean
}

export interface UseBoxIntersectionOptions {
  // Container element to observe within
  containerRef: Ref<HTMLElement | undefined>
  // Pre-render buffer: number of boxes to render ahead/behind visible area
  preRenderBuffer?: number
  // Root margin for intersection observer
  rootMargin?: string
}

export function useBoxIntersection(options: UseBoxIntersectionOptions) {
  const { containerRef, preRenderBuffer = 2, rootMargin = '200px' } = options

  const visibilityMap = ref<Map<string, boolean>>(new Map())
  const observedElements = new Map<string, HTMLElement>()
  let observer: IntersectionObserver | null = null

  const setupObserver = () => {
    if (observer) return

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const messageId = entry.target.getAttribute('data-message-id')
          if (!messageId) continue

          const isIntersecting = entry.isIntersecting
          visibilityMap.value.set(messageId, isIntersecting)
        }

        // Apply pre-render buffer
        applyPreRenderBuffer()
      },
      {
        root: containerRef.value,
        rootMargin,
        threshold: [0, 0.1, 0.5, 0.9, 1.0]
      }
    )
  }

  const applyPreRenderBuffer = () => {
    if (!observer) return

    // Get all message IDs in order
    const allIds = Array.from(observedElements.keys())
    const visibleIds = allIds.filter((id) => visibilityMap.value.get(id))

    if (visibleIds.length === 0) {
      // If nothing is visible, show first few items
      allIds.slice(0, preRenderBuffer * 2).forEach((id) => {
        visibilityMap.value.set(id, true)
      })
      return
    }

    // Find min and max visible indices
    const visibleIndices = visibleIds.map((id) => allIds.indexOf(id))
    const minVisibleIndex = Math.min(...visibleIndices)
    const maxVisibleIndex = Math.max(...visibleIndices)

    // Calculate buffer range
    const bufferStart = Math.max(0, minVisibleIndex - preRenderBuffer)
    const bufferEnd = Math.min(allIds.length - 1, maxVisibleIndex + preRenderBuffer)

    // Update visibility map with buffer
    allIds.forEach((id, index) => {
      const shouldBeVisible = index >= bufferStart && index <= bufferEnd
      visibilityMap.value.set(id, shouldBeVisible)
    })
  }

  const observeBox = (messageId: string, element: HTMLElement) => {
    if (!messageId || !element) return

    // Setup observer if not already done
    if (!observer) {
      setupObserver()
    }

    // Cleanup previous observation if exists
    const previousElement = observedElements.get(messageId)
    if (previousElement && observer) {
      observer.unobserve(previousElement)
    }

    // Store and observe
    observedElements.set(messageId, element)
    if (observer) {
      observer.observe(element)
      // Initialize visibility to true for immediate render
      visibilityMap.value.set(messageId, true)
    }
  }

  const unobserveBox = (messageId: string) => {
    const element = observedElements.get(messageId)
    if (element && observer) {
      observer.unobserve(element)
    }
    observedElements.delete(messageId)
    visibilityMap.value.delete(messageId)
  }

  const isBoxInView = (messageId: string): boolean => {
    return visibilityMap.value.get(messageId) ?? false
  }

  const cleanupObserver = () => {
    if (observer) {
      observer.disconnect()
      observer = null
    }
    observedElements.clear()
    visibilityMap.value.clear()
  }

  const resetObserver = () => {
    cleanupObserver()
    setupObserver()
  }

  onBeforeUnmount(() => {
    cleanupObserver()
  })

  return {
    visibilityMap,
    observeBox,
    unobserveBox,
    isBoxInView,
    cleanupObserver,
    resetObserver
  }
}
