import { nextTick, watch, type MaybeRefOrGetter, type Ref, toValue } from 'vue'
import { tryOnMounted, tryOnScopeDispose, useResizeObserver } from '@vueuse/core'
import type { useSessionStore } from '@/stores/ui/session'

export const restoreSessionListScrollTop = (
  listElement: HTMLElement | null,
  scrollTop: number | null
) => {
  if (scrollTop === null || !listElement) {
    return
  }

  listElement.scrollTop = scrollTop
}

interface UseSessionListAutoFillOptions {
  sessionStore: ReturnType<typeof useSessionStore>
  sessionListRef: Ref<HTMLElement | null>
  collapsed: MaybeRefOrGetter<boolean>
  canAutoFill: MaybeRefOrGetter<boolean>
  /** While true (e.g. during a group drag) scrolling and auto-fill are paused. */
  suspended: MaybeRefOrGetter<boolean>
  /** Extra reactive sources that should re-trigger the fill check when they change. */
  fillCheckSources: MaybeRefOrGetter<unknown>[]
}

/**
 * Keeps the session list paginated: loads the next page near the scroll bottom, and when
 * the first pages are too short to produce a scrollbar keeps loading until the viewport
 * is filled (issue #1762).
 */
export function useSessionListAutoFill(options: UseSessionListAutoFillOptions) {
  const { sessionStore, sessionListRef } = options

  let scrollFrame: number | null = null
  let fillFrame: number | null = null
  let isFillingSessionList = false

  const performSessionListScrollCheck = () => {
    const listElement = sessionListRef.value
    if (
      !listElement ||
      toValue(options.suspended) ||
      sessionStore.loadingMore ||
      !sessionStore.hasMore
    ) {
      return
    }

    const distanceToBottom =
      listElement.scrollHeight - listElement.scrollTop - listElement.clientHeight

    if (distanceToBottom <= 96) {
      void sessionStore.loadNextPage()
    }
  }

  const handleSessionListScroll = () => {
    if (scrollFrame !== null) {
      return
    }

    scrollFrame = window.requestAnimationFrame(() => {
      scrollFrame = null
      performSessionListScrollCheck()
    })
  }

  const ensureSessionListFilled = async () => {
    if (
      isFillingSessionList ||
      toValue(options.suspended) ||
      toValue(options.collapsed) ||
      !toValue(options.canAutoFill)
    ) {
      return
    }
    isFillingSessionList = true
    try {
      // 轮数上限兜底，避免异常情况下（如 cursor 不推进）陷入死循环。
      const MAX_FILL_ROUNDS = 50
      for (let round = 0; round < MAX_FILL_ROUNDS; round += 1) {
        await nextTick()
        const listElement = sessionListRef.value
        if (
          !listElement ||
          toValue(options.suspended) ||
          toValue(options.collapsed) ||
          !toValue(options.canAutoFill) ||
          !sessionStore.hasMore ||
          sessionStore.loadingMore ||
          sessionStore.loading
        ) {
          return
        }
        // 内容高度已超过容器（存在可滚动空间），交还给滚动事件处理后续分页。
        if (listElement.scrollHeight > listElement.clientHeight + 1) {
          return
        }
        const beforeCount = sessionStore.sessions.length
        const beforeHasMore = sessionStore.hasMore
        await sessionStore.loadNextPage()
        if (
          beforeHasMore === sessionStore.hasMore &&
          sessionStore.hasMore &&
          sessionStore.sessions.length <= beforeCount
        ) {
          return
        }
      }
    } finally {
      isFillingSessionList = false
    }
  }

  const scheduleSessionListFillCheck = () => {
    if (fillFrame !== null) {
      return
    }

    fillFrame = window.requestAnimationFrame(() => {
      fillFrame = null
      void ensureSessionListFilled()
    })
  }

  // 会话列表内容或容器高度变化后，若视口仍未填满则继续加载，保证「滚动加载更多」
  // 在首屏内容过少时也能启动（issue #1762）。搜索仅过滤已加载会话，仍要求所有
  // 分组展开，避免因为筛选或隐藏行扫完剩余分页。
  watch(
    [
      () => sessionStore.sessions.length,
      () => sessionStore.hasMore,
      () => sessionStore.loading,
      () => sessionStore.groupMode,
      () => toValue(options.collapsed),
      ...options.fillCheckSources.map((source) => () => toValue(source))
    ],
    () => {
      scheduleSessionListFillCheck()
    },
    { immediate: true }
  )

  useResizeObserver(sessionListRef, () => {
    scheduleSessionListFillCheck()
  })

  tryOnMounted(() => {
    scheduleSessionListFillCheck()
  })

  tryOnScopeDispose(() => {
    if (scrollFrame !== null) {
      window.cancelAnimationFrame(scrollFrame)
      scrollFrame = null
    }

    if (fillFrame !== null) {
      window.cancelAnimationFrame(fillFrame)
      fillFrame = null
    }
  })

  return {
    handleSessionListScroll,
    ensureSessionListFilled
  }
}
