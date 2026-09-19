import { nextTick, ref, type Ref } from 'vue'
import { tryOnScopeDispose, usePreferredReducedMotion, useTimeoutFn } from '@vueuse/core'
import type { UISession, useSessionStore } from '@/stores/ui/session'
import { restoreSessionListScrollTop } from './useSessionListAutoFill'

export type SessionItemRegion = 'pinned' | 'grouped'
export type PinFeedbackMode = 'pinning' | 'unpinning'

const PIN_FEEDBACK_DURATION_MS: Record<PinFeedbackMode, number> = {
  pinning: 560,
  unpinning: 460
}
const PIN_FLIGHT_DURATION_MS = 460
const PIN_TARGET_SETTLE_MAX_FRAMES = 10
const PIN_TARGET_SETTLE_EPSILON_PX = 0.5

const getPinFeedbackMode = (nextPinned: boolean): PinFeedbackMode =>
  nextPinned ? 'pinning' : 'unpinning'

type SessionItemRect = {
  left: number
  top: number
  width: number
  height: number
}

interface UseSessionPinFlightOptions {
  sessionStore: ReturnType<typeof useSessionStore>
  sessionListRef: Ref<HTMLElement | null>
}

/**
 * Animates a session row flying between the pinned section and its group when its pinned
 * state toggles, then plays a short feedback pulse on the landed row. Respects the
 * user's reduced-motion preference by committing the toggle without animation.
 */
