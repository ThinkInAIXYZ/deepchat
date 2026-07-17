import { ref, type Ref } from 'vue'

type GestureKind = 'wheel' | 'touch' | 'pointer' | 'keyboard'

type UseListGesturesOptions = {
  viewport: Ref<HTMLElement | null>
  /** ms to wait after the last scroll signal before declaring the list settled. */
  scrollIdleMs: number
  /** scrollTop at/below which an upward drag should arm history pagination. */
  topHistoryThreshold: number
  /** Notifies the scroll controller that a user gesture began (suspends auto-follow). */
  onGestureStart: (kind: GestureKind) => void
  /** Notifies the scroll controller that the user gesture ended. */
  onGestureEnd: () => void
  /** Called once when scrolling starts, to pin the overscan window around the gesture. */
  onScrollingStart: () => void
  /** Called once the list has settled (no active gesture, idle elapsed). */
  onScrollingSettled: () => void
  /** Called on settle when an upward-pagination intent is armed at the top. */
  onIdleHistoryLoad: () => void
}

/**
 * Single-responsibility atom: translates raw DOM pointer/touch/wheel/keyboard
 * activity into a small intent surface — `isListScrolling`, an "active gesture"
 * flag, and an armed upward-pagination intent — and fires lifecycle callbacks at
 * the right moments. It owns NO window, geometry, or history state; the composing
 * hook wires those in through callbacks so this atom stays free of cross-concern
 * coupling.
 */
