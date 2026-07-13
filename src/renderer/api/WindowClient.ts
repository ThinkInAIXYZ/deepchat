import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  type DeepchatEventPayload,
  databaseRepairSuggestedEvent,
  notificationErrorEvent,
  settingsCheckForUpdatesRequestedEvent,
  settingsNavigateRequestedEvent,
  settingsProviderInstallRequestedEvent,
  windowStateChangedEvent
} from '@shared/contracts/events'
import {
  windowCloseSettingsRoute,
  windowConsumePendingSettingsProviderInstallRoute,
  windowFocusMainRoute,
  windowCloseCurrentRoute,
  windowCloseFloatingCurrentRoute,
  windowGetCurrentStateRoute,
  windowMinimizeCurrentRoute,
  windowNotifySettingsReadyRoute,
  windowPreviewFileRoute,
  windowRequeuePendingSettingsProviderInstallRoute,
  windowStartGuidedOnboardingRoute,
  windowToggleMaximizeCurrentRoute
} from '@shared/contracts/routes'
import type { ProviderInstallPreview } from '@shared/providerDeeplink'
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

  async function closeSettings() {
    const result = await bridge.invoke(windowCloseSettingsRoute.name, {})
    return result.closed
  }

  async function focusMainWindow() {
    const result = await bridge.invoke(windowFocusMainRoute.name, {})
    return result.focused
  }

  async function notifySettingsReady() {
    const result = await bridge.invoke(windowNotifySettingsReadyRoute.name, {})
    return result.notified
  }

  async function consumePendingSettingsProviderInstall() {
    const result = await bridge.invoke(windowConsumePendingSettingsProviderInstallRoute.name, {})
    return result.preview as ProviderInstallPreview | null
  }

  async function requeuePendingSettingsProviderInstall(preview: ProviderInstallPreview) {
    const result = await bridge.invoke(windowRequeuePendingSettingsProviderInstallRoute.name, {
      preview
    })
    return result.queued
  }

  async function startGuidedOnboarding() {
    return await bridge.invoke(windowStartGuidedOnboardingRoute.name, {})
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
    let disposed = false
    let cleanup: (() => void) | null = null

    void getRuntimeWindowId()
      .then((currentWindowId) => {
        if (disposed) {
          return
        }

        cleanup = onStateChanged((payload) => {
          if (currentWindowId != null && payload.windowId !== currentWindowId) {
            return
          }

          listener(payload)
        })
      })
      .catch((error) => {
        console.warn('[WindowClient] Failed to resolve runtime window id:', error)
        if (!disposed) {
          cleanup = onStateChanged(listener)
        }
      })

    return () => {
      disposed = true
      cleanup?.()
    }
  }

  function onSettingsNavigate(
    listener: (payload: DeepchatEventPayload<typeof settingsNavigateRequestedEvent.name>) => void
  ) {
    return bridge.on(settingsNavigateRequestedEvent.name, listener)
  }

  function onSettingsProviderInstall(
    listener: (
      payload: DeepchatEventPayload<typeof settingsProviderInstallRequestedEvent.name>
    ) => void
  ) {
    return bridge.on(settingsProviderInstallRequestedEvent.name, listener)
  }

  function onSettingsCheckForUpdates(
    listener: (
      payload: DeepchatEventPayload<typeof settingsCheckForUpdatesRequestedEvent.name>
    ) => void
  ) {
    return bridge.on(settingsCheckForUpdatesRequestedEvent.name, listener)
  }

  function onNotificationError(
    listener: (payload: DeepchatEventPayload<typeof notificationErrorEvent.name>) => void
  ) {
    return bridge.on(notificationErrorEvent.name, listener)
  }

  function onDatabaseRepairSuggested(
    listener: (payload: DeepchatEventPayload<typeof databaseRepairSuggestedEvent.name>) => void
  ) {
    return bridge.on(databaseRepairSuggestedEvent.name, listener)
  }

  return {
    getCurrentState,
    minimizeCurrent,
    toggleMaximizeCurrent,
    closeCurrent,
    closeFloatingCurrent,
    previewFile,
    closeSettings,
    focusMainWindow,
    notifySettingsReady,
    consumePendingSettingsProviderInstall,
    requeuePendingSettingsProviderInstall,
    startGuidedOnboarding,
    onStateChanged,
    onCurrentStateChanged,
    onSettingsNavigate,
    onSettingsProviderInstall,
    onSettingsCheckForUpdates,
    onNotificationError,
    onDatabaseRepairSuggested
  }
}

export type WindowClient = ReturnType<typeof createWindowClient>
