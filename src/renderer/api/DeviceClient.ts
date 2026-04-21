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

export function createDeviceClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getAppVersion() {
    const result = await bridge.invoke(deviceGetAppVersionRoute.name, {})
    return result.version
  }

  async function getDeviceInfo() {
    const result = await bridge.invoke(deviceGetInfoRoute.name, {})
    return result.info
  }

  async function selectDirectory() {
    return await bridge.invoke(deviceSelectDirectoryRoute.name, {})
  }

  async function restartApp() {
    return await bridge.invoke(deviceRestartAppRoute.name, {})
  }

  async function sanitizeSvgContent(svgContent: string) {
    const result = await bridge.invoke(deviceSanitizeSvgRoute.name, { svgContent })
    return result.content
  }

  function copyText(text: string): void {
    copyRuntimeText(text)
  }

  function copyImage(image: string): void {
    copyRuntimeImage(image)
  }

  function readClipboardText(): string {
    return readRuntimeClipboardText()
  }

  return {
    getAppVersion,
    getDeviceInfo,
    selectDirectory,
    restartApp,
    sanitizeSvgContent,
    copyText,
    copyImage,
    readClipboardText
  }
}

export type DeviceClient = ReturnType<typeof createDeviceClient>
