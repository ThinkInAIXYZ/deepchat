import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_BUTTON_EVENTS } from '../../../../src/main/events'
import { getCollapsedWidgetSize, getExpandedWidgetSize } from '@/desktop/floatingButton/layout'
import type { SessionWithState } from '../../../../src/shared/types/agent-interface'
import { buildFloatingWidgetSnapshot } from '@/session/widgetSnapshot'
import type { FloatingWidgetSnapshot } from '@shared/types/floating-widget'

const {
  electronState,
  floatingWindowState,
  presenterState,
  webContentsSendMock,
  menuPopupMock,
  getAgentsMock,
  getSessionListMock
} = vi.hoisted(() => {
  const eventHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const invokeHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const workArea = {
    x: 0,
    y: 0,
    width: 1200,
    height: 900
  }

  const floatingWindowState = {
    bounds: { x: 1136, y: 180, width: 64, height: 64 },
    dockSide: 'right' as 'left' | 'right',
    opacity: 1,
    exists: true,
    instance: null as null | {
      create: ReturnType<typeof vi.fn>
      show: ReturnType<typeof vi.fn>
      destroy: ReturnType<typeof vi.fn>
      exists: ReturnType<typeof vi.fn>
      getState: ReturnType<typeof vi.fn>
      getBounds: ReturnType<typeof vi.fn>
      setBounds: ReturnType<typeof vi.fn>
      setOpacity: ReturnType<typeof vi.fn>
      getDockSide: ReturnType<typeof vi.fn>
      setDockSide: ReturnType<typeof vi.fn>
      getWindow: ReturnType<typeof vi.fn>
    },
    reset() {
      this.bounds = { x: 1136, y: 180, width: 64, height: 64 }
      this.dockSide = 'right'
      this.opacity = 1
      this.exists = true
      this.instance = null
    }
  }

  const presenterState = {
    sessions: [] as SessionWithState[],
    agents: [
      {
        id: 'deepchat',
        name: 'DeepChat',
        type: 'deepchat' as const,
        enabled: true,
        avatar: null
      },
      {
        id: 'acp-agent',
        name: 'ACP Agent',
        type: 'acp' as const,
        enabled: true,
        avatar: null,
        icon: 'https://example.com/acp-agent.svg'
      }
    ],
    reset() {
      this.sessions = []
    }
  }

  const webContentsSendMock = vi.fn()
  const menuPopupMock = vi.fn()
  const getAgentsMock = vi.fn(async () => presenterState.agents)
  const getSessionListMock = vi.fn(async () => presenterState.sessions)

  return {
    electronState: {
      frame: { url: 'http://localhost:5173/floating/' },
      workArea,
      eventHandlers,
      invokeHandlers,
      reset() {
        eventHandlers.clear()
        invokeHandlers.clear()
      }
    },
    floatingWindowState,
    presenterState,
    webContentsSendMock,
    menuPopupMock,
    getAgentsMock,
    getSessionListMock
  }
})

const BrowserWindow = vi.hoisted(() => class BrowserWindow {})

vi.mock('electron', () => ({
  BrowserWindow,
  ipcMain: {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.eventHandlers.set(channel, handler)
    }),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronState.invokeHandlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      electronState.invokeHandlers.delete(channel)
    }),
    removeAllListeners: vi.fn((channel: string) => {
      electronState.eventHandlers.delete(channel)
    })
  },
  screen: {
    getDisplayMatching: vi.fn(() => ({
      workArea: electronState.workArea
    }))
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({
      popup: menuPopupMock
    }))
  },
  app: {
    quit: vi.fn()
  }
}))

vi.mock('@/desktop/floatingButton/FloatingButtonWindow', () => ({
  FloatingButtonWindow: class MockFloatingButtonWindow {
    public create = vi.fn().mockResolvedValue(undefined)
    public show = vi.fn()
    public destroy = vi.fn()
    public exists = vi.fn(() => floatingWindowState.exists)
    public getState = vi.fn(() => null)
    public getBounds = vi.fn(() => ({ ...floatingWindowState.bounds }))
    public setBounds = vi.fn((bounds) => {
      floatingWindowState.bounds = { ...bounds }
    })
    public setOpacity = vi.fn((opacity: number) => {
      floatingWindowState.opacity = opacity
    })
    public getDockSide = vi.fn(() => floatingWindowState.dockSide)
    public setDockSide = vi.fn((dockSide: 'left' | 'right') => {
      floatingWindowState.dockSide = dockSide
    })
    private window = {
      id: 3,
      isDestroyed: () => false,
      webContents: {
        id: 1,
        mainFrame: electronState.frame,
        isDestroyed: () => false,
        getURL: () => electronState.frame.url,
        send: webContentsSendMock
      }
    }
    public getWindow = vi.fn(() => this.window)

    constructor() {
      floatingWindowState.instance = this as unknown as typeof floatingWindowState.instance
    }
  }
}))

