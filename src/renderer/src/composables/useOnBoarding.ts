import { computed, toValue, watch, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
import { useElementBounding, useElementSize } from '@vueuse/core'

export interface SpotlightRect {
  x: number
  y: number
  width: number
  height: number
}

export interface UseOnBoardingOptions {
  visible?: MaybeRefOrGetter<boolean>
  padding?: number
  radius?: number
  edgeInset?: number
}

export interface UseOnBoardingReturn {
  spotlightRect: ComputedRef<SpotlightRect | null>
  viewportWidth: Ref<number>
  viewportHeight: Ref<number>
  pathD: ComputedRef<string>
  cutoutPathD: ComputedRef<string>
}

/**
 * Reactive spotlight cutout geometry. Tracks the target element and viewport
 * via ResizeObserver (through @vueuse/core), so updates land in the same layout
 * pass as the window resize and do not lag behind the compositor.
 *
 * The returned `pathD` follows driver.js' technique: a single SVG `<path>` with
 * `fill-rule: evenodd` — outer subpath covers the viewport, inner rounded-rect
 * subpath cuts the spotlight hole.
 */
export function useOnBoarding(
  targetEl: MaybeRefOrGetter<HTMLElement | null>,
  options: UseOnBoardingOptions = {}
): UseOnBoardingReturn {
  const padding = options.padding ?? 12
  const radius = options.radius ?? 24
  const edgeInset = options.edgeInset ?? 16

  const documentEl = typeof document !== 'undefined' ? document.documentElement : null
  const { width: viewportWidth, height: viewportHeight } = useElementSize(documentEl)

  const targetElRef = computed(() => toValue(targetEl))
  const {
    x: targetX,
    y: targetY,
    width: targetWidth,
    height: targetHeight,
    update: updateTargetBounds
  } = useElementBounding(targetElRef)

  // Viewport changes via window resize don't necessarily change the target's
  // box size, so its own ResizeObserver may not fire. Re-read its rect when the
  // viewport resizes; this runs before the next paint and keeps the cutout in
  // sync with the layout pass.
  watch([viewportWidth, viewportHeight], () => updateTargetBounds())

  const spotlightRect = computed<SpotlightRect | null>(() => {
    const isVisible = options.visible === undefined ? true : Boolean(toValue(options.visible))
    if (
      !isVisible ||
      !targetElRef.value ||
      targetWidth.value < 1 ||
      targetHeight.value < 1 ||
      viewportWidth.value < 1 ||
      viewportHeight.value < 1
    ) {
      return null
    }

    const top = Math.max(targetY.value - padding, edgeInset)
    const left = Math.max(targetX.value - padding, edgeInset)
    const width = Math.min(
      targetWidth.value + padding * 2,
      Math.max(viewportWidth.value - left - edgeInset, 0)
    )
    const height = Math.min(
      targetHeight.value + padding * 2,
      Math.max(viewportHeight.value - top - edgeInset, 0)
    )

    if (width <= 0 || height <= 0) {
      return null
    }

    return { x: left, y: top, width, height }
  })

  const cutoutPathD = computed(() => {
    const rect = spotlightRect.value
    if (!rect) return ''
    const r = Math.floor(Math.max(Math.min(radius, rect.width / 2, rect.height / 2), 0))
    const vx = rect.x + r
    const vy = rect.y
    const innerWidth = rect.width - r * 2
    const innerHeight = rect.height - r * 2
    return (
      `M${vx},${vy} h${innerWidth} ` +
      `a${r},${r} 0 0 1 ${r},${r} v${innerHeight} ` +
      `a${r},${r} 0 0 1 -${r},${r} h-${innerWidth} ` +
      `a${r},${r} 0 0 1 -${r},-${r} v-${innerHeight} ` +
      `a${r},${r} 0 0 1 ${r},-${r} z`
    )
  })

  const pathD = computed(() => {
    const vw = viewportWidth.value
    const vh = viewportHeight.value
    const outer = `M${vw},0L0,0L0,${vh}L${vw},${vh}L${vw},0Z`
    if (!cutoutPathD.value) return outer
    return `${outer} ${cutoutPathD.value}`
  })

  return { spotlightRect, viewportWidth, viewportHeight, pathD, cutoutPathD }
}
