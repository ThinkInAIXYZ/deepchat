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

export class BrowserClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  private toSerializableBounds(bounds: { x: number; y: number; width: number; height: number }) {
    return {
      x: Number(bounds.x),
      y: Number(bounds.y),
      width: Number(bounds.width),
      height: Number(bounds.height)
    }
  }

  async getStatus(sessionId: string) {
    const result = await this.bridge.invoke(browserGetStatusRoute.name, { sessionId })
    return result.status
  }

  async loadUrl(sessionId: string, url: string, timeoutMs?: number) {
    const result = await this.bridge.invoke(browserLoadUrlRoute.name, {
      sessionId,
      url,
      timeoutMs
    })
    return result.status
  }

  async attachCurrentWindow(sessionId: string) {
    const result = await this.bridge.invoke(browserAttachCurrentWindowRoute.name, { sessionId })
    return result.attached
  }

  async updateCurrentWindowBounds(
    sessionId: string,
    bounds: {
      x: number
      y: number
      width: number
      height: number
    },
    visible: boolean
  ) {
    const result = await this.bridge.invoke(browserUpdateCurrentWindowBoundsRoute.name, {
      sessionId,
      bounds: this.toSerializableBounds(bounds),
      visible
    })
    return result.updated
  }

  async detach(sessionId: string) {
    const result = await this.bridge.invoke(browserDetachRoute.name, { sessionId })
    return result.detached
  }

  async destroy(sessionId: string) {
    const result = await this.bridge.invoke(browserDestroyRoute.name, { sessionId })
    return result.destroyed
  }

  async goBack(sessionId: string) {
    const result = await this.bridge.invoke(browserGoBackRoute.name, { sessionId })
    return result.status
  }

  async goForward(sessionId: string) {
    const result = await this.bridge.invoke(browserGoForwardRoute.name, { sessionId })
    return result.status
  }

  async reload(sessionId: string) {
    const result = await this.bridge.invoke(browserReloadRoute.name, { sessionId })
    return result.status
  }

  async openExternal(url: string) {
    await openRuntimeExternal(url)
  }

  onOpenRequested(
    listener: (payload: {
      sessionId: string
      windowId: number
      url: string
      version: number
    }) => void
  ) {
    return this.bridge.on(browserOpenRequestedEvent.name, listener)
  }

  onOpenRequestedForCurrentWindow(
    listener: (payload: {
      sessionId: string
      windowId: number
      url: string
      version: number
    }) => void
  ) {
    const currentWindowId = getRuntimeWindowId()

    return this.onOpenRequested((payload) => {
      if (currentWindowId != null && payload.windowId !== currentWindowId) {
        return
      }

      listener(payload)
    })
  }

  onStatusChanged(
    listener: (payload: {
      sessionId: string
      reason: 'created' | 'updated' | 'closed' | 'focused' | 'visibility'
      windowId?: number | null
      visible?: boolean
      status: YoBrowserStatus | null
      version: number
    }) => void
  ) {
    return this.bridge.on(browserStatusChangedEvent.name, listener)
  }
}
