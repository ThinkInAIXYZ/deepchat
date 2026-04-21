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

export function createWindowClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function getCurrentState() {
    const result = await bridge.invoke(windowGetCurrentStateRoute.name, {})
    return result.state
  }

  async function minimizeCurrent() {
    const result = await bridge.invoke(windowMinimizeCurrentRoute.name, {})
    return result.state
  }

  async function toggleMaximizeCurrent() {
    const result = await bridge.invoke(windowToggleMaximizeCurrentRoute.name, {})
    return result.state
  }

  async function closeCurrent() {
    return await bridge.invoke(windowCloseCurrentRoute.name, {})
  }

  async function closeFloatingCurrent() {
    return await bridge.invoke(windowCloseFloatingCurrentRoute.name, {})
  }

  async function previewFile(filePath: string) {
    return await bridge.invoke(windowPreviewFileRoute.name, { filePath })
  }

  function onStateChanged(
    listener: (payload: {
      windowId: number | null
      exists: boolean
      isMaximized: boolean
      isFullScreen: boolean
      isFocused: boolean
      version: number
    }) => void
  ) {
    return bridge.on(windowStateChangedEvent.name, listener)
  }

  function onCurrentStateChanged(
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

    return onStateChanged((payload) => {
      if (currentWindowId != null && payload.windowId !== currentWindowId) {
        return
      }

      listener(payload)
    })
  }

  return {
    getCurrentState,
    minimizeCurrent,
    toggleMaximizeCurrent,
    closeCurrent,
    closeFloatingCurrent,
    previewFile,
    onStateChanged,
    onCurrentStateChanged
  }
}

export type WindowClient = ReturnType<typeof createWindowClient>