export function useSessionPinFlight(options: UseSessionPinFlightOptions) {
  const { sessionStore, sessionListRef } = options

  const pinFlightSessionId = ref<string | null>(null)
  const pinDockedSessionId = ref<string | null>(null)
  const pinFeedbackSessionId = ref<string | null>(null)
  const pinFeedbackMode = ref<PinFeedbackMode | null>(null)

  const reducedMotion = usePreferredReducedMotion()
  const prefersReducedMotion = () => reducedMotion.value === 'reduce'

  const pinFeedbackTimeout = useTimeoutFn(
    () => {
      pinFeedbackSessionId.value = null
      pinFeedbackMode.value = null
    },
    () => PIN_FEEDBACK_DURATION_MS[pinFeedbackMode.value ?? 'pinning'],
    { immediate: false }
  )

  const clearPinFeedback = () => {
    pinFeedbackTimeout.stop()
    pinFeedbackSessionId.value = null
    pinFeedbackMode.value = null
  }

  const applyPinFeedback = (sessionId: string, nextPinned: boolean) => {
    if (prefersReducedMotion()) {
      clearPinFeedback()
      return
    }

    pinFeedbackTimeout.stop()
    pinFeedbackSessionId.value = sessionId
    pinFeedbackMode.value = getPinFeedbackMode(nextPinned)
    pinFeedbackTimeout.start()
  }

  const commitPinToggle = async (session: UISession, nextPinned: boolean, withFeedback = true) => {
    await sessionStore.toggleSessionPinned(session.id, nextPinned)
    if (withFeedback) {
      applyPinFeedback(session.id, nextPinned)
    }
    await nextTick()
  }

  const waitForAnimationFrame = () =>
    new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })

  const getSessionItemElement = (sessionId: string, region: SessionItemRegion) =>
    document.querySelector<HTMLElement>(
      `.session-item[data-session-id="${sessionId}"][data-session-region="${region}"]`
    )

  const getPinPlaceholderElement = (sessionId: string, region: SessionItemRegion) =>
    document.querySelector<HTMLElement>(
      `.session-item[data-session-id="${sessionId}"][data-session-region="${region}"][data-pin-placeholder="true"]`
    )

  const captureSessionItemRect = (element: HTMLElement | null): SessionItemRect | null => {
    if (!element) {
      return null
    }

    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) {
      return null
    }

    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    }
  }

  const areSessionItemRectsEqual = (left: SessionItemRect, right: SessionItemRect) =>
    Math.abs(left.left - right.left) <= PIN_TARGET_SETTLE_EPSILON_PX &&
    Math.abs(left.top - right.top) <= PIN_TARGET_SETTLE_EPSILON_PX &&
    Math.abs(left.width - right.width) <= PIN_TARGET_SETTLE_EPSILON_PX &&
    Math.abs(left.height - right.height) <= PIN_TARGET_SETTLE_EPSILON_PX

  const waitForPinTargetPlaceholder = async (
    sessionId: string,
    region: SessionItemRegion
  ): Promise<{ element: HTMLElement; rect: SessionItemRect } | null> => {
    let previousRect: SessionItemRect | null = null

    for (let frame = 0; frame < PIN_TARGET_SETTLE_MAX_FRAMES; frame += 1) {
      await waitForAnimationFrame()
      const element = getPinPlaceholderElement(sessionId, region)
      const rect = captureSessionItemRect(element)

      if (!element || !rect) {
        previousRect = null
        continue
      }

      if (previousRect && areSessionItemRectsEqual(previousRect, rect)) {
        return { element, rect }
      }

      previousRect = rect
    }

    const fallbackElement =
      getPinPlaceholderElement(sessionId, region) ?? getSessionItemElement(sessionId, region)
    const fallbackRect = captureSessionItemRect(fallbackElement)
    if (!fallbackElement || !fallbackRect) {
      return null
    }

    return {
      element: fallbackElement,
      rect: fallbackRect
    }
  }

  const getPinFlightAnimationOptions = (nextPinned: boolean) =>
    nextPinned
      ? {
          duration: PIN_FLIGHT_DURATION_MS,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        }
      : {
          duration: PIN_FLIGHT_DURATION_MS + 20,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
        }

  const createPinFlightKeyframes = (
    deltaX: number,
    deltaY: number,
    scaleX: number,
    scaleY: number,
    nextPinned: boolean
  ): Keyframe[] => {
    const leadX = nextPinned ? deltaX * 0.82 : deltaX * 0.9
    const leadY = nextPinned ? deltaY * 0.78 : deltaY * 0.86
    const leadScaleX = nextPinned ? 1.018 : 1.008
    const leadScaleY = nextPinned ? 1.018 : 1.008

    return [
      {
        transform: 'translate3d(0, 0, 0) scale(1)',
        opacity: 1,
        offset: 0
      },
      {
        transform: `translate3d(${leadX}px, ${leadY}px, 0) scale(${leadScaleX}, ${leadScaleY})`,
        opacity: 1,
        offset: nextPinned ? 0.68 : 0.74
      },
      {
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
        opacity: 1,
        offset: 1
      }
    ]
  }

  const createPinFlightClone = (sourceElement: HTMLElement, sourceRect: DOMRect) => {
    const clone = sourceElement.cloneNode(true) as HTMLElement

    clone.removeAttribute('style')
    clone.classList.remove('is-hero-hidden')
    delete clone.dataset.pinFx
    delete clone.dataset.heroHidden
    clone.setAttribute('aria-hidden', 'true')
    clone.classList.add('sidebar-pin-flight')
    Object.assign(clone.style, {
      position: 'fixed',
      left: `${sourceRect.left}px`,
      top: `${sourceRect.top}px`,
      width: `${sourceRect.width}px`,
      height: `${sourceRect.height}px`,
      margin: '0',
      pointerEvents: 'none',
      zIndex: '2147483647',
      transformOrigin: 'top left',
      willChange: 'transform',
      contain: 'layout style paint'
    })

    return clone
  }

  const animatePinFlight = async (session: UISession, nextPinned: boolean) => {
    const sourceRegion: SessionItemRegion = session.isPinned ? 'pinned' : 'grouped'
    const targetRegion: SessionItemRegion = nextPinned ? 'pinned' : 'grouped'
    const sourceElement = getSessionItemElement(session.id, sourceRegion)
    const sourceRect = sourceElement?.getBoundingClientRect()
    const preservedScrollTop = sessionListRef.value?.scrollTop ?? null

    if (!sourceElement || !sourceRect || sourceRect.width === 0 || sourceRect.height === 0) {
      await commitPinToggle(session, nextPinned)
      return
    }

    const clone = createPinFlightClone(sourceElement, sourceRect)
    document.body.appendChild(clone)
    pinFlightSessionId.value = session.id
    if (!nextPinned) {
      pinDockedSessionId.value = session.id
    }
    await nextTick()

    try {
      await waitForAnimationFrame()
      clone.dataset.pinState = 'docked'
      await waitForAnimationFrame()

      await commitPinToggle(session, nextPinned, false)
      restoreSessionListScrollTop(sessionListRef.value, preservedScrollTop)
      await waitForAnimationFrame()
      restoreSessionListScrollTop(sessionListRef.value, preservedScrollTop)
      await waitForAnimationFrame()

      const targetSettledState = await waitForPinTargetPlaceholder(session.id, targetRegion)
      const targetElement = targetSettledState?.element
      const targetRect = targetSettledState?.rect

      if (!targetElement || !targetRect) {
        clone.remove()
        if (pinDockedSessionId.value === session.id) {
          pinDockedSessionId.value = null
        }
        applyPinFeedback(session.id, nextPinned)
        if (pinFlightSessionId.value === session.id) {
          pinFlightSessionId.value = null
        }
        await nextTick()
        return
      }

      const deltaX = targetRect.left - sourceRect.left
      const deltaY = targetRect.top - sourceRect.top
      const scaleX = targetRect.width / sourceRect.width
      const scaleY = targetRect.height / sourceRect.height

      const animation = clone.animate(
        createPinFlightKeyframes(deltaX, deltaY, scaleX, scaleY, nextPinned),
        {
          ...getPinFlightAnimationOptions(nextPinned),
          fill: 'forwards'
        }
      )

      await animation.finished.catch(() => undefined)
      clone.remove()
      if (pinDockedSessionId.value === session.id) {
        pinDockedSessionId.value = null
      }
      applyPinFeedback(session.id, nextPinned)
      if (pinFlightSessionId.value === session.id) {
        pinFlightSessionId.value = null
      }
      await nextTick()
    } finally {
      if (pinDockedSessionId.value === session.id) {
        pinDockedSessionId.value = null
      }
      if (pinFlightSessionId.value === session.id) {
        pinFlightSessionId.value = null
      }
      clone.remove()
    }
  }

  /**
   * Pin toggles are serialized: a toggle requested while a flight is still animating
   * starts only after that flight settles. The flight/docked ownership refs hold a
   * single id, so concurrent flights would fight over them and unhide each other's
   * source rows mid-animation.
   */
  let pinToggleChain: Promise<void> = Promise.resolve()

  const handleTogglePin = (session: UISession) => {
    const queued = pinToggleChain.then(async () => {
      const nextPinned = !session.isPinned

      try {
        if (prefersReducedMotion()) {
          await commitPinToggle(session, nextPinned)
          return
        }

        await animatePinFlight(session, nextPinned)
      } catch (error) {
        console.error('Failed to toggle pin status:', error)
      }
    })
    pinToggleChain = queued
    return queued
  }

  tryOnScopeDispose(() => {
    pinFlightSessionId.value = null
    pinDockedSessionId.value = null
    clearPinFeedback()
  })

  return {
    pinFlightSessionId,
    pinDockedSessionId,
    pinFeedbackSessionId,
    pinFeedbackMode,
    handleTogglePin
  }
}
