import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { useMessageWindow } from '@/composables/message/useMessageWindow'
import type { DisplayMessage } from '@/features/chat-page/model/displayMessage'

type MessageWindow = ReturnType<typeof useMessageWindow>

type LogicalViewportAnchor = {
  messageId: string
  layoutTop: number
}

type UseMessageVirtualizationOptions = {
  viewport: Ref<HTMLElement | null>
  displayMessages: ComputedRef<DisplayMessage[]>
  messageWindow: MessageWindow
  windowingThreshold: number
  initialWindowCount: number
  overscanPx: number
  /** Reads the logical origin top of the window inside the scroll container. */
  getWindowOriginTop: (el: HTMLElement) => number | null
  /** True while a user gesture freezes windowing/measurement. */
  isListScrolling: Ref<boolean>
  /** True when the list is pinned to the bottom (auto-follow / restoring). */
  isBottomFollowingMode: () => boolean
  /** Scrolls to keep bottom pinned; mirrors ChatPage.scrollToBottom. */
  scrollToBottom: (force?: boolean) => void
  /** Requests an absolute-top anchor correction through the scroll controller. */
  requestAnchorScroll: (top: number) => void
  currentScrollMode: () => string
}

/**
 * Single-responsibility atom for message virtualization: computes the rendered
 * window range from the shared geometry refs, batches ResizeObserver measurements
 * into one rAF commit, and preserves the reading position across height changes
 * with a logical (not DOM-rect) anchor. It owns no gesture or session state.
 */