import { FloatingButtonPresenter, type FloatingWidgetBusinessPort } from '@/desktop/floatingButton'

describe('FloatingButtonPresenter drag layout sync', () => {
  let floatingPresenter: FloatingButtonPresenter | null = null

  const createProviderSettings = () =>
    ({
      getLanguage: vi.fn(() => 'zh-CN'),
      listAgents: getAgentsMock,
      getAcpEnabled: vi.fn(async () => true)
    }) as any

  const createDesktopSettings = () => ({
    getFloatingButtonEnabled: vi.fn(() => true),
    getFloatingButtonBounds: vi.fn(() => null),
    setFloatingButtonBounds: vi.fn(async () => {}),
    getLanguage: vi.fn(() => 'zh-CN' as const),
    getCurrentThemeIsDark: vi.fn(async () => false)
  })

  const createFloatingPresenter = (
    providerSettings = createProviderSettings(),
    settings = createDesktopSettings(),
    business: FloatingWidgetBusinessPort = {
      getSnapshot: async () =>
        buildFloatingWidgetSnapshot(
          await getSessionListMock(),
          await providerSettings.listAgents(),
          false
        ),
      getRegistryIconMarkup: async () => '',
      openSession: async () => true
    }
  ) =>
    new FloatingButtonPresenter(
      settings,
      {
        mainWindow: null,
        windows: new Map(),
        getAllWindows: vi.fn(() => []),
        getFocusedWindow: vi.fn(() => null),
        createAppWindow: vi.fn(async () => null),
        show: vi.fn()
      } as any,
      { getWindowType: vi.fn(() => 'chat') } as any,
      business
    )

  const emitEvent = async (channel: string, payload?: unknown) => {
    const handler = electronState.eventHandlers.get(channel)
    if (!handler) {
      throw new Error(`Missing IPC handler for ${channel}`)
    }

    return await handler(
      { sender: { id: 1, isDestroyed: () => false }, senderFrame: electronState.frame },
      payload
    )
  }

  beforeEach(() => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    vi.useFakeTimers()
    electronState.reset()
    floatingWindowState.reset()
    presenterState.reset()
    webContentsSendMock.mockReset()
    menuPopupMock.mockReset()
    getAgentsMock.mockClear()
    getSessionListMock.mockClear()
  })

  afterEach(async () => {
    floatingPresenter?.destroy()
    floatingPresenter = null
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('acknowledges Native startup before a Core read and ignores a retired window reply', async () => {
    const held = Promise.withResolvers<FloatingWidgetSnapshot>()
    const fresh: FloatingWidgetSnapshot = { expanded: false, activeCount: 2, sessions: [] }
    const business = {
      getSnapshot: vi
        .fn()
        .mockImplementationOnce(() => held.promise)
        .mockResolvedValue(fresh),
      getRegistryIconMarkup: vi.fn(async () => ''),
      openSession: vi.fn(async () => true)
    }
    floatingPresenter = createFloatingPresenter(undefined, undefined, business)
    await floatingPresenter.initialize()
    const retired = floatingWindowState.instance!
    expect(retired.show).not.toHaveBeenCalled()
    const oldRead = floatingPresenter.refreshWidgetState()
    floatingPresenter.destroy()
    await floatingPresenter.enable()
    await floatingPresenter.refreshWidgetState()
    expect(floatingWindowState.instance?.show).toHaveBeenCalledOnce()
    held.resolve({ expanded: false, activeCount: 7, sessions: [] })
    await oldRead
    expect(retired.show).not.toHaveBeenCalled()
    const snapshot = await electronState.invokeHandlers.get(
      FLOATING_BUTTON_EVENTS.SNAPSHOT_REQUEST
    )!({ sender: { id: 1, isDestroyed: () => false }, senderFrame: electronState.frame })
    expect(snapshot).toEqual(fresh)
    const before = business.getSnapshot.mock.calls.length
    await expect(
      electronState.invokeHandlers.get(FLOATING_BUTTON_EVENTS.SNAPSHOT_REQUEST)!({
        sender: { id: 2, isDestroyed: () => false },
        senderFrame: electronState.frame
      })
    ).rejects.toThrow('caller retired')
    expect(business.getSnapshot).toHaveBeenCalledTimes(before)
  })

  it('applies acknowledged host appearance without reentering the pending core command', async () => {
    const settings = createDesktopSettings()
    floatingPresenter = createFloatingPresenter(createProviderSettings(), settings)
    await floatingPresenter.initialize()
    settings.getLanguage.mockClear()
    settings.getCurrentThemeIsDark.mockClear()
    settings.getCurrentThemeIsDark.mockRejectedValue(new Error('core command is awaiting host'))
    floatingPresenter.refreshLanguage('fa-IR')
    await floatingPresenter.refreshTheme(true)
    expect(webContentsSendMock).toHaveBeenCalledWith(
      FLOATING_BUTTON_EVENTS.LANGUAGE_CHANGED,
      'fa-IR'
    )
    expect(webContentsSendMock).toHaveBeenCalledWith(FLOATING_BUTTON_EVENTS.THEME_CHANGED, 'dark')
    expect(settings.getLanguage).not.toHaveBeenCalled()
    expect(settings.getCurrentThemeIsDark).not.toHaveBeenCalled()
  })

  it('keeps the collapsed size stable when dragging interrupts collapse animation', async () => {
    floatingPresenter = createFloatingPresenter()
    await floatingPresenter.initialize()
    await floatingPresenter.refreshWidgetState()

    expect(floatingWindowState.bounds).toMatchObject({
      x:
        electronState.workArea.x +
        electronState.workArea.width -
        getCollapsedWidgetSize(0).width / 2,
      y: 180,
      width: getCollapsedWidgetSize(0).width,
      height: getCollapsedWidgetSize(0).height
    })
    expect(floatingWindowState.opacity).toBe(0.5)

    await emitEvent(FLOATING_BUTTON_EVENTS.SET_EXPANDED, true)
    await vi.advanceTimersByTimeAsync(400)

    await emitEvent(FLOATING_BUTTON_EVENTS.SET_EXPANDED, false)
    await vi.advanceTimersByTimeAsync(160)

    expect(floatingWindowState.bounds.width).toBeGreaterThan(getCollapsedWidgetSize(0).width)

    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_START, { x: 100, y: 100 })
    expect(floatingWindowState.bounds).toMatchObject({
      x: electronState.workArea.x + electronState.workArea.width - getCollapsedWidgetSize(0).width,
      width: getCollapsedWidgetSize(0).width,
      height: getCollapsedWidgetSize(0).height
    })
    expect(floatingWindowState.opacity).toBe(1)

    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_MOVE, { x: 220, y: 150 })
    expect(floatingWindowState.bounds).toMatchObject({
      x: 1270,
      y: 230,
      width: getCollapsedWidgetSize(0).width,
      height: getCollapsedWidgetSize(0).height
    })

    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_END)
    expect(floatingWindowState.bounds).toMatchObject({
      x:
        electronState.workArea.x +
        electronState.workArea.width -
        getCollapsedWidgetSize(0).width / 2,
      y: 230,
      width: getCollapsedWidgetSize(0).width,
      height: getCollapsedWidgetSize(0).height
    })
    expect(floatingWindowState.opacity).toBe(0.5)
  })

  it('restores the persisted resting position on initialization', async () => {
    const settings = createDesktopSettings()
    floatingPresenter = createFloatingPresenter(createProviderSettings(), settings)
    await floatingPresenter.initialize()

    expect(settings.getFloatingButtonBounds).toHaveBeenCalled()
  })

  it('persists the docked resting position after a drag ends', async () => {
    const settings = createDesktopSettings()
    floatingPresenter = createFloatingPresenter(createProviderSettings(), settings)
    await floatingPresenter.initialize()

    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_START, { x: 100, y: 100 })
    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_MOVE, { x: 220, y: 150 })
    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_END)

    // Snapped/docked bounds (fully on-screen), not the peeked idle position.
    expect(settings.setFloatingButtonBounds).toHaveBeenCalledWith({
      x: electronState.workArea.x + electronState.workArea.width - getCollapsedWidgetSize(0).width,
      y: 230,
      dockSide: 'right'
    })
  })

  it('rejects drag writes from another window or a nested frame', async () => {
    const settings = createDesktopSettings()
    floatingPresenter = createFloatingPresenter(createProviderSettings(), settings)
    await floatingPresenter.initialize()
    const before = { ...floatingWindowState.bounds }
    for (const event of [
      { sender: { id: 999 }, senderFrame: electronState.frame },
      { sender: { id: 1 }, senderFrame: {} }
    ]) {
      electronState.eventHandlers.get(FLOATING_BUTTON_EVENTS.DRAG_START)!(event, { x: 100, y: 100 })
      electronState.eventHandlers.get(FLOATING_BUTTON_EVENTS.DRAG_MOVE)!(event, { x: 200, y: 200 })
      electronState.eventHandlers.get(FLOATING_BUTTON_EVENTS.DRAG_END)!(event)
    }
    expect(settings.setFloatingButtonBounds).not.toHaveBeenCalled()
    expect(floatingWindowState.bounds).toEqual(before)
  })

  it('loads all regular sessions without restricting the agent id', async () => {
    floatingPresenter = createFloatingPresenter()
    await floatingPresenter.initialize()

    expect(getSessionListMock).toHaveBeenCalledWith()
  })

  it('defers layout changes during drag and applies the latest snapshot after drop', async () => {
    floatingPresenter = createFloatingPresenter()
    await floatingPresenter.initialize()

    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_START, { x: 80, y: 90 })

    await emitEvent(FLOATING_BUTTON_EVENTS.SET_EXPANDED, true)
    presenterState.sessions = [
      {
        id: 'session-1',
        agentId: 'deepchat',
        title: 'Session 1',
        projectDir: null,
        isPinned: false,
        isDraft: false,
        sessionKind: 'regular',
        orchestrationPolicy: 'explicit',
        toolModeOverride: null,
        createdAt: 1,
        updatedAt: 10,
        status: 'idle',
        providerId: 'openai',
        modelId: 'gpt-5.4'
      },
      {
        id: 'session-2',
        agentId: 'deepchat',
        title: 'Session 2',
        projectDir: null,
        isPinned: false,
        isDraft: false,
        sessionKind: 'regular',
        orchestrationPolicy: 'explicit',
        toolModeOverride: null,
        createdAt: 2,
        updatedAt: 11,
        status: 'generating',
        providerId: 'openai',
        modelId: 'gpt-5.4'
      }
    ]

    await floatingPresenter.refreshWidgetState()
    expect(getAgentsMock).toHaveBeenCalled()
    expect(floatingWindowState.bounds).toMatchObject({
      width: getCollapsedWidgetSize(0).width,
      height: getCollapsedWidgetSize(0).height
    })

    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_MOVE, { x: 140, y: 170 })
    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_END)

    expect(floatingWindowState.bounds).toMatchObject({
      x: electronState.workArea.x + electronState.workArea.width - getExpandedWidgetSize(2).width,
      y: 260,
      width: getExpandedWidgetSize(2).width,
      height: getExpandedWidgetSize(2).height
    })
  })

  it('reveals the collapsed widget on hover and peeks it again on mouse leave', async () => {
    floatingPresenter = createFloatingPresenter()
    await floatingPresenter.initialize()
    await floatingPresenter.refreshWidgetState()

    expect(floatingWindowState.bounds.x).toBe(
      electronState.workArea.x + electronState.workArea.width - getCollapsedWidgetSize(0).width / 2
    )
    expect(floatingWindowState.opacity).toBe(0.5)

    await emitEvent(FLOATING_BUTTON_EVENTS.HOVER_STATE_CHANGED, true)
    await vi.advanceTimersByTimeAsync(400)

    expect(floatingWindowState.bounds.x).toBe(
      electronState.workArea.x + electronState.workArea.width - getCollapsedWidgetSize(0).width
    )
    expect(floatingWindowState.opacity).toBe(1)

    await emitEvent(FLOATING_BUTTON_EVENTS.HOVER_STATE_CHANGED, false)
    await vi.advanceTimersByTimeAsync(400)

    expect(floatingWindowState.bounds.x).toBe(
      electronState.workArea.x + electronState.workArea.width - getCollapsedWidgetSize(0).width / 2
    )
    expect(floatingWindowState.opacity).toBe(0.5)
  })

  it('finishes the close animation before applying the idle peek state', async () => {
    floatingPresenter = createFloatingPresenter()
    await floatingPresenter.initialize()

    const revealedX =
      electronState.workArea.x + electronState.workArea.width - getCollapsedWidgetSize(0).width
    const peekedX =
      electronState.workArea.x + electronState.workArea.width - getCollapsedWidgetSize(0).width / 2

    await emitEvent(FLOATING_BUTTON_EVENTS.HOVER_STATE_CHANGED, true)
    await vi.advanceTimersByTimeAsync(400)

    await emitEvent(FLOATING_BUTTON_EVENTS.SET_EXPANDED, true)
    await vi.advanceTimersByTimeAsync(400)

    await emitEvent(FLOATING_BUTTON_EVENTS.SET_EXPANDED, false)
    await vi.advanceTimersByTimeAsync(140)
    await emitEvent(FLOATING_BUTTON_EVENTS.HOVER_STATE_CHANGED, false)
    await vi.advanceTimersByTimeAsync(260)

    expect(floatingWindowState.bounds).toMatchObject({
      x: revealedX,
      y: 180,
      width: getCollapsedWidgetSize(0).width,
      height: getCollapsedWidgetSize(0).height
    })
    expect(floatingWindowState.opacity).toBe(1)

    await vi.advanceTimersByTimeAsync(200)

    expect(floatingWindowState.bounds.x).toBeGreaterThan(revealedX)
    expect(floatingWindowState.bounds.x).toBeLessThan(peekedX)
    expect(floatingWindowState.opacity).toBe(0.5)

    await vi.advanceTimersByTimeAsync(240)

    expect(floatingWindowState.bounds.x).toBe(peekedX)
    expect(floatingWindowState.opacity).toBe(0.5)
  })
})
