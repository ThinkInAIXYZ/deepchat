import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_BUTTON_EVENTS } from '../../../src/shared/floatingButtonChannels'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '../../../src/shared/contracts/channels'
import { browserActivityChangedEvent } from '../../../src/shared/contracts/events'
import {
  DATABASE_UNLOCK_CANCEL_CHANNEL,
  DATABASE_UNLOCK_PROGRESS_CHANNEL,
  DATABASE_UNLOCK_REQUEST_CHANNEL,
  DATABASE_UNLOCK_SUBMIT_CHANNEL
} from '../../../src/shared/contracts/databaseSecurity'

type Listener = (_event: unknown, payload: unknown) => void

const validSnapshot = {
  expanded: false,
  activeCount: 1,
  sessions: [
    {
      id: 'session-1',
      title: 'Active task',
      status: 'in_progress',
      updatedAt: 1,
      agent: {
        id: 'agent-1',
        name: 'DeepChat',
        type: 'deepchat'
      }
    }
  ]
}

const validBrowserActivity = {
  id: 'activity-1',
  sessionId: 'session-1',
  windowId: 1,
  kind: 'navigation',
  action: 'navigate',
  phase: 'started',
  timestamp: 1
}

const validUnlockRequest = {
  requestId: 'unlock-1',
  reason: 'manual-required' as const,
  safeStorageAvailable: true
}

const validUnlockProgress = {
  active: true,
  safeStorageAvailable: true
}

const installElectronPreloadMock = () => {
  const listeners = new Map<string, Listener[]>()
  const exposeInMainWorld = vi.fn((key: string, api: unknown) => {
    Object.defineProperty(window, key, {
      value: api,
      configurable: true
    })
  })

  const ipcRenderer = {
    invoke: vi.fn(async (channel: string, routeName?: string) => {
      if (channel === DEEPCHAT_ROUTE_INVOKE_CHANNEL) {
        if (routeName === 'plugins.get') {
          return {
            plugin: {
              id: 'plugin-1',
              enabled: true,
              runtime: 'renderer',
              mcpServers: []
            }
          }
        }

        return {
          result: {
            ok: true
          }
        }
      }

      if (channel === FLOATING_BUTTON_EVENTS.SNAPSHOT_REQUEST) {
        return validSnapshot
      }

      if (channel === FLOATING_BUTTON_EVENTS.LANGUAGE_REQUEST) {
        return 'zh-CN'
      }

      if (channel === FLOATING_BUTTON_EVENTS.THEME_REQUEST) {
        return 'light'
      }

      if (channel === FLOATING_BUTTON_EVENTS.ACP_REGISTRY_ICON_REQUEST) {
        return '<svg />'
      }

      return undefined
    }),
    on: vi.fn((channel: string, listener: Listener) => {
      const channelListeners = listeners.get(channel) ?? []
      channelListeners.push(listener)
      listeners.set(channel, channelListeners)
    }),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      listeners.set(
        channel,
        (listeners.get(channel) ?? []).filter((candidate) => candidate !== listener)
      )
    }),
    removeAllListeners: vi.fn(),
    send: vi.fn()
  }

  vi.doMock('electron', () => ({
    contextBridge: {
      exposeInMainWorld
    },
    ipcRenderer,
    webFrame: {
      setVisualZoomLevelLimits: vi.fn(),
      setZoomFactor: vi.fn()
    }
  }))

  Object.defineProperty(process, 'contextIsolated', {
    value: true,
    configurable: true
  })

  return { exposeInMainWorld, ipcRenderer, listeners }
}

