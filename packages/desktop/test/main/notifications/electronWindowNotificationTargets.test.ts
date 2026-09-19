import { beforeEach, describe, expect, it, vi } from 'vitest'
import { semanticNotificationEvent } from '@shared/contracts/events'

type ElectronListener = (...args: unknown[]) => void

const electron = vi.hoisted(() => {
  const contents = new Map<
    number,
    {
      id: number
      destroyed: boolean
      ownerWindowId?: number
      listeners: Map<string, Set<ElectronListener>>
      isDestroyed: () => boolean
      on: (event: string, listener: ElectronListener) => void
      once: (event: string, listener: ElectronListener) => void
      removeListener: (event: string, listener: ElectronListener) => void
      emit: (event: string, ...args: unknown[]) => void
    }
  >()
  const windows = new Map<
    number,
    {
      id: number
      destroyed: boolean
      webContents: ReturnType<typeof createContents>
      isDestroyed: () => boolean
    }
  >()

  function createContents(id: number, ownerWindowId?: number) {
    const listeners = new Map<string, Set<ElectronListener>>()
    const addListener = (event: string, listener: ElectronListener) => {
      const eventListeners = listeners.get(event) ?? new Set<ElectronListener>()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
    }
    const value = {
      id,
      destroyed: false,
      ownerWindowId,
      listeners,
      isDestroyed: () => value.destroyed,
      on: addListener,
      once: (event: string, listener: ElectronListener) => {
        const wrapped = (...args: unknown[]) => {
          value.removeListener(event, wrapped)
          listener(...args)
        }
        addListener(event, wrapped)
      },
      removeListener: (event: string, listener: ElectronListener) => {
        listeners.get(event)?.delete(listener)
      },
      emit: (event: string, ...args: unknown[]) => {
        for (const listener of Array.from(listeners.get(event) ?? [])) {
          listener(...args)
        }
      }
    }
    contents.set(id, value)
    return value
  }

  function createWindow(id: number, webContentsId: number) {
    const value = {
      id,
      destroyed: false,
      webContents: createContents(webContentsId, id),
      isDestroyed: () => value.destroyed
    }
    windows.set(id, value)
    return value
  }

  return {
    contents,
    windows,
    createContents,
    createWindow,
    BrowserWindow: {
      fromId: vi.fn((id: number) => windows.get(id)),
      fromWebContents: vi.fn((value: { ownerWindowId?: number }) =>
        value.ownerWindowId === undefined ? undefined : windows.get(value.ownerWindowId)
      )
    },
    webContents: {
      fromId: vi.fn((id: number) => contents.get(id))
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: electron.BrowserWindow,
  webContents: electron.webContents
}))

import { ElectronWindowNotificationTargets } from '@/notifications'

describe('ElectronWindowNotificationTargets', () => {
  beforeEach(() => {
    electron.contents.clear()
    electron.windows.clear()
    vi.clearAllMocks()
  })

  it('requires renderer readiness and resolves the active main tab exactly', async () => {
    const mainWindow = electron.createWindow(1, 10)
    const firstTab = electron.createContents(11)
    const secondTab = electron.createContents(12)
    let activeTabId = 101
    const tabs = {
      getActiveTabId: vi.fn(async () => activeTabId),
      getTab: vi.fn(async (tabId: number) =>
        tabId === 101
          ? { webContents: firstTab }
          : tabId === 102
            ? { webContents: secondTab }
            : undefined
      ),
      getWindowIdByWebContentsId: vi.fn((webContentsId: number) =>
        webContentsId === 11 || webContentsId === 12 ? 1 : undefined
      )
    }
    const sendToWebContents = vi.fn(async () => true)
    const targets = new ElectronWindowNotificationTargets(
      {
        getAllWindows: () => [mainWindow] as never,
        getFocusedWindow: () => mainWindow as never,
        getSettingsWindowId: () => null,
        sendToWebContents
      },
      () => tabs as never
    )

    expect(await targets.getFocusedTarget()).toBeUndefined()
    await expect(targets.markRendererReady(11)).resolves.toBe(true)
    await expect(targets.getFocusedTarget()).resolves.toEqual({
      windowId: 1,
      webContentsId: 11,
      kind: 'main'
    })

    activeTabId = 102
    expect(await targets.getFocusedTarget()).toBeUndefined()
    await targets.markRendererReady(12)
    await expect(targets.getFocusedTarget()).resolves.toEqual({
      windowId: 1,
      webContentsId: 12,
      kind: 'main'
    })
  })

  it('sends a typed semantic envelope to one ready webContents', async () => {
    const mainWindow = electron.createWindow(1, 10)
    const tab = electron.createContents(11)
    const sendToWebContents = vi.fn(async () => true)
    const targets = new ElectronWindowNotificationTargets(
      {
        getAllWindows: () => [mainWindow] as never,
        getFocusedWindow: () => mainWindow as never,
        getSettingsWindowId: () => null,
        sendToWebContents
      },
      () =>
        ({
          getActiveTabId: async () => 101,
          getTab: async () => ({ webContents: tab }),
          getWindowIdByWebContentsId: (webContentsId: number) =>
            webContentsId === 11 ? 1 : undefined
        }) as never
    )
    await targets.markRendererReady(11)

    const sent = await targets.send(
      {
        windowId: 1,
        webContentsId: 11,
        kind: 'main'
      },
      {
        kind: 'occur',
        episodeId: 'episode-1',
        intent: {
          code: 'mcp.connectionFailed',
          serverName: 'filesystem'
        }
      }
    )

    expect(sent).toBe(true)
    expect(sendToWebContents).toHaveBeenCalledOnce()
    expect(sendToWebContents).toHaveBeenCalledWith(
      11,
      'deepchat:event',
      expect.objectContaining({
        name: semanticNotificationEvent.name,
        payload: expect.objectContaining({
          kind: 'occur',
          episodeId: 'episode-1'
        })
      })
    )
  })

  it('rejects readiness from unmanaged renderer processes', async () => {
    electron.createContents(99, 9)
    const targets = new ElectronWindowNotificationTargets(
      {
        getAllWindows: () => [],
        getFocusedWindow: () => undefined,
        getSettingsWindowId: () => null,
        sendToWebContents: vi.fn(async () => true)
      },
      () => undefined
    )

    await expect(targets.markRendererReady(99)).resolves.toBe(false)
    await expect(targets.getTargetByWebContents(99)).resolves.toBeUndefined()
  })

  it('invalidates readiness across main-frame reloads and renderer crashes', async () => {
    const mainWindow = electron.createWindow(1, 10)
    const tab = electron.createContents(11)
    const onRendererUnavailable = vi.fn()
    const targets = new ElectronWindowNotificationTargets(
      {
        getAllWindows: () => [mainWindow] as never,
        getFocusedWindow: () => mainWindow as never,
        getSettingsWindowId: () => null,
        sendToWebContents: vi.fn(async () => true)
      },
      () =>
        ({
          getActiveTabId: async () => 101,
          getTab: async () => ({ webContents: tab }),
          getWindowIdByWebContentsId: (webContentsId: number) =>
            webContentsId === 11 ? 1 : undefined
        }) as never,
      onRendererUnavailable
    )

    await targets.markRendererReady(11)
    tab.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: true
    })
    expect(onRendererUnavailable).not.toHaveBeenCalled()

    tab.emit('did-start-navigation', {
      isMainFrame: true,
      isSameDocument: false
    })
    expect(onRendererUnavailable).toHaveBeenCalledWith(11)
    await expect(targets.getTargetByWebContents(11)).resolves.toBeUndefined()

    await targets.markRendererReady(11)
    tab.emit('render-process-gone')
    expect(onRendererUnavailable).toHaveBeenCalledTimes(2)
    await expect(targets.getTargetByWebContents(11)).resolves.toBeUndefined()
  })

  it('rejects a tab that moves windows while its delivery target is being resolved', async () => {
    const firstWindow = electron.createWindow(1, 10)
    const secondWindow = electron.createWindow(2, 20)
    const tab = electron.createContents(11)
    let ownerWindowId = 1
    let moveDuringLookup = false
    const sendToWebContents = vi.fn(async () => true)
    const targets = new ElectronWindowNotificationTargets(
      {
        getAllWindows: () => [firstWindow, secondWindow] as never,
        getFocusedWindow: () => firstWindow as never,
        getSettingsWindowId: () => null,
        sendToWebContents
      },
      () =>
        ({
          getActiveTabId: async () => 101,
          getTab: async () => {
            if (moveDuringLookup) ownerWindowId = 2
            return { webContents: tab }
          },
          getWindowIdByWebContentsId: (webContentsId: number) =>
            webContentsId === 11 ? ownerWindowId : undefined
        }) as never
    )

    await targets.markRendererReady(11)
    moveDuringLookup = true

    await expect(targets.getTargetForWindow(1)).resolves.toBeUndefined()
    await expect(
      targets.send(
        { windowId: 1, webContentsId: 11, kind: 'main' },
        {
          kind: 'recover',
          episodeId: 'episode-1'
        }
      )
    ).resolves.toBe(false)
    expect(sendToWebContents).not.toHaveBeenCalled()
  })
})
