export type ComputerUsePreviewMode = 'eligible' | 'suspended' | 'stopped'

export type ComputerUsePreviewSurface = 'native-overlay' | 'renderer-canvas' | 'none'

export interface ComputerUsePreviewModeResult {
  updated: boolean
  surface: ComputerUsePreviewSurface
}