export function useListGestures(options: UseListGesturesOptions) {
  const { viewport, scrollIdleMs, topHistoryThreshold } = options

  const isListScrolling = ref(false)

  let scrollIdleTimer: number | null = null
  let isListGestureActive = false
  let pendingHistoryLoadAtIdle = false
  let hasUpwardPaginationIntent = false
  let lastGestureClientY: number | null = null

  function finishListScrollingNow(): void {
    isListScrolling.value = false
    options.onGestureEnd()
    options.onScrollingSettled()
    if (pendingHistoryLoadAtIdle) {
      pendingHistoryLoadAtIdle = false
      options.onIdleHistoryLoad()
    }
  }

  function finishListScrollingAfterIdle(delay = scrollIdleMs): void {
    if (scrollIdleTimer !== null) {
      window.clearTimeout(scrollIdleTimer)
      scrollIdleTimer = null
    }
    if (delay <= 0 && !isListGestureActive) {
      finishListScrollingNow()
      return
    }
    scrollIdleTimer = window.setTimeout(() => {
      scrollIdleTimer = null
      if (isListGestureActive) {
        finishListScrollingAfterIdle()
        return
      }
      finishListScrollingNow()
    }, delay)
  }

  function markListScrolling(): void {
    if (!isListScrolling.value) {
      isListScrolling.value = true
      options.onScrollingStart()
    }

    if (isListGestureActive) {
      if (scrollIdleTimer !== null) {
        window.clearTimeout(scrollIdleTimer)
        scrollIdleTimer = null
      }
      return
    }

    finishListScrollingAfterIdle()
  }

  function beginListGesture(kind: 'touch' | 'pointer', clientY?: number): void {
    options.onGestureStart(kind)
    isListGestureActive = true
    lastGestureClientY = clientY ?? null
    markListScrolling()
  }

  function updateUpwardPaginationIntent(isUpward: boolean): void {
    hasUpwardPaginationIntent = isUpward
    if (!isUpward) {
      pendingHistoryLoadAtIdle = false
      return
    }

    if ((viewport.value?.scrollTop ?? Number.POSITIVE_INFINITY) <= topHistoryThreshold) {
      pendingHistoryLoadAtIdle = true
    }
  }

  function endListGesture(): void {
    if (!isListGestureActive) {
      lastGestureClientY = null
      return
    }
    isListGestureActive = false
    lastGestureClientY = null
    finishListScrollingAfterIdle(0)
  }

  function onListTouchStart(event: TouchEvent): void {
    lastGestureClientY = event.touches[0]?.clientY ?? null
  }

  function onListTouchMove(event: TouchEvent): void {
    const clientY = event.touches[0]?.clientY
    if (clientY !== undefined && lastGestureClientY !== null) {
      updateUpwardPaginationIntent(clientY > lastGestureClientY)
    }
    if (!isListGestureActive) {
      beginListGesture('touch', clientY)
      return
    }
    lastGestureClientY = clientY ?? lastGestureClientY
    markListScrolling()
  }

  function onListTouchEnd(): void {
    if (!isListGestureActive) {
      lastGestureClientY = null
      return
    }
    isListGestureActive = false
    lastGestureClientY = null
    finishListScrollingAfterIdle()
  }

  function onListTouchCancel(): void {
    endListGesture()
  }

  function onListPointerDown(event: PointerEvent): void {
    const el = viewport.value
    if (!el || el.scrollHeight <= el.clientHeight) return
    const rect = el.getBoundingClientRect()
    const scrollbarHitWidth = Math.max(el.offsetWidth - el.clientWidth, 12)
    if (event.clientX < rect.right - scrollbarHitWidth) return
    beginListGesture('pointer', event.clientY)
  }

  function onListPointerMove(event: PointerEvent): void {
    if (isListGestureActive && event.buttons !== 0) {
      if (lastGestureClientY !== null) {
        updateUpwardPaginationIntent(event.clientY < lastGestureClientY)
      }
      lastGestureClientY = event.clientY
      markListScrolling()
    }
  }

  function onListPointerEnd(): void {
    endListGesture()
  }

  function onListScrollEnd(): void {
    if (!isListGestureActive) {
      finishListScrollingAfterIdle(0)
    }
  }

  /**
   * Keyboard scroll intent (arrow/page/home/end) routed through the same gesture
   * lifecycle so auto-follow yields to the user identically to pointer input.
   */
  function markKeyboardScrollIntent(isUpward: boolean): void {
    options.onGestureStart('keyboard')
    updateUpwardPaginationIntent(isUpward)
    markListScrolling()
  }

  /** Wheel intent: arm pagination direction and keep the scrolling state warm. */
  function markWheelScrollIntent(isUpward: boolean): void {
    updateUpwardPaginationIntent(isUpward)
    markListScrolling()
  }

  function isGestureActive(): boolean {
    return isListGestureActive
  }

  function consumeUpwardPaginationIntent(): boolean {
    const armed = hasUpwardPaginationIntent
    hasUpwardPaginationIntent = false
    return armed
  }

  function armPendingHistoryLoadAtIdle(): void {
    pendingHistoryLoadAtIdle = true
  }

  function reset(): void {
    if (scrollIdleTimer !== null) {
      window.clearTimeout(scrollIdleTimer)
      scrollIdleTimer = null
    }
    isListScrolling.value = false
    isListGestureActive = false
    pendingHistoryLoadAtIdle = false
    hasUpwardPaginationIntent = false
    lastGestureClientY = null
  }

  function resetIntentForSessionChange(): void {
    pendingHistoryLoadAtIdle = false
    hasUpwardPaginationIntent = false
    lastGestureClientY = null
  }

  return {
    isListScrolling,
    // DOM event handlers (bound in template)
    onListTouchStart,
    onListTouchMove,
    onListTouchEnd,
    onListTouchCancel,
    onListPointerDown,
    onListPointerMove,
    onListPointerEnd,
    onListScrollEnd,
    // intent helpers used by wheel/keyboard/native-scroll paths
    markListScrolling,
    markWheelScrollIntent,
    markKeyboardScrollIntent,
    updateUpwardPaginationIntent,
    consumeUpwardPaginationIntent,
    armPendingHistoryLoadAtIdle,
    isGestureActive,
    reset,
    resetIntentForSessionChange
  }
}
