import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  tabCaptureCurrentAreaRoute,
  tabNotifyRendererActivatedRoute,
  tabNotifyRendererReadyRoute,
  tabStitchImagesWithWatermarkRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'

export function createTabClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function notifyRendererReady() {
    return await bridge.invoke(tabNotifyRendererReadyRoute.name, {})
  }

  async function notifyRendererActivated(sessionId: string) {
    return await bridge.invoke(tabNotifyRendererActivatedRoute.name, { sessionId })
  }

  async function captureCurrentArea(rect: { x: number; y: number; width: number; height: number }) {
    const result = await bridge.invoke(tabCaptureCurrentAreaRoute.name, { rect })
    return result.imageData
  }

  async function stitchImagesWithWatermark(
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
    const result = await bridge.invoke(tabStitchImagesWithWatermarkRoute.name, {
      images,
      watermark
    })
    return result.imageData
  }

  return {
    notifyRendererReady,
    notifyRendererActivated,
    captureCurrentArea,
    stitchImagesWithWatermark
  }
}

export type TabClient = ReturnType<typeof createTabClient>
