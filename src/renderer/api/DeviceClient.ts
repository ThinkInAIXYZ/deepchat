import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  deviceGetAppVersionRoute,
  deviceGetInfoRoute,
  deviceRestartAppRoute,
  deviceSanitizeSvgRoute,
  deviceSelectDirectoryRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'
import { copyRuntimeImage, copyRuntimeText, readRuntimeClipboardText } from './runtime'

export class DeviceClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async getAppVersion() {
    const result = await this.bridge.invoke(deviceGetAppVersionRoute.name, {})
    return result.version
  }

  async getDeviceInfo() {
    const result = await this.bridge.invoke(deviceGetInfoRoute.name, {})
    return result.info
  }

  async selectDirectory() {
    return await this.bridge.invoke(deviceSelectDirectoryRoute.name, {})
  }

  async restartApp() {
    return await this.bridge.invoke(deviceRestartAppRoute.name, {})
  }

  async sanitizeSvgContent(svgContent: string) {
    const result = await this.bridge.invoke(deviceSanitizeSvgRoute.name, { svgContent })
    return result.content
  }

  copyText(text: string): void {
    copyRuntimeText(text)
  }

  copyImage(image: string): void {
    copyRuntimeImage(image)
  }

  readClipboardText(): string {
    return readRuntimeClipboardText()
  }
}
