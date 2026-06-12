const HERO_DURATION_MS = 380
const HERO_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'
const HERO_SETTLE_OFFSET = 0.88
const HERO_SETTLE_SCALE = 1.012
const HERO_TARGET_REVEAL_OFFSET = 0.58
const HERO_OVERLAY_FADE_OFFSET = 0.8
const HERO_CLEANUP_GRACE_MS = 240

type PendingChatInputHeroFlight = {
  clone: HTMLElement
  sourceElement: HTMLElement
  sourceOpacity: string
  cleanupTimer: number | null
}

let pendingFlight: PendingChatInputHeroFlight | null = null

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const clearPendingFlight = () => {
  if (!pendingFlight) {
    return
  }

  pendingFlight.sourceElement.style.opacity = pendingFlight.sourceOpacity
  if (pendingFlight.cleanupTimer !== null) {
    window.clearTimeout(pendingFlight.cleanupTimer)
  }
  pendingFlight.clone.remove()
  pendingFlight = null
}

const waitForAnimationCompletion = async (animation: Animation, durationMs: number) => {
  await Promise.race([
    animation.finished.catch(() => undefined),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, durationMs + HERO_CLEANUP_GRACE_MS)
    })
  ])
}

const createHeroClone = (sourceElement: HTMLElement, sourceRect: DOMRect) => {
  const clone = sourceElement.cloneNode(true) as HTMLElement
  const sourceStyle = window.getComputedStyle(sourceElement)

  clone.setAttribute('aria-hidden', 'true')
  clone.dataset.heroClone = 'chat-input'
  clone.querySelectorAll('[contenteditable]').forEach((element) => {
    element.setAttribute('contenteditable', 'false')
  })

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
    willChange: 'transform, opacity, border-radius',
    contain: 'layout style paint',
    borderRadius: sourceStyle.borderRadius
  })

  return clone
}

export const prepareChatInputHeroFlight = (sourceElement: HTMLElement | null): boolean => {
  clearPendingFlight()

  if (
    !sourceElement ||
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    prefersReducedMotion()
  ) {
    return false
  }

  const sourceRect = sourceElement.getBoundingClientRect()
  if (sourceRect.width === 0 || sourceRect.height === 0) {
    return false
  }

  const clone = createHeroClone(sourceElement, sourceRect)
  document.body.appendChild(clone)

  const cleanupTimer = window.setTimeout(() => {
    clearPendingFlight()
  }, HERO_DURATION_MS + HERO_CLEANUP_GRACE_MS)

  pendingFlight = {
    clone,
    sourceElement,
    sourceOpacity: sourceElement.style.opacity,
    cleanupTimer
  }

  sourceElement.style.opacity = '0'
  return true
}

export const cancelChatInputHeroFlight = () => {
  clearPendingFlight()
}

export const playChatInputHeroFlight = async (
  targetElement: HTMLElement | null
): Promise<boolean> => {
  if (!pendingFlight) {
    return false
  }

  if (
    !targetElement ||
    typeof window === 'undefined' ||
    prefersReducedMotion() ||
    !document.body.contains(pendingFlight.clone)
  ) {
    clearPendingFlight()
    return false
  }

  const flight = pendingFlight
  pendingFlight = null
  if (flight.cleanupTimer !== null) {
    window.clearTimeout(flight.cleanupTimer)
  }

  const targetRect = targetElement.getBoundingClientRect()
  if (targetRect.width === 0 || targetRect.height === 0) {
    flight.sourceElement.style.opacity = flight.sourceOpacity
    flight.clone.remove()
    return false
  }

  const sourceRect = flight.clone.getBoundingClientRect()
  const targetStyle = window.getComputedStyle(targetElement)
  const deltaX = targetRect.left - sourceRect.left
  const deltaY = targetRect.top - sourceRect.top
  const scaleX = targetRect.width / sourceRect.width
  const scaleY = targetRect.height / sourceRect.height
  const settleTranslateX = deltaX * HERO_SETTLE_OFFSET
  const settleTranslateY = deltaY * HERO_SETTLE_OFFSET
  const settleScaleX = scaleX + (1 - scaleX) * (1 - HERO_SETTLE_OFFSET) + (HERO_SETTLE_SCALE - 1)
  const settleScaleY = scaleY + (1 - scaleY) * (1 - HERO_SETTLE_OFFSET) + (HERO_SETTLE_SCALE - 1)

  targetElement.style.opacity = '0'

  let overlayAnimation: Animation | null = null
  let targetAnimation: Animation | null = null
  let animationsCompleted = false

  try {
    overlayAnimation = flight.clone.animate(
      [
        {
          transform: 'translate3d(0, 0, 0) scale(1, 1)',
          borderRadius: flight.clone.style.borderRadius,
          opacity: 1,
          offset: 0
        },
        {
          transform: `translate3d(${deltaX * HERO_OVERLAY_FADE_OFFSET}px, ${deltaY * HERO_OVERLAY_FADE_OFFSET}px, 0) scale(${1 + (scaleX - 1) * HERO_OVERLAY_FADE_OFFSET}, ${1 + (scaleY - 1) * HERO_OVERLAY_FADE_OFFSET})`,
          borderRadius: targetStyle.borderRadius,
          opacity: 1,
          offset: HERO_OVERLAY_FADE_OFFSET
        },
        {
          transform: `translate3d(${settleTranslateX}px, ${settleTranslateY}px, 0) scale(${settleScaleX}, ${settleScaleY})`,
          borderRadius: targetStyle.borderRadius,
          opacity: 0.42,
          offset: HERO_SETTLE_OFFSET
        },
        {
          transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
          borderRadius: targetStyle.borderRadius,
          opacity: 0,
          offset: 1
        }
      ],
      {
        duration: HERO_DURATION_MS,
        easing: HERO_EASING,
        fill: 'forwards'
      }
    )

    targetAnimation = targetElement.animate(
      [
        { opacity: 0, transform: 'translate3d(0, 10px, 0) scale(0.992)', offset: 0 },
        {
          opacity: 0,
          transform: 'translate3d(0, 10px, 0) scale(0.992)',
          offset: HERO_TARGET_REVEAL_OFFSET
        },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', offset: 1 }
      ],
      {
        duration: HERO_DURATION_MS,
        easing: HERO_EASING,
        fill: 'forwards'
      }
    )

    await Promise.all([
      waitForAnimationCompletion(overlayAnimation, HERO_DURATION_MS),
      waitForAnimationCompletion(targetAnimation, HERO_DURATION_MS)
    ])
    animationsCompleted = true

    return true
  } finally {
    if (!animationsCompleted) {
      overlayAnimation?.cancel()
      targetAnimation?.cancel()
    }
    targetElement.style.opacity = ''
    flight.sourceElement.style.opacity = flight.sourceOpacity
    flight.clone.remove()
  }
}
