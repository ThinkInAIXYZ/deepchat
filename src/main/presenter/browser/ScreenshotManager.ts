import type { Debugger } from 'electron'
import type { ScreenshotOptions } from '@shared/types/browser'
import { CDPManager } from './CDPManager'

export class ScreenshotManager {
  private readonly cdpManager: CDPManager

  constructor(cdpManager: CDPManager) {
    this.cdpManager = cdpManager
  }

  async captureScreenshot(session: Debugger, options?: ScreenshotOptions): Promise<string> {
    try {
      if (options?.fullPage) {
        const metrics = await session.sendCommand('Page.getLayoutMetrics')
        const width = metrics?.contentSize?.width || metrics?.layoutViewport?.clientWidth || 1280
        const height = metrics?.contentSize?.height || metrics?.layoutViewport?.clientHeight || 720
        return await this.cdpManager.captureScreenshot(session, {
          clip: { x: 0, y: 0, width, height },
          quality: options?.quality
        })
      }

      return await this.cdpManager.captureScreenshot(session, options)
    } catch (error) {
      console.error('[YoBrowser] captureScreenshot failed', error)
      throw error
    }
  }
}
