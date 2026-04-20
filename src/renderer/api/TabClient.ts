import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  tabCaptureCurrentAreaRoute,
  tabNotifyRendererActivatedRoute,
  tabNotifyRendererReadyRoute,
  tabStitchImagesWithWatermarkRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export class TabClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async notifyRendererReady() {
    return await this.bridge.invoke(tabNotifyRendererReadyRoute.name, {})
  }

  async notifyRendererActivated(sessionId: string) {
    return await this.bridge.invoke(tabNotifyRendererActivatedRoute.name, { sessionId })
  }

  async captureCurrentArea(rect: { x: number; y: number; width: number; height: number }) {
    const result = await this.bridge.invoke(tabCaptureCurrentAreaRoute.name, { rect })
    return result.imageData
  }

  async stitchImagesWithWatermark(
    images: string[],
    watermark?: {
      isDark?: boolean
      version?: string
      texts?: {
        brand?: string
        time?: string
        tip?: string
        model?: string
        provider?: string
      }
    }
  ) {
    const result = await this.bridge.invoke(tabStitchImagesWithWatermarkRoute.name, {
      images,
      watermark
    })
    return result.imageData
  }
}