describe('preload IPC boundaries', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('electron')
    delete (process as { contextIsolated?: boolean }).contextIsolated
    delete (window as { floatingButtonAPI?: unknown }).floatingButtonAPI
    delete (window as { yoBrowserOverlay?: unknown }).yoBrowserOverlay
    delete (window as { deepchatPlugin?: unknown }).deepchatPlugin
    delete (window as { deepchatSplash?: unknown }).deepchatSplash
  })

  it('exposes floating listeners with scoped unsubscribe and payload validation', async () => {
    const { ipcRenderer, listeners } = installElectronPreloadMock()
    await import('../../../src/preload/floating-preload')

    const floatingButtonAPI = (
      window as Window & {
        floatingButtonAPI: {
          setExpanded: (expanded: boolean) => void
          onSnapshotUpdate: (callback: (payload: typeof validSnapshot) => void) => () => void
        }
      }
    ).floatingButtonAPI

    floatingButtonAPI.setExpanded(true)
    floatingButtonAPI.setExpanded('yes' as unknown as boolean)

    expect(ipcRenderer.send).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.send).toHaveBeenCalledWith(FLOATING_BUTTON_EVENTS.SET_EXPANDED, true)

    const callback = vi.fn()
    const unsubscribe = floatingButtonAPI.onSnapshotUpdate(callback)
    const [listener] = listeners.get(FLOATING_BUTTON_EVENTS.SNAPSHOT_UPDATED) ?? []

    listener?.({}, validSnapshot)
    listener?.({}, { expanded: true })
    unsubscribe()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(validSnapshot)
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      FLOATING_BUTTON_EVENTS.SNAPSHOT_UPDATED,
      listener
    )
    expect(ipcRenderer.removeAllListeners).not.toHaveBeenCalled()
  })

  it('validates browser overlay activity events before invoking the renderer callback', async () => {
    const { ipcRenderer, listeners } = installElectronPreloadMock()
    await import('../../../src/preload/browser-overlay-preload')

    const yoBrowserOverlay = (
      window as Window & {
        yoBrowserOverlay: {
          onActivityChanged: (
            callback: (payload: typeof validBrowserActivity) => void
          ) => () => void
        }
      }
    ).yoBrowserOverlay

    const callback = vi.fn()
    const unsubscribe = yoBrowserOverlay.onActivityChanged(callback)
    const [listener] = listeners.get(browserActivityChangedEvent.name) ?? []

    listener?.({}, validBrowserActivity)
    listener?.({}, { id: 'missing-required-fields' })
    unsubscribe()

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(validBrowserActivity)
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      browserActivityChangedEvent.name,
      listener
    )
    expect(ipcRenderer.removeAllListeners).not.toHaveBeenCalled()
  })

  it('backs plugin settings preload APIs with typed route bridge calls', async () => {
    const { ipcRenderer } = installElectronPreloadMock()
    window.history.pushState({}, '', '/plugin-settings/?pluginId=plugin-1')

    await import('../../../src/preload/plugin-settings-preload')

    const deepchatPlugin = (
      window as Window & {
        deepchatPlugin: {
          getPluginId: () => string
          getStatus: () => Promise<{ pluginId: string; enabled: boolean }>
          enable: () => Promise<unknown>
          invokeAction: (actionId: string, payload?: Record<string, unknown>) => Promise<unknown>
        }
      }
    ).deepchatPlugin

    await expect(deepchatPlugin.getStatus()).resolves.toMatchObject({
      pluginId: 'plugin-1',
      enabled: true
    })

    await deepchatPlugin.enable()
    await deepchatPlugin.invokeAction('refresh', { force: true })

    expect(deepchatPlugin.getPluginId()).toBe('plugin-1')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(DEEPCHAT_ROUTE_INVOKE_CHANNEL, 'plugins.get', {
      pluginId: 'plugin-1'
    })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      DEEPCHAT_ROUTE_INVOKE_CHANNEL,
      'plugins.enable',
      {
        pluginId: 'plugin-1'
      }
    )
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      DEEPCHAT_ROUTE_INVOKE_CHANNEL,
      'plugins.invokeAction',
      {
        pluginId: 'plugin-1',
        actionId: 'refresh',
        payload: { force: true }
      }
    )
  })

  it('exposes splash unlock APIs through scoped database-security channels', async () => {
    const { ipcRenderer, listeners } = installElectronPreloadMock()
    await import('../../../src/preload/splash-preload')

    const deepchatSplash = (
      window as Window & {
        deepchatSplash: {
          onUnlockRequest: (callback: (payload: typeof validUnlockRequest) => void) => () => void
          onUnlockProgress: (callback: (payload: typeof validUnlockProgress) => void) => () => void
          submitUnlock: (payload: { requestId: string; password: string }) => void
          cancelUnlock: (payload: { requestId: string }) => void
        }
      }
    ).deepchatSplash

    expect(Object.keys(deepchatSplash).sort()).toEqual([
      'cancelUnlock',
      'onUnlockProgress',
      'onUnlockRequest',
      'onUpdate',
      'submitUnlock'
    ])

    const unlockRequestCallback = vi.fn()
    const unlockProgressCallback = vi.fn()
    const unsubscribeRequest = deepchatSplash.onUnlockRequest(unlockRequestCallback)
    const unsubscribeProgress = deepchatSplash.onUnlockProgress(unlockProgressCallback)
    const [requestListener] = listeners.get(DATABASE_UNLOCK_REQUEST_CHANNEL) ?? []
    const [progressListener] = listeners.get(DATABASE_UNLOCK_PROGRESS_CHANNEL) ?? []

    requestListener?.({}, validUnlockRequest)
    progressListener?.({}, validUnlockProgress)
    unsubscribeRequest()
    unsubscribeProgress()

    deepchatSplash.submitUnlock({ requestId: 'unlock-1', password: 'secret' })
    deepchatSplash.submitUnlock({ requestId: '', password: 'secret' })
    deepchatSplash.submitUnlock({ requestId: 'unlock-1', password: 42 as unknown as string })
    deepchatSplash.cancelUnlock({ requestId: 'unlock-1' })
    deepchatSplash.cancelUnlock({ requestId: '' })

    expect(unlockRequestCallback).toHaveBeenCalledWith(validUnlockRequest)
    expect(unlockProgressCallback).toHaveBeenCalledWith(validUnlockProgress)
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      DATABASE_UNLOCK_REQUEST_CHANNEL,
      requestListener
    )
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(
      DATABASE_UNLOCK_PROGRESS_CHANNEL,
      progressListener
    )
    expect(ipcRenderer.removeAllListeners).not.toHaveBeenCalled()
    expect(ipcRenderer.send).toHaveBeenCalledTimes(2)
    expect(ipcRenderer.send).toHaveBeenCalledWith(DATABASE_UNLOCK_SUBMIT_CHANNEL, {
      requestId: 'unlock-1',
      password: 'secret'
    })
    expect(ipcRenderer.send).toHaveBeenCalledWith(DATABASE_UNLOCK_CANCEL_CHANNEL, {
      requestId: 'unlock-1'
    })
  })
})
