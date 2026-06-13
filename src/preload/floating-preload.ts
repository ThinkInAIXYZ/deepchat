import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { FLOATING_BUTTON_EVENTS } from '@shared/floatingButtonChannels'
import type { FloatingWidgetSnapshot } from '@shared/types/floating-widget'

const EMPTY_SNAPSHOT: FloatingWidgetSnapshot = {
  expanded: false,
  activeCount: 0,
  sessions: []
}

type Unsubscribe = () => void
type FloatingTheme = 'dark' | 'light'
type FloatingEventCallback<T> = (payload: T) => void
type FloatingEventParser<T> = (payload: unknown) => T | null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isTheme = (value: unknown): value is FloatingTheme => value === 'dark' || value === 'light'

const isFloatingWidgetSnapshot = (value: unknown): value is FloatingWidgetSnapshot => {
  if (!isRecord(value)) {
    return false
  }

  const activeCount = value.activeCount

  return (
    typeof value.expanded === 'boolean' &&
    typeof activeCount === 'number' &&
    Number.isInteger(activeCount) &&
    activeCount >= 0 &&
    Array.isArray(value.sessions) &&
    value.sessions.every((session) => {
      if (!isRecord(session) || !isRecord(session.agent)) {
        return false
      }

      return (
        isNonEmptyString(session.id) &&
        typeof session.title === 'string' &&
        isFiniteCoordinate(session.updatedAt) &&
        (session.status === 'in_progress' ||
          session.status === 'done' ||
          session.status === 'error') &&
        isNonEmptyString(session.agent.id) &&
        typeof session.agent.name === 'string' &&
        typeof session.agent.type === 'string'
      )
    })
  )
}

const parseSnapshot: FloatingEventParser<FloatingWidgetSnapshot> = (payload) =>
  isFloatingWidgetSnapshot(payload) ? payload : null

const parseLanguage: FloatingEventParser<string> = (payload) =>
  isNonEmptyString(payload) ? payload : null

const parseTheme: FloatingEventParser<FloatingTheme> = (payload) =>
  isTheme(payload) ? payload : null

const warnInvalidPayload = (channel: string) => {
  console.warn(`FloatingPreload: Ignoring invalid payload for ${channel}`)
}

const sendMessage = (channel: string, ...args: unknown[]) => {
  try {
    ipcRenderer.send(channel, ...args)
  } catch (error) {
    console.error(`FloatingPreload: Error sending ${channel}:`, error)
  }
}

const sendBooleanMessage = (channel: string, value: unknown) => {
  if (typeof value !== 'boolean') {
    warnInvalidPayload(channel)
    return
  }

  sendMessage(channel, value)
}

const sendPointMessage = (channel: string, x: unknown, y: unknown) => {
  if (!isFiniteCoordinate(x) || !isFiniteCoordinate(y)) {
    warnInvalidPayload(channel)
    return
  }

  sendMessage(channel, { x, y })
}

const onFloatingEvent = <T>(
  channel: string,
  parse: FloatingEventParser<T>,
  callback: FloatingEventCallback<T>
): Unsubscribe => {
  const listener = (_event: IpcRendererEvent, payload: unknown) => {
    const parsedPayload = parse(payload)
    if (parsedPayload === null) {
      warnInvalidPayload(channel)
      return
    }

    callback(parsedPayload)
  }

  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

// Define floating button API
const floatingButtonAPI = {
  // Backward-compatible click entry; now toggles the floating widget panel.
  onClick: () => {
    sendMessage(FLOATING_BUTTON_EVENTS.TOGGLE_EXPANDED)
  },

  onRightClick: () => {
    sendMessage(FLOATING_BUTTON_EVENTS.RIGHT_CLICKED)
  },

  getSnapshot: async (): Promise<FloatingWidgetSnapshot> => {
    const snapshot = parseSnapshot(
      await ipcRenderer.invoke(FLOATING_BUTTON_EVENTS.SNAPSHOT_REQUEST)
    )
    if (!snapshot) {
      warnInvalidPayload(FLOATING_BUTTON_EVENTS.SNAPSHOT_REQUEST)
      return { ...EMPTY_SNAPSHOT }
    }

    return snapshot
  },

  getLanguage: async (): Promise<string> => {
    const language = parseLanguage(
      await ipcRenderer.invoke(FLOATING_BUTTON_EVENTS.LANGUAGE_REQUEST)
    )
    return language ?? 'en-US'
  },

  getTheme: async (): Promise<FloatingTheme> => {
    const theme = parseTheme(await ipcRenderer.invoke(FLOATING_BUTTON_EVENTS.THEME_REQUEST))
    return theme ?? 'dark'
  },

  getAcpRegistryIconMarkup: async (agentId: string, iconUrl: string): Promise<string> => {
    if (!isNonEmptyString(agentId) || !isNonEmptyString(iconUrl)) {
      return ''
    }

    const markup = await ipcRenderer.invoke(FLOATING_BUTTON_EVENTS.ACP_REGISTRY_ICON_REQUEST, {
      agentId: agentId.trim(),
      iconUrl: iconUrl.trim()
    })
    return typeof markup === 'string' ? markup : ''
  },

  toggleExpanded: () => {
    sendMessage(FLOATING_BUTTON_EVENTS.TOGGLE_EXPANDED)
  },

  setExpanded: (expanded: boolean) => {
    sendBooleanMessage(FLOATING_BUTTON_EVENTS.SET_EXPANDED, expanded)
  },

  setHovering: (hovering: boolean) => {
    sendBooleanMessage(FLOATING_BUTTON_EVENTS.HOVER_STATE_CHANGED, hovering)
  },

  openSession: (sessionId: string) => {
    if (!isNonEmptyString(sessionId)) {
      warnInvalidPayload(FLOATING_BUTTON_EVENTS.OPEN_SESSION)
      return
    }

    sendMessage(FLOATING_BUTTON_EVENTS.OPEN_SESSION, sessionId.trim())
  },

  // Drag-related API
  onDragStart: (x: number, y: number) => {
    sendPointMessage(FLOATING_BUTTON_EVENTS.DRAG_START, x, y)
  },

  onDragMove: (x: number, y: number) => {
    sendPointMessage(FLOATING_BUTTON_EVENTS.DRAG_MOVE, x, y)
  },

  onDragEnd: (x: number, y: number) => {
    sendPointMessage(FLOATING_BUTTON_EVENTS.DRAG_END, x, y)
  },

  // Listen to events from main process
  onSnapshotUpdate: (callback: (snapshot: FloatingWidgetSnapshot) => void) => {
    return onFloatingEvent(FLOATING_BUTTON_EVENTS.SNAPSHOT_UPDATED, parseSnapshot, callback)
  },

  onLanguageChanged: (callback: (language: string) => void) => {
    return onFloatingEvent(FLOATING_BUTTON_EVENTS.LANGUAGE_CHANGED, parseLanguage, callback)
  },

  onThemeChanged: (callback: (theme: FloatingTheme) => void) => {
    return onFloatingEvent(FLOATING_BUTTON_EVENTS.THEME_CHANGED, parseTheme, callback)
  }
}

// Try different ways to expose API
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('floatingButtonAPI', floatingButtonAPI)
  } catch (error) {
    console.error('=== FloatingPreload: Error exposing API via contextBridge ===:', error)
  }
} else {
  try {
    ;(window as any).floatingButtonAPI = floatingButtonAPI
  } catch (error) {
    console.error('=== FloatingPreload: Error attaching API to window ===:', error)
  }
}
