import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  appRuntimeDataResetCompleteDevEvent,
  appRuntimeGuidedOnboardingStartRequestedEvent,
  appRuntimeMcpInstallRequestedEvent,
  appRuntimeShortcutRequestedEvent,
  appRuntimeStartDeeplinkRequestedEvent,
  appRuntimeSystemNotificationClickedEvent,
  appRuntimeWindowBlurredEvent,
  appRuntimeWindowFocusedEvent,
  type DeepchatEventPayload
} from '@shared/contracts/events'
import { getDeepchatBridge } from './core'

export function createAppRuntimeClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  function onStartDeeplink(
    listener: (payload: DeepchatEventPayload<'appRuntime.startDeeplinkRequested'>) => void
  ) {
    return bridge.on(appRuntimeStartDeeplinkRequestedEvent.name, listener)
  }

  function onMcpInstallRequested(
    listener: (payload: DeepchatEventPayload<'appRuntime.mcpInstallRequested'>) => void
  ) {
    return bridge.on(appRuntimeMcpInstallRequestedEvent.name, listener)
  }

  function onGuidedOnboardingStartRequested(listener: () => void) {
    return bridge.on(appRuntimeGuidedOnboardingStartRequestedEvent.name, () => listener())
  }

  function onWindowFocused(
    listener: (payload: DeepchatEventPayload<'appRuntime.windowFocused'>) => void
  ) {
    return bridge.on(appRuntimeWindowFocusedEvent.name, listener)
  }

  function onWindowBlurred(
    listener: (payload: DeepchatEventPayload<'appRuntime.windowBlurred'>) => void
  ) {
    return bridge.on(appRuntimeWindowBlurredEvent.name, listener)
  }

  function onShortcutRequested(
    listener: (payload: DeepchatEventPayload<'appRuntime.shortcutRequested'>) => void
  ) {
    return bridge.on(appRuntimeShortcutRequestedEvent.name, listener)
  }

  function onDataResetCompleteDev(listener: () => void) {
    return bridge.on(appRuntimeDataResetCompleteDevEvent.name, () => listener())
  }

  function onSystemNotificationClicked(
    listener: (payload: DeepchatEventPayload<'appRuntime.systemNotificationClicked'>) => void
  ) {
    return bridge.on(appRuntimeSystemNotificationClickedEvent.name, listener)
  }

  return {
    onStartDeeplink,
    onMcpInstallRequested,
    onGuidedOnboardingStartRequested,
    onWindowFocused,
    onWindowBlurred,
    onShortcutRequested,
    onDataResetCompleteDev,
    onSystemNotificationClicked
  }
}

export type AppRuntimeClient = ReturnType<typeof createAppRuntimeClient>
