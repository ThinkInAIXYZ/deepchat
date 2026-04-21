import type { DeepchatBridge } from '@shared/contracts/bridge'
import { browserOpenRequestedEvent, browserStatusChangedEvent } from '@shared/contracts/events'
import {
  browserAttachCurrentWindowRoute,
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
    const currentWindowId = getRuntimeWindowId()

    return onOpenRequested((payload) => {
      if (currentWindowId != null && payload.windowId !== currentWindowId) {
        return
      }

      listener(payload)
    })
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
    openExternal,
    onOpenRequested,
    onOpenRequestedForCurrentWindow,
    onStatusChanged
  }
}

export type BrowserClient = ReturnType<typeof createBrowserClient>
