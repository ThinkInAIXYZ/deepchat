import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOATING_BUTTON_EVENTS } from '../../../../src/main/events'
import {
  getCollapsedWidgetSize,
  getExpandedWidgetSize
} from '../../../../src/main/presenter/floatingButtonPresenter/layout'
import type { SessionWithState } from '../../../../src/shared/types/agent-interface'

const { electronState, floatingWindowState, presenterState, sendToRendererMock, menuPopupMock } =
  vi.hoisted(() => {
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
      exists: true,
      instance: null as null | {
        create: ReturnType<typeof vi.fn>
        show: ReturnType<typeof vi.fn>
        destroy: ReturnType<typeof vi.fn>
        exists: ReturnType<typeof vi.fn>
        getState: ReturnType<typeof vi.fn>
        getBounds: ReturnType<typeof vi.fn>
        setBounds: ReturnType<typeof vi.fn>
        getDockSide: ReturnType<typeof vi.fn>
        setDockSide: ReturnType<typeof vi.fn>
        getWindow: ReturnType<typeof vi.fn>
      },
      reset() {
        this.bounds = { x: 1136, y: 180, width: 64, height: 64 }
        this.dockSide = 'right'
        this.exists = true
        this.instance = null
      }
    }

    const presenterState = {
      sessions: [] as SessionWithState[],
      reset() {
        this.sessions = []
      }
    }

    const sendToRendererMock = vi.fn()
    const menuPopupMock = vi.fn()

    return {
      electronState: {
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
      sendToRendererMock,
      menuPopupMock
    }
  })

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
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

vi.mock('../../../../src/main/presenter/floatingButtonPresenter/FloatingButtonWindow', () => ({
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
    public getDockSide = vi.fn(() => floatingWindowState.dockSide)
    public setDockSide = vi.fn((dockSide: 'left' | 'right') => {
      floatingWindowState.dockSide = dockSide
    })
    public getWindow = vi.fn(() => ({
      isDestroyed: () => false,
      webContents: {
        id: 1,
        send: sendToRendererMock
      }
    }))

    constructor() {
      floatingWindowState.instance = this as unknown as typeof floatingWindowState.instance
    }
  }
}))

vi.mock('../../../../src/main/presenter/index', () => ({
  presenter: {
    newAgentPresenter: {
      getSessionList: vi.fn(async () => presenterState.sessions),
      activateSession: vi.fn()
    },
    windowPresenter: {
      mainWindow: null,
      getAllWindows: vi.fn(() => []),
      getFocusedWindow: vi.fn(() => null),
      createAppWindow: vi.fn(async () => null),
      show: vi.fn()
    },
    tabPresenter: {
      getWindowType: vi.fn(() => 'chat')
    }
  }
}))

import { FloatingButtonPresenter } from '../../../../src/main/presenter/floatingButtonPresenter'

describe('FloatingButtonPresenter drag layout sync', () => {
  let floatingPresenter: FloatingButtonPresenter | null = null

  const createConfigPresenter = () =>
    ({
      getFloatingButtonEnabled: vi.fn(() => true),
      getLanguage: vi.fn(() => 'zh-CN'),
      getCurrentThemeIsDark: vi.fn(async () => false)
    }) as any

  const emitEvent = async (channel: string, payload?: unknown) => {
    const handler = electronState.eventHandlers.get(channel)
    if (!handler) {
      throw new Error(`Missing IPC handler for ${channel}`)
    }

    return await handler({}, payload)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    electronState.reset()
    floatingWindowState.reset()
    presenterState.reset()
    sendToRendererMock.mockReset()
    menuPopupMock.mockReset()
  })

  afterEach(async () => {
    floatingPresenter?.destroy()
    floatingPresenter = null
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
  })

  it('keeps the collapsed size stable when dragging interrupts collapse animation', async () => {
    floatingPresenter = new FloatingButtonPresenter(createConfigPresenter())
    await floatingPresenter.initialize()

    await emitEvent(FLOATING_BUTTON_EVENTS.SET_EXPANDED, true)
    await vi.advanceTimersByTimeAsync(400)

    await emitEvent(FLOATING_BUTTON_EVENTS.SET_EXPANDED, false)
    await vi.advanceTimersByTimeAsync(160)

    expect(floatingWindowState.bounds.width).toBeGreaterThan(getCollapsedWidgetSize(0).width)

    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_START, { x: 100, y: 100 })
    expect(floatingWindowState.bounds).toMatchObject({
      width: getCollapsedWidgetSize(0).width,
      height: getCollapsedWidgetSize(0).height
    })

    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_MOVE, { x: 220, y: 150 })
    expect(floatingWindowState.bounds).toMatchObject({
      x: 1256,
      y: 230,
      width: getCollapsedWidgetSize(0).width,
      height: getCollapsedWidgetSize(0).height
    })

    await emitEvent(FLOATING_BUTTON_EVENTS.DRAG_END)
    expect(floatingWindowState.bounds).toMatchObject({
      x: electronState.workArea.x + electronState.workArea.width - getCollapsedWidgetSize(0).width,
      y: 230,
      width: getCollapsedWidgetSize(0).width,
      height: getCollapsedWidgetSize(0).height
    })
  })

  it('defers layout changes during drag and applies the latest snapshot after drop', async () => {
    floatingPresenter = new FloatingButtonPresenter(createConfigPresenter())
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
        createdAt: 2,
        updatedAt: 11,
        status: 'generating',
        providerId: 'openai',
        modelId: 'gpt-5.4'
      }
    ]

    await floatingPresenter.refreshWidgetState()
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
})
