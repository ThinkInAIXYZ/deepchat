export interface FloatingButtonConfig {
  /** 是否启用悬浮按钮 */
  enabled: boolean
  /** 悬浮按钮位置 */
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** 距离边缘的偏移量 */
  offset: {
    x: number
    y: number
  }
  /** 悬浮按钮大小 */
  size: {
    width: number
    height: number
  }
  /** 是否置顶显示 */
  alwaysOnTop: boolean
  /** 透明度 (0-1) */
  opacity: number
}

export interface FloatingButtonState {
  /** 是否正在显示 */
  isVisible: boolean
  /** 当前位置 */
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface FloatingButtonEvents {
  /** 悬浮按钮被点击 */
  'floating-button-clicked': void
  /** 悬浮按钮显示状态改变 */
  'floating-button-visibility-changed': { visible: boolean }
  /** 悬浮按钮位置改变 */
  'floating-button-position-changed': { x: number; y: number }
}

export const DEFAULT_FLOATING_BUTTON_CONFIG: FloatingButtonConfig = {
  enabled: true,
  position: 'bottom-right',
  offset: {
    x: 20,
    y: 20
  },
  size: {
    width: 60,
    height: 60
  },
  alwaysOnTop: true,
  opacity: 0.8
}
