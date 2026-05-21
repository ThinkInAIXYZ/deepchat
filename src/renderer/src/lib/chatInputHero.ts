const HERO_DURATION_MS = 320
const HERO_EASING = 'cubic-bezier(0.22, 0.86, 0.24, 1)'

type PendingChatInputHeroFlight = {
  clone: HTMLElement
  sourceElement: HTMLElement
  sourceOpacity: string
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
  pendingFlight.clone.remove()
  pendingFlight = null
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

  pendingFlight = {
    clone,
    sourceElement,
    sourceOpacity: sourceElement.style.opacity
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

  targetElement.style.opacity = '0'

  const overlayAnimation = flight.clone.animate(
    [
      {
        transform: 'translate3d(0, 0, 0) scale(1, 1)',
        borderRadius: flight.clone.style.borderRadius,
        opacity: 1,
        offset: 0
      },
      {
        transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
        borderRadius: targetStyle.borderRadius,
        opacity: 1,
        offset: 1
      }
    ],
    {
      duration: HERO_DURATION_MS,
      easing: HERO_EASING,
      fill: 'forwards'
    }
  )

  const targetAnimation = targetElement.animate(
    [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: 0.6 },
      { opacity: 1, offset: 1 }
    ],
    {
      duration: HERO_DURATION_MS,
      easing: HERO_EASING,
      fill: 'forwards'
    }
  )

  await Promise.allSettled([overlayAnimation.finished, targetAnimation.finished])

  targetElement.style.opacity = ''
  flight.sourceElement.style.opacity = flight.sourceOpacity
  flight.clone.remove()
  return true
}
