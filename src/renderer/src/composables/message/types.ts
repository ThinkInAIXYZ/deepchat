export interface ScrollInfo {
  viewportHeight: number
  contentHeight: number
  scrollTop: number
}

export interface CaptureOptions {
  messageId: string
  parentId?: string
  fromTop?: boolean
  modelInfo?: {
    model_name: string
    model_provider: string
  }
}

export interface WatermarkConfig {
  isDark: boolean
  version: string
  texts: {
    brand: string
    tip: string
    model?: string
    provider?: string
  }
}
