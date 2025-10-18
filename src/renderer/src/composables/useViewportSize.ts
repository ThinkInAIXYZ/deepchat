// === Vue Core ===
import { ref } from 'vue'

export type ViewportSizeType = 'desktop' | 'tablet' | 'mobile'

interface ViewportDimensions {
  width: number
  height: number
}

/**
 * Default viewport dimensions for different device sizes
 */
const DEFAULT_DIMENSIONS: Record<Exclude<ViewportSizeType, 'desktop'>, ViewportDimensions> = {
  tablet: { width: 768, height: 1024 }, // 4:3 aspect ratio
  mobile: { width: 375, height: 667 } // 16:9 aspect ratio
}

/**
 * Composable for managing viewport size state
 *
 * Features:
 * - Device size presets (desktop/tablet/mobile)
 * - Fixed dimensions for consistent preview experience
 * - Type-safe viewport management
 */
export function useViewportSize() {
  // === Local State ===
  const viewportSize = ref<ViewportSizeType>('desktop')

  // === Public Methods ===
  /**
   * Set viewport size type
   */
  const setViewportSize = (size: ViewportSizeType) => {
    viewportSize.value = size
  }

  /**
   * Get dimensions for current viewport size
   */
  const getDimensions = (): ViewportDimensions | null => {
    if (viewportSize.value === 'desktop') return null
    return DEFAULT_DIMENSIONS[viewportSize.value]
  }

  // === Return API ===
  return {
    // State
    viewportSize,

    // Methods
    setViewportSize,
    getDimensions,

    // Constants
    TABLET_WIDTH: DEFAULT_DIMENSIONS.tablet.width,
    TABLET_HEIGHT: DEFAULT_DIMENSIONS.tablet.height,
    MOBILE_WIDTH: DEFAULT_DIMENSIONS.mobile.width,
    MOBILE_HEIGHT: DEFAULT_DIMENSIONS.mobile.height
  }
}