export function useMessageVirtualization(options: UseMessageVirtualizationOptions) {
  const { viewport, displayMessages, messageWindow } = options
  const { windowingThreshold, initialWindowCount, overscanPx } = options

  // Shared geometry, written by the composing hook's scroll/resize reads.
  const scrollViewportTop = ref(0)
  const scrollViewportHeight = ref(0)
  const messageWindowOriginTop = ref(0)

  const pendingMeasureQueue = new Map<string, number>()
  let pendingMeasureFlushFrame: number | null = null

  const findFirstEntryWithBottomAtOrAfter = (
    entries: Array<{ bottom: number }>,
    target: number
  ): number => {
    let low = 0
    let high = entries.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (entries[middle].bottom >= target) {
        high = middle
      } else {
        low = middle + 1
      }
    }
    return low
  }

  const findFirstEntryWithTopAfter = (entries: Array<{ top: number }>, target: number): number => {
    let low = 0
    let high = entries.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (entries[middle].top > target) {
        high = middle
      } else {
        low = middle + 1
      }
    }
    return low
  }

  const messageWindowRange = computed(() => {
    const entries = messageWindow.entries.value
    const total = entries.length
    if (total === 0) {
      return { start: 0, end: 0, before: 0, after: 0 }
    }

    if (total <= windowingThreshold) {
      return { start: 0, end: total, before: 0, after: 0 }
    }

    const viewportHeight = scrollViewportHeight.value
    if (viewportHeight <= 0) {
      const start = Math.max(0, total - initialWindowCount)
      return {
        start,
        end: total,
        before: entries[start]?.top ?? 0,
        after: 0
      }
    }

    const viewportTop = Math.max(scrollViewportTop.value - messageWindowOriginTop.value, 0)
    const windowTop = Math.max(0, viewportTop - overscanPx)
    const windowBottom = viewportTop + viewportHeight + overscanPx
    let start = findFirstEntryWithBottomAtOrAfter(entries, windowTop)
    if (start >= total) start = Math.max(0, total - initialWindowCount)

    let end = findFirstEntryWithTopAfter(entries, windowBottom)
    end = Math.min(total, Math.max(end, start + 1))

    return {
      start,
      end,
      before: entries[start]?.top ?? 0,
      after: Math.max((messageWindow.totalHeight.value ?? 0) - (entries[end - 1]?.bottom ?? 0), 0)
    }
  })

  const visibleDisplayMessages = computed(() => {
    const { start, end } = messageWindowRange.value
    return displayMessages.value.slice(start, end)
  })
  const messageWindowBeforeHeight = computed(() => messageWindowRange.value.before)
  const messageWindowAfterHeight = computed(() => messageWindowRange.value.after)

  const usesWindowedMessages = () => messageWindow.entries.value.length > windowingThreshold

  function captureLogicalViewportAnchor(): LogicalViewportAnchor | null {
    const container = viewport.value
    if (!container) return null

    const originTop = options.getWindowOriginTop(container)
    if (originTop === null) return null
    const layoutViewportTop = Math.max(container.scrollTop - originTop, 0)
    const entries = messageWindow.entries.value
    const anchorIndex = findFirstEntryWithBottomAtOrAfter(entries, layoutViewportTop)
    const anchor = entries[Math.min(anchorIndex, entries.length - 1)]
    return anchor ? { messageId: anchor.id, layoutTop: anchor.top } : null
  }

  function restoreLogicalViewportAnchor(anchor: LogicalViewportAnchor | null): void {
    if (!anchor || options.isBottomFollowingMode() || options.isListScrolling.value) return

    const container = viewport.value
    const nextAnchor = messageWindow.getEntry(anchor.messageId)
    if (!container || !nextAnchor) return

    const delta = nextAnchor.top - anchor.layoutTop
    if (Math.abs(delta) < 1) return

    options.requestAnchorScroll(container.scrollTop + delta)
  }

  function applyMessageMeasures(payloads: Array<{ messageId: string; height: number }>) {
    if (payloads.length === 0) return

    // Snapshot the logical entry before changing the height map. DOM rects are
    // intentionally not used here: waiting for a later rendered rect produces a
    // visible drift frame before the corrective scroll.
    const isBottomFollowing = options.isBottomFollowingMode()
    const windowed = usesWindowedMessages()
    const preChangeAnchor = isBottomFollowing || !windowed ? null : captureLogicalViewportAnchor()

    let changed = false
    for (const payload of payloads) {
      const delta = messageWindow.setMeasuredHeight(payload.messageId, payload.height)
      if (delta === 0) continue
      changed = true
    }
    if (!changed) return
    messageWindow.flushMeasurements()

    if (isBottomFollowing) {
      // Unified coalesced auto-follow path (same as streamRevision watcher).
      options.scrollToBottom(options.currentScrollMode() === 'restoring')
    } else if (windowed) {
      restoreLogicalViewportAnchor(preChangeAnchor)
    }
  }

  function flushPendingMeasures(): void {
    if (pendingMeasureFlushFrame !== null || pendingMeasureQueue.size === 0) return

    pendingMeasureFlushFrame = window.requestAnimationFrame(() => {
      pendingMeasureFlushFrame = null
      const batch = Array.from(pendingMeasureQueue, ([messageId, height]) => ({
        messageId,
        height
      }))
      pendingMeasureQueue.clear()
      applyMessageMeasures(batch)
      flushPendingMeasures()
    })
  }

  function onMessageMeasure(payload: { messageId: string; height: number }) {
    // Always batch row measurements. Window mounts commonly emit many ResizeObserver
    // callbacks in the same frame; committing them one-by-one makes the spacer and
    // rendered range chase each other.
    pendingMeasureQueue.set(payload.messageId, payload.height)
    if (!options.isListScrolling.value) {
      flushPendingMeasures()
    }
  }

  /** Pin the current window around the start of a gesture so overscan is centered. */
  function pinWindowToViewport(): void {
    const el = viewport.value
    if (el) {
      scrollViewportTop.value = el.scrollTop
      scrollViewportHeight.value = el.clientHeight
    }
  }

  function cancelPendingMeasureFlush(): void {
    if (pendingMeasureFlushFrame !== null) {
      window.cancelAnimationFrame(pendingMeasureFlushFrame)
      pendingMeasureFlushFrame = null
    }
    pendingMeasureQueue.clear()
  }

  return {
    // geometry refs (written by the composing hook's metric sync)
    scrollViewportTop,
    scrollViewportHeight,
    messageWindowOriginTop,
    // rendered window
    messageWindowRange,
    visibleDisplayMessages,
    messageWindowBeforeHeight,
    messageWindowAfterHeight,
    usesWindowedMessages,
    // measurement pipeline
    onMessageMeasure,
    flushPendingMeasures,
    cancelPendingMeasureFlush,
    // anchors
    captureLogicalViewportAnchor,
    restoreLogicalViewportAnchor,
    pinWindowToViewport
  }
}
