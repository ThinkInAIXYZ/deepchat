import { contextBridge, ipcRenderer } from 'electron'
import type { FloatingWidgetSnapshot } from '@shared/types/floating-widget'

// Define event constants directly to avoid path resolution issues
const FLOATING_BUTTON_EVENTS = {
  CLICKED: 'floating-button:clicked',
  RIGHT_CLICKED: 'floating-button:right-clicked',
  SNAPSHOT_REQUEST: 'floating-button:snapshot-request',
  SNAPSHOT_UPDATED: 'floating-button:snapshot-updated',
  LANGUAGE_REQUEST: 'floating-button:language-request',
  LANGUAGE_CHANGED: 'floating-button:language-changed',
  THEME_REQUEST: 'floating-button:theme-request',
  THEME_CHANGED: 'floating-button:theme-changed',
  TOGGLE_EXPANDED: 'floating-button:toggle-expanded',
  SET_EXPANDED: 'floating-button:set-expanded',
  OPEN_SESSION: 'floating-button:open-session',
  DRAG_START: 'floating-button:drag-start',
  DRAG_MOVE: 'floating-button:drag-move',
  DRAG_END: 'floating-button:drag-end'
} as const

// Define floating button API
const floatingButtonAPI = {
  // Backward-compatible click entry; now toggles the floating widget panel.
  onClick: () => {
    try {
      ipcRenderer.send(FLOATING_BUTTON_EVENTS.TOGGLE_EXPANDED)
    } catch (error) {
      console.error('FloatingPreload: Error sending IPC message:', error)
    }
  },

  onRightClick: () => {
    try {
      ipcRenderer.send(FLOATING_BUTTON_EVENTS.RIGHT_CLICKED)
    } catch (error) {
      console.error('FloatingPreload: Error sending right click IPC message:', error)
    }
  },

  getSnapshot: async (): Promise<FloatingWidgetSnapshot> => {
    return await ipcRenderer.invoke(FLOATING_BUTTON_EVENTS.SNAPSHOT_REQUEST)
  },

  getLanguage: async (): Promise<string> => {
    return await ipcRenderer.invoke(FLOATING_BUTTON_EVENTS.LANGUAGE_REQUEST)
  },

  getTheme: async (): Promise<'dark' | 'light'> => {
    return await ipcRenderer.invoke(FLOATING_BUTTON_EVENTS.THEME_REQUEST)
  },

  toggleExpanded: () => {
    ipcRenderer.send(FLOATING_BUTTON_EVENTS.TOGGLE_EXPANDED)
  },

  setExpanded: (expanded: boolean) => {
    ipcRenderer.send(FLOATING_BUTTON_EVENTS.SET_EXPANDED, expanded)
  },

  openSession: (sessionId: string) => {
    ipcRenderer.send(FLOATING_BUTTON_EVENTS.OPEN_SESSION, sessionId)
  },

  // Drag-related API
  onDragStart: (x: number, y: number) => {
    try {
      ipcRenderer.send(FLOATING_BUTTON_EVENTS.DRAG_START, { x, y })
    } catch (error) {
      console.error('FloatingPreload: Error sending drag start IPC message:', error)
    }
  },

  onDragMove: (x: number, y: number) => {
    try {
      ipcRenderer.send(FLOATING_BUTTON_EVENTS.DRAG_MOVE, { x, y })
    } catch (error) {
      console.error('FloatingPreload: Error sending drag move IPC message:', error)
    }
  },

  onDragEnd: (x: number, y: number) => {
    try {
      ipcRenderer.send(FLOATING_BUTTON_EVENTS.DRAG_END, { x, y })
    } catch (error) {
      console.error('FloatingPreload: Error sending drag end IPC message:', error)
    }
  },

  // Listen to events from main process
  onSnapshotUpdate: (callback: (snapshot: FloatingWidgetSnapshot) => void) => {
    ipcRenderer.on(FLOATING_BUTTON_EVENTS.SNAPSHOT_UPDATED, (_event, snapshot) => {
      callback(snapshot)
    })
  },

  onLanguageChanged: (callback: (language: string) => void) => {
    ipcRenderer.on(FLOATING_BUTTON_EVENTS.LANGUAGE_CHANGED, (_event, language) => {
      callback(language)
    })
  },

  onThemeChanged: (callback: (theme: 'dark' | 'light') => void) => {
    ipcRenderer.on(FLOATING_BUTTON_EVENTS.THEME_CHANGED, (_event, theme) => {
      callback(theme)
    })
  },

  onConfigUpdate: (callback: (config: Record<string, unknown>) => void) => {
    ipcRenderer.on('floating-button-config-update', (_event, config) => {
      callback(config)
    })
  },

  // Remove event listeners
  removeAllListeners: () => {
    console.log('FloatingPreload: Removing all listeners')
    ipcRenderer.removeAllListeners(FLOATING_BUTTON_EVENTS.SNAPSHOT_UPDATED)
    ipcRenderer.removeAllListeners(FLOATING_BUTTON_EVENTS.LANGUAGE_CHANGED)
    ipcRenderer.removeAllListeners(FLOATING_BUTTON_EVENTS.THEME_CHANGED)
    ipcRenderer.removeAllListeners('floating-button-config-update')
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
