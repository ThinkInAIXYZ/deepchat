import type { DeepchatBridge } from '@shared/contracts/bridge'
import { windowStateChangedEvent } from '@shared/contracts/events'
import {
  windowCloseCurrentRoute,
  windowCloseFloatingCurrentRoute,
  windowGetCurrentStateRoute,
  windowMinimizeCurrentRoute,
  windowPreviewFileRoute,
  windowToggleMaximizeCurrentRoute
} from '@shared/contracts/routes'
import { getDeepchatBridge } from './core'
import { getRuntimeWindowId } from './runtime'

export class WindowClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async getCurrentState() {
    const result = await this.bridge.invoke(windowGetCurrentStateRoute.name, {})
    return result.state
  }

  async minimizeCurrent() {
    const result = await this.bridge.invoke(windowMinimizeCurrentRoute.name, {})
    return result.state
  }

  async toggleMaximizeCurrent() {
    const result = await this.bridge.invoke(windowToggleMaximizeCurrentRoute.name, {})
    return result.state
  }

  async closeCurrent() {
    return await this.bridge.invoke(windowCloseCurrentRoute.name, {})
  }

  async closeFloatingCurrent() {
    return await this.bridge.invoke(windowCloseFloatingCurrentRoute.name, {})
  }

  async previewFile(filePath: string) {
    return await this.bridge.invoke(windowPreviewFileRoute.name, { filePath })
  }

  onStateChanged(
    listener: (payload: {
      windowId: number | null
      exists: boolean
      isMaximized: boolean
      isFullScreen: boolean
      isFocused: boolean
      version: number
    }) => void
  ) {
    return this.bridge.on(windowStateChangedEvent.name, listener)
  }

  onCurrentStateChanged(
    listener: (payload: {
      windowId: number | null
      exists: boolean
      isMaximized: boolean
      isFullScreen: boolean
      isFocused: boolean
      version: number
    }) => void
  ) {
    const currentWindowId = getRuntimeWindowId()

    return this.onStateChanged((payload) => {
      if (currentWindowId != null && payload.windowId !== currentWindowId) {
        return
      }

      listener(payload)
    })
  }
}
