import type { DeepchatBridge } from '@shared/contracts/bridge'
import {
  browserActivityChangedEvent,
  browserOpenRequestedEvent,
  browserStatusChangedEvent
} from '@shared/contracts/events'
import {
  browserAttachCurrentWindowRoute,
  browserClearSandboxDataRoute,
  browserDestroyRoute,
  browserDetachRoute,
  browserGetStatusRoute,
  browserGoBackRoute,
  browserGoForwardRoute,
  browserLoadUrlRoute,
  browserReloadRoute,
  browserUpdateCurrentWindowBoundsRoute
} from '@shared/contracts/routes'
import type { YoBrowserStatus } from '@shared/types/browser'
import type { YoBrowserActivityPayload } from '@shared/types/browser'
import { getDeepchatBridge } from './core'
import { getRuntimeWindowId, openRuntimeExternal } from './runtime'

export function createBrowserClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  function toSerializableBounds(bounds: { x: number; y: number; width: number; height: number }) {
    return {
      x: Number(bounds.x),
      y: Number(bounds.y),
      width: Number(bounds.width),
      height: Number(bounds.height)
    }
  }

  async function getStatus(sessionId: string) {
    const result = await bridge.invoke(browserGetStatusRoute.name, { sessionId })
    return result.status
  }

  async function loadUrl(sessionId: string, url: string, timeoutMs?: number) {
    const result = await bridge.invoke(browserLoadUrlRoute.name, {
      sessionId,
      url,
      timeoutMs
    })
    return result.status
  }

  async function attachCurrentWindow(sessionId: string) {
    const result = await bridge.invoke(browserAttachCurrentWindowRoute.name, { sessionId })
    return result.attached
  }

  async function updateCurrentWindowBounds(
    sessionId: string,
    bounds: {
      x: number
      y: number
      width: number
      height: number
    },
    visible: boolean
  ) {
    const result = await bridge.invoke(browserUpdateCurrentWindowBoundsRoute.name, {
      sessionId,
      bounds: toSerializableBounds(bounds),
      visible
    })
    return result.updated
  }

  async function detach(sessionId: string) {
    const result = await bridge.invoke(browserDetachRoute.name, { sessionId })
    return result.detached
  }

  async function destroy(sessionId: string) {
    const result = await bridge.invoke(browserDestroyRoute.name, { sessionId })
    return result.destroyed
  }

  async function goBack(sessionId: string) {
    const result = await bridge.invoke(browserGoBackRoute.name, { sessionId })
    return result.status
  }

  async function goForward(sessionId: string) {
    const result = await bridge.invoke(browserGoForwardRoute.name, { sessionId })
    return result.status
  }

  async function reload(sessionId: string) {
    const result = await bridge.invoke(browserReloadRoute.name, { sessionId })
    return result.status
  }

  async function clearSandboxData() {
    const result = await bridge.invoke(browserClearSandboxDataRoute.name, {})
    return result.cleared
  }

  async function openExternal(url: string) {
    await openRuntimeExternal(url)
  }

  function onOpenRequested(
    listener: (payload: {
      sessionId: string
      windowId: number
      url: string
      version: number
    }) => void
  ) {
    return bridge.on(browserOpenRequestedEvent.name, listener)
  }

  function onOpenRequestedForCurrentWindow(
    listener: (payload: {
      sessionId: string
      windowId: number
      url: string
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

        cleanup = onOpenRequested((payload) => {
          if (currentWindowId != null && payload.windowId !== currentWindowId) {
            return
          }

          listener(payload)
        })
      })
      .catch((error) => {
        console.warn('[BrowserClient] Failed to resolve runtime window id:', error)
        if (!disposed) {
          cleanup = onOpenRequested(listener)
        }
      })

    return () => {
      disposed = true
      cleanup?.()
    }
  }

  function onStatusChanged(
    listener: (payload: {
      sessionId: string
      reason: 'created' | 'updated' | 'closed' | 'focused' | 'visibility'
      windowId?: number | null
      visible?: boolean
      status: YoBrowserStatus | null
      version: number
    }) => void
  ) {
    return bridge.on(browserStatusChangedEvent.name, listener)
  }

  function onActivityChanged(listener: (payload: YoBrowserActivityPayload) => void) {
    return bridge.on(browserActivityChangedEvent.name, listener)
  }

  return {
    getStatus,
    loadUrl,
    attachCurrentWindow,
    updateCurrentWindowBounds,
    detach,
    destroy,
    goBack,
    goForward,
    reload,
    clearSandboxData,
    openExternal,
    onOpenRequested,
    onOpenRequestedForCurrentWindow,
    onStatusChanged,
    onActivityChanged
  }
}

export type BrowserClient = ReturnType<typeof createBrowserClient>
